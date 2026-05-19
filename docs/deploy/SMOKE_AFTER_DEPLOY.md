# 10-Minute Smoke Test After Every Deploy

Run this after each production or staging deploy. Keep `META_DRY_RUN=true` unless the owner intentionally runs a live send test.

## 1. Register a test account

What to do:
- Open the deployed app URL.
- Register a test owner account using a clearly marked test email.

Verify:
- Registration succeeds.
- User lands in dashboard.
- No console errors.

If it fails:
- Check auth/session secrets.
- Check seed completed and roles exist.

## 2. Create a test workspace

What to do:
- Create a workspace named `SMOKE-<date>-Workspace`.

Verify:
- Workspace appears in session.
- Dashboard loads.

If it fails:
- Check `workspaces`, `workspace_memberships`, `membership_roles`.

## 3. Connect a channel via Embedded Signup, or skip if Meta not configured

What to do:
- If Meta env vars are configured, open Integrations and start Embedded Signup.
- If Meta is not configured, skip and keep manual/DRY_RUN channel testing.

Verify:
- Channel account is created or config-missing is clearly shown.
- No token value is visible in UI/logs.

If it fails:
- Keep `META_DRY_RUN=true`.
- Check Meta app config and redirect URI.

## 4. Create an agent

What to do:
- Create an agent named `SMOKE Agent`.
- System prompt: `أجب فقط من معرفة النشاط، وإذا لم تعرف قل سأتحقق من المعلومة.`
- Keep trust mode as `suggest`.

Verify:
- Agent status is active.
- Trust mode is `suggest`.

If it fails:
- Check `ai_agents` and permissions `ai:configure`.

## 5. Upload or create a knowledge document

What to do:
- Create a knowledge base and document:
  - Title: `SMOKE Pricing`
  - Content: `سعر القميص الأبيض 12000 ريال يمني، والتوصيل داخل صنعاء خلال 24 ساعة.`

Verify:
- Document status is ready.
- Chunks exist.

SQL:

```sql
SELECT d.title, count(c.id) AS chunks
FROM knowledge_documents d
LEFT JOIN knowledge_chunks c ON c.document_id = d.id
WHERE d.title LIKE 'SMOKE%'
GROUP BY d.title;
```

If it fails:
- Run KB chunking/backfill.
- Check `knowledge:write` permission.

## 6. Send an inbound message to the channel

What to do:
- If Meta test number is configured, send: `كم سعر القميص الأبيض؟`
- If not, use the internal webhook dry-run/test method with a Meta-shaped payload.

Verify:
- Webhook returns 2xx.
- Message appears in Inbox.

SQL:

```sql
SELECT id, direction, source, content, created_at
FROM messages
WHERE created_at > now() - interval '10 minutes'
ORDER BY created_at DESC;
```

If it fails:
- Check webhook HMAC.
- Check channel account phone number ID.
- Check Cloud Run logs for webhook errors.

## 7. Verify Inbox

What to do:
- Open Inbox.
- Locate the smoke conversation.

Verify:
- Inbound message is visible.
- Realtime indicator is live or reconnecting gracefully.
- No broken page.

If it fails:
- Check `/api/inbox/stream`.
- Check browser console.

## 8. Generate draft reply

What to do:
- Click suggested/draft reply action for the conversation.

Verify:
- Draft reply mentions the KB answer.
- It does not auto-send while trust mode is `suggest`.
- Sources appear if UI exposes them.

SQL:

```sql
SELECT task_type, status, provider, created_at
FROM ai_runs
WHERE created_at > now() - interval '10 minutes'
ORDER BY created_at DESC;
```

If it fails:
- Check Vertex env vars or fallback mode.
- Check KB binding on the agent.

## 9. Verify auto_reply_decisions reason is `trust_mode_off`

SQL:

```sql
SELECT decision, reason, confidence, topic_detected, created_at
FROM auto_reply_decisions
WHERE created_at > now() - interval '10 minutes'
ORDER BY created_at DESC
LIMIT 10;
```

Expected:
- `decision='suggest_only'`
- `reason='trust_mode_off'`

If it fails:
- Confirm the request used an agent with trust settings.
- Confirm trust mode is `suggest`.

## 10. Flip agent to auto mode for controlled smoke

What to do:
- Set agent trust mode to `auto`.
- Add trust topic: pricing.
- Keep `META_DRY_RUN=true`.

Verify:
- Agent settings save.
- No outbound live send occurs while DRY_RUN is true.

If it fails:
- Leave trust mode as `suggest`.

## 11. Send another matching message

Message:

```text
كم سعر القميص الأبيض؟
```

Verify:
- New auto_reply_decision exists.
- If KB confidence passes, decision is `auto_sent`.
- Outbox event is created.

SQL:

```sql
SELECT decision, reason, confidence, topic_detected, created_at
FROM auto_reply_decisions
WHERE created_at > now() - interval '10 minutes'
ORDER BY created_at DESC
LIMIT 10;

SELECT event_type, status, idempotency_key, created_at
FROM outbox_events
WHERE created_at > now() - interval '10 minutes'
ORDER BY created_at DESC
LIMIT 10;
```

Expected:
- `message.send.whatsapp.text` outbox event.
- In DRY_RUN, worker can mark it sent without a real provider call.

If it fails:
- Check trust topics and KB confidence.
- Check worker logs.
- Keep DRY_RUN enabled.

## 12. End smoke safely

What to do:
- Return agent trust mode to `suggest` unless owner approves continuing.
- Keep test data clearly named with `SMOKE-`.

Verify:
- No real customer data affected.
- No secrets exposed.
- `/api/readyz` remains 200.
