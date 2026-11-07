# Interaction specification

## Navigation

Desktop sidebar: Overview, Inbox, Copilot, Sent, Settings, Compose. Mobile bar is in the layout, not over the scrolling pane: Overview, Inbox, Copilot, Compose, More. More is a modal with Sent and Settings. Escape closes it. `/` focuses the mailbox search when focus is not already in a field.

## Mail

One conversation can be highlighted. Star and read call `POST /api/threads/:id/flags`. Archive and Trash open a dialog that names the subject, then the existing approval endpoints. The confirm button disables while the request is in flight. There is no multi-select and no bulk action. Load next page uses the API `nextPageToken`. Search from Sent sends `view: "sent"`.

## Drafts

Compose creates with `POST /api/drafts` and updates with `PUT /api/drafts/:id`. The list reloads the same draft into the form. A dirty form says “Unsaved changes”. Nothing in the UI calls a send endpoint.

## AI

Summaries and drafts show the mock label when `mock` is true. Source message ids are printed on the summary. Overview priorities and follow-ups are links. Dates on the overview are strings found in stored snippets. Copilot copy says suggestions are not confirmed facts and cannot archive or delete.

## Feedback

Toasts confirm refresh, archive, trash, draft save, privacy save, and sync. Errors use `role="alert"`. Empty views explain the next useful action. Google and Gmail stay in a blocked panel until those variables exist. Demo mail keeps the synthetic banner.

## Email rendering

The message frame stays sandboxed. Its document background is `#14151c`. Remote images follow the settings checkbox. The frame does not gain scripts.
