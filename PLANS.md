# Wesal One UI Foundation Execution Log

## Objective

Establish one shared, RTL-first and mobile-first UI foundation for Wesal One using shadcn/ui conventions, Base UI primitives, Tailwind CSS, and centralized design tokens without redesigning or migrating existing product pages.

## Safety Baseline

- Primary repository worktree: `C:\Users\USERW\Documents\khadamatak-github-publish-20260507163016`
- Isolated implementation worktree: `C:\Users\USERW\Documents\khadamatak-wesal-ui-foundation`
- Branch: `chore/wesal-ui-foundation`
- Start commit / rollback point: `ffea61ad9676c6503c9a840fe5426638eb60509d`
- Package manager: `pnpm@10.33.2` from `packageManager` and `pnpm-lock.yaml`
- Protected uncommitted user work in primary worktree:
  - `WESAL_ONE_CHAT_HANDOFF.md`
  - `artifacts/api-server/src/modules/integrations/integrations.routes.ts`
- Protection decision: all UI-foundation work happens in the isolated worktree. The protected files will not be edited, staged, or committed here.

## Architecture Decisions

| Decision | Status | Rationale |
|---|---|---|
| Shared UI location | Approved: `lib/ui` as `@workspace/ui` | Fits existing `lib/*` workspaces and prevents a third duplicated component tree. |
| Primitive engine | Approved | Base UI only for new primitives; existing Radix remains until its consumers are migrated later. |
| Component convention | Approved | shadcn/ui-style open source files, adapted to Base UI. |
| Styling | Approved | Tailwind CSS with one CSS-variable token source. |
| Product pages | Frozen | No redesign, forced migration, API, database, auth, or business-logic changes. |
| Migration strategy | Additive | New Base UI components live only in `@workspace/ui`; existing Radix files remain unchanged until later screen migrations. |
| Package exports | Explicit subpaths | Avoids a side-effectful barrel and preserves tree-shaking. |
| Tailwind ownership | Host applications | `@workspace/ui` does not install Tailwind; hosts scan its source with Tailwind v4 `@source`. |

## Phases

| Phase | Owner | Expected files | Dependencies | Status |
|---|---|---|---|---|
| 0. Safety and baseline | Lead | `PLANS.md` | None | Complete |
| 1. Repository audit | Audit agents 1-3 | None (read-only) | Phase 0 start | Complete |
| 2. Foundation architecture | Foundation worker | Manifests, `components.json`, shared UI package/config | Audit decision | Pending |
| 3. Central design tokens | Design-system worker | Token CSS and token documentation | Phase 2 | Pending |
| 4. Base components | Component workers | Disjoint component files and tests | Phases 2-3 | Pending |
| 5. RTL/mobile/accessibility | Accessibility worker | Foundation-only styles/tests | Phase 4 | Pending |
| 6. Component lab | Lab worker | Development-only route/app | Phase 4 | Pending |
| 7. Permanent guidance | Documentation worker | `AGENTS.md`, `docs/design-system/**` | Phases 2-6 | Pending |
| 8. Independent review | Reviewer | Review only, then assigned fixes | Phases 2-7 | Pending |
| 9. Acceptance tests | Lead + verifier | Test artifacts only if required | Review clean | Pending |
| 10. Integration and cleanup | Lead | Git history/worktrees | Acceptance green | Pending |

## Baseline Results

| Check | Before changes | After changes |
|---|---|---|
| Frozen install | PASS — `corepack pnpm install --frozen-lockfile` | Pending |
| Build | PRE-EXISTING FAIL — sandbox requires `PORT` | Pending |
| Production build | PASS — web bundle 1,063.97 kB / 268.17 kB gzip; existing sourcemap and chunk warnings | Pending |
| Typecheck | Root wrapper fails because nested `pnpm` is absent from PATH; equivalent libs + all artifact/script typechecks PASS | Pending |
| Lint | No lint script or config exists | Pending |
| Tests | No unit/component/browser test script exists | Pending |

## Audit Agents

| Agent | Assignment | Status | Result |
|---|---|---|---|
| James | Monorepo and application architecture | Complete | pnpm monorepo; CSR Vite web; recommend `lib/ui`; no current test/lint system |
| Darwin | Current UI, CSS, libraries, RTL and visual risks | Complete | Radix/shadcn duplication, hardcoded RTL/body direction, dual modal systems, token drift |
| Planck | Compatibility, dependency, CSP/SSR and rollback risks | Complete | Additive Base UI only; explicit exports; host Tailwind scan; runtime/type version mismatch is pre-existing |

## Issues and Resolutions

| Issue | Impact | Resolution | Status |
|---|---|---|---|
| Primary worktree has uncommitted PD-6 work | Risk of overwrite or accidental commit | Created isolated branch/worktree from the current commit; primary remains untouched | Resolved |
| Root `typecheck` invokes bare `pnpm` | Fails in this Windows shell despite valid code | Recorded as baseline; run equivalent `corepack pnpm` commands for acceptance | Pre-existing |
| Full recursive build requires sandbox `PORT` | Root build cannot complete without environment | Recorded as baseline; `build:prod` excludes sandbox and passes | Pre-existing |
| Two active Tailwind versions and stale deleted-app importer in lockfile | Lockfile noise and duplicate tooling | Do not add Tailwind to `@workspace/ui`; defer stale importer pruning to dedicated maintenance | Accepted debt |
| React runtime 19.1 vs types 19.2 | Potential type/runtime mismatch | Do not change React in this task; document for dedicated dependency alignment | Accepted debt |

## Test Log

Results are appended after each phase. A phase cannot be marked complete until its required checks pass or a pre-existing failure is reproduced and documented.
