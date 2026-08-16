// Step 5: old `conversations` + `messages` -> new `Conversation` + `Message`,
// synthesizing the `ContactInbox` join row (contact <-> inbox pairing) that
// OLD has no table for — one ContactInbox per distinct (contact, channel
// account) pair actually seen in the old conversation data, created here the
// first time that pair is encountered.
//
// `sourceId`/`source` on ContactInbox are set to clearly-synthetic
// `legacy-import:...` values (confirmed against a real creation call in
// packages/business/src/contact/service.ts: sourceId there is just an opaque
// id, not a meaningful external identifier — safe to synthesize for migrated
// history rather than needing OLD's actual provider-side identifiers).
//
// Conversation: NEW allows at most one conversation with sourceId=null per
// contact (the "DM" slot) plus any number with a non-null sourceId. OLD has
// no such constraint, so the first old conversation migrated per contact
// takes the null-sourceId DM slot; any additional old conversations for the
// same contact (multi-thread — uncommon but possible) get a synthetic
// sourceId instead of violating that uniqueness. Worth a spot check in the
// Phase 2 manual verification if any workspace shows this.

import { db } from "../../../src/client"
import {
  contactInboxModel,
  conversationModel,
  messageModel,
} from "../../../src/schema"
import { BATCH_SIZE, chunk } from "../batch"
import { getOrCreateId } from "../id-map"
import {
  fetchAllOldMessagesByConversation,
  fetchOldConversations,
} from "../old-db"
import type { WorkspaceMigrationResult } from "./01-workspaces"

const MESSAGE_TYPES = ["incoming", "outgoing", "activity"] as const
const CONTENT_TYPES = ["text", "location", "refLink"] as const
const SENDER_TYPES = ["bot", "contact", "system", "user", "api"] as const

// NEW's contentType enum has no "media" value at all — a media message there
// is a Message row plus a separate Attachment row pointing at real stored file
// bytes, not a text content type. This script does NOT migrate `messages.
// attachments` (the old jsonb column holding the actual file reference) or any
// file bytes — that's a distinct, larger piece of work (copying real files
// between storage backends) intentionally out of scope here, same spirit as
// not migrating WhatsApp credentials or knowledge embeddings. Every "media"
// message lands as a text row with no attachment, and is counted separately
// below so this gap is visible rather than lost in generic warning noise.
const unrecognizedContentTypeCounts = new Map<string, number>()

const validate = <T extends string>(
  allowed: readonly T[],
  value: string,
  fallback: T,
  label: string,
): T => {
  if ((allowed as readonly string[]).includes(value)) {
    return value as T
  }
  if (label === "content type") {
    unrecognizedContentTypeCounts.set(
      value,
      (unrecognizedContentTypeCounts.get(value) ?? 0) + 1,
    )
    return fallback
  }
  console.warn(
    `Step 5: unrecognized ${label} "${value}", defaulting to "${fallback}"`,
  )
  return fallback
}

const mapMessageType = (direction: string) =>
  direction === "inbound" ? "incoming" : "outgoing"

const mapSenderType = (
  oldSenderType: string,
): (typeof SENDER_TYPES)[number] => {
  const lowered = oldSenderType.toLowerCase()
  if (["ai", "agent", "assistant", "bot"].includes(lowered)) {
    return "bot"
  }
  if (["contact", "customer", "client"].includes(lowered)) {
    return "contact"
  }
  if (["system"].includes(lowered)) {
    return "system"
  }
  if (["user", "staff", "admin"].includes(lowered)) {
    return "user"
  }
  console.warn(
    `Step 5: unrecognized sender type "${oldSenderType}", defaulting to "system"`,
  )
  return "system"
}

export const migrateConversations = async (
  workspaces: WorkspaceMigrationResult[],
) => {
  const newWorkspaceIdByOld = new Map(
    workspaces.map((w) => [w.oldWorkspaceId, w.newWorkspaceId]),
  )
  const dmSlotTakenByContact = new Set<string>()
  const contactInboxIdByPair = new Map<string, string>() // `${newContactId}:${newInboxId}` -> ContactInbox.id

  const conversations = await fetchOldConversations()
  const messagesByConversation = await fetchAllOldMessagesByConversation(
    workspaces.map((w) => w.oldWorkspaceId),
  )
  let conversationsMigrated = 0
  let skippedConversations = 0
  const messageRows: (typeof messageModel.$inferInsert)[] = []
  const contactInboxRows: (typeof contactInboxModel.$inferInsert)[] = []
  const conversationRows: (typeof conversationModel.$inferInsert)[] = []

  for (const conversation of conversations) {
    const newWorkspaceId = newWorkspaceIdByOld.get(conversation.workspaceId)
    const newContactId = conversation.contactId
      ? getOrCreateId("contact", conversation.contactId)
      : undefined
    const newInboxId = conversation.channelAccountId
      ? getOrCreateId("inbox", conversation.channelAccountId)
      : undefined

    if (!(newWorkspaceId && newContactId && newInboxId)) {
      skippedConversations += 1
      continue
    }

    // ── ContactInbox: create once per (contact, inbox) pair ──
    const pairKey = `${newContactId}:${newInboxId}`
    let contactInboxId = contactInboxIdByPair.get(pairKey)
    if (!contactInboxId) {
      contactInboxId = getOrCreateId("contactInbox", pairKey)
      contactInboxRows.push({
        id: contactInboxId,
        originalContactId: newContactId,
        contactId: newContactId,
        inboxId: newInboxId,
        channel: "legacy-import",
        source: "legacy-import",
        sourceId: `legacy-import:${pairKey}`,
      })
      contactInboxIdByPair.set(pairKey, contactInboxId)
    }

    // ── Conversation ──
    const newConversationId = getOrCreateId("conversation", conversation.id)
    const takesDmSlot = !dmSlotTakenByContact.has(newContactId)
    if (takesDmSlot) {
      dmSlotTakenByContact.add(newContactId)
    }

    conversationRows.push({
      id: newConversationId,
      workspaceId: newWorkspaceId,
      contactId: newContactId,
      sourceId: takesDmSlot ? undefined : `legacy-import:${conversation.id}`,
      createdAt: conversation.createdAt,
    })
    conversationsMigrated += 1

    // ── Messages (collected, batch-inserted after the loop) ──
    const messages = messagesByConversation.get(conversation.id) ?? []
    for (const message of messages) {
      messageRows.push({
        id: getOrCreateId("message", message.id),
        conversationId: newConversationId,
        contactInboxId,
        workspaceId: newWorkspaceId,
        text: message.content,
        messageType: validate(
          MESSAGE_TYPES,
          mapMessageType(message.direction),
          "outgoing",
          "message type",
        ),
        contentType: validate(
          CONTENT_TYPES,
          message.contentType,
          "text",
          "content type",
        ),
        senderType: mapSenderType(message.senderType),
        createdAt: message.createdAt,
      })
    }
  }

  for (const rows of chunk(contactInboxRows, BATCH_SIZE)) {
    await db
      .insert(contactInboxModel)
      .values(rows)
      .onConflictDoNothing({ target: contactInboxModel.id })
  }
  for (const rows of chunk(conversationRows, BATCH_SIZE)) {
    await db
      .insert(conversationModel)
      .values(rows)
      .onConflictDoNothing({ target: conversationModel.id })
  }

  for (const rows of chunk(messageRows, BATCH_SIZE)) {
    // Composite PK (id, createdAt) — a bare ON CONFLICT DO NOTHING catches a
    // re-inserted (id, createdAt) on re-run.
    await db.insert(messageModel).values(rows).onConflictDoNothing()
  }
  const messagesMigrated = messageRows.length

  if (skippedConversations > 0) {
    console.warn(
      `Step 5: skipped ${skippedConversations} conversation(s) missing a workspace/contact/channel link.`,
    )
  }
  console.log(
    `Step 5: migrated ${conversationsMigrated}/${conversations.length} conversation(s), ${messagesMigrated} message(s).`,
  )
  if (unrecognizedContentTypeCounts.size > 0) {
    console.warn(
      'Step 5: message content types with no NEW equivalent, defaulted to "text" (attachment/file content, if any, was NOT migrated):',
      Object.fromEntries(unrecognizedContentTypeCounts),
    )
  }
}
