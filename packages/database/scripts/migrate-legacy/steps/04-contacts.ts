// Step 4: old `contacts` -> new `Contact`; old `channel_accounts` -> new
// `Inbox`. `ContactInbox` (the join between them) is NOT created here — OLD
// has no equivalent table, and the real (contact, channel) pairs are only
// discoverable from `conversations`, so that synthesis happens in Step 5
// alongside conversation migration.
//
// Inboxes are created DISCONNECTED (synthetic sourceId, status="disconnected",
// no token/credentials copied) — per the approved plan, each merchant
// reconnects WhatsApp/Meta through the new system's own embedded-signup flow
// during Phase 3 rather than migrating encrypted tokens.

import { db } from "../../../src/client"
import { contactModel, inboxModel } from "../../../src/schema"
import { BATCH_SIZE, chunk } from "../batch"
import { getOrCreateId } from "../id-map"
import { fetchOldChannelAccounts, fetchOldContacts } from "../old-db"
import type { WorkspaceMigrationResult } from "./01-workspaces"

// OLD stores one free-text `name`; NEW splits first/last (fullName is a
// generated column from the two). First word -> firstName, remainder ->
// lastName. Lossy for names that don't split cleanly — worth a spot check in
// the Phase 2 manual verification pass.
const WHITESPACE = /\s+/
const splitName = (
  name: string | null,
): { firstName: string | null; lastName: string | null } => {
  if (!name?.trim()) {
    return { firstName: null, lastName: null }
  }
  const [first, ...rest] = name.trim().split(WHITESPACE)
  return { firstName: first, lastName: rest.length > 0 ? rest.join(" ") : null }
}

export const migrateContacts = async (
  workspaces: WorkspaceMigrationResult[],
) => {
  const newWorkspaceIdByOld = new Map(
    workspaces.map((w) => [w.oldWorkspaceId, w.newWorkspaceId]),
  )

  const contacts = await fetchOldContacts()
  const contactRows = contacts.flatMap((contact) => {
    const newWorkspaceId = newWorkspaceIdByOld.get(contact.workspaceId)
    if (!newWorkspaceId) {
      return []
    }
    const { firstName, lastName } = splitName(contact.name)
    return [
      {
        id: getOrCreateId("contact", contact.id),
        workspaceId: newWorkspaceId,
        firstName,
        lastName,
        phoneNumber: contact.phone,
        email: contact.email,
        createdAt: contact.createdAt,
      },
    ]
  })
  for (const rows of chunk(contactRows, BATCH_SIZE)) {
    await db
      .insert(contactModel)
      .values(rows)
      .onConflictDoNothing({ target: contactModel.id })
  }
  console.log(
    `Step 4: migrated ${contactRows.length}/${contacts.length} contact(s).`,
  )

  const channelAccounts = await fetchOldChannelAccounts()
  let inboxesMigrated = 0
  for (const account of channelAccounts) {
    const newWorkspaceId = newWorkspaceIdByOld.get(account.workspaceId)
    if (!newWorkspaceId) {
      continue
    }

    await db
      .insert(inboxModel)
      .values({
        id: getOrCreateId("inbox", account.id),
        workspaceId: newWorkspaceId,
        name: account.name,
        channel: account.channelType,
        sourceId: `legacy-import:${account.id}`,
        status: "disconnected",
      })
      .onConflictDoNothing({ target: inboxModel.id })
    inboxesMigrated += 1
  }
  console.log(
    `Step 4: migrated ${inboxesMigrated}/${channelAccounts.length} inbox(es) (all disconnected — merchants reconnect in Phase 3).`,
  )
}
