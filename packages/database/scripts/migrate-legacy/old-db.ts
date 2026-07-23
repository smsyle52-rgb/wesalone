// Raw read-only client for the OLD Wesal One database (khadamatak `lib/db` schema).
// Not a workspace dependency — that schema lives in a separate repo — so this talks
// to it with plain parameterized SQL instead of importing its Drizzle models.
//
// Point OLD_DATABASE_URL at a scratch copy (restored snapshot), never at the real
// instance, until Phase 3 (real cutover) explicitly says otherwise.
//
// IMPORTANT — confirmed against the real Cloud SQL instance during Phase 2: the
// database actually holding live customer data is named `khadamatak_staging`,
// NOT `khadamatak_prod` (that name is stale/abandoned since 2026-05-05, just 1
// leftover workspace). Same naming trap as the Cloud Run service itself. Point
// OLD_DATABASE_URL's dbname at `khadamatak_staging` (or a scratch clone of it).

import { Pool, type QueryResultRow } from "pg"

const oldDatabaseUrl = process.env.OLD_DATABASE_URL
if (!oldDatabaseUrl) {
  throw new Error(
    "OLD_DATABASE_URL is required (point it at a scratch copy of khadamatak-prod).",
  )
}

export const oldPool = new Pool({
  connectionString: oldDatabaseUrl,
  max: 1,
})

// A single long-lived pooled connection over a Cloud SQL proxy tunnel can drop
// mid-query during a long run (observed twice during Phase 2's dry run, always
// inside the Step 5 per-conversation message loop — hundreds of sequential
// queries over one connection). `pg.Pool` opens a fresh connection for the
// *next* query fine on its own; the problem is only the query that was
// in-flight when the drop happened. Retry just that one query a few times
// before giving up, instead of failing the whole run over a transient blip.
const query = async <T extends QueryResultRow>(
  text: string,
  params?: unknown[],
  attempts = 4,
) => {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await oldPool.query<T>(text, params)
    } catch (error) {
      lastError = error
      const code = (error as { code?: string } | undefined)?.code
      if (code !== "ECONNRESET" && code !== "ETIMEDOUT" && code !== "EPIPE") {
        throw error
      }
      console.warn(
        `old-db: transient connection error (${code}), retry ${attempt}/${attempts}`,
      )
    }
  }
  throw lastError
}

export type OldWorkspace = {
  id: string
  name: string
  slug: string
  status: string
  createdAt: Date
  updatedAt: Date
}

// Scope confirmed directly with the owner during Phase 2 (191 total workspaces
// exist, almost all untouched trial signups): migrate only workspaces that are
// either on a paid+active subscription, or have connected at least one channel
// — i.e. someone actually used the product, paying or not. Verified this exact
// filter against the real data (32 workspaces) before wiring it in here.
export const fetchOldWorkspaces = async (): Promise<OldWorkspace[]> => {
  const result = await query<OldWorkspace>(
    `SELECT DISTINCT w.id, w.name, w.slug, w.status,
            w.created_at AS "createdAt", w.updated_at AS "updatedAt"
     FROM workspaces w
     LEFT JOIN subscriptions s ON s.workspace_id = w.id
     LEFT JOIN plans p ON p.id = s.plan_id
     WHERE (s.status = 'active' AND p.slug != 'free')
        OR EXISTS (SELECT 1 FROM channel_accounts ca WHERE ca.workspace_id = w.id)
     ORDER BY w.created_at ASC`,
  )
  return result.rows
}

export type OldWorkspaceOwner = {
  workspaceId: string
  userId: string
  email: string
  name: string
  status: string
}

// The old schema has no first-class "owner" column on workspace_memberships —
// ownership is a membership row linked (via the membership_roles join table) to
// the system role whose slug is 'owner'. A workspace with zero or more-than-one
// owner membership is a data problem to resolve by hand before migrating that
// workspace, not something this query should guess at silently.
export const fetchOldWorkspaceOwners = async (): Promise<
  OldWorkspaceOwner[]
> => {
  const result = await query<OldWorkspaceOwner>(
    `SELECT wm.workspace_id AS "workspaceId", u.id AS "userId", u.email, u.name, u.status
     FROM workspace_memberships wm
     JOIN membership_roles mr ON mr.membership_id = wm.id
     JOIN roles r ON r.id = mr.role_id
     JOIN users u ON u.id = wm.user_id
     WHERE r.slug = 'owner'
     ORDER BY wm.workspace_id ASC`,
  )
  return result.rows
}

// ─── Step 2: subscription payment history ─────────────────────────────────

export type OldSubscriptionPayment = {
  id: string
  workspaceId: string
  planSlug: string | null
  billingCycle: string
  paymentMethod: string
  reference: string | null
  receiptNote: string | null
  rejectionReason: string | null
  status: string
  reviewedBy: string | null
  reviewedAt: Date | null
  createdAt: Date
}

// submission_type='subscription' only — 'point_topup' rows are the OLD system's
// proof-of-payment for a point purchase order and feed Step 3 instead.
export const fetchOldSubscriptionPayments = async (): Promise<
  OldSubscriptionPayment[]
> => {
  const result = await query<OldSubscriptionPayment>(
    `SELECT ps.id, ps.workspace_id AS "workspaceId", p.slug AS "planSlug",
            ps.billing_cycle AS "billingCycle", ps.payment_method AS "paymentMethod",
            ps.reference, ps.receipt_note AS "receiptNote", ps.rejection_reason AS "rejectionReason",
            ps.status, ps.reviewed_by AS "reviewedBy", ps.reviewed_at AS "reviewedAt",
            ps.created_at AS "createdAt"
     FROM payment_submissions ps
     LEFT JOIN plans p ON p.id = ps.plan_id
     WHERE ps.submission_type = 'subscription'
     ORDER BY ps.created_at ASC`,
  )
  return result.rows
}

// ─── Step 3: points wallet / grants / ledger ───────────────────────────────
// OLD already stores amounts in micro-points (1 visible point = 1,000,000
// micro — see original_micro_points/remaining_micro_points column names and
// the Arabic comment in lib/db/src/schema/point_wallet.ts), same convention
// NEW uses. No unit conversion needed, despite the migration plan's original
// "scale x1,000,000 if needed" caveat — confirmed unnecessary by reading the
// actual column definitions rather than trusting the earlier research summary.

export type OldPointWallet = { id: string; workspaceId: string; status: string }
export const fetchOldPointWallets = async (): Promise<OldPointWallet[]> => {
  const result = await query<OldPointWallet>(
    `SELECT id, workspace_id AS "workspaceId", status FROM point_wallets ORDER BY created_at ASC`,
  )
  return result.rows
}

export type OldPointGrant = {
  id: string
  workspaceId: string
  walletId: string
  grantType: string
  originalMicroPoints: string
  remainingMicroPoints: string
  startsAt: Date
  expiresAt: Date | null
  status: string
  sourceType: string | null
  sourceId: string | null
  createdAt: Date
}
export const fetchOldPointGrants = async (): Promise<OldPointGrant[]> => {
  const result = await query<OldPointGrant>(
    `SELECT id, workspace_id AS "workspaceId", wallet_id AS "walletId", grant_type AS "grantType",
            original_micro_points::text AS "originalMicroPoints",
            remaining_micro_points::text AS "remainingMicroPoints",
            starts_at AS "startsAt", expires_at AS "expiresAt", status,
            source_type AS "sourceType", source_id AS "sourceId", created_at AS "createdAt"
     FROM point_grants
     ORDER BY created_at ASC`,
  )
  return result.rows
}

export type OldPointLedgerEntry = {
  id: string
  workspaceId: string
  walletId: string
  grantId: string | null
  transactionType: string
  microPoints: string
  sourceType: string | null
  sourceId: string | null
  reason: string | null
  actorType: string | null
  actorId: string | null
  createdAt: Date
}
export const fetchOldPointLedger = async (): Promise<OldPointLedgerEntry[]> => {
  const result = await query<OldPointLedgerEntry>(
    `SELECT id, workspace_id AS "workspaceId", wallet_id AS "walletId", grant_id AS "grantId",
            transaction_type AS "transactionType", micro_points::text AS "microPoints",
            source_type AS "sourceType", source_id AS "sourceId", reason,
            actor_type AS "actorType", actor_id AS "actorId", created_at AS "createdAt"
     FROM point_ledger
     ORDER BY created_at ASC`,
  )
  return result.rows
}

// ─── Step 4: contacts + channel accounts ───────────────────────────────────

export type OldContact = {
  id: string
  workspaceId: string
  name: string | null
  phone: string | null
  email: string | null
  createdAt: Date
}
export const fetchOldContacts = async (): Promise<OldContact[]> => {
  const result = await query<OldContact>(
    `SELECT id, workspace_id AS "workspaceId", name, phone, email, created_at AS "createdAt"
     FROM contacts
     ORDER BY created_at ASC`,
  )
  return result.rows
}

export type OldChannelAccount = {
  id: string
  workspaceId: string
  channelType: string
  name: string
  externalAccountId: string | null
  createdAt: Date
}
export const fetchOldChannelAccounts = async (): Promise<
  OldChannelAccount[]
> => {
  const result = await query<OldChannelAccount>(
    `SELECT id, workspace_id AS "workspaceId", channel_type AS "channelType", name,
            external_account_id AS "externalAccountId", created_at AS "createdAt"
     FROM channel_accounts
     ORDER BY created_at ASC`,
  )
  return result.rows
}

// ─── Step 5: conversations + messages ──────────────────────────────────────

export type OldConversation = {
  id: string
  workspaceId: string
  contactId: string | null
  channelAccountId: string | null
  createdAt: Date
}
export const fetchOldConversations = async (): Promise<OldConversation[]> => {
  const result = await query<OldConversation>(
    `SELECT id, workspace_id AS "workspaceId", contact_id AS "contactId",
            channel_account_id AS "channelAccountId", created_at AS "createdAt"
     FROM conversations
     ORDER BY created_at ASC`,
  )
  return result.rows
}

export type OldMessage = {
  id: string
  conversationId: string
  workspaceId: string
  direction: string
  senderType: string
  content: string
  contentType: string
  createdAt: Date
}
export const fetchOldMessages = async (
  conversationId: string,
): Promise<OldMessage[]> => {
  const result = await query<OldMessage>(
    `SELECT id, conversation_id AS "conversationId", workspace_id AS "workspaceId",
            direction, sender_type AS "senderType", content, content_type AS "contentType",
            created_at AS "createdAt"
     FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId],
  )
  return result.rows
}

// One query for every migrated workspace's messages, grouped by conversation,
// instead of one query per conversation (hundreds of round-trips over a proxy
// tunnel that's shown real transient instability during Phase 2 — fewer,
// bigger round-trips are both faster and far less exposed to that).
export const fetchAllOldMessagesByConversation = async (
  oldWorkspaceIds: string[],
): Promise<Map<string, OldMessage[]>> => {
  const result = await query<OldMessage>(
    `SELECT id, conversation_id AS "conversationId", workspace_id AS "workspaceId",
            direction, sender_type AS "senderType", content, content_type AS "contentType",
            created_at AS "createdAt"
     FROM messages
     WHERE workspace_id = ANY($1)
     ORDER BY conversation_id ASC, created_at ASC`,
    [oldWorkspaceIds],
  )
  const byConversation = new Map<string, OldMessage[]>()
  for (const message of result.rows) {
    const bucket = byConversation.get(message.conversationId)
    if (bucket) {
      bucket.push(message)
    } else {
      byConversation.set(message.conversationId, [message])
    }
  }
  return byConversation
}

// ─── Step 6: knowledge base (text content only, see migration plan) ───────

export type OldKnowledgeDocument = {
  id: string
  workspaceId: string
  title: string
  contentText: string
  createdAt: Date
}
export const fetchOldKnowledgeDocuments = async (): Promise<
  OldKnowledgeDocument[]
> => {
  const result = await query<OldKnowledgeDocument>(
    `SELECT id, workspace_id AS "workspaceId", title, content_text AS "contentText", created_at AS "createdAt"
     FROM knowledge_documents
     ORDER BY created_at ASC`,
  )
  return result.rows
}

export type OldKnowledgeChunk = {
  id: string
  workspaceId: string
  documentId: string
  chunkIndex: number
  chunkText: string
}
export const fetchOldKnowledgeChunks = async (
  documentId: string,
): Promise<OldKnowledgeChunk[]> => {
  const result = await query<OldKnowledgeChunk>(
    `SELECT id, workspace_id AS "workspaceId", document_id AS "documentId",
            chunk_index AS "chunkIndex", chunk_text AS "chunkText"
     FROM knowledge_chunks
     WHERE document_id = $1
     ORDER BY chunk_index ASC`,
    [documentId],
  )
  return result.rows
}

export const closeOldPool = () => oldPool.end()
