import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const config = JSON.parse(readFileSync(path.join(root, "vercel.json"), "utf8")) as {
  services: Record<string, { root: string; bindings?: unknown; rewrites?: Array<{ destination: string }> }>;
  rewrites: Array<{ source: string; destination: { service?: string } | string }>;
};

const serviceName = /^[a-z]([a-z_-]*[a-z])?$/;
const forbiddenAtRoot = [
  "framework",
  "installCommand",
  "buildCommand",
  "devCommand",
  "ignoreCommand",
  "outputDirectory",
  "functions",
];

describe("vercel services config", () => {
  it("keeps build settings on services and routes /api before the site", () => {
    for (const key of forbiddenAtRoot) {
      assert.equal(key in config, false, key);
    }
    for (const name of Object.keys(config.services)) {
      assert.match(name, serviceName);
      assert.equal(config.services[name].bindings, undefined);
    }
    assert.deepEqual(
      config.rewrites.map((rule) => [rule.source, typeof rule.destination === "string" ? rule.destination : rule.destination.service]),
      [
        ["/api/(.*)", "api-server"],
        ["/(.*)", "mail"],
      ],
    );
    assert.equal(
      config.rewrites.some((rule) => JSON.stringify(rule).includes("mockup-sandbox")),
      false,
    );
    const mailFallback = config.services.mail.rewrites?.map((rule) => rule.destination);
    assert.deepEqual(mailFallback, ["/index.html"]);
  });

  it("does not publish a root function that would own /api before the service rewrite", () => {
    assert.equal(existsSync(path.join(root, "api")), false);
  });
});
