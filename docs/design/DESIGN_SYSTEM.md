# FLUENT design system

Source of truth for the product skin: `artifacts/mail/src/fluent.css`. Screens use the shared components in `artifacts/mail/src/components/fluent/`.

## Color

| Token | Value | Use |
|---|---|---|
| `--fluent-bg` | `#101116` | Page background |
| `--fluent-bg-2` | `#171820` | Sidebar |
| `--fluent-card` | `#20212b` | Cards |
| `--fluent-elevated` | `#30313d` | Controls and toasts |
| `--fluent-text` | `#f5f5fa` | Primary text |
| `--fluent-text-2` | `#a5a6b5` | Secondary text |
| `--fluent-purple` | `#806bff` | Primary action |
| `--fluent-blue` | `#43b9ff` | Focus and unread mark |
| `--fluent-success` | `#46d6a0` | Positive status |
| `--fluent-danger` | `#e08a9a` | Destructive action |
| `--fluent-warning` | `#e3c27a` | Mock / unsaved |

`#707180` is not used for small text. On `#101116` it falls short of the contrast used for body copy.

## Type

Inter for interface text. Fraunces for the wordmark and page titles. Sizes: titles `clamp(2.2rem, 4vw, 3.6rem)`, body 15px / 1.5, meta 0.82–0.92rem.

## Space, radius, elevation

Spacing: 4, 8, 12, 16, 24, 32, 48, 64. Radius: 8, 12, 18, pill. Cards use a hairline border plus a soft shadow. Dialogs use a deeper shadow. Motion is 160ms and disabled under `prefers-reduced-motion`.

## Components

`Button`, `PageHeader`, `EmptyState`, `ErrorState`, `LoadingState` (skeleton), `ConfirmDialog`, `ToastProvider`, and `FluentChrome` / `AppShell`. Icons in the mailbox are the star and read marks at a 44px target. The same button classes are used on every screen.

## What this is not

Not a light theme. Not a claim that Gmail or a live model is connected. Mock and blocked states stay labeled.
