# Screen inventory

Public and signed-in routes are separate.

| Route | Role | States |
|---|---|---|
| `/` | Product introduction. No testimonials and no claim that Gmail is connected. | Signed-out sign-in link. Signed-in “Open workspace”. |
| `/login` | Google sign-in or an honest blocked setup list. Labeled demo only when demo mode is on. | Loading, API error, blocked Google, existing session. |
| `/onboarding` | Account vs mailbox permission, including the real breadth of `gmail.modify`. | Connect link only when OAuth is configured. Otherwise a blocked status. |
| `/overview` | Counts from stored flags, dates copied from snippets, mock or blocked narrative, priorities and follow-ups linking to the source thread. | Loading, empty, thread error, AI error. |
| `/inbox` | List, category, unread/starred/important filters, star and read controls, one-thread archive/trash, next page. | Loading skeleton, empty, error, success toast. |
| `/inbox/:id` | Reading pane, sandboxed HTML, summary with source ids, local reply draft, unsaved marker. | Loading, missing thread, summary error, assist error, save error. |
| `/copilot` | Mailbox question, labeled interpretation, summary, editable draft. No mutation tools. | Loading, search error, summary error, assist error. |
| `/compose` | New local draft, saved list, reopen, unsaved changes. No send. | Empty list, load error, save error, success toast. |
| `/sent` | Same list pattern, search kept on `view: sent`, no archive/trash. | Same as inbox. |
| `/settings` | Account, connection blocker, sync, privacy, AI mode, dark-only appearance, sign out. | Loading and error on each card that can fail. |

Mobile reaches Sent, Settings, and Compose from the More sheet. Desktop shows them in the sidebar.
