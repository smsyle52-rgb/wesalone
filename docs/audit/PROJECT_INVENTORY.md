# Project Inventory Report

## 0. Project Identity
- Project name: `workspace` from `package.json`; product identity in docs/UI: `خدماتك (Khadamatak)`.
- Framework + version: React `19.1.0` + Vite `7.3.2` frontend; Express `^5` API backend.
- Language(s): TypeScript, TSX, SQL, Bash, Markdown.
- Hosting: Google Cloud Run / Cloud Build / Artifact Registry / Cloud SQL are active hints (`Dockerfile`, `cloudbuild.yaml`, runbooks). Replit files are historical/staging docs. No Vercel config detected.
- Database type: PostgreSQL via Drizzle ORM and `pg`.
- Detected product positioning: B2B SaaS customer-ops dashboard for Yemen: inbox, contacts, orders, payments, debts, knowledge, AI assistance, analytics, and integration readiness. Manual/Yemeni payments are emphasized; no Shopify/TikTok work in current scope.

## 1. Tech Stack
| Layer | Tool | Version | Notes |
|---|---|---:|---|
| Package manager | pnpm | `10.33.2` | Workspace packages under `artifacts/*`, `lib/*`, `scripts`. |
| Runtime | Node.js | `22-bookworm-slim` | Docker runtime image. |
| Frontend | React | `19.1.0` | Vite SPA. |
| Frontend build | Vite | `^7.3.2` | Requires `BASE_PATH`; output `dist/public`. |
| Routing | Wouter | `^3.3.5` | Client-side routes in `artifacts/web/src/App.tsx`. |
| Data fetching | TanStack Query | `^5.90.21` | Query cache in App. |
| UI primitives | Radix UI | mixed | shadcn-style `components/ui`. |
| Styling | Tailwind CSS | `^4.1.14` | `@tailwindcss/vite`, `tw-animate-css`. |
| Icons | lucide-react/react-icons | `^0.545.0` / `^5.4.0` | Used throughout UI. |
| Backend | Express | `^5` | API under `artifacts/api-server/src/modules`. |
| API validation | Zod | `3.25.76` | Route bodies/query validation. |
| Database | PostgreSQL | external | Cloud SQL target. |
| ORM | Drizzle ORM / Kit | `^0.45.2` / `^0.31.9` | Schema in `lib/db/src/schema`, migrations in `lib/db/drizzle`. |
| Auth | Custom email/password | app code | `bcryptjs`, `express-session`, `connect-pg-simple`. |
| RBAC | Custom roles/permissions | app code | Seeded in `seed.ts`, enforced by `requirePermission`. |
| Payments | Manual ledger | app code | Payment methods, exchange rates, payment confirmation/rejection. No gateway. |
| AI | Vertex AI / Gemini / mock | app code | `AI_PROVIDER=vertex` preferred; `GEMINI_API_KEY` fallback; mock fallback. |
| Queue | NONE DETECTED | - | Outbox tables exist, no worker/queue package. |
| Storage | Schema only | - | `files` table and optional `GCS_BUCKET`; no upload flow detected. |
| i18n | Hardcoded Arabic RTL | - | No translation framework/files. |
| API spec | OpenAPI + Orval | `orval ^7.17.0` | `lib/api-spec/openapi.yaml`, generated clients. |

## 2. Routes & Pages

### Public
| Path | File | Type | Auth required | Status |
|---|---|---|---|---|
| `/login` | `artifacts/web/src/pages/LoginPage.tsx` | page | no | working |
| `/register` | `artifacts/web/src/pages/RegisterPage.tsx` | page | no | working |
| `/` | `artifacts/web/src/App.tsx` | redirect | unknown | working |
| `*` | `artifacts/web/src/pages/not-found.tsx` | page | no | working |

### Dashboard
| Path | File | Type | Auth required | Status |
|---|---|---|---|---|
| `/dashboard` | `artifacts/web/src/pages/DashboardPage.tsx` | page | yes | working |
| `/start` | `artifacts/web/src/pages/BusinessSetupPage.tsx` | page | yes | working |
| `/inbox` | `artifacts/web/src/pages/InboxPage.tsx` | page | yes | working |
| `/tickets` | `artifacts/web/src/pages/TicketsPage.tsx` | page | yes | working |
| `/tasks` | `artifacts/web/src/pages/TasksPage.tsx` | page | yes | working |
| `/followups` | `artifacts/web/src/pages/FollowupsPage.tsx` | page | yes | working |
| `/contacts` | `artifacts/web/src/pages/ContactsPage.tsx` | page | yes | working |
| `/contacts/:id` | `artifacts/web/src/pages/ContactProfilePage.tsx` | page | yes | working |
| `/opportunities` | `artifacts/web/src/pages/OpportunitiesPage.tsx` | page | yes | working |
| `/orders` | `artifacts/web/src/pages/OrdersPage.tsx` | page | yes | working |
| `/payments` | `artifacts/web/src/pages/PaymentsPage.tsx` | page | yes | working |
| `/debts` | `artifacts/web/src/pages/DebtsPage.tsx` | page | yes | working |
| `/knowledge` | `artifacts/web/src/pages/KnowledgePage.tsx` | page | yes | working |
| `/agents` | `artifacts/web/src/pages/AgentsPage.tsx` | page | yes | working |
| `/integrations` | `artifacts/web/src/pages/IntegrationsPage.tsx` | page | yes | working |
| `/analytics` | `artifacts/web/src/pages/AnalyticsPage.tsx` | page | yes | working |
| `/reports` | `artifacts/web/src/pages/ReportsPage.tsx` | page | yes | working |
| `/audit-logs` | `artifacts/web/src/pages/AuditLogsPage.tsx` | page | yes | working |
| `/settings` | `artifacts/web/src/pages/SettingsPage.tsx` | page | yes | working |

### API
| Path | File | Type | Auth required | Status |
|---|---|---|---|---|
| `/api/healthz` | `artifacts/api-server/src/routes/health.ts` | api | no | working |
| `/api/readyz` | `artifacts/api-server/src/routes/health.ts` | api | no | working |
| `/api/auth/*` | `artifacts/api-server/src/modules/auth/auth.routes.ts` | api | mixed | working |
| `/api/workspace/*` | `artifacts/api-server/src/modules/workspace/workspace.routes.ts` | api | yes | working |
| `/api/users/*` | `artifacts/api-server/src/modules/users/users.routes.ts` | api | yes | working |
| `/api/audit-logs/*` | `artifacts/api-server/src/modules/audit/audit.routes.ts` | api | yes | working |
| `/api/contacts/*` | `artifacts/api-server/src/modules/contacts/contacts.routes.ts` | api | yes | working |
| `/api/conversations/*` | `artifacts/api-server/src/modules/conversations/conversations.routes.ts` | api | yes | working |
| `/api/tickets/*` | `artifacts/api-server/src/modules/tickets/tickets.routes.ts` | api | yes | working |
| `/api/tasks/*` | `artifacts/api-server/src/modules/tasks/tasks.routes.ts` | api | yes | working |
| `/api/followups/*` | `artifacts/api-server/src/modules/followups/followups.routes.ts` | api | yes | working |
| `/api/opportunities/*` | `artifacts/api-server/src/modules/opportunities/opportunities.routes.ts` | api | yes | working |
| `/api/orders/*` | `artifacts/api-server/src/modules/orders/orders.routes.ts` | api | yes | working |
| `/api/payments/*` | `artifacts/api-server/src/modules/payments/payments.routes.ts` | api | yes | working |
| `/api/payment-methods/*` | `artifacts/api-server/src/modules/payments/payment-methods.routes.ts` | api | yes | working |
| `/api/exchange-rates/*` | `artifacts/api-server/src/modules/payments/exchange-rates.routes.ts` | api | yes | working |
| `/api/dashboard/*` | `artifacts/api-server/src/modules/dashboard/dashboard.routes.ts` | api | yes | working |
| `/api/channels/*` | `artifacts/api-server/src/modules/channels/channels.routes.ts` | api | yes | working |
| `/api/debts/*` | `artifacts/api-server/src/modules/debts/debts.routes.ts` | api | yes | working |
| `/api/knowledge/*` | `artifacts/api-server/src/modules/knowledge/knowledge.routes.ts` | api | yes | working |
| `/api/ai/*` | `artifacts/api-server/src/modules/ai/ai.routes.ts` | api | yes | working |
| `/api/approvals/*` | `artifacts/api-server/src/modules/approvals/approvals.routes.ts` | api | yes | working |
| `/api/analytics/*` | `artifacts/api-server/src/modules/analytics/analytics.routes.ts` | api | yes | working |
| `/api/reports/*` | `artifacts/api-server/src/modules/reports/reports.routes.ts` | api | yes | working |
| `/api/integrations/*` | `artifacts/api-server/src/modules/integrations/integrations.routes.ts` | api | yes | working |

### Webhooks
| Path | File | Type | Auth required | Status |
|---|---|---|---|---|
| `POST /api/webhooks/:provider` | `artifacts/api-server/src/modules/integrations/webhooks.routes.ts` | webhook | no | partial |

### Admin
| Path | File | Type | Auth required | Status |
|---|---|---|---|---|
| `/api/users/invite` | `artifacts/api-server/src/modules/users/users.routes.ts` | api | yes | working |
| `/api/users/:membershipId/role` | `artifacts/api-server/src/modules/users/users.routes.ts` | api | yes | working |
| `/api/audit-logs` | `artifacts/api-server/src/modules/audit/audit.routes.ts` | api | yes | working |

## 3. Components Inventory
| Name | File | Purpose | Used in |
|---|---|---|---|
| `Layout` | `artifacts/web/src/components/Layout.tsx` | Authenticated app shell/nav/sidebar. | Protected pages |
| `ErrorBoundary` | `artifacts/web/src/components/ErrorBoundary.tsx` | Runtime error guard. | `App.tsx` |
| `PaymentMethodsTab` | `artifacts/web/src/components/settings/PaymentMethodsTab.tsx` | Manage manual payment methods. | `SettingsPage` |
| `ExchangeRatesTab` | `artifacts/web/src/components/settings/ExchangeRatesTab.tsx` | Manage/display exchange rates. | `SettingsPage`, payments UX |
| `PageHeader` | `artifacts/web/src/components/ui/PageHeader.tsx` | Shared page title/action header. | Multiple pages |
| `DataTable` | `artifacts/web/src/components/ui/DataTable.tsx` | Reusable table wrapper. | Multiple list pages |
| `StatusBadge` | `artifacts/web/src/components/ui/StatusBadge.tsx` | Status label styling. | Multiple pages |
| `Modal` | `artifacts/web/src/components/ui/Modal.tsx` | Reusable modal shell. | Forms/dialogs |
| `accordion` | `artifacts/web/src/components/ui/accordion.tsx` | Radix accordion. | UI primitive |
| `alert-dialog` | `artifacts/web/src/components/ui/alert-dialog.tsx` | Confirmation/dialog primitive. | Destructive confirmations |
| `alert` | `artifacts/web/src/components/ui/alert.tsx` | Alert block. | Errors/empty states |
| `aspect-ratio` | `artifacts/web/src/components/ui/aspect-ratio.tsx` | Aspect ratio primitive. | UI primitive |
| `avatar` | `artifacts/web/src/components/ui/avatar.tsx` | User/contact avatar. | Layout, profiles |
| `badge` | `artifacts/web/src/components/ui/badge.tsx` | Labels/status chips. | Multiple pages |
| `breadcrumb` | `artifacts/web/src/components/ui/breadcrumb.tsx` | Breadcrumb nav. | UI primitive |
| `button` | `artifacts/web/src/components/ui/button.tsx` | Button styling. | All forms/actions |
| `button-group` | `artifacts/web/src/components/ui/button-group.tsx` | Grouped buttons. | Toolbars |
| `calendar` | `artifacts/web/src/components/ui/calendar.tsx` | Date picker calendar. | Date fields |
| `card` | `artifacts/web/src/components/ui/card.tsx` | Card container. | Dashboards/forms |
| `carousel` | `artifacts/web/src/components/ui/carousel.tsx` | Carousel primitive. | UI primitive |
| `chart` | `artifacts/web/src/components/ui/chart.tsx` | Chart wrapper. | Analytics/dashboard |
| `checkbox` | `artifacts/web/src/components/ui/checkbox.tsx` | Checkbox primitive. | Forms |
| `collapsible` | `artifacts/web/src/components/ui/collapsible.tsx` | Expand/collapse UI. | Layout/settings |
| `command` | `artifacts/web/src/components/ui/command.tsx` | Command/search palette primitive. | UI primitive |
| `context-menu` | `artifacts/web/src/components/ui/context-menu.tsx` | Context menu primitive. | UI primitive |
| `dialog` | `artifacts/web/src/components/ui/dialog.tsx` | Modal/dialog primitive. | Forms |
| `drawer` | `artifacts/web/src/components/ui/drawer.tsx` | Drawer primitive. | Mobile/action panes |
| `dropdown-menu` | `artifacts/web/src/components/ui/dropdown-menu.tsx` | Dropdown primitive. | Menus |
| `empty` | `artifacts/web/src/components/ui/empty.tsx` | Empty state block. | Lists |
| `field` | `artifacts/web/src/components/ui/field.tsx` | Form field layout. | Forms |
| `form` | `artifacts/web/src/components/ui/form.tsx` | React Hook Form wrapper. | Forms |
| `hover-card` | `artifacts/web/src/components/ui/hover-card.tsx` | Hover popover. | UI primitive |
| `input`, `input-group`, `input-otp` | `artifacts/web/src/components/ui/input*.tsx` | Text/OTP inputs. | Forms/auth |
| `item` | `artifacts/web/src/components/ui/item.tsx` | List item primitive. | Lists |
| `kbd` | `artifacts/web/src/components/ui/kbd.tsx` | Keyboard label. | Help/UI |
| `label` | `artifacts/web/src/components/ui/label.tsx` | Form labels. | Forms |
| `menubar`, `navigation-menu` | `artifacts/web/src/components/ui/*menu*.tsx` | Menu primitives. | Navigation |
| `pagination` | `artifacts/web/src/components/ui/pagination.tsx` | Pagination primitive. | Lists |
| `popover` | `artifacts/web/src/components/ui/popover.tsx` | Popover primitive. | Filters/forms |
| `progress`, `slider`, `switch` | `artifacts/web/src/components/ui/*.tsx` | Controls/status. | Settings/forms |
| `radio-group`, `select`, `textarea` | `artifacts/web/src/components/ui/*.tsx` | Form controls. | Forms |
| `resizable`, `scroll-area`, `separator`, `sheet`, `sidebar` | `artifacts/web/src/components/ui/*.tsx` | Layout primitives. | App shell/pages |
| `skeleton`, `spinner` | `artifacts/web/src/components/ui/*.tsx` | Loading states. | Lists/pages |
| `sonner`, `toast`, `toaster` | `artifacts/web/src/components/ui/*.tsx` | Notifications. | App-wide |
| `table`, `tabs`, `toggle`, `toggle-group`, `tooltip` | `artifacts/web/src/components/ui/*.tsx` | UI primitives. | Multiple pages |
| mockup `ui/*` | `artifacts/mockup-sandbox/src/components/ui/*` | Duplicate design sandbox components. | Mockup sandbox only |

## 4. Database Schema
| Name | Fields (name:type) | Relations | Indexes |
|---|---|---|---|
| `workspaces` | id uuid, name text, slug text, plan text, status text, settings jsonb, timestamps | root tenant | none |
| `users` | id, email, phone, name, password_hash, avatar_url, status, email_verified, last_seen_at, timestamps | memberships, audit, records | none |
| `roles` | id, workspace_id, name, slug, is_system, description, created_at | workspace | none |
| `permissions` | id, resource, action, slug, description | role_permissions | none |
| `role_permissions` | role_id, permission_id | roles, permissions | none |
| `workspace_memberships` | id, workspace_id, user_id, status, invited_by, joined_at, created_at | workspace, user, roles, teams | none |
| `membership_roles` | membership_id, role_id, assigned_by, assigned_at | membership, role, user | none |
| `teams` | id, workspace_id, name, description, created_at | workspace, members | none |
| `team_members` | team_id, membership_id, is_lead, joined_at | team, membership | none |
| `audit_logs` | id, workspace_id, actor_type/id/label, action, severity, entity, old_data, new_data, request data, created_at | workspace | none |
| `login_events` | id, user_id, email, success, failure_reason, ip, user_agent, created_at | user | none |
| `session` | sid, sess jsonb, expire | Express session store | primary `sid` |
| `plans` | id, name, slug, active, price_yer, price_usd, billing_cycle, limits, features | subscriptions | none |
| `subscriptions` | id, workspace_id, plan_id, status, trial/current period/cancel dates, timestamps | workspace, plan | none |
| `feature_flags` | id, workspace_id, flag_key, is_enabled, config | workspace | none |
| `files` | id, workspace_id, uploaded_by, provider, bucket, object_key, url, original_name, mime_type, size, scan_status, visibility, expiry, created_at | workspace, user | none |
| `payment_methods` | id, workspace_id, slug, label_ar/en, active, requires_reference/receipt, sort_order, config, created_at | workspace | none |
| `exchange_rates` | id, workspace_id, from_currency, to_currency, rate, set_by, effective_at, created_at | workspace, user | none |
| `outbox_events` | id, workspace_id, event_type, entity_type/id, payload, status, attempts, next_attempt_at, created/published | workspace | none |
| `contacts` | id, workspace_id, name, phone, email, city, company, tags, total_orders, total_spent, last_contacted_at, created_by, timestamps | workspace, user, child contact data | none |
| `contact_channels` | id, workspace_id, contact_id, channel_type, identifier, normalized_identifier, primary/verified/opt flags, provider_data, timestamps | workspace, contact | unique `workspace_id+channel_type+normalized_identifier` |
| `contact_notes` | id, workspace_id, contact_id, author_id, body, is_private, timestamps | workspace, contact, user | none |
| `contact_timeline` | id, workspace_id, contact_id, event/entity, title, description, metadata, created_by, occurred/created | workspace, contact, user | none |
| `channel_accounts` | id, workspace_id, channel_type, name, display_name, status, provider_config, credentials_secret_ref, created_by, timestamps | workspace, user | none |
| `conversations` | id, workspace_id, contact/channel refs, external_thread_id, channel, status, priority, subject, assignment/team, last message, unread, ai_summary, lifecycle, timestamps | workspace, contact, contact_channel, channel_account, membership, team | none |
| `messages` | id, conversation_id, workspace_id, provider_message_id, direction, sender, source, content_type/content, ai/private flags, delivery_status, provider_payload, sent/created | conversation, workspace, user | none |
| `tickets` | id, workspace_id, number, title, description, status, priority, category, contact/conversation/source refs, assignee/team, due/lifecycle, created_by, timestamps | workspace, contact, conversation, membership, team, user | none |
| `tasks` | id, workspace_id, title, description, status, priority, contact/conversation/source refs, related_type/id, due, assignee, completion, creator, timestamps | workspace, contact, conversation, membership, users | none |
| `followups` | id, workspace_id, contact/conversation/opportunity refs, assignee, creator, type, status, title, scheduled_at, note, completion, skip, timestamps | workspace, contact, conversation, opportunity, membership, users | none |
| `opportunities` | id, workspace_id, title, stage, value, currency, contact/conversation/source refs, assignee, probability, close/loss/win fields, created_by, timestamps | workspace, contact, conversation, membership, user | none |
| `orders` | id, workspace_id, order_number, status, channel, contact/conversation/opportunity/source refs, assignee, totals, currency, notes, lifecycle, payment_status, items jsonb, created_by, timestamps | workspace, contact, conversation, user | none |
| `order_items` | id, workspace_id, order_id, name, description, quantity, unit_price, currency, total, timestamps | workspace, order | none |
| `payments` | id, workspace_id, amount, currency, method, payment_method/exchange refs, snapshots, base_amount_yer, paid_at, status, contact/order refs, reference/notes, confirmation/rejection users/dates, created_by, timestamps | workspace, payment_method, exchange_rate, contact, order, users | none |
| `debts` | id, workspace_id, contact_id, order_id, source_payment_id, amount/currency/remaining, status, due_at, description/notes, created_by, assignee, paid/writeoff/cancel fields, timestamps | workspace, contact, order, payment, users, membership | none |
| `collection_notes` | id, workspace_id, debt_id, contact_id, author_id, note, promised_payment_date, promised_amount, created_at | workspace, debt, contact, user | none |
| `knowledge_bases` | id, workspace_id, name, description, status, created_by, timestamps | workspace, user | none |
| `knowledge_sources` | id, workspace_id, knowledge_base_id, type, title, status, source_url/file/raw_text, metadata, created_by, timestamps | workspace, knowledge_base, user | none |
| `knowledge_documents` | id, workspace_id, knowledge_base_id, source_id, title, content_text, status, token_estimate, created_by, timestamps | workspace, knowledge_base, source, user | none |
| `knowledge_chunks` | id, workspace_id, knowledge_base_id, document_id, chunk_index, chunk_text, token_estimate, embedding_status/ref, metadata, created_at | workspace, knowledge_base, document | none |
| `faq_entries` | id, workspace_id, knowledge_base_id, question, answer, category, status, created_by, timestamps | workspace, knowledge_base, user | none |
| `embeddings_index_reference` | id, workspace_id, knowledge_base_id, provider, index_name, status, config, timestamps | workspace, knowledge_base | none |
| `ai_agents` | id, workspace_id, name, type, status, default_model, dialect, tone, created_by, timestamps | workspace, user | none |
| `ai_agent_versions` | id, workspace_id, agent_id, version_number, status, instruction/tool/model snapshots, created_by, created_at | workspace, agent, user | none |
| `ai_agent_instructions` | id, workspace_id, agent_id, role_prompt, business_rules, forbidden_actions, escalation_rules, timestamps | workspace, agent | none |
| `ai_agent_tools` | id, workspace_id, agent_id, tool_key, enabled, requires_approval, config, timestamps | workspace, agent | none |
| `ai_agent_channels` | id, workspace_id, agent_id, channel_account_id, mode, timestamps | workspace, agent, channel_account | none |
| `ai_runs` | id, workspace_id, agent_id, task_type, input_type/ref, status, model, provider, token/cost counts, safety_status, error, created_by, timestamps | workspace, agent, user | none |
| `ai_messages` | id, workspace_id, ai_run_id, role, content, metadata, created_at | workspace, ai_run | none |
| `ai_extractions` | id, workspace_id, ai_run_id, extraction_type, result_json, confidence, created_at | workspace, ai_run | none |
| `ai_usage` | id, workspace_id, date, model, provider, task_type, total_runs, total_tokens, estimated_cost, created_at | workspace | none |
| `ai_feedback` | id, workspace_id, ai_run_id, rating, comment, created_by, created_at | workspace, ai_run, user | none |
| `ai_safety_events` | id, workspace_id, ai_run_id, event_type, severity, blocked_action, reason, payload, created_by, created_at | workspace, ai_run, user | none |
| `approval_requests` | id, workspace_id, source_type/id, action_type, payload, status, requested/approved/rejected users, reason, created/resolved | workspace, users | none |
| `metrics_events` | id, workspace_id, event_type, entity, actor_id, value, metadata, occurred_at, created_at | workspace, user | none |
| `daily_stats` | id, workspace_id, stat_date, aggregate counts/totals, ai_runs_count, timestamps | workspace | none |
| `team_daily_stats` | id, workspace_id, stat_date, member_id, assigned/sent/resolved/completed/created/recorded/ai counts, timestamps | workspace, user | none |
| `report_definitions` | id, workspace_id, name, type, description, config, is_archived, created_by, timestamps | workspace, user | none |
| `generated_reports` | id, workspace_id, report_definition_id, type, title, date range, status, data, generated_by, created_at | workspace, report_definition, user | none |
| `provider_accounts` | id, workspace_id, provider, display_name, status, external_account_id/business_id/phone_id, metadata, created_by, timestamps | workspace, user | indexes workspace/provider/status |
| `provider_secret_refs` | id, workspace_id, provider_account_id, secret_key, secret_ref, status, created_by, created_at, rotated_at | workspace, provider_account, user | indexes workspace/account; no secret value column |
| `webhook_events` | id, workspace_id nullable, provider, provider_account_id, event_type, external_event_id, idempotency_key, headers, payload, received/processed, status, error, retry_count | workspace, provider_account | unique `provider+idempotency_key`; indexes workspace/account/status/received_at |
| `inbound_event_links` | id, workspace_id, webhook_event_id, entity_type, entity_id, created_at | workspace, webhook_event | indexes workspace/webhook/entity |
| `outbox_messages` | id, workspace_id, provider, provider/channel/conversation/message refs, destination, payload, status, idempotency_key, schedule/sent/failed, error, retry_count, created_by, timestamps | workspace, provider_account, channel_account, conversation, message, user | unique `workspace_id+idempotency_key`; indexes workspace/status/provider/scheduled_at |
| `provider_delivery_attempts` | id, workspace_id, outbox_message_id, provider, attempt_number, request/response payload, status_code, status, error, created_at | workspace, outbox_message | indexes workspace/outbox |
| `integration_health_checks` | id, workspace_id, provider, provider_account_id, status, last_checked_at, latency_ms, message, metadata | workspace, provider_account | indexes workspace/provider/account |
| `integration_error_events` | id, workspace_id, provider, provider_account_id, severity, error_code, message, payload, resolved_at, created_at | workspace, provider_account | indexes workspace/provider/created_at |
| `idempotency_keys` | id, workspace_id nullable, key, scope, status, response_hash, created_at, expires_at | workspace | unique `scope+key`; indexes workspace/status/expires_at |
| `dead_letter_events` | id, workspace_id nullable, source_type, source_id, provider, reason, payload, created_at, resolved_at | workspace | indexes workspace/source/created_at |

## 5. API Endpoints
| Method | Path | Handler file | Auth | Inputs | Outputs |
|---|---|---|---|---|---|
| GET | `/api/healthz` | `routes/health.ts` | no | none | `{status}` |
| GET | `/api/readyz` | `routes/health.ts` | no | none | `{status, db}` |
| POST | `/api/auth/register` | `auth.routes.ts` | no | email/name/password/workspace | user + workspace session |
| POST | `/api/auth/login` | `auth.routes.ts` | no | email/password | session + user |
| POST | `/api/auth/logout` | `auth.routes.ts` | yes | none | ok |
| GET | `/api/auth/me` | `auth.routes.ts` | yes | session | user, memberships |
| POST | `/api/auth/change-password` | `auth.routes.ts` | yes | old/new password | ok |
| POST | `/api/auth/switch-workspace` | `auth.routes.ts` | yes | workspaceId | session update |
| GET/PATCH | `/api/workspace` | `workspace.routes.ts` | yes | settings fields | workspace |
| GET | `/api/workspace/flags` | `workspace.routes.ts` | yes | none | feature flags |
| GET | `/api/workspace/payment-methods` | `workspace.routes.ts` | yes | none | payment methods |
| GET | `/api/workspace/usage` | `workspace.routes.ts` | yes | none | usage summary |
| GET | `/api/users` | `users.routes.ts` | yes | none | `{members}` |
| POST | `/api/users/invite` | `users.routes.ts` | yes | email/name/role | invited member |
| PATCH | `/api/users/:membershipId/role` | `users.routes.ts` | yes | role | updated role |
| GET | `/api/audit-logs` | `audit.routes.ts` | yes | filters | audit entries |
| GET/POST | `/api/contacts` | `contacts.routes.ts` | yes | filters/body | contacts/contact |
| GET/PATCH/DELETE | `/api/contacts/:id` | `contacts.routes.ts` | yes | id/body | contact/ok |
| GET/POST | `/api/contacts/:id/channels` | `contacts.routes.ts` | yes | id/body | channels/channel |
| PATCH/DELETE | `/api/contacts/:id/channels/:channelId` | `contacts.routes.ts` | yes | ids/body | channel/ok |
| GET/POST | `/api/contacts/:id/notes` | `contacts.routes.ts` | yes | id/body | notes/note |
| PATCH/DELETE | `/api/contacts/:id/notes/:noteId` | `contacts.routes.ts` | yes | ids/body | note/ok |
| GET | `/api/contacts/:id/timeline` | `contacts.routes.ts` | yes | id | timeline |
| GET/POST | `/api/conversations` | `conversations.routes.ts` | yes | filters/body | conversations/conversation |
| GET/PATCH | `/api/conversations/:id` | `conversations.routes.ts` | yes | id/body | conversation |
| PATCH | `/api/conversations/:id/status` | `conversations.routes.ts` | yes | status | conversation |
| PATCH | `/api/conversations/:id/assign` | `conversations.routes.ts` | yes | membership/team | conversation |
| GET/POST | `/api/conversations/:id/messages` | `conversations.routes.ts` | yes | id/body | messages/message |
| POST | `/api/conversations/:id/import` | `conversations.routes.ts` | yes | messages | imported messages |
| GET/POST | `/api/tickets` | `tickets.routes.ts` | yes | filters/body | tickets/ticket |
| GET/PATCH/DELETE | `/api/tickets/:id` | `tickets.routes.ts` | yes | id/body | ticket/ok |
| PATCH | `/api/tickets/:id/status` | `tickets.routes.ts` | yes | status | ticket |
| PATCH | `/api/tickets/:id/assign` | `tickets.routes.ts` | yes | assignee/team | ticket |
| GET/POST | `/api/tasks` | `tasks.routes.ts` | yes | filters/body | tasks/task |
| GET/PATCH/DELETE | `/api/tasks/:id` | `tasks.routes.ts` | yes | id/body | task/ok |
| PATCH | `/api/tasks/:id/status` | `tasks.routes.ts` | yes | status | task |
| GET/POST | `/api/followups` | `followups.routes.ts` | yes | filters/body | followups/followup |
| GET/PATCH/DELETE | `/api/followups/:id` | `followups.routes.ts` | yes | id/body | followup/ok |
| PATCH | `/api/followups/:id/status` | `followups.routes.ts` | yes | status | followup |
| GET/POST | `/api/opportunities` | `opportunities.routes.ts` | yes | filters/body | opportunities/opportunity |
| GET/PATCH/DELETE | `/api/opportunities/:id` | `opportunities.routes.ts` | yes | id/body | opportunity/ok |
| PATCH | `/api/opportunities/:id/stage` | `opportunities.routes.ts` | yes | stage | opportunity |
| GET/POST | `/api/orders` | `orders.routes.ts` | yes | filters/body | orders/order |
| GET/PATCH/DELETE | `/api/orders/:id` | `orders.routes.ts` | yes | id/body | order/ok |
| PATCH | `/api/orders/:id/status` | `orders.routes.ts` | yes | status | order |
| GET/POST | `/api/orders/:id/items` | `orders.routes.ts` | yes | order/body | items/item |
| PATCH/DELETE | `/api/orders/:id/items/:itemId` | `orders.routes.ts` | yes | ids/body | item/ok |
| GET/POST | `/api/payments` | `payments.routes.ts` | yes | filters/body | payments/payment |
| GET/PATCH | `/api/payments/:id` | `payments.routes.ts` | yes | id/body | payment |
| POST | `/api/payments/:id/confirm` | `payments.routes.ts` | yes | id | payment/order effects |
| POST | `/api/payments/:id/reject` | `payments.routes.ts` | yes | reason | payment |
| GET/POST | `/api/payment-methods` | `payment-methods.routes.ts` | yes | body | methods/method |
| PATCH | `/api/payment-methods/:id` | `payment-methods.routes.ts` | yes | body | method |
| PATCH | `/api/payment-methods/:id/deactivate` | `payment-methods.routes.ts` | yes | id | method |
| GET/POST | `/api/exchange-rates` | `exchange-rates.routes.ts` | yes | body | rates/rate |
| PATCH | `/api/exchange-rates/:id` | `exchange-rates.routes.ts` | yes | body | rate |
| GET/POST | `/api/debts` | `debts.routes.ts` | yes | filters/body | debts/debt |
| GET/PATCH/DELETE | `/api/debts/:id` | `debts.routes.ts` | yes | id/body | debt/ok |
| PATCH | `/api/debts/:id/status` | `debts.routes.ts` | yes | status | debt |
| GET/POST | `/api/debts/:id/notes` | `debts.routes.ts` | yes | id/body | notes/note |
| PATCH/DELETE | `/api/debts/:id/notes/:noteId` | `debts.routes.ts` | yes | ids/body | note/ok |
| GET | `/api/dashboard/summary` | `dashboard.routes.ts` | yes | none | summary metrics |
| GET | `/api/dashboard/activity` | `dashboard.routes.ts` | yes | none | recent activity |
| GET | `/api/channels/catalog` | `channels.routes.ts` | yes | none | channel catalog |
| GET/POST | `/api/channels/accounts` | `channels.routes.ts` | yes | body | accounts/account |
| GET/PATCH | `/api/channels/accounts/:id` | `channels.routes.ts` | yes | id/body | account |
| GET/POST | `/api/knowledge/bases` | `knowledge.routes.ts` | yes | body | bases/base |
| GET/PATCH | `/api/knowledge/bases/:id` | `knowledge.routes.ts` | yes | id/body | base |
| PATCH | `/api/knowledge/bases/:id/archive` | `knowledge.routes.ts` | yes | id | base |
| GET/POST | `/api/knowledge/bases/:id/sources` | `knowledge.routes.ts` | yes | body | sources/source |
| PATCH | `/api/knowledge/sources/:sourceId` | `knowledge.routes.ts` | yes | body | source |
| PATCH | `/api/knowledge/sources/:sourceId/archive` | `knowledge.routes.ts` | yes | id | source |
| GET/POST | `/api/knowledge/bases/:id/documents` | `knowledge.routes.ts` | yes | body | docs/doc |
| GET/PATCH | `/api/knowledge/documents/:documentId` | `knowledge.routes.ts` | yes | body | document |
| PATCH | `/api/knowledge/documents/:documentId/archive` | `knowledge.routes.ts` | yes | id | document |
| GET | `/api/knowledge/documents/:documentId/chunks` | `knowledge.routes.ts` | yes | id | chunks |
| POST | `/api/knowledge/documents/:documentId/rechunk` | `knowledge.routes.ts` | yes | id | chunks |
| GET/POST | `/api/knowledge/bases/:id/faqs` | `knowledge.routes.ts` | yes | body | FAQs/FAQ |
| PATCH | `/api/knowledge/faqs/:faqId` | `knowledge.routes.ts` | yes | body | FAQ |
| PATCH | `/api/knowledge/faqs/:faqId/archive` | `knowledge.routes.ts` | yes | id | FAQ |
| GET | `/api/knowledge/search` | `knowledge.routes.ts` | yes | query | results |
| GET | `/api/ai/provider-status` | `ai.routes.ts` | yes | none | provider status |
| GET/POST | `/api/ai/agents` | `ai.routes.ts` | yes | body | agents/agent |
| GET/PATCH | `/api/ai/agents/:id` | `ai.routes.ts` | yes | body | agent |
| POST | `/api/ai/agents/:id/versions` | `ai.routes.ts` | yes | body | version |
| PATCH | `/api/ai/agents/:id/instructions` | `ai.routes.ts` | yes | body | instructions |
| GET/PATCH | `/api/ai/agents/:id/tools` | `ai.routes.ts` | yes | body | tools |
| GET | `/api/ai/runs` | `ai.routes.ts` | yes | filters | AI runs |
| GET | `/api/ai/runs/:id` | `ai.routes.ts` | yes | id | AI run |
| POST | `/api/ai/runs/:id/feedback` | `ai.routes.ts` | yes | rating/comment | feedback |
| GET | `/api/ai/usage` | `ai.routes.ts` | yes | date range | usage |
| GET | `/api/ai/safety-events` | `ai.routes.ts` | yes | filters | safety events |
| POST | `/api/ai/runs/summarize-conversation` | `ai.routes.ts` | yes | conversation | draft summary |
| POST | `/api/ai/runs/knowledge-answer` | `ai.routes.ts` | yes | question/base | answer + sources |
| POST | `/api/ai/runs/classify-conversation` | `ai.routes.ts` | yes | conversation | classification |
| POST | `/api/ai/runs/draft-reply` | `ai.routes.ts` | yes | conversation/context | draft reply |
| POST | `/api/ai/runs/extract` | `ai.routes.ts` | yes | text | extraction |
| POST | `/api/ai/runs/suggest-actions` | `ai.routes.ts` | yes | context | suggested actions |
| GET | `/api/approvals` | `approvals.routes.ts` | yes | filters | approval requests |
| GET | `/api/approvals/:id` | `approvals.routes.ts` | yes | id | approval |
| POST | `/api/approvals/:id/approve` | `approvals.routes.ts` | yes | id | approval |
| POST | `/api/approvals/:id/reject` | `approvals.routes.ts` | yes | reason | approval |
| POST | `/api/approvals/:id/cancel` | `approvals.routes.ts` | yes | id | approval |
| GET | `/api/analytics/{overview,operations,sales,finance,ai,team,channels}` | `analytics.routes.ts` | yes | date range | analytics panels |
| GET/POST | `/api/reports/definitions` | `reports.routes.ts` | yes | body | definitions/definition |
| PATCH/DELETE | `/api/reports/definitions/:id` | `reports.routes.ts` | yes | body/id | definition/ok |
| POST | `/api/reports/generate` | `reports.routes.ts` | yes | report config | generated report |
| GET | `/api/reports/generated` | `reports.routes.ts` | yes | filters | generated reports |
| GET | `/api/reports/generated/:id` | `reports.routes.ts` | yes | id | report |
| GET/POST | `/api/integrations/provider-accounts` | `integrations.routes.ts` | yes | body | accounts/account |
| PATCH | `/api/integrations/provider-accounts/:id` | `integrations.routes.ts` | yes | body | account |
| POST | `/api/integrations/provider-accounts/:id/disable` | `integrations.routes.ts` | yes | id | account |
| GET | `/api/integrations/webhook-events` | `integrations.routes.ts` | yes | limit | events |
| GET | `/api/integrations/webhook-events/:id` | `integrations.routes.ts` | yes | id | event |
| POST | `/api/integrations/webhook-events/:id/replay` | `integrations.routes.ts` | yes | id | safe mock replay |
| GET | `/api/integrations/outbox` | `integrations.routes.ts` | yes | limit | outbox messages |
| GET | `/api/integrations/outbox/:id` | `integrations.routes.ts` | yes | id | outbox message |
| POST | `/api/integrations/outbox/:id/cancel` | `integrations.routes.ts` | yes | id | cancelled message |
| POST | `/api/integrations/outbox/:id/retry` | `integrations.routes.ts` | yes | id | retry status |
| GET | `/api/integrations/health` | `integrations.routes.ts` | yes | none | health statuses |
| POST | `/api/webhooks/:provider` | `webhooks.routes.ts` | no | raw provider payload | recorded/duplicate result |

## 6. Authentication & Roles
- Auth provider: custom app auth, not NextAuth/Clerk.
- Sign-in methods: email + password (`bcryptjs`). Registration creates user/workspace/membership.
- Sessions/cookies strategy: `express-session` + Postgres `session` table through `connect-pg-simple`; cookie `khadamatak.sid`, `httpOnly`, `sameSite=lax`, `secure` in production, 24h max age.
- Auth middleware: `requireSession` validates session user and active workspace.
- RBAC middleware: `requirePermission(permissionSlug)` checks membership roles against seeded `permissions`.
- Roles defined: `owner`, `manager`, `agent`, `accountant`, `viewer`.
- Enforcement location: route modules call `requirePermission`; client pages rely on protected route but server is source of truth.
- RBAC matrix:

| Role | Access summary |
|---|---|
| `owner` | All seeded permissions. |
| `manager` | Broad operational access; excludes `billing:manage`, `users:manage_roles`, `integrations:manage`. |
| `agent` | Contacts, conversations, tickets, tasks, followups, opportunities, orders, basic payments/debts, knowledge read, AI use/read, reports/analytics read, channels/integrations read. |
| `accountant` | Finance-heavy: payments confirm/reject/export, debts write-off/cancel, reports, audit read, limited operational read. |
| `viewer` | Read-only across contacts, ops, finance, knowledge, AI, analytics, reports, integrations, settings, team. |

## 7. Integrations & Channels (CRITICAL)
| Integration/channel | Status | Evidence | Notes |
|---|---|---|---|
| WhatsApp Cloud API | Partial | `integrationTypes.ts`, `provider_accounts`, UI labels | No live send; no Cloud API calls detected. |
| WhatsApp Business Management API | Not started | no Meta management routes | Embedded signup not implemented in current code. |
| Instagram | Partial | provider enum/UI readiness | Planned placeholder only. |
| Facebook Messenger | Partial | provider enum/UI readiness | Planned placeholder only. |
| Telegram | Partial | provider enum/UI readiness | Placeholder/channel type only. |
| Email SMTP/Resend/SendGrid | Not started | no deps/routes | Email channel not implemented. |
| Web Chat widget | Partial | `website_widget` provider/feature flags | No embeddable widget runtime detected. |
| Voice / Phone | Not started | no Twilio/voice deps | Voice appears only as future/readiness text. |
| Salla | Not started | no code/deps | NONE DETECTED. |
| Zid | Not started | no code/deps | NONE DETECTED. |
| Shopify | EXCLUDED FROM SCOPE | no code | Exclude from current Yemen plan. |
| WooCommerce | Not started | no code/deps | NONE DETECTED. |
| TikTok | DEFERRED — exclude from current work | no code | No current work. |
| Generic Webhooks | Partial | `POST /api/webhooks/:provider`, `webhook_events` | Stores raw events; sanitizes sensitive headers; no HMAC verification. |
| Public API keys | Not started | no API key tables/routes | Generated client can send Authorization header, but no public key management. |
| AI provider | Implemented | `ai-provider.ts` | Vertex/Gemini/mock; suggest-only safety prompt. |
| Vector DB / embeddings | Partial | `embeddings_index_reference`, `embedding_status` | Storage/reference schema exists; no live vector DB provider detected. |

## 8. Payment System
- Current provider: NONE external. Manual payment ledger only.
- Files involved:
  - `lib/db/src/schema/payments.ts`
  - `lib/db/src/schema/finance.ts`
  - `artifacts/api-server/src/modules/payments/payments.routes.ts`
  - `artifacts/api-server/src/modules/payments/payment-methods.routes.ts`
  - `artifacts/api-server/src/modules/payments/exchange-rates.routes.ts`
  - `artifacts/web/src/pages/PaymentsPage.tsx`
  - `artifacts/web/src/components/settings/PaymentMethodsTab.tsx`
  - `artifacts/web/src/components/settings/ExchangeRatesTab.tsx`
- Plans/products defined in code: `trial`, `starter`, `pro`, `team` are seeded in `seed.ts`; prices include YER/USD.
- Webhook handlers: no payment provider webhook handlers detected.
- Target note: target state is Yemeni payment (manual bank transfer + local gateways). This audit reports current state only; no proposal included.

## 9. Localization (i18n)
- Languages supported: Arabic UI text is hardcoded; English appears in docs/config/developer-facing names.
- Direction handling: app layout and pages are RTL-oriented; no centralized i18n direction middleware detected.
- Translation files location: NONE DETECTED (`public/locales`, `locales`, `i18n` files not present).
- Missing keys flagged by tooling: NONE DETECTED because no i18n tooling exists.
- Encoding note: terminal output shows mojibake for some Arabic source text, but files contain Arabic UI strings.

## 10. Environment Variables
Keys only; no values printed.

### Auth/session
- `SESSION_SECRET`
- `NODE_ENV`

### Database
- `DATABASE_URL`

### Server/runtime
- `PORT`
- `ALLOWED_ORIGINS`
- `LOG_LEVEL`
- `SERVE_STATIC`

### AI
- `AI_PROVIDER`
- `GEMINI_API_KEY`
- `VERTEX_PROJECT_ID`
- `GCP_PROJECT_ID`
- `GOOGLE_CLOUD_PROJECT`
- `GCLOUD_PROJECT`
- `VERTEX_LOCATION`
- `GCP_LOCATION`
- `GOOGLE_CLOUD_LOCATION`
- `VERTEX_MODEL`
- `AI_MAX_OUTPUT_TOKENS`
- `AI_TEMPERATURE`

### Payment
- NONE DETECTED for live provider secrets.

### Storage
- `STORAGE_PROVIDER`
- `GCS_BUCKET`

### Frontend/build
- `BASE_PATH`
- `REPL_ID`
- `import.meta.env.BASE_URL`

### WhatsApp/Meta
- NONE in live code. Phase prompts/docs mention future `META_*` keys, but current source does not implement them.

### Other
- `.env.example`: NONE DETECTED.

## 11. Background Jobs / Webhooks / Cron
- Queue system: NONE DETECTED. No BullMQ/Inngest/Cloud Tasks package in active code.
- Defined jobs/handlers: no worker process found. `outbox_events` and `outbox_messages` tables exist, but no active sender/dispatcher.
- Cron: NONE DETECTED. No `vercel.json`, Cloud Scheduler config, or cron runner found.
- Webhook endpoints:
  - `POST /api/webhooks/:provider` for generic integration ingestion.
- HMAC verification:
  - Generic webhook endpoint: no.
  - Sensitive incoming headers (`authorization`, `cookie`, `x-api-key`, `x-hub-signature`, `x-hub-signature-256`) are stripped before persistence.
- Idempotency:
  - Webhook event key from known event/message id or payload hash.
  - Unique index on `provider + idempotency_key`.

## 12. Gap Analysis vs Target Blueprint
| Section | Status (✅ done / 🟡 partial / ❌ missing) | Files involved | Notes |
|---|---|---|---|
| Overview | ✅ done | `DashboardPage.tsx`, `dashboard.routes.ts`, `analytics.routes.ts` | Dashboard metrics and recent activity exist. |
| Inbox | ✅ done | `InboxPage.tsx`, `conversations.routes.ts`, `messages` schema | Manual inbox, conversation/message APIs, AI buttons. |
| Contacts | ✅ done | `ContactsPage.tsx`, `ContactProfilePage.tsx`, `contacts.routes.ts` | Contacts, channels, notes, timeline. |
| Bots & Agents | 🟡 partial | `AgentsPage.tsx`, `ai.routes.ts`, `ai-provider.ts` | Agents and AI runs exist; no auto-send by design. |
| Knowledge Base | ✅ done | `KnowledgePage.tsx`, `knowledge.routes.ts`, knowledge schema | Bases, sources, docs, FAQs, chunks, search. |
| Templates | ❌ missing | none | No template model/page found. |
| Broadcasts & Campaigns | ❌ missing | none | No bulk campaign system; should remain out of current scope. |
| Automations | 🟡 partial | permissions only, AI suggestions | Automation permissions exist; no automation engine/workers. |
| Scheduling | 🟡 partial | `followups`, task due dates, reports definitions | Followups/schedules exist; no calendar sync/cron engine. |
| Voice | ❌ missing | none | No voice provider or call flows. |
| Analytics | ✅ done | `AnalyticsPage.tsx`, `ReportsPage.tsx`, reports/analytics routes | Multiple analytics panels and report generation. |
| Integrations | 🟡 partial | `IntegrationsPage.tsx`, integration spine tables/routes | Ledger/outbox/webhook spine exists; live Meta channels not active. |
| Team | ✅ done | `SettingsPage.tsx`, `users.routes.ts`, RBAC schema | Members, roles, invitations/role patch. |
| Settings | ✅ done | `SettingsPage.tsx`, workspace/payment/exchange routes | Workspace settings, payment methods, exchange rates. |

## 13. Top 10 Findings
- The active product is clearly a Google Cloud Run monorepo, but old Replit docs and `attached_assets` phase prompts remain in the repo and can confuse future audits.
- `artifacts/mockup-sandbox` duplicates the UI component library used by `artifacts/web`; it is useful for design but should not be mistaken for production UI.
- Generic webhook ingestion lacks HMAC/signature verification; sensitive headers are sanitized, but authenticity is not enforced.
- Meta Embedded Signup / WhatsApp Business Management / Instagram / Messenger are not implemented live; only integration spine and placeholders exist.
- `.env.example` is missing, so environment variable discovery currently relies on code/runbooks rather than a canonical key list.
- No centralized i18n translation system exists; Arabic/RTL is hardcoded across pages.
- Storage has schema and env placeholders but no upload/file lifecycle flow in active UI/API.
- Billing plans/subscriptions are seeded, but no complete customer billing workflow or payment gateway exists.
- `db:push` scripts exist in `lib/db/package.json` with DEV ONLY warnings; production runbooks correctly prefer migrations.
- TODO/FIXME scan: live code has no clear TODO/FIXME; `replit.md:394` references a historical TODO, and `attached_assets/*` contains old prompt TODO text. Search also matched `XXX` inside a lockfile integrity hash, not a code TODO.

## 14. Open Questions for the Architect
1. Should `artifacts/mockup-sandbox` stay in the production repo, or be split into design-only tooling?
2. Should `.env.example` be added as the canonical non-secret env contract?
3. Is the future Meta implementation expected to reuse `channel_accounts`, `provider_accounts`, or both as the primary account record?
4. Should generic webhooks be public for all providers, or should each provider get explicit signature verification routes?
5. Should AI prompts and sources be redacted further from logs/DB for customer privacy?
6. Are templates/campaigns intentionally deferred, or needed before first paid pilot?
7. Should the hardcoded Arabic UI become an i18n layer before adding English/admin support?
8. Which Yemeni payment methods are first-class: كريمي, جوالي, cash, bank transfer, or others?
9. Should subscriptions/billing remain internal/admin-only until local payment is ready?
10. What is the intended cleanup policy for `attached_assets` and demo docs after architecture review?
