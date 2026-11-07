# Responsive QA

Local only. API: `PORT=8080 FLUENT_DEMO_MODE=true FLUENT_DB=pglite AI_PROVIDER=mock NODE_ENV=development APP_ORIGIN=http://localhost:20126 pnpm exec tsx src/index.ts` from `artifacts/api-server`.

Web: `PORT=20126 BASE_PATH=/ pnpm exec vite --host 127.0.0.1 --port 20126` from `artifacts/mail`.

Browser: headless Chrome with the DevTools protocol. The page was `http://localhost:20126`. No public URL.

## Matrix

Widths: 320, 390, 768, 1366, 1920. Height 844 below 800px and 1000 otherwise.

Screens captured at each width: welcome, login, onboarding, overview, inbox, sent, copilot, compose, settings, and the first thread. Files are `/opt/cursor/artifacts/fluent-qa/<screen>-<width>.png`.

First pass: the demo click ran before the Vite bundle had hydrated, so later routes rendered the login page. That pass also found horizontal overflow of 24px on the login layout and a thread header that did not wrap at 320 and 390 (scrollWidth 407 and 406).

After the layout fix, a signed-in recheck reported scrollWidth equal to clientWidth for:

- login 1366
- welcome 1366
- inbox 320 and 390
- thread 320 and 390
- overview 1366 (1351 with the scrollbar, still equal to clientWidth)
- compose 1366
- settings 768
- sent 1920
- copilot 768

## Interactions that were exercised in the browser

- Demo sign-in reached `/overview` with the synthetic banner and `demo@fluent.invalid`.
- Search for “invoice” showed Northwind and the rules-interpreter note.
- Archive opened the confirmation dialog.
- A compose draft titled “QA draft” was saved and the button to reopen it was present (`draft-reopen.ok: true` in the QA script output).
- Sent at 1920 showed only the demo sent note, with star/read and without archive/trash.

## Not verified in the browser

- A real Google button success. The screen correctly says sign-in is not configured.
- Live Gmail pagination, because no mailbox is connected.
- Reduced-motion was checked in CSS (`prefers-reduced-motion: reduce` disables animation) and not by toggling the OS setting in this Chrome session.
- Keyboard focus was styled and the dialog uses the native `<dialog>` element. A full tab-order audit was not recorded.
- Contrast was judged from the screenshots, not from an automated WCAG scanner.
