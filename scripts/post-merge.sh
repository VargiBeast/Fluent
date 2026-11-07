#!/bin/bash
set -e
# Install only. Schema changes are reviewed SQL migrations, applied on purpose
# with `pnpm --filter @workspace/db run migrate`. Never auto-push a schema.
pnpm install --frozen-lockfile
