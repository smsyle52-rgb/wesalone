import {
  createSelectSchema,
  inboxTeamModel,
} from "@chatbotx.io/database/schema"
import { z } from "zod"

/**
 * The shape of an inbox team as it travels to the client.
 *
 * Team *management* (the settings pages and their API) lived under
 * `src/enterprise` and is covered by the ChatbotX Commercial License, so it was
 * removed from this deployment. The conversation and contact resources still
 * carry `assignedInboxTeam`, though — the column is part of the MIT database
 * schema (`packages/database/src/schema/inbox-team.ts`), and the inbox reads it
 * in a dozen places. Deriving the schema here keeps those reads intact without
 * shipping any licensed code.
 */
export const inboxTeamResource = createSelectSchema(inboxTeamModel, {
  id: z.string(),
  workspaceId: z.string(),
})
export type InboxTeamResource = z.infer<typeof inboxTeamResource>
