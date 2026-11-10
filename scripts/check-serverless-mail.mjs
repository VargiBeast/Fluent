/* global process, console */
// Proves the IMAP/SMTP stack (imapflow, nodemailer, mailparser) bundles for Vercel's Node runtime and runs as
// short-lived, per-invocation connections:
//  1. bundles the real Vercel entry (api/index.ts) for node20 with every dependency inlined, then imports it and
//     serves one request from a directory without node_modules;
//  2. bundles a probe that uses the IMAP/SMTP code, runs two "invocations" against local fakes, and checks the
//     process exits on its own (no sockets left open between invocations).
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "fluent-serverless-"));
const common = { bundle: true, platform: "node", target: "node20", format: "esm", logLevel: "error", banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" } };
try {
  await build({ ...common, entryPoints: ["api/index.ts"], outfile: join(dir, "api.mjs") });
  await build({ ...common, entryPoints: ["tests/serverless/probe.ts"], outfile: join(dir, "probe.mjs") });
  const env = { PATH: process.env.PATH, NODE_ENV: "test", APP_URL: "http://localhost:5173", DATABASE_URL: "postgres://u:p@127.0.0.1:1/none", TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"), LOG_LEVEL: "silent" };

  writeFileSync(join(dir, "run-api.mjs"), `const m = await import("./api.mjs"); const r = await m.GET(new Request("http://localhost/api/mail-accounts/providers")); console.log(JSON.stringify({ status: r.status }));`);
  const api = JSON.parse(execFileSync("node", ["run-api.mjs"], { cwd: dir, env, timeout: 30_000 }).toString().trim().split("\n").pop());
  if (api.status !== 401) throw new Error(`bundled API answered ${api.status}, expected 401 (signed out)`);
  console.log("✓ api/index.ts bundles for node20 with imapflow/nodemailer/mailparser inlined and serves requests");

  // Fakes run in this process (they need node_modules); the probe runs in the bare directory.
  const { startFakeMailServers } = await import("../tests/fakes/mailServers.ts"); // run via tsx
  const mail = await startFakeMailServers("pw-probe");
  try {
    writeFileSync(join(dir, "run-probe.mjs"), `const p = await import("./probe.mjs"); const a = await p.invoke("pw-probe"); const b = await p.invoke("pw-probe"); const c = await p.blocked(); console.log(JSON.stringify({ a, b, c }));`);
    const out = await new Promise((resolve, reject) => {
      import("node:child_process").then(({ execFile }) => execFile("node", ["run-probe.mjs"], {
        cwd: dir, timeout: 30_000, env: { ...env, FLUENT_TEST_MAIL_PORTS: `993=${mail.imapPort},465=${mail.smtpPort}` },
      }, (err, stdout) => (err ? reject(err) : resolve(JSON.parse(stdout.trim().split("\n").pop())))));
    });
    if (out.a.messages !== 2 || out.b.messages !== 2) throw new Error(`probe read ${out.a.messages}/${out.b.messages} messages`);
    if (mail.sent.length !== 2) throw new Error(`probe sent ${mail.sent.length} messages`);
    if (out.c.join() !== "mail_server_blocked,mail_server_blocked") throw new Error(`unsafe hosts not blocked: ${out.c}`);
    console.log("✓ bundled IMAP/SMTP ran two invocations without node_modules, closed its connections and blocked unsafe hosts");
  } finally {
    await mail.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
