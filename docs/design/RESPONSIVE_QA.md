# Responsive QA

Final local pass after the login proportion and in-flow mobile bar fixes. No public URL. External hosts for Google fonts, Google APIs, and the default model host were blocked in Chrome. Only `localhost` was used.

## Commands

API, from `artifacts/api-server`:

`PORT=8080 FLUENT_DEMO_MODE=true FLUENT_DB=pglite AI_PROVIDER=mock NODE_ENV=development APP_ORIGIN=http://localhost:20126 pnpm exec tsx src/index.ts`

Web, from `artifacts/mail`:

`PORT=20126 BASE_PATH=/ pnpm exec vite --host 127.0.0.1 --port 20126`

Browser: headless Chrome, DevTools protocol, `--host-resolver-rules` blocking `fonts.googleapis.com`, `fonts.gstatic.com`, `accounts.google.com`, `www.googleapis.com`, `oauth2.googleapis.com`, and `api.openai.com`.

A capture was kept only when `location.pathname`, `[data-screen]`, and the visible `h1` matched the route. App routes were rejected if the login demo button was on screen.

## Matrix

Widths 320, 390, 768, 1366, and 1920. Height 844 below 800px, otherwise 1000. Each cell passed, including no horizontal overflow (`scrollWidth` was not greater than `clientWidth + 1`).

| Screen | Heading checked | 320 | 390 | 768 | 1366 | 1920 |
|---|---|---|---|---|---|---|
| `/` welcome | Email, without the effort. | pass | pass | pass | pass | pass |
| `/login` | Email, without the effort. | pass | pass | pass | pass | pass |
| `/onboarding` | Two different permissions | pass | pass | pass | pass | pass |
| `/overview` | Overview | pass | pass | pass | pass | pass |
| `/inbox` | Inbox | pass | pass | pass | pass | pass |
| `/sent` | Sent | pass | pass | pass | pass | pass |
| `/copilot` | Copilot | pass | pass | pass | pass | pass |
| `/compose` | Compose | pass | pass | pass | pass | pass |
| `/settings` | Settings | pass | pass | pass | pass | pass |
| `/inbox/:id` thread | Thread title, not Inbox | pass | pass | pass | pass | pass |

Files: `/opt/cursor/artifacts/fluent-qa/<screen>-<width>.png`. Summary: `/opt/cursor/artifacts/fluent-qa/results.json`. 50 captures, 0 failed.

## Interactions in the same signed-in session

- Pagination at 390: inbox showed 2 cards, then 4 after Load next page.
- Star: a later check toggled the first card from Star to Unstar. The matrix script’s star assertion failed once because that row was already starred and the click cleared it. The control does toggle.
- Read/unread control was clicked.
- Search “invoice” stayed on Inbox and showed Northwind plus the rules-interpreter note.
- At 390, scrolling the workspace to the top, middle, and bottom found no inbox action intersecting the bottom bar.
- More opened as a modal, then Sent and Settings showed those headings.
- Archive dialog contained focus, Escape closed it, and focus returned to Archive. The next Tab target had a 2px solid outline.
- Draft: unsaved, saved, edited, updated, reopened with “Updated visual QA body.”
- `/inbox/not-a-real-thread` showed the alert “Something went wrong”.
- `Emulation.setEmulatedMedia` with `prefers-reduced-motion: reduce` made the measured animation name `none` and duration `0s`. The operating-system setting was not changed.
- Composited contrast on the inbox, after solid fills for the current nav item, pressed chip, and primary button: 0 pairs under 4.5:1 for normal text or 3:1 for large text in the sampled elements. An earlier pass reported 4 failures because translucent and gradient backgrounds were not composited. That was a measurement error, then the fills were made solid and remeasured.

## Not claimed

No real Gmail page, no live model, no hosted deploy, and no operating-system reduced-motion toggle. A full screen-reader pass was not recorded.
