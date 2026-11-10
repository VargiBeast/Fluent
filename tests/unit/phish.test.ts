import { describe, expect, it } from "vitest";
import { assessMessage, lookalikeOf, type PhishInput } from "../../server/security/phish.js";

const base: PhishInput = { fromName: "Brightline Billing", fromEmail: "billing@brightline.example", replyTo: [], subject: "Your invoice", text: "Invoice attached. Due in 14 days.", html: null, attachments: ["INV-1.pdf"], authResults: ["mx.google.com; spf=pass smtp.mailfrom=brightline.example; dkim=pass; dmarc=pass"] };
const codes = (m: Partial<PhishInput>) => assessMessage({ ...base, ...m }).signals.map((s) => s.code);

describe("lookalikeOf", () => {
  it.each([["paypa1.com", "paypal"], ["paypal-secure.net", "paypal"], ["paypal.co", "paypal"], ["amazom.com", "amazon"], ["g00gle.com", "google"], ["secure-netflix.info", "netflix"]])("%s imitates %s", (h, b) => {
    expect(lookalikeOf(h)).toBe(b);
  });
  it.each(["paypal.com", "mail.paypal.com", "amazon.de", "accounts.google.com", "s3.amazonaws.com", "lh3.googleusercontent.com", "poster.com", "applebees.com", "brightline.example", "ups.com"])("%s is fine", (h) => {
    expect(lookalikeOf(h)).toBeNull();
  });
});

describe("assessMessage", () => {
  it("an ordinary invoice with passing auth is safe", () => {
    expect(assessMessage(base)).toMatchObject({ level: "safe", signals: [], auth: { spf: "pass", dkim: "pass", dmarc: "pass" } });
  });

  it("flags failed authentication in plain language, trusting Gmail's own header over a forged one", () => {
    const a = assessMessage({ ...base, authResults: ["mx.google.com; spf=softfail; dkim=none; dmarc=fail", "attacker.example; spf=pass; dkim=pass; dmarc=pass"] });
    expect(a.level).toBe("danger");
    expect(a.signals[0]).toMatchObject({ code: "dmarc_fail", severity: "high" });
    expect(a.signals[0]!.text).toMatch(/couldn't verify/);
    expect(a.signals.map((s) => s.code)).toContain("spf_fail");
  });

  it("missing authentication results are not a signal", () => {
    expect(codes({ authResults: [] })).toEqual([]);
  });

  it("lookalike sender domains and brand names on the wrong domain", () => {
    expect(codes({ fromName: "PayPal", fromEmail: "service@paypa1.com" })).toContain("lookalike_sender");
    expect(codes({ fromName: "PayPal Security", fromEmail: "alerts@secure-mail.example" })).toContain("brand_name_mismatch");
    expect(codes({ fromName: "PayPal", fromEmail: "service@paypal.com" })).toEqual([]);
    expect(codes({ fromEmail: "x@xn--pypal-4ve.com" })).toContain("punycode_sender");
    expect(codes({ fromName: "ceo@northwind.example", fromEmail: "ceo@gmail-mailer.example" })).toContain("name_shows_other_address");
  });

  it("reply-to on another domain", () => {
    expect(codes({ replyTo: ["pay@collect-now.example"] })).toContain("reply_to_mismatch");
    expect(codes({ replyTo: ["support@mail.brightline.example"] })).not.toContain("reply_to_mismatch");
  });

  it("links: shown vs real destination, brand lookalikes, IPs, shorteners", () => {
    const a = assessMessage({ ...base, html: '<a href="https://paypal.account-verify.example/login">www.paypal.com</a>' });
    expect(a.signals.find((s) => s.code === "link_text_mismatch")).toMatchObject({ severity: "high" });
    const nl = assessMessage({ ...base, html: '<a href="https://click.tracker.example/abc">brightline.example/blog</a>' });
    expect(nl.signals.find((s) => s.code === "link_text_mismatch")).toMatchObject({ severity: "medium" });
    expect(nl.level).toBe("caution");
    expect(codes({ html: '<a href="http://192.168.4.20/pay">Pay</a>' })).toContain("ip_link");
    expect(codes({ html: '<a href="https://paypa1-login.com/x">Log in</a>' })).toContain("lookalike_link");
    expect(codes({ html: '<a href="https://bit.ly/x">here</a>' })).toContain("shortened_link");
    expect(codes({ html: '<a href="https://brightline.example/pay">brightline.example/pay</a> <a href="javascript:x">www.paypal.com</a>' })).toEqual([]);
  });

  it("fake invoices: changed bank details, risky attachments, payment plus red flags", () => {
    const a = assessMessage({ ...base, text: "Please note we have new bank details. Pay the overdue invoice to the IBAN below today." });
    expect(a.level).toBe("danger");
    expect(a.signals[0]!.code).toBe("changed_bank_details");
    expect(codes({ attachments: ["Invoice_0931.html"] })).toContain("risky_attachment");
    expect(codes({ replyTo: ["ap@other.example"], text: "Invoice overdue, payment required." })).toContain("payment_with_red_flags");
  });

  it("credential requests and urgency", () => {
    const a = assessMessage({ ...base, subject: "Unusual sign-in activity", text: "Verify your account within 24 hours or your account will be suspended. Confirm your password here." });
    expect(a.signals.map((s) => s.code)).toEqual(expect.arrayContaining(["asks_credentials", "urgency"]));
    expect(a.level).not.toBe("safe");
  });
});
