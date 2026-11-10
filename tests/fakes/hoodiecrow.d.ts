declare module "hoodiecrow-imap" {
  import type { AddressInfo } from "node:net";
  interface HoodiecrowServer {
    listen(port: number, host: string, cb: () => void): void;
    close(cb: () => void): void;
    address(): AddressInfo | string | null;
  }
  export default function hoodiecrow(options: Record<string, unknown>): HoodiecrowServer;
}
