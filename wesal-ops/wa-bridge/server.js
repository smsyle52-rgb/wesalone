// Wesal WhatsApp Web bridge — a linked device of each workspace's WhatsApp
// Business app. Sends ONLY what the platform worker asks for (agent messages
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

/** @type {Record<string, any>} */
const sessions = {}

// A container restart leaves Chromium's profile lock behind (the old
// hostname no longer exists), and Chromium then refuses to start.
function clearProfileLock(ws) {
  const dir = path.join(DATA_DIR, `session-ws${ws}`)
  for (const f of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    try {
      fs.rmSync(path.join(dir, f), { force: true })
    } catch {}
  }
}

function startSession(ws) {
  clearProfileLock(ws)
  const s = sessions[ws] || (sessions[ws] = { ws, sent: 0, day: "", chain: Promise.resolve() })
  s.state = "starting"
  s.qr = null
  s.lastError = null
  const client = new Client({
    authStrategy: new LocalAuth({ clientId: `ws${ws}`, dataPath: DATA_DIR }),
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
    s.state = "qr"
    s.qr = qr
    log("info", "qr", { ws })
  })
  client.on("authenticated", () => {
    s.state = "authenticated"
    s.qr = null
    log("info", "authenticated", { ws })
  })
  client.on("ready", async () => {
    s.state = "ready"
    s.qr = null
    s.me = client.info?.wid?.user || null
    log("info", "ready", { ws, me: s.me })
    // Stay "offline" so the phone keeps getting its notifications.
    try {
      await client.sendPresenceUnavailable()
    } catch {}
  })
  client.on("auth_failure", (m) => {
    s.state = "auth_failure"
    s.lastError = String(m)
    log("error", "auth_failure", { ws, m: String(m) })
  })
  client.on("disconnected", async (reason) => {
    if (s.client !== client) return
    s.state = "disconnected"
    s.lastError = String(reason)
    log("warn", "disconnected", { ws, reason: String(reason) })
    try {
      await client.destroy()
    } catch {}
    setTimeout(() => {
      if (s.client === client) startSession(ws)
    }, 15_000)
  })
  client.initialize().catch((err) => {
    if (s.client !== client) return
    s.state = "error"
    s.lastError = String(err?.message || err)
    log("error", "initialize failed", { ws, err: s.lastError })
    setTimeout(async () => {
      if (s.client !== client) return
      try {
        await client.destroy()
      } catch {}
      startSession(ws)
    }, 60_000)
  })
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
  authenticated: "تم المسح، جارٍ التحميل…",
  ready: "متصل ✅",
  disconnected: "انقطع — يعيد المحاولة",
  auth_failure: "فشل الربط — اضغط إعادة الربط",
  error: "خطأ — يعيد المحاولة",
}

async function adminPage(ws) {
  const s = sessions[ws]
  const label = WORKSPACES[ws]
  let qrImg = ""
  if (s?.state === "qr" && s.qr) {
    qrImg = `<img alt="QR" src="${await QRCode.toDataURL(s.qr, { width: 320, margin: 2 })}">`
  }
  const today = new Date().toISOString().slice(0, 10)
  const sentToday = s?.day === today ? s.sent : 0
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="5"><title>واتساب ويب — ${label}</title>
<style>body{font-family:system-ui,Tahoma,sans-serif;max-width:480px;margin:24px auto;padding:0 16px;text-align:center;color:#111;background:#fff}
.card{border:1px solid #ddd;border-radius:12px;padding:20px}img{width:100%;max-width:320px}
.s{font-size:20px;margin:12px 0}small{color:#666;display:block;line-height:1.7}
button{margin-top:16px;padding:10px 16px;border-radius:8px;border:1px solid #c33;background:#fff;color:#c33;font-size:15px}</style></head>
<body><div class="card"><h2>${label}</h2>
<div class="s">${STATE_AR[s?.state] || s?.state || "—"}</div>
${s?.me ? `<div>الرقم المربوط: <b dir="ltr">+${s.me}</b></div>` : ""}
${qrImg}
${qrImg ? `<small>من جوال الرقم: واتساب للأعمال ← الأجهزة المرتبطة ← ربط جهاز، ثم امسح الرمز.</small>` : ""}
<small>رسائل اليوم عبر واتساب ويب: ${sentToday} / ${DAILY_CAP}</small>
${["ready", "auth_failure", "error"].includes(s?.state) ? `<form method="post" action="logout" onsubmit="return confirm('فكّ الربط وإظهار رمز جديد؟')"><button>إعادة الربط</button></form>` : ""}
</div><small>الصفحة تتحدّث كل ٥ ثوانٍ.</small></body></html>`
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x")
    const parts = url.pathname.split("/").filter(Boolean)

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, {
        sessions: Object.values(sessions).map((s) => ({ ws: s.ws, state: s.state, me: s.me || null, sent: s.sent, day: s.day })),
      })
    }

    // /admin/<token>/<ws>[/logout]
    if (parts[0] === "admin") {
      const ws = parts[2]
      if (!WORKSPACES[ws]) return send(res, 404, "not found", "text/plain")
      // Either the master token, or the per-workspace token the platform's
      // WhatsApp settings page links to: HMAC(ADMIN_TOKEN, workspaceId).
      const wsToken = crypto.createHmac("sha256", ADMIN_TOKEN).update(ws).digest("hex")
      if (!(safeEqual(parts[1] || "", ADMIN_TOKEN) || safeEqual(parts[1] || "", wsToken))) {
        return send(res, 404, "not found", "text/plain")
      }
      if (req.method === "POST" && parts[3] === "logout") {
        const s = sessions[ws]
        // Only a linked or failed session can be reset; pressing it while
        // WhatsApp Web is still loading just restarts the load forever.
        if (!["ready", "authenticated", "auth_failure", "error", "disconnected"].includes(s?.state)) {
          res.writeHead(303, { Location: "./" })
          return res.end()
        }
        log("warn", "admin logout", { ws })
        try {
          await s?.client?.logout()
        } catch {}
        try {
          await s?.client?.destroy()
        } catch {}
        startSession(ws)
        res.writeHead(303, { Location: "./" })
        return res.end()
      }
      if (req.method === "GET" && !parts[3]) {
        if (!url.pathname.endsWith("/")) {
          res.writeHead(302, { Location: `${parts[2]}/` })
          return res.end()
        }
        return send(res, 200, await adminPage(ws), "text/html; charset=utf-8")
      }
      return send(res, 404, "not found", "text/plain")
    }

    if (req.method === "POST" && url.pathname === "/send") {
      if (!safeEqual(req.headers["x-bridge-token"] || "", BRIDGE_TOKEN)) return send(res, 401, { error: "unauthorized" })
      const body = await readJson(req)
      const ws = String(body.workspaceId || "")
      if (!WORKSPACES[ws]) return send(res, 403, { error: "workspace not enabled" })
      const s = sessions[ws]
      if (s?.state !== "ready") return send(res, 503, { error: "واتساب ويب غير متصل — امسح رمز QR من صفحة الربط" })
      const today = new Date().toISOString().slice(0, 10)
      if (s.day !== today) {
        s.day = today
        s.sent = 0
      }
      if (s.sent >= DAILY_CAP) return send(res, 429, { error: `تجاوز الحد اليومي (${DAILY_CAP}) لحماية الرقم` })
      s.sent += 1
      // One send at a time per number.
      const run = s.chain.then(() => doSend(s, body))
      s.chain = run.catch(() => {})
      try {
        const ids = await run
        log("info", "sent", { ws, count: ids.length })
        return send(res, 200, { ids })
      } catch (err) {
        s.sent -= 1
        log("error", "send failed", { ws, err: String(err?.message || err) })
        return send(res, err?.status || 502, { error: String(err?.message || err) })
      }
    }

    return send(res, 404, { error: "not found" })
  } catch (err) {
    log("error", "request failed", { err: String(err?.message || err) })
    return send(res, err?.status || 500, { error: String(err?.message || err) })
  }
})

for (const ws of Object.keys(WORKSPACES)) startSession(ws)
server.listen(PORT, () => log("info", "listening", { port: PORT, workspaces: Object.keys(WORKSPACES) }))

const shutdown = async () => {
  log("info", "shutting down")
  await Promise.allSettled(Object.values(sessions).map((s) => s.client?.destroy()))
  process.exit(0)
}
// A closed browser tab rejects in-flight puppeteer calls; log it, never crash
// (a crash would drop every linked session at once).
process.on("unhandledRejection", (err) => log("error", "unhandledRejection", { err: String(err?.message || err) }))
process.on("uncaughtException", (err) => log("error", "uncaughtException", { err: String(err?.message || err) }))
process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)
