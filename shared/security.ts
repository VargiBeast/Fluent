/** Phishing / fake-invoice assessment of one received message (server/security/phish.ts). */
export interface SecuritySignal {
  code: string;
  severity: "high" | "medium" | "low";
  /** Plain-language reason, shown to the user as is. */
  text: string;
}

export interface SecurityAssessment {
  level: "safe" | "caution" | "danger";
  signals: SecuritySignal[];
  /** Gmail's SPF/DKIM/DMARC results when the message carries them. */
  auth: { spf: string | null; dkim: string | null; dmarc: string | null } | null;
}

/** Copilot's plain-language second opinion. */
export interface SecurityReview {
  verdict: "likely_safe" | "suspicious" | "likely_phishing";
  reasons: string[];
  advice: string;
}
