/**
 * Wesal One: a workspace's AI agent can be limited to a few test numbers
 * while the merchant tries it out. `AI_AGENT_TEST_CONTACTS` is a
 * comma-separated list of `workspaceId:number|number` entries; a listed
 * workspace's agent answers only those numbers and stays silent for every
 * other contact. Unlisted workspaces are unaffected.
 */
const WORKSPACE_ID = /^\d+$/

const digits = (value: string): string => value.replace(/\D/g, "")

export function parseAgentTestContacts(
  raw: string | undefined,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const entry of (raw ?? "").split(",")) {
    const separator = entry.indexOf(":")
    const workspaceId = entry.slice(0, separator).trim()
    if (separator <= 0 || !WORKSPACE_ID.test(workspaceId)) {
      continue
    }
    const numbers = entry
      .slice(separator + 1)
      .split("|")
      .map(digits)
      .filter(Boolean)
    if (numbers.length > 0) {
      map.set(workspaceId, new Set(numbers))
    }
  }
  return map
}

/** False when the workspace is in test mode and this contact is not listed. */
export function isAgentAllowedForContact(
  workspaceId: string,
  contactSourceId: string | null | undefined,
  raw: string | undefined = process.env.AI_AGENT_TEST_CONTACTS,
): boolean {
  const allowed = parseAgentTestContacts(raw).get(workspaceId)
  if (!allowed) {
    return true
  }
  return (
    Boolean(contactSourceId) && allowed.has(digits(String(contactSourceId)))
  )
}
