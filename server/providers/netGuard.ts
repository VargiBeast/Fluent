import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { getEnv, isProduction } from "../env.js";
import { HttpError } from "../lib/errors.js";
import { isPublicAddress } from "../lib/oneClick.js";

/** Where to open the socket: a validated IP (pinned), plus the name for TLS SNI and certificate checks. */
export interface PinnedTarget {
  address: string;
  port: number;
  servername: string;
  /** Only true for the loopback test fakes; production always uses TLS. */
  plaintext: boolean;
}

const ALLOWED_PORTS = new Set([993, 465, 587]);

function testPorts(): Map<number, number> | null {
  const raw = getEnv().MAILIQ_TEST_MAIL_PORTS;
  if (isProduction() || !raw) return null;
  return new Map(raw.split(",").map((p) => p.split("=").map(Number) as [number, number]));
}

const blocked = () => new HttpError(400, "mail_server_blocked", "That mail server address isn't allowed. Use your provider's public IMAP/SMTP server name.");

/**
 * Resolve a mail server name once, refuse private/loopback/link-local/reserved addresses, and return the IP to
 * connect to. The caller connects to that exact IP (with SNI = the name), so a DNS answer that changes between
 * this check and the connection (rebinding) can't redirect it. Only ports 993, 465 and 587.
 */
export async function pinMailServer(host: string, port: number): Promise<PinnedTarget> {
  if (!ALLOWED_PORTS.has(port)) throw blocked();
  if (isIP(host)) throw blocked(); // names only, so TLS certificates can be verified
  const test = testPorts();
  if (test && host.endsWith(".fluent.test")) {
    const mapped = test.get(port);
    if (!mapped) throw blocked();
    return { address: "127.0.0.1", port: mapped, servername: host, plaintext: true };
  }
  let addrs: Array<{ address: string }>;
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new HttpError(400, "mail_server_unknown", `Couldn't find the mail server ${host}.`);
  }
  if (!addrs.length || addrs.some((a) => !isPublicAddress(a.address))) throw blocked();
  return { address: addrs[0]!.address, port, servername: host, plaintext: false };
}
