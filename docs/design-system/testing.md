# Testing and Component Lab

```powershell
corepack pnpm --filter @workspace/ui test
corepack pnpm --filter @workspace/ui run typecheck
corepack pnpm --filter @workspace/web run typecheck
corepack pnpm run build:prod
```

Start the web development server and open `/__ui-lab`. The route exists only when `import.meta.env.DEV` is true.

Verify 320, 360, 390, and 430px, tablet, and desktop. Check RTL/LTR, light/dark, focus, Escape, focus return, clipping, and horizontal overflow.

The repository has no lint configuration or product integration-test runner. Document that absence until dedicated tooling is introduced.
