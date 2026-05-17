# Building

### Production / CI (authoritative)

```bash
pnpm run build:prod
```

Executed by Cloud Build on Linux. This is the only build whose output is shipped.

### Local development

```bash
pnpm run build:prod
```

This should work on Linux, macOS, and Windows after the canonical pnpm fix.

If Windows still fails with `Cannot find module @rollup/rollup-win32-x64-msvc`, run:

```bash
rm -rf node_modules
corepack pnpm install
```

If it still fails, this is a local environment-only issue and does not block PRs or deploys; CI is authoritative.

### Type checking (always full sweep)

```bash
pnpm -r typecheck
```
