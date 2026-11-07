# Security notes

- Sessions are random tokens. The database stores SHA-256 hashes. The cookie is httpOnly, SameSite=Lax, and Secure in production.
- Mutations require the `Origin` to match `APP_ORIGIN` and, when a session exists, an `x-fluent-csrf` header that matches both the cookie and the session hash.
- Product queries run as `fluent_app` with forced RLS. The browser never supplies the user id that is trusted.
- `withOwner` is only for session lookup and OAuth state, where the user is not known yet. Mailbox reads do not use it.
- CORS allows only `APP_ORIGIN`.
- The API rate limiter is in-memory. It does not coordinate across multiple serverless instances. Put a shared limiter in front before a public launch.
- Email HTML is sanitized on write. The reader renders it in a sandboxed iframe with a CSP. Remote images are removed unless the user opts in, and the default frame CSP still blocks them.
- Logs redact cookies, authorization, CSRF, tokens, and message bodies. Audit rows do not store bodies.
- Archive removes `INBOX`. Trash adds `TRASH` and, for Gmail, calls threads.trash. There is no permanent delete and no send route.
- AI output is schema-checked. Tool calls are rejected. Injected instructions in mail are treated as untrusted text.
- `pnpm --filter @workspace/db run push` and `push-force` exit with an error. The post-merge hook only installs dependencies.
