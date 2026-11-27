// Wesal WhatsApp Web bridge — linked devices of each workspace's WhatsApp
// Business numbers (up to MAX_NUMBERS per workspace). Sends ONLY what the platform worker asks for (agent messages
// outside the 24h window, or large videos). It never answers or marks
// incoming messages; the Cloud API (coexistence) stays the inbound path —
// except for INBOUND_WEBHOOKS workspaces (no Cloud API number at all), whose
// incoming messages are forwarded to their manual WhatsApp webhook in the
// Cloud API payload shape, signed with that integration's secret.
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
// Per-workspace overrides: DAILY_CAP_OVERRIDES="<workspaceId>:<cap>,..."
const CAP_OVERRIDES = Object.fromEntries(
  String(process.env.DAILY_CAP_OVERRIDES || "")
    .split(",")
    .map((p) => p.trim().split(":"))
    .filter(([w, c]) => w && Number(c) > 0)
    .map(([w, c]) => [w.trim(), Number(c)]),
)
const capFor = (ws) => CAP_OVERRIDES[String(ws)] ?? DAILY_CAP
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

// Bridge-only workspaces: "<ws>:<integrationId>:<phoneNumberId>:<secret>"
// entries, comma separated. Their incoming messages are POSTed to
// `${INBOUND_WEBHOOK_BASE}/<integrationId>`.
const INBOUND_WEBHOOK_BASE = (process.env.INBOUND_WEBHOOK_BASE || "").replace(/\/+$/, "")
const INBOUND = Object.fromEntries(
  (process.env.INBOUND_WEBHOOKS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [ws, integrationId, phoneNumberId, ...secret] = entry.split(":")
      return [ws, { integrationId, phoneNumberId, secret: secret.join(":") }]
    })
    .filter(([ws, v]) => ws && v.integrationId && v.phoneNumberId && v.secret),
)
const MEDIA_DIR = path.join(DATA_DIR, "inbound-media")
const MEDIA_TTL_MS = 6 * 60 * 60_000
// Platform media ids for files this bridge received (see /media/<token>).
const MEDIA_PREFIX = "wab-media:"

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

// Only a few WhatsApp Web pages may boot at once: on a 2-vCPU host nine
// Chromiums starting together starve each other and every one times out.
const START_CONCURRENCY = Math.max(1, Number(process.env.START_CONCURRENCY || 2))
let booting = 0
const bootWaiters = []
const acquireBoot = () =>
  booting < START_CONCURRENCY
    ? (booting++, Promise.resolve())
    : new Promise((resolve) => bootWaiters.push(resolve))
const releaseBoot = () => {
  const next = bootWaiters.shift()
  if (next) next()
  else booting--
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
    authTimeoutMs: Math.max(60_000, Number(process.env.AUTH_TIMEOUT_MS || 180_000)),
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
  if (INBOUND[ws]) {
    client.on("message", (m) => {
      forwardInbound(s, m).catch((err) =>
        log("error", "inbound forward failed", { ws, slot, err: String(err?.message || err) }),
      )
    })
  }
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
  acquireBoot().then(() => bootClient(s, client, ws, slot))
}

function bootClient(s, client, ws, slot) {
  let released = false
  const done = () => {
    if (!released) {
      released = true
      releaseBoot()
    }
  }
  // Replaced while waiting for a boot slot: hand the slot straight back.
  if (s.client !== client) return done()
  client.once("qr", done)
  client.once("ready", done)
  client.once("auth_failure", done)
  client.once("disconnected", done)
  client.initialize().catch((err) => {
    done()
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
  const usable = all.filter((s) => s.state === "ready" && sentToday(s) < capFor(ws))
  if (from) {
    const own = all.find((s) => s.me === from)
    if (own) {
      if (usable.includes(own)) return { s: own }
      // The conversation's own number is linked but down: do not answer the
      // customer from another number of the same business.
      if (own.state !== "ready") return { error: "رقم هذه المحادثة غير متصل بواتساب ويب — امسح رمز QR من صفحة الربط", status: 503 }
      return { error: `تجاوز رقم هذه المحادثة الحد اليومي (${capFor(ws)}) لحماية الرقم`, status: 429 }
    }
  }
  if (usable.length === 0) {
    const anyReady = all.some((s) => s.state === "ready")
    return anyReady
      ? { error: `تجاوزت كل الأرقام الحد اليومي (${capFor(ws)}) لحماية الأرقام`, status: 429 }
      : { error: "واتساب ويب غير متصل — امسح رمز QR من صفحة الربط", status: 503 }
  }
  const sticky = routes[ws]?.[to]
  const prev = sticky && usable.find((s) => s.me === sticky)
  if (prev) return { s: prev }
  return { s: usable.reduce((a, b) => (sentToday(b) < sentToday(a) ? b : a)) }
}

const MEDIA_KINDS = ["image/", "video/", "audio/"]

// A customer WhatsApp addresses by a LID (privacy id) reaches the platform
// keyed by that LID's digits (see senderOf), so a reply to it is not a phone
// number: fall back to the existing LID chat they wrote from.
async function resolveChatId(client, to) {
  const digits = String(to).replace(/\D/g, "")
  try {
    const numberId = await client.getNumberId(digits)
    if (numberId) return numberId._serialized
  } catch {}
  if (!/^\d{7,20}$/.test(digits)) return null
  try {
    const chat = await client.getChatById(`${digits}@lid`)
    if (chat?.id?._serialized) return chat.id._serialized
  } catch {}
  return null
}

// Reads a business's catalog through WhatsApp Web's own catalog module. The
// module is internal, so the call shape is probed and the raw answer is
// returned (trimmed) beside the products found in it.
async function readCatalog(s, { phone, limit }) {
  return await s.client.pupPage.evaluate(
    async ({ phone, limit }) => {
      const out = { fns: [], used: null, errors: [], raw: null, products: [] }
      let bridge
      try {
        bridge = window.require("WAWebBizProductCatalogBridge")
        out.fns = Object.keys(bridge)
      } catch (e) {
        out.errors.push(`module: ${e?.message || e}`)
        return out
      }
      const wid = window.require("WAWebWidFactory").createWid(`${phone}@c.us`)
      const names = out.fns.filter((n) => /catalog/i.test(n) && typeof bridge[n] === "function")
      let res
      for (const name of names) {
        for (const args of [[wid, undefined, limit, 800, 800], [wid, limit, 800, 800], [wid]]) {
          try {
            res = await bridge[name](...args)
            if (res) {
              out.used = `${name}/${args.length}`
              break
            }
          } catch (e) {
            out.errors.push(`${name}/${args.length}: ${e?.message || e}`)
          }
        }
        if (res) break
      }
      if (!res) return out
      const seen = new WeakSet()
      const plain = (v, depth = 0) => {
        if (v === null || typeof v !== "object") return v
        if (seen.has(v) || depth > 6) return "[…]"
        seen.add(v)
        if (Array.isArray(v)) return v.slice(0, 120).map((x) => plain(x, depth + 1))
        const o = {}
        for (const k of Object.keys(v).slice(0, 60)) o[k] = plain(v[k], depth + 1)
        return o
      }
      const data = plain(res)
      out.raw = JSON.stringify(data).slice(0, 4000)
      const urlsIn = (o) => {
        const urls = []
        const walk = (x) => {
          if (typeof x === "string" && /^https:\/\//.test(x) && !urls.includes(x)) urls.push(x)
          else if (x && typeof x === "object") for (const v of Object.values(x)) walk(v)
        }
        walk(o)
        return urls
      }
      const walk = (x) => {
        if (!x || typeof x !== "object") return
        if (Array.isArray(x)) return x.forEach(walk)
        if (typeof x.name === "string" && (x.price !== undefined || x.priceAmount1000 !== undefined || x.image_cdn_urls || x.imageCdnUrl || x.retailer_id || x.retailerId)) {
          out.products.push({
            id: x.id ?? null,
            name: x.name,
            description: x.description ?? null,
            price: x.price ?? x.priceAmount1000 ?? null,
            currency: x.currency ?? null,
            images: urlsIn(x),
          })
          return
        }
        Object.values(x).forEach(walk)
      }
      walk(data)
      return out
    },
    { phone, limit },
  )
}

async function doSend(s, { to, text, media }) {
  const client = s.client
  const chatId = await resolveChatId(client, to)
  if (!chatId) {
    const e = new Error("الرقم غير مسجّل في واتساب")
    e.status = 422
    throw e
  }
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

// ---- Inbound (bridge-only workspaces) ------------------------------------

const KEY_ID = /^(?:true|false)_[^_]+_([A-Za-z0-9]+)/
const inboundId = (m) => {
  const id = msgId(m)
  const keyId = KEY_ID.exec(id)?.[1] || m?.id?.id || id
  return `wab.${keyId}`
}

// WhatsApp Web addresses some customers by a LID instead of their number;
// the platform keys WhatsApp contacts by phone number.
async function senderOf(m) {
  const from = String(m.from || "")
  let contact = null
  try {
    contact = await m.getContact()
  } catch {}
  let phone = from.endsWith("@c.us") ? from.split("@")[0] : String(contact?.number || "")
  phone = phone.replace(/\D/g, "")
  const name = contact?.pushname || contact?.name || contact?.verifiedName || ""
  return { phone, name }
}

const MEDIA_TYPES = { image: "image", video: "video", audio: "audio", ptt: "audio", document: "document", sticker: "sticker" }

async function storeInboundMedia(m) {
  const media = await m.downloadMedia()
  if (!media?.data) return null
  fs.mkdirSync(MEDIA_DIR, { recursive: true })
  const token = crypto.randomBytes(16).toString("hex")
  fs.writeFileSync(path.join(MEDIA_DIR, token), Buffer.from(media.data, "base64"))
  fs.writeFileSync(
    path.join(MEDIA_DIR, `${token}.json`),
    JSON.stringify({ mimeType: media.mimetype || "application/octet-stream", filename: media.filename || null }),
  )
  return { id: `${MEDIA_PREFIX}${token}`, mimeType: (media.mimetype || "application/octet-stream").split(";")[0].trim(), filename: media.filename || null }
}

/** Builds the Cloud API `messages[0]` entry for one WhatsApp Web message. */
async function toCloudMessage(m, phone) {
  const base = { from: phone, id: inboundId(m), timestamp: String(m.timestamp || Math.floor(Date.now() / 1000)) }
  const kind = MEDIA_TYPES[m.type]
  if (kind && m.hasMedia) {
    const stored = await storeInboundMedia(m)
    if (stored) {
      const body = { id: stored.id, mime_type: stored.mimeType }
      const caption = (m.body || "").trim()
      if (caption && (kind === "image" || kind === "document" || kind === "video")) body.caption = caption
      if (kind === "document" && stored.filename) body.filename = stored.filename
      if (m.type === "ptt") body.voice = true
      return { ...base, type: kind, [kind]: body }
    }
  }
  if (m.type === "location" && m.location) {
    return {
      ...base,
      type: "location",
      location: {
        latitude: Number(m.location.latitude),
        longitude: Number(m.location.longitude),
        ...(m.location.name ? { name: String(m.location.name) } : {}),
        ...(m.location.address ? { address: String(m.location.address) } : {}),
      },
    }
  }
  const text = (m.body || "").trim()
  if (!text) return null
  return { ...base, type: "text", text: { body: text } }
}

async function postInbound(cfg, payload) {
  const body = JSON.stringify(payload)
  const sig = crypto.createHmac("sha256", cfg.secret).update(body).digest("hex")
  let lastErr = null
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(2000 * 2 ** attempt)
    try {
      const r = await fetch(`${INBOUND_WEBHOOK_BASE}/${cfg.integrationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-hub-signature-256": `sha256=${sig}` },
        body,
        signal: AbortSignal.timeout(30_000),
      })
      if (r.ok) return
      lastErr = `HTTP ${r.status}`
      if (r.status >= 400 && r.status < 500 && r.status !== 429) break
    } catch (err) {
      lastErr = String(err?.message || err)
    }
  }
  throw new Error(`webhook rejected: ${lastErr}`)
}

async function forwardInbound(s, m) {
  const cfg = INBOUND[s.ws]
  if (!(cfg && INBOUND_WEBHOOK_BASE) || m.fromMe || m.isStatus || m.broadcast) return
  const from = String(m.from || "")
  if (!from || from.endsWith("@g.us") || from.endsWith("@broadcast") || from.endsWith("@newsletter")) return
  const { phone, name } = await senderOf(m)
  if (!/^\d{7,15}$/.test(phone)) {
    log("warn", "inbound skipped: no phone number", { ws: s.ws, slot: s.slot })
    return
  }
  const message = await toCloudMessage(m, phone)
  if (!message) return
  // Replies to this customer leave from the number they wrote to.
  if (s.me) {
    if (!routes[s.ws]) routes[s.ws] = {}
    routes[s.ws][phone] = s.me
    saveRoutesSoon()
  }
  await postInbound(cfg, {
    object: "whatsapp_business_account",
    entry: [
      {
        id: `wab-${s.ws}`,
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: s.me || "", phone_number_id: cfg.phoneNumberId },
              contacts: [{ profile: { name: name || phone }, wa_id: phone }],
              messages: [message],
            },
          },
        ],
      },
    ],
  })
  log("info", "inbound forwarded", { ws: s.ws, slot: s.slot, type: message.type })
}

// Drop received files the platform has had time to copy.
setInterval(() => {
  let names = []
  try {
    names = fs.readdirSync(MEDIA_DIR)
  } catch {
    return
  }
  const cutoff = Date.now() - MEDIA_TTL_MS
  for (const n of names) {
    try {
      const f = path.join(MEDIA_DIR, n)
      if (fs.statSync(f).mtimeMs < cutoff) fs.rmSync(f, { force: true })
    } catch {}
  }
}, 60 * 60_000).unref()

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
<small>رسائل اليوم عبر هذا الرقم: ${sentToday(s)} / ${capFor(ws)}</small>
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

    // GET /media/<token>: a file an inbound message carried (bridge token).
    if (req.method === "GET" && parts[0] === "media" && parts.length === 2) {
      if (!safeEqual(req.headers["x-bridge-token"] || "", BRIDGE_TOKEN)) return send(res, 401, { error: "unauthorized" })
      const token = parts[1].startsWith(MEDIA_PREFIX) ? parts[1].slice(MEDIA_PREFIX.length) : parts[1]
      if (!/^[a-f0-9]{32}$/.test(token)) return send(res, 404, { error: "not found" })
      const file = path.join(MEDIA_DIR, token)
      if (!fs.existsSync(file)) return send(res, 404, { error: "not found" })
      const meta = readJsonFile(`${file}.json`, {})
      res.writeHead(200, { "Content-Type": meta.mimeType || "application/octet-stream", "Cache-Control": "no-store" })
      return fs.createReadStream(file).pipe(res)
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

    // POST /catalog: read another business's WhatsApp catalog the way a
    // customer browses it from this workspace's linked number (the Cloud API
    // cannot read a catalog made in the WhatsApp Business app).
    if (req.method === "POST" && url.pathname === "/catalog") {
      if (!safeEqual(req.headers["x-bridge-token"] || "", BRIDGE_TOKEN)) return send(res, 401, { error: "unauthorized" })
      const body = await readJson(req)
      const ws = String(body.workspaceId || "")
      if (!WORKSPACES[ws]) return send(res, 403, { error: "workspace not enabled" })
      const phone = String(body.phone || "").replace(/\D/g, "")
      if (!/^\d{7,15}$/.test(phone)) return send(res, 400, { error: "phone required" })
      const s = sessionsOf(ws).find((x) => x.state === "ready")
      if (!s) return send(res, 503, { error: "no linked number is ready" })
      const result = await readCatalog(s, { phone, limit: Math.min(Number(body.limit) || 60, 100) })
      if (body.images !== false) {
        for (const p of result.products) {
          const url = p.images[0]
          if (!url) continue
          try {
            const r = await fetch(url)
            if (r.ok) p.image = Buffer.from(await r.arrayBuffer()).toString("base64")
            else p.imageError = `HTTP ${r.status}`
          } catch (err) {
            p.imageError = String(err?.message || err)
          }
        }
      }
      log("info", "catalog read", { ws, slot: s.slot, count: result.products.length })
      return send(res, 200, result)
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
