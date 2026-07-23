// Old-uuid -> new-Snowflake-bigint id remap, persisted to a local JSON file so a
// dry run and the real run (against the same kind of source data) produce the
// same mapping if re-executed. Keyed by "<entityKind>:<oldId>" so different old
// tables never collide even if two of them happen to reuse a uuid by coincidence.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createId } from "@chatbotx.io/utils"

const __dirname = dirname(fileURLToPath(import.meta.url))
const mapFile = join(__dirname, ".id-map.json")

type EntityKind =
  | "workspace"
  | "user"
  | "workspaceMember"
  | "subscriptionPayment"
  | "pointWallet"
  | "pointGrant"
  | "pointLedger"
  | "contact"
  | "inbox"
  | "contactInbox"
  | "conversation"
  | "message"
  | "aiFile"
  | "aiEmbedding"

let cache: Record<string, string> | null = null

const load = (): Record<string, string> => {
  if (cache) {
    return cache
  }
  if (existsSync(mapFile)) {
    cache = JSON.parse(readFileSync(mapFile, "utf8"))
  } else {
    cache = {}
  }
  return cache as Record<string, string>
}

const persist = () => {
  mkdirSync(dirname(mapFile), { recursive: true })
  writeFileSync(mapFile, JSON.stringify(cache, null, 2))
}

export const getOrCreateId = (kind: EntityKind, oldId: string): string => {
  const map = load()
  const key = `${kind}:${oldId}`
  const existing = map[key]
  if (existing) {
    return existing
  }
  const newId = createId()
  map[key] = newId
  persist()
  return newId
}

export const setId = (
  kind: EntityKind,
  oldId: string,
  newId: string,
): void => {
  const map = load()
  const key = `${kind}:${oldId}`
  if (map[key] === newId) {
    return
  }
  map[key] = newId
  persist()
}

export const peekId = (kind: EntityKind, oldId: string): string | undefined =>
  load()[`${kind}:${oldId}`]
