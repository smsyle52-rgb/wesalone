// Wrapper: reads the chatbotx_staging connection secret (dumped to a file
// earlier), rewrites the Cloud-Run-style unix-socket URL to a TCP URL through
// the local proxy tunnel, sets DATABASE_URL, then runs set-meta-credential.ts.
// Secrets for the credential itself (webhook verify token / app secret /
// system user token) are read from their own dumped files, never printed.
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const SP =
  "C:/Users/USERW/AppData/Local/Temp/claude/C--Users-USERW/561ac460-f74c-429e-af86-56de2a7d095f/scratchpad"

const readTrim = (path) => readFileSync(path, "utf8").trim()

const rawDbUrl = readTrim(`${SP}/chatbotx-url.txt`)
const m = rawDbUrl.match(/^postgresql:\/\/([^:]+):([^@]+)@[^/]*\/([^?]+)/)
if (!m) throw new Error("could not parse chatbotx-url.txt")
const [, user, pass, db] = m
const tcpDatabaseUrl = `postgresql://${user}:${pass}@127.0.0.1:5435/${db}`

const env = {
  ...process.env,
  DATABASE_URL: tcpDatabaseUrl,
  META_WEBHOOK_VERIFY_TOKEN: readTrim(`${SP}/mwvt.txt`),
  META_APP_SECRET: readTrim(`${SP}/mas.txt`),
  META_SYSTEM_USER_TOKEN: readTrim(`${SP}/msut.txt`),
}

execFileSync(
  "npx",
  ["tsx", "scripts/migrate-legacy/set-meta-credential.ts"],
  { stdio: "inherit", env, shell: true },
)
