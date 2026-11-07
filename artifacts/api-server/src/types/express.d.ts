declare global {
  namespace Express {
    interface Request {
      fluent?: {
        userId: string;
        sessionId: string;
        email: string;
        displayName: string | null;
        isDemo: boolean;
        onboarded: boolean;
        csrfHash: string;
      };
      authFailure?: "expired" | "revoked";
    }
    interface Locals {
      fetchImpl?: typeof fetch;
    }
  }
}

export {};
