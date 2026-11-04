// biome-ignore-all lint/suspicious/noBitwiseOperators: parsing EBML/Opus bytes and computing Ogg CRCs
/**
 * Turns a browser voice recording into a file WhatsApp accepts as a voice
 * note: Ogg container with the Opus codec (WhatsApp rejects WebM audio).
 *
 * Chrome/Edge record `audio/webm;codecs=opus`, so the Opus packets are copied
 * out of the WebM (Matroska) container into Ogg pages without re-encoding.
 * Firefox records Ogg/Opus directly, and Safari records MP4/AAC, which
 * WhatsApp accepts as a regular audio message.
 */

const OPUS_SAMPLE_RATE = 48_000
const MAX_SEGMENTS_PER_PAGE = 255

// Matroska element ids used while walking the WebM stream.
const EBML_ID = {
  segment: 0x18_53_80_67,
  cluster: 0x1f_43_b6_75,
  tracks: 0x16_54_ae_6b,
  trackEntry: 0xae,
  blockGroup: 0xa0,
  codecPrivate: 0x63_a2,
  simpleBlock: 0xa3,
  block: 0xa1,
} as const

const MASTER_IDS = new Set<number>([
  EBML_ID.segment,
  EBML_ID.cluster,
  EBML_ID.tracks,
  EBML_ID.trackEntry,
  EBML_ID.blockGroup,
])

export type RecordingFormat = {
  /** Value passed to `MediaRecorder` as `mimeType`. */
  recorderMimeType: string
  /** Mime type of the file that is finally sent. */
  fileMimeType: string
  extension: string
  /** Whether the WebM output must be converted to Ogg before sending. */
  needsOggRemux: boolean
}

/** Picks the best recording format the current browser supports. */
export function pickRecordingFormat(
  isTypeSupported: (type: string) => boolean,
): RecordingFormat | null {
  if (isTypeSupported("audio/ogg;codecs=opus")) {
    return {
      recorderMimeType: "audio/ogg;codecs=opus",
      fileMimeType: "audio/ogg",
      extension: "ogg",
      needsOggRemux: false,
    }
  }
  if (isTypeSupported("audio/webm;codecs=opus")) {
    return {
      recorderMimeType: "audio/webm;codecs=opus",
      fileMimeType: "audio/ogg",
      extension: "ogg",
      needsOggRemux: true,
    }
  }
  if (isTypeSupported("audio/mp4")) {
    return {
      recorderMimeType: "audio/mp4",
      fileMimeType: "audio/mp4",
      extension: "m4a",
      needsOggRemux: false,
    }
  }
  return null
}

type Reader = { bytes: Uint8Array; offset: number }

/** Reads an EBML variable-length integer. `keepMarker` keeps the length bit (element ids). */
function readVint(reader: Reader, keepMarker: boolean): number | null {
  const first = reader.bytes[reader.offset]
  if (first === undefined || first === 0) {
    return null
  }
  let length = 1
  while (length <= 8 && (first & (0x80 >> (length - 1))) === 0) {
    length += 1
  }
  if (reader.offset + length > reader.bytes.length) {
    return null
  }
  let value = keepMarker ? first : first & (0xff >> length)
  let allOnes = value === 0xff >> length
  for (let i = 1; i < length; i += 1) {
    const byte = reader.bytes[reader.offset + i] as number
    value = value * 256 + byte
    allOnes = allOnes && byte === 0xff
  }
  reader.offset += length
  // An all-ones size means "unknown size" (live recordings use it for
  // Segment and Cluster); callers descend into those instead of skipping.
  if (!keepMarker && allOnes) {
    return Number.POSITIVE_INFINITY
  }
  return value
}

type WebmOpus = { opusHead: Uint8Array | null; packets: Uint8Array[] }

/** Extracts the OpusHead and the raw Opus packets from a WebM recording. */
export function extractOpusFromWebm(bytes: Uint8Array): WebmOpus {
  const reader: Reader = { bytes, offset: 0 }
  const packets: Uint8Array[] = []
  let opusHead: Uint8Array | null = null

  while (reader.offset < bytes.length) {
    const id = readVint(reader, true)
    const size = readVint(reader, false)
    if (id === null || size === null) {
      break
    }
    if (MASTER_IDS.has(id)) {
      // Walk children in place; an unknown-size master simply continues.
      continue
    }
    if (!Number.isFinite(size)) {
      break
    }
    const end = Math.min(reader.offset + size, bytes.length)
    if (id === EBML_ID.codecPrivate) {
      opusHead = bytes.slice(reader.offset, end)
    } else if (id === EBML_ID.simpleBlock || id === EBML_ID.block) {
      const block: Reader = { bytes, offset: reader.offset }
      readVint(block, false) // track number
      const flags = bytes[block.offset + 2] ?? 0
      block.offset += 3 // int16 timecode + flags
      const lacing = (flags >> 1) & 0x03
      if (lacing !== 0) {
        throw new Error("Laced WebM audio blocks are not supported")
      }
      if (block.offset < end) {
        packets.push(bytes.slice(block.offset, end))
      }
    }
    reader.offset = end
  }

  return { opusHead, packets }
}

/** Number of 48 kHz samples in one Opus packet (RFC 6716 section 3.1). */
export function opusPacketSamples(packet: Uint8Array): number {
  const toc = packet[0]
  if (toc === undefined) {
    return 0
  }
  const config = toc >> 3
  let frameSamples: number
  if (config < 12) {
    frameSamples = [480, 960, 1920, 2880][config % 4] as number
  } else if (config < 16) {
    frameSamples = config % 2 === 0 ? 480 : 960
  } else {
    frameSamples = [120, 240, 480, 960][config % 4] as number
  }
  const code = toc & 0x03
  let frames = 1
  if (code === 1 || code === 2) {
    frames = 2
  } else if (code === 3) {
    frames = (packet[1] ?? 0) & 0x3f
  }
  return frames * frameSamples
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let crc = i << 24
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80_00_00_00 ? (crc << 1) ^ 0x04_c1_1d_b7 : crc << 1
    }
    table[i] = crc >>> 0
  }
  return table
})()

/** Ogg page checksum (CRC-32, polynomial 0x04c11db7, no reflection). */
export function oggCrc(data: Uint8Array): number {
  let crc = 0
  for (const byte of data) {
    crc =
      ((crc << 8) ^ (CRC_TABLE[((crc >>> 24) ^ byte) & 0xff] as number)) >>> 0
  }
  return crc >>> 0
}

function buildPage(input: {
  packets: Uint8Array[]
  granule: number
  serial: number
  sequence: number
  headerType: number
}): Uint8Array {
  const lacing: number[] = []
  for (const packet of input.packets) {
    let remaining = packet.length
    while (remaining >= 255) {
      lacing.push(255)
      remaining -= 255
    }
    lacing.push(remaining)
  }
  const bodyLength = input.packets.reduce((sum, p) => sum + p.length, 0)
  const page = new Uint8Array(27 + lacing.length + bodyLength)
  const view = new DataView(page.buffer)
  page.set([0x4f, 0x67, 0x67, 0x53], 0) // "OggS"
  page[4] = 0 // version
  page[5] = input.headerType
  view.setBigUint64(6, BigInt(input.granule), true)
  view.setUint32(14, input.serial, true)
  view.setUint32(18, input.sequence, true)
  page[26] = lacing.length
  page.set(lacing, 27)
  let offset = 27 + lacing.length
  for (const packet of input.packets) {
    page.set(packet, offset)
    offset += packet.length
  }
  view.setUint32(22, oggCrc(page), true)
  return page
}

function segmentCount(packet: Uint8Array): number {
  return Math.floor(packet.length / 255) + 1
}

function defaultOpusHead(): Uint8Array {
  const head = new Uint8Array(19)
  const view = new DataView(head.buffer)
  head.set(new TextEncoder().encode("OpusHead"), 0)
  head[8] = 1 // version
  head[9] = 1 // mono
  view.setUint16(10, 312, true) // pre-skip used by browser encoders
  view.setUint32(12, OPUS_SAMPLE_RATE, true)
  view.setInt16(16, 0, true) // output gain
  head[18] = 0 // channel mapping family
  return head
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode("Wesal One")
  const tags = new Uint8Array(8 + 4 + vendor.length + 4)
  const view = new DataView(tags.buffer)
  tags.set(new TextEncoder().encode("OpusTags"), 0)
  view.setUint32(8, vendor.length, true)
  tags.set(vendor, 12)
  view.setUint32(12 + vendor.length, 0, true) // no user comments
  return tags
}

/** Wraps Opus packets in an Ogg Opus stream (RFC 7845). */
export function buildOggOpus(input: {
  opusHead: Uint8Array | null
  packets: Uint8Array[]
  serial?: number
}): Uint8Array<ArrayBuffer> {
  const serial = input.serial ?? 0x57_45_53_4c
  const pages: Uint8Array[] = []
  let sequence = 0
  pages.push(
    buildPage({
      packets: [input.opusHead ?? defaultOpusHead()],
      granule: 0,
      serial,
      sequence: sequence++,
      headerType: 0x02,
    }),
  )
  pages.push(
    buildPage({
      packets: [opusTags()],
      granule: 0,
      serial,
      sequence: sequence++,
      headerType: 0x00,
    }),
  )

  let granule = 0
  let pending: Uint8Array[] = []
  let pendingSegments = 0
  const flush = (isLast: boolean) => {
    if (pending.length === 0) {
      return
    }
    pages.push(
      buildPage({
        packets: pending,
        granule,
        serial,
        sequence: sequence++,
        headerType: isLast ? 0x04 : 0x00,
      }),
    )
    pending = []
    pendingSegments = 0
  }

  input.packets.forEach((packet, index) => {
    const segments = segmentCount(packet)
    if (pendingSegments + segments > MAX_SEGMENTS_PER_PAGE) {
      flush(false)
    }
    pending.push(packet)
    pendingSegments += segments
    granule += opusPacketSamples(packet)
    if (index === input.packets.length - 1) {
      flush(true)
    }
  })

  const total = pages.reduce((sum, page) => sum + page.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const page of pages) {
    out.set(page, offset)
    offset += page.length
  }
  return out
}

/** Converts a WebM/Opus recording to Ogg/Opus without re-encoding. */
export function webmOpusToOggOpus(webm: Uint8Array): Uint8Array<ArrayBuffer> {
  const { opusHead, packets } = extractOpusFromWebm(webm)
  if (packets.length === 0) {
    throw new Error("No audio found in the recording")
  }
  return buildOggOpus({ opusHead, packets })
}

/** Builds the file that is attached to the outgoing message. */
export async function toVoiceNoteFile(
  recording: Blob,
  format: RecordingFormat,
  now: Date = new Date(),
): Promise<File> {
  const stamp = now.toISOString().replace(/[:.]/g, "-")
  const name = `voice-${stamp}.${format.extension}`
  if (!format.needsOggRemux) {
    return new File([recording], name, { type: format.fileMimeType })
  }
  const ogg = webmOpusToOggOpus(new Uint8Array(await recording.arrayBuffer()))
  return new File([ogg], name, { type: format.fileMimeType })
}
