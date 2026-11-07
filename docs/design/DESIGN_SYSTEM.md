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

Primary buttons use solid `#806bff` with `#16141f` text. The current navigation item is `#34315a`. A pressed filter chip is `#2a3d4d`. Those fills keep the contrast measurable. Shared pieces are `Button`, `PageHeader`, `EmptyState`, `ErrorState`, `LoadingState`, `ConfirmDialog`, `ToastProvider`, and `FluentChrome`. Star and read controls are 44px. The mobile bar is a layout row, not a floating layer.

## What this is not

Not a light theme. Not a claim that Gmail or a live model is connected. Mock and blocked states stay labeled.
