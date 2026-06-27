# Wesal One — Owner User Journey Checklist

**Purpose:** PASS/FAIL checklist to run after every production deployment and before enabling any feature flag.
**Service:** https://www.wesal.one
**Cloud Run service:** `khadamatak-staging` (region: `us-central1`, project: `khadamatk-auth`)

---

## Pre-flight: API Health

Run before anything else. All must be ✅ before continuing.

| Check | Command / URL | Expected | Result |
|---|---|---|---|
| Site loads | `GET https://www.wesal.one/` | 200 HTML | |
| API alive | `GET https://www.wesal.one/api/auth/me` | 401 JSON | |
| Webhook handler alive | `GET https://www.wesal.one/api/webhooks/meta` | 403 (no verify token) | |
| Workspace API alive | `GET https://www.wesal.one/api/workspace` | 401 JSON | |

---

## A. Registration

| # | Step | Expected | PASS/FAIL |
|---|---|---|---|
| A-1 | Open `https://www.wesal.one` in an incognito window | Login page loads in Arabic, RTL | |
| A-2 | Click **إنشاء حساب** (Register) | Registration form appears | |
| A-3 | Enter name, email, password (≥8 chars), workspace name | Fields accept input | |
| A-4 | Submit the form | Account created; redirect to onboarding or dashboard | |
| A-5 | Check email for verification (if enabled) | Email received within 60 s | |
| A-6 | Log in with new credentials | Dashboard loads with workspace name | |
| A-7 | `GET /api/auth/me` with session cookie | Returns `{ id, email, workspaceId }` (not 401) | |

---

## B. Channel Connection (WhatsApp via Meta)

| # | Step | Expected | PASS/FAIL |
|---|---|---|---|
| B-1 | Go to **الإعدادات → القنوات** (Settings → Channels) | Channel list page loads | |
| B-2 | Click **ربط واتساب** (Connect WhatsApp) | Meta OAuth or manual config wizard opens | |
| B-3 | Complete Meta Business verification or enter phone_number_id + token | Channel appears in list with status **نشط** | |
| B-4 | `GET /api/channels` — confirm channel_account row exists | Returns channel with `channel_type=whatsapp_api`, `status=active` | |
| B-5 | Send a test WhatsApp message to the connected number | Message appears in inbox within 5 s | |
| B-6 | Check `webhook_events` table (inline mode): **no row** added | 0 rows when `INGEST_DEFERRED=false` | |

---

## C. Connect a Second Channel Account

| # | Step | Expected | PASS/FAIL |
|---|---|---|---|
| C-1 | Connect a second WhatsApp number (different phone_number_id) | Second channel appears in list | |
| C-2 | Send a test message to each number | Each message lands in the correct conversation (no cross-contamination) | |
| C-3 | Connect an Instagram account | IG channel appears with `channel_type=instagram` | |
| C-4 | Send a DM to the IG account | IG message appears in inbox | |
| C-5 | Confirm workspace_id isolation: second workspace cannot see first workspace's conversations | `GET /api/conversations` returns only this workspace's data | |

---

## D. Messages — Inbound and Outbound

| # | Step | Expected | PASS/FAIL |
|---|---|---|---|
| D-1 | Open an inbound conversation | Conversation detail renders, all messages visible | |
| D-2 | Type a manual reply and send | Reply sent; delivery status → **مُسلَّم** (delivered) | |
| D-3 | Check `outbox_events` row | Row created with `status=sent`, `sent_at` populated | |
| D-4 | Receive a media message (image/voice) | Media message displayed with correct label (صورة / رسالة صوتية) | |
| D-5 | Check `messages` table for media | `content_type` correct; `attachments` JSON has media_id | |
| D-6 | Send a message >4096 chars | Truncation or error surfaced — not silent failure | |

---

## E. AI Agent

| # | Step | Expected | PASS/FAIL |
|---|---|---|---|
| E-1 | Go to **الوكلاء** (Agents) → Create new agent (wizard) | 5-step wizard: name → model → prompt → channel → activate | |
| E-2 | Set agent status to **نشط** (active) on a channel | Agent visible in channel list | |
| E-3 | Send a new inbound message on the connected channel | Agent replies within 10 s | |
| E-4 | Verify reply in `messages` table | `sender_type=agent`, `sender_id=NULL`, `sender_name=<agent name>`, `source=ai` | |
| E-5 | Verify `domain_events` row | `event_type=message.received`, linked to conversation | |
| E-6 | Verify `outbox_events` row for AI reply | `status=sent`; `idempotency_key` starts with `de:` or `auto:` | |
| E-7 | Check points deduction | `point_ledger` has negative entry for AI token usage | |

---

## F. Human Handoff

| # | Step | Expected | PASS/FAIL |
|---|---|---|---|
| F-1 | In an active AI conversation, click **تحويل لبشري** (Escalate) | Conversation `agent_status` → `human` | |
| F-2 | Confirm AI does NOT reply to next customer message | No new AI message in conversation | |
| F-3 | Assign conversation to a team member | `assigned_membership_id` populated | |
| F-4 | Team member sends reply | Reply delivered; `sender_type=agent` (human agent via dashboard) | |
| F-5 | Re-enable AI on conversation | AI resumes auto-reply on next message | |

---

## G. Disconnect Channel

| # | Step | Expected | PASS/FAIL |
|---|---|---|---|
| G-1 | Go to Settings → Channels → Select active channel → Disconnect | Confirmation dialog appears | |
| G-2 | Confirm disconnect | Channel status → **غير نشط** (inactive); removed from Meta app subscriptions if applicable | |
| G-3 | Send a message to the disconnected number | No conversation created; no error surfaced to Meta (returns 200) | |
| G-4 | Inbox not affected | Existing conversations still visible; historical messages intact | |

---

## H. Reconnect Channel

| # | Step | Expected | PASS/FAIL |
|---|---|---|---|
| H-1 | Reconnect the same WhatsApp number | Channel status → **نشط** again | |
| H-2 | Send a new inbound message | Message received; appears in existing conversation (same thread, no duplicate) | |
| H-3 | AI agent resumes (if previously active on this channel) | Auto-reply on next message | |

---

## I. INGEST_DEFERRED=true Verification

**Only run this section after sections A–H all pass with `INGEST_DEFERRED=false`.**

### Enable deferred mode
```bash
gcloud run services update khadamatak-staging \
  --region=us-central1 \
  --project=khadamatk-auth \
  --update-env-vars INGEST_DEFERRED=true \
  --quiet
```

### I-1 Verify fast-ack path

| # | Step | Expected | PASS/FAIL |
|---|---|---|---|
| I-1a | Send a WhatsApp message after enabling flag | Meta receives 200 immediately (<500 ms) | |
| I-1b | Check `webhook_events` table | Row created with `status=received`, `correlation_id` set | |
| I-1c | Wait ≤6 s (worker polls every 3 s) | Row status → `processed` | |
| I-1d | Check `messages` table | Inbound message row created | |
| I-1e | Check `domain_events` table | `event_type=message.received` row created | |
| I-1f | AI reply arrives | AI reply sent within 15 s total | |

### I-2 Dedup test

| # | Step | Expected | PASS/FAIL |
|---|---|---|---|
| I-2a | Replay the same webhook payload (same message id) | `webhook_events` dedup — only 1 row; no duplicate message | |

### I-3 Failure and retry

| # | Step | Expected | PASS/FAIL |
|---|---|---|---|
| I-3a | (With Cloud Logging access) Check `webhook_events` rows stuck in `processing` | Cleanup job resets them to `received` after 10 min | |
| I-3b | Row with `retry_count=3` | Status → `failed`; `dead_letter_events` row created; CRITICAL log alert fired | |

### Disable deferred mode (if anything fails in I-*)
```bash
gcloud run services update khadamatak-staging \
  --region=us-central1 \
  --project=khadamatk-auth \
  --remove-env-vars INGEST_DEFERRED \
  --quiet
```

---

## Deployment Monitoring

### Cloud Build status (requires gcloud auth)
```bash
gcloud builds list \
  --project=khadamatk-auth \
  --limit=5 \
  --format="table(id,status,createTime,duration,substitutions.SHORT_SHA)"
```

### Tail build logs
```bash
gcloud builds log <BUILD_ID> --project=khadamatk-auth --stream
```

### Check current Cloud Run env vars
```bash
gcloud run services describe khadamatak-staging \
  --region=us-central1 \
  --project=khadamatk-auth \
  --format="value(spec.template.spec.containers[0].env)"
```

---

## Known Constraints

- `INGEST_DEFERRED=false` is the **safe default**. The inline path in `POST /api/webhooks/meta` is the proven production path.
- `INGEST_DEFERRED=true` activates fast-ack + worker dispatch. The outbox worker (`outbox-worker` container / same binary) must be running for deferred mode to process events.
- Worker loop is gated: the ingestion dispatcher loop only starts when the worker process reads `INGEST_DEFERRED=true` from its own environment. Check the worker's env separately if it's a separate Cloud Run service.
- Do not enable `INGEST_DEFERRED=true` in production unless sections A–H above are all ✅ and Cloud Logging shows `outbox-worker` polling.
- Do not start W3 until this document is fully filled in and signed off by the owner.
