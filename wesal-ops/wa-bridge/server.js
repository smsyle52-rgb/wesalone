// Wesal WhatsApp Web bridge — linked devices of each workspace's WhatsApp
// Business numbers (up to MAX_NUMBERS per workspace). Sends ONLY what the platform worker asks for (agent messages
// outside the 24h window, or large videos). It never reads, answers or marks
// incoming messages; the Cloud API (coexistence) stays the inbound path.
"use strict"
const http = require("node:http")
const crypto = require("node:crypto")
const fs = require("node:fs")
const path = require("node:path")
const QRCode = require("qrcode")
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js")

const PORT = Number(process.env.PORT || 8090)
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || ""
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || ""
const DATA_DIR = process.env.DATA_DIR || "/data"
const DAILY_CAP = Number(process.env.DAILY_CAP || 300)
const WORKSPACES = Object.fromEntries(
  (process.env.WORKSPACES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [id, ...label] = pair.split(":")
      return [id, label.join(":") || id]
    }),
)

if (BRIDGE_TOKEN.length < 32 || ADMIN_TOKEN.length < 32) {
  console.error("BRIDGE_TOKEN and ADMIN_TOKEN must be set (>=32 chars)")
  process.exit(1)
}

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra }))

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

// WhatsApp Web renamed id._serialized to id.$1 in July 2026.
const msgId = (m) => m?.id?._serialized || m?.id?.$1 || m?.id?.id || ""

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MAX_NUMBERS = Math.max(1, Number(process.env.MAX_NUMBERS || 5))
// An unlinked number shows its QR only while someone has the page open;
// after this long unviewed its browser is closed to save memory.
const QR_IDLE_MS = Number(process.env.QR_IDLE_MS || 5 * 60_000)
const NUMBERS_FILE = path.join(DATA_DIR, "numbers.json")
const ROUTES_FILE = path.join(DATA_DIR, "routes.json")

const readJsonFile = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return fallback
  }
}
const writeJsonFile = (file, value) => {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value))
  fs.renameSync(tmp, file)
}

// Each workspace has numbered slots ("1", "2", …), one linked device each.
// Slot "1" keeps the original single-number profile, so a number linked
// before multi-number support stays linked.
/** @type {Record<string, string[]>} */
const numbers = readJsonFile(NUMBERS_FILE, {})
for (const ws of Object.keys(WORKSPACES)) {
  if (!Array.isArray(numbers[ws]) || numbers[ws].length === 0) numbers[ws] = ["1"]
}
const saveNumbers = () => writeJsonFile(NUMBERS_FILE, numbers)

// Sticky routing: the number that last wrote to a customer keeps writing to
// them, so a customer does not hear from a different number each time.
/** @type {Record<string, Record<string, string>>} */
const routes = readJsonFile(ROUTES_FILE, {})
let routesTimer = null
const saveRoutesSoon = () => {
  if (routesTimer) return
  routesTimer = setTimeout(() => {
    routesTimer = null
    try {
      writeJsonFile(ROUTES_FILE, routes)
    } catch (err) {
      log("warn", "routes save failed", { err: String(err?.message || err) })
    }
  }, 2000)
}

const key = (ws, slot) => `${ws}#${slot}`
const clientIdOf = (ws, slot) => (slot === "1" ? `ws${ws}` : `ws${ws}-n${slot}`)
const profileDir = (ws, slot) => path.join(DATA_DIR, `session-${clientIdOf(ws, slot)}`)

/** @type {Record<string, any>} */
const sessions = {}
const sessionsOf = (ws) => (numbers[ws] || []).map((slot) => sessions[key(ws, slot)]).filter(Boolean)

// A container restart leaves Chromium's profile lock behind (the old
// hostname no longer exists), and Chromium then refuses to start.
function clearProfileLock(ws, slot) {
  const dir = profileDir(ws, slot)
  for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      fs.rmSync(path.join(dir, f), { force: true })
    } catch {}
  }
}

function startSession(ws, slot) {
  clearProfileLock(ws, slot)
  const k = key(ws, slot)
  const s = sessions[k] || (sessions[k] = { ws, slot, sent: 0, day: "", chain: Promise.resolve() })
  s.state = "starting"
  s.qr = null
  s.lastError = null
  s.qrSince = null
  s.viewedAt = Date.now()
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: clientIdOf(ws, slot), dataPath: DATA_DIR }),
    // The host can be busy (image builds): give WhatsApp Web time to load.
    authTimeoutMs: 180_000,
    qrMaxRetries: 0,
    puppeteer: {
      headless: true,
      protocolTimeout: 300_000,
      executablePath: process.env.CHROME_PATH || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
      ],
    },
  })
  s.client = client
  client.on("qr", (qr) => {
    if (s.state !== "qr") s.qrSince = Date.now()
    s.state = "qr"
    s.qr = qr
    log("info", "qr", { ws, slot })
  })
  client.on("authenticated", () => {
    s.state = "authenticated"
    s.qr = null
    log("info", "authenticated", { ws, slot })
  })
  client.on("ready", async () => {
    s.state = "ready"
    s.qr = null
    s.me = client.info?.wid?.user || null
    log("info", "ready", { ws, slot, me: s.me })
    // Stay "offline" so the phone keeps getting its notifications.
    try {
      await client.sendPresenceUnavailable()
    } catch {}
  })
  client.on("auth_failure", (m) => {
    s.state = "auth_failure"
    s.lastError = String(m)
    log("error", "auth_failure", { ws, slot, m: String(m) })
  })
  client.on("disconnected", async (reason) => {
    if (s.client !== client) return
    s.state = "disconnected"
    s.lastError = String(reason)
    log("warn", "disconnected", { ws, slot, reason: String(reason) })
    try {
      await client.destroy()
    } catch {}
    setTimeout(() => {
      if (s.client === client) startSession(ws, slot)
    }, 15_000)
  })
  client.initialize().catch((err) => {
    if (s.client !== client) return
    s.state = "error"
    s.lastError = String(err?.message || err)
    log("error", "initialize failed", { ws, slot, err: s.lastError })
    setTimeout(async () => {
      if (s.client !== client) return
      try {
        await client.destroy()
      } catch {}
      startSession(ws, slot)
    }, 60_000)
  })
}

async function stopSession(s, { logout = false } = {}) {
  const client = s.client
  s.client = null
  if (logout) {
    try {
      await client?.logout()
    } catch {}
  }
  try {
    await client?.destroy()
  } catch {}
}

// Close the browser of a number nobody is linking right now.
setInterval(async () => {
  for (const s of Object.values(sessions)) {
    if (s.state === "qr" && Date.now() - s.viewedAt > QR_IDLE_MS) {
      log("info", "qr idle, paused", { ws: s.ws, slot: s.slot })
      s.state = "idle"
      s.qr = null
      await stopSession(s)
    }
  }
}, 60_000).unref()

function addNumber(ws) {
  const slots = numbers[ws]
  if (slots.length >= MAX_NUMBERS) return null
  const next = String(Math.max(0, ...slots.map(Number)) + 1)
  slots.push(next)
  saveNumbers()
  startSession(ws, next)
  log("info", "number added", { ws, slot: next })
  return next
}

async function removeNumber(ws, slot) {
  const slots = numbers[ws]
  if (!slots.includes(slot) || slots.length <= 1) return false
  const k = key(ws, slot)
  const s = sessions[k]
  if (s) await stopSession(s, { logout: s.state === "ready" })
  delete sessions[k]
  numbers[ws] = slots.filter((x) => x !== slot)
  saveNumbers()
  if (s?.me && routes[ws]) {
    for (const [to, me] of Object.entries(routes[ws])) if (me === s.me) delete routes[ws][to]
    saveRoutesSoon()
  }
  try {
    fs.rmSync(profileDir(ws, slot), { recursive: true, force: true })
  } catch {}
  log("warn", "number removed", { ws, slot })
  return true
}

const today = () => new Date().toISOString().slice(0, 10)
const sentToday = (s) => (s.day === today() ? s.sent : 0)

/**
 * Picks the number that sends: the inbox's own number when it is linked here;
 * otherwise the number that last wrote to this customer; otherwise the least
 * used linked number today. Every linked number of the workspace can serve
 * every inbox of the workspace.
 */
function pickSession(ws, from, to) {
  const all = sessionsOf(ws)
  const usable = all.filter((s) => s.state === "ready" && sentToday(s) < DAILY_CAP)
  if (from) {
    const own = all.find((s) => s.me === from)
    if (own) {
      if (usable.includes(own)) return { s: own }
      // The conversation's own number is linked but down: do not answer the
      // customer from another number of the same business.
      if (own.state !== "ready") return { error: "رقم هذه المحادثة غير متصل بواتساب ويب — امسح رمز QR من صفحة الربط", status: 503 }
      return { error: `تجاوز رقم هذه المحادثة الحد اليومي (${DAILY_CAP}) لحماية الرقم`, status: 429 }
    }
  }
  if (usable.length === 0) {
    const anyReady = all.some((s) => s.state === "ready")
    return anyReady
      ? { error: `تجاوزت كل الأرقام الحد اليومي (${DAILY_CAP}) لحماية الأرقام`, status: 429 }
      : { error: "واتساب ويب غير متصل — امسح رمز QR من صفحة الربط", status: 503 }
  }
  const sticky = routes[ws]?.[to]
  const prev = sticky && usable.find((s) => s.me === sticky)
  if (prev) return { s: prev }
  return { s: usable.reduce((a, b) => (sentToday(b) < sentToday(a) ? b : a)) }
}

const MEDIA_KINDS = ["image/", "video/", "audio/"]

async function doSend(s, { to, text, media }) {
  const client = s.client
  const numberId = await client.getNumberId(String(to))
  if (!numberId) {
    const e = new Error("الرقم غير مسجّل في واتساب")
    e.status = 422
    throw e
  }
  const chatId = numberId._serialized
  const ids = []
  await sleep(1200 + Math.floor(Math.random() * 2300))
  const files = Array.isArray(media) ? media : []
  let caption = (text || "").trim()
  // Audio cannot carry a caption: send the text on its own first.
  if (caption && files.some((f) => String(f.mimeType || "").startsWith("audio/"))) {
    const m = await client.sendMessage(chatId, caption, { sendSeen: false })
    ids.push(msgId(m))
    caption = ""
  }
  if (files.length === 0) {
    if (!caption) {
      const e = new Error("رسالة فارغة")
      e.status = 400
      throw e
    }
    const m = await client.sendMessage(chatId, caption, { sendSeen: false })
    ids.push(msgId(m))
  }
  for (const f of files) {
    const mime = String(f.mimeType || "")
    const mm = await MessageMedia.fromUrl(f.url, {
      unsafeMime: true,
      filename: f.name || undefined,
    })
    if (mime) mm.mimetype = mime
    if (f.name) mm.filename = f.name
    const opts = { sendSeen: false }
    if (!MEDIA_KINDS.some((k) => mime.startsWith(k))) opts.sendMediaAsDocument = true
    if (mime.startsWith("audio/") && /ogg|opus/.test(mime)) opts.sendAudioAsVoice = true
    if (caption && !mime.startsWith("audio/")) {
      opts.caption = caption
      caption = ""
    }
    const m = await client.sendMessage(chatId, mm, opts)
    ids.push(msgId(m))
  }
  try {
    await client.sendPresenceUnavailable()
  } catch {}
  return ids
}

function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on("data", (c) => {
      size += c.length
      if (size > limit) {
        reject(Object.assign(new Error("body too large"), { status: 413 }))
        req.destroy()
      } else chunks.push(c)
    })
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"))
      } catch {
        reject(Object.assign(new Error("bad json"), { status: 400 }))
      }
    })
    req.on("error", reject)
  })
}

const send = (res, status, body, type = "application/json; charset=utf-8") => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" })
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body)
}

const STATE_AR = {
  starting: "جارٍ التشغيل…",
  qr: "بانتظار مسح الرمز",
  idle: "متوقف — افتح الصفحة لعرض الرمز",
  authenticated: "تم المسح، جارٍ التحميل…",
  ready: "متصل ✅",
  disconnected: "انقطع — يعيد المحاولة",
  auth_failure: "فشل الربط — اضغط إعادة الربط",
  error: "خطأ — يعيد المحاولة",
}

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

async function numberCard(ws, s, canRemove) {
  let qrImg = ""
  if (s.state === "qr" && s.qr) {
    qrImg = `<img alt="QR" src="${await QRCode.toDataURL(s.qr, { width: 320, margin: 2 })}">`
  }
  const base = `n/${encodeURIComponent(s.slot)}`
  return `<div class="card"><h3>رقم ${esc(s.slot)}</h3>
<div class="s">${STATE_AR[s.state] || esc(s.state) || "—"}</div>
${s.me ? `<div>الرقم المربوط: <b dir="ltr">+${esc(s.me)}</b></div>` : ""}
${qrImg}
${qrImg ? `<small>من جوال الرقم: واتساب للأعمال ← الأجهزة المرتبطة ← ربط جهاز، ثم امسح الرمز.</small>` : ""}
<small>رسائل اليوم عبر هذا الرقم: ${sentToday(s)} / ${DAILY_CAP}</small>
<div class="row">
${["ready", "auth_failure", "error"].includes(s.state) ? `<form method="post" action="${base}/logout" onsubmit="return confirm('فكّ الربط وإظهار رمز جديد؟')"><button>إعادة الربط</button></form>` : ""}
${canRemove ? `<form method="post" action="${base}/remove" onsubmit="return confirm('حذف هذا الرقم من واتساب ويب؟')"><button>حذف الرقم</button></form>` : ""}
</div></div>`
}

async function adminPage(ws) {
  const label = esc(WORKSPACES[ws])
  const list = sessionsOf(ws)
  const cards = []
  for (const s of list) cards.push(await numberCard(ws, s, list.length > 1))
  const canAdd = list.length < MAX_NUMBERS
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5"><title>واتساب ويب — ${label}</title>
<style>body{font-family:system-ui,Tahoma,sans-serif;max-width:520px;margin:24px auto;padding:0 16px;text-align:center;color:#111;background:#fff}
.card{border:1px solid #ddd;border-radius:12px;padding:20px;margin-bottom:16px}img{width:100%;max-width:320px}
.s{font-size:20px;margin:12px 0}small{color:#666;display:block;line-height:1.7}.row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
button{margin-top:16px;padding:10px 16px;border-radius:8px;border:1px solid #c33;background:#fff;color:#c33;font-size:15px}
.add{border-color:#128c7e;color:#128c7e}</style></head>
<body><h2>${label}</h2>
<small>كل الأرقام المربوطة هنا تخدم كل محادثات المساحة. العميل يبقى على نفس الرقم اللي راسله آخر مرة.</small>
${cards.join("\n")}
${canAdd ? `<form method="post" action="add"><button class="add">+ إضافة رقم</button></form>` : `<small>وصلت للحد الأقصى (${MAX_NUMBERS} أرقام).</small>`}
<small>الصفحة تتحدّث كل ٥ ثوانٍ.</small></body></html>`
}

const redirect = (res, location) => {
  res.writeHead(303, { Location: location })
  res.end()
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x")
    const parts = url.pathname.split("/").filter(Boolean)

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        sessions: Object.values(sessions).map((s) => ({
          ws: s.ws,
          slot: s.slot,
          state: s.state,
          me: s.me || null,
          sent: s.sent,
          day: s.day,
        })),
      })
    }

    // /admin/<token>/<ws>/            page
    // /admin/<token>/<ws>/add         POST add a number
    // /admin/<token>/<ws>/n/<slot>/(logout|remove)  POST
    // /admin/<token>/<ws>/logout      POST (old link: number 1)
    if (parts[0] === "admin") {
      const ws = parts[2]
      if (!WORKSPACES[ws]) return send(res, 404, "not found", "text/plain")
      // Either the master token, or the per-workspace token the platform's
      // WhatsApp settings page links to: HMAC(ADMIN_TOKEN, workspaceId).
      const wsToken = crypto.createHmac("sha256", ADMIN_TOKEN).update(ws).digest("hex")
      if (!(safeEqual(parts[1] || "", ADMIN_TOKEN) || safeEqual(parts[1] || "", wsToken))) {
        return send(res, 404, "not found", "text/plain")
      }
      const rest = parts.slice(3)

      if (req.method === "GET" && rest.length === 0) {
        if (!url.pathname.endsWith("/")) return redirect(res, `${parts[2]}/`)
        // Someone is looking: wake paused numbers so their QR shows.
        for (const s of sessionsOf(ws)) {
          s.viewedAt = Date.now()
          if (s.state === "idle") startSession(ws, s.slot)
        }
        return send(res, 200, await adminPage(ws), "text/html; charset=utf-8")
      }

      if (req.method === "POST" && rest.length === 1 && rest[0] === "add") {
        addNumber(ws)
        return redirect(res, "./")
      }

      const isOld = rest.length === 1 && rest[0] === "logout"
      const isSlot = rest.length === 3 && rest[0] === "n" && ["logout", "remove"].includes(rest[2])
      if (req.method === "POST" && (isOld || isSlot)) {
        const slot = isOld ? numbers[ws][0] : rest[1]
        const action = isOld ? "logout" : rest[2]
        const back = isOld ? "./" : "../../"
        const s = sessions[key(ws, slot)]
        if (!s) return redirect(res, back)
        if (action === "remove") {
          await removeNumber(ws, slot)
          return redirect(res, back)
        }
        // Only a linked or failed session can be reset; pressing it while
        // WhatsApp Web is still loading just restarts the load forever.
        if (!["ready", "authenticated", "auth_failure", "error", "disconnected"].includes(s.state)) {
          return redirect(res, back)
        }
        log("warn", "admin logout", { ws, slot })
        await stopSession(s, { logout: true })
        s.me = null
        startSession(ws, slot)
        return redirect(res, back)
      }
      return send(res, 404, "not found", "text/plain")
    }

    if (req.method === "POST" && url.pathname === "/send") {
      if (!safeEqual(req.headers["x-bridge-token"] || "", BRIDGE_TOKEN)) return send(res, 401, { error: "unauthorized" })
      const body = await readJson(req)
      const ws = String(body.workspaceId || "")
      if (!WORKSPACES[ws]) return send(res, 403, { error: "workspace not enabled" })
      const to = String(body.to || "").replace(/\D/g, "")
      const from = String(body.from || "").replace(/\D/g, "")
      const picked = pickSession(ws, from, to)
      if (!picked.s) return send(res, picked.status, { error: picked.error })
      const s = picked.s
      if (s.day !== today()) {
        s.day = today()
        s.sent = 0
      }
      s.sent += 1
      // One send at a time per number.
      const run = s.chain.then(() => doSend(s, body))
      s.chain = run.catch(() => {})
      try {
        const ids = await run
        if (to) {
          if (!routes[ws]) routes[ws] = {}
          routes[ws][to] = s.me
          saveRoutesSoon()
        }
        log("info", "sent", { ws, slot: s.slot, count: ids.length })
        return send(res, 200, { ids, from: s.me })
      } catch (err) {
        s.sent -= 1
        log("error", "send failed", { ws, slot: s.slot, err: String(err?.message || err) })
        return send(res, err?.status || 502, { error: String(err?.message || err) })
      }
    }

    return send(res, 404, { error: "not found" })
  } catch (err) {
    log("error", "request failed", { err: String(err?.message || err) })
    return send(res, err?.status || 500, { error: String(err?.message || err) })
  }
})

saveNumbers()
for (const ws of Object.keys(WORKSPACES)) for (const slot of numbers[ws]) startSession(ws, slot)
server.listen(PORT, () => log("info", "listening", { port: PORT, workspaces: Object.keys(WORKSPACES), maxNumbers: MAX_NUMBERS }))

const shutdown = async () => {
  log("info", "shutting down")
  await Promise.allSettled(Object.values(sessions).map((s) => s.client?.destroy()))
  if (routesTimer) writeJsonFile(ROUTES_FILE, routes)
  process.exit(0)
}
// A closed browser tab rejects in-flight puppeteer calls; log it, never crash
// (a crash would drop every linked session at once).
process.on("unhandledRejection", (err) => log("error", "unhandledRejection", { err: String(err?.message || err) }))
process.on("uncaughtException", (err) => log("error", "uncaughtException", { err: String(err?.message || err) }))
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
