// @vitest-environment node
// biome-ignore-all lint/suspicious/noBitwiseOperators: reference CRC and byte fixtures
import { describe, expect, it } from "vitest"
import {
  buildOggOpus,
  extractOpusFromWebm,
  oggCrc,
  opusPacketSamples,
  pickRecordingFormat,
  toVoiceNoteFile,
  webmOpusToOggOpus,
} from "@/features/messages/lib/voice-note"

/** Bitwise reference CRC (independent of the table-driven implementation). */
function referenceCrc(data: Uint8Array) {
  let crc = 0
  for (const byte of data) {
    crc ^= byte << 24
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80_00_00_00 ? (crc << 1) ^ 0x04_c1_1d_b7 : crc << 1
      crc >>>= 0
    }
  }
  return crc >>> 0
}

const ascii = (text: string) => Array.from(new TextEncoder().encode(text))

/** EBML element with a 1-byte size (enough for these small fixtures). */
const element = (id: number[], payload: number[]) => [
  ...id,
  0x80 | payload.length,
  ...payload,
]
const UNKNOWN_SIZE = [0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]

const opusHead = [
  ...ascii("OpusHead"),
  1,
  1,
  0x38,
  0x01,
  0x80,
  0xbb,
  0,
  0,
  0,
  0,
  0,
]
// TOC 0xfc = CELT config 31 (20 ms), single frame -> 960 samples.
const packetA = [0xfc, 1, 2, 3]
const packetB = [0xfc, 4, 5]
const simpleBlock = (packet: number[]) =>
  element([0xa3], [0x81, 0x00, 0x00, 0x80, ...packet])

/** Mirrors Chrome's live MediaRecorder output: unknown-size Segment and Cluster. */
function chromeLikeWebm() {
  return new Uint8Array([
    ...element([0x1a, 0x45, 0xdf, 0xa3], [0x42, 0x82, 0x84, ...ascii("webm")]),
    0x18,
    0x53,
    0x80,
    0x67,
    ...UNKNOWN_SIZE,
    ...element(
      [0x16, 0x54, 0xae, 0x6b],
      element([0xae], element([0x63, 0xa2], opusHead)),
    ),
    0x1f,
    0x43,
    0xb6,
    0x75,
    ...UNKNOWN_SIZE,
    ...element([0xe7], [0x00]),
    ...simpleBlock(packetA),
    ...simpleBlock(packetB),
  ])
}

type OggPage = {
  headerType: number
  granule: bigint
  sequence: number
  packets: Uint8Array[]
  crcOk: boolean
}

function parseOgg(bytes: Uint8Array): OggPage[] {
  const pages: OggPage[] = []
  let offset = 0
  while (offset < bytes.length) {
    expect(new TextDecoder().decode(bytes.slice(offset, offset + 4))).toBe(
      "OggS",
    )
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset)
    const segments = bytes[offset + 26] as number
    const lacing = Array.from(bytes.slice(offset + 27, offset + 27 + segments))
    const bodyLength = lacing.reduce((sum, value) => sum + value, 0)
    const size = 27 + segments + bodyLength
    const page = bytes.slice(offset, offset + size)
    const stored = new DataView(page.buffer).getUint32(22, true)
    page.set([0, 0, 0, 0], 22)

    const packets: Uint8Array[] = []
    let bodyOffset = offset + 27 + segments
    let current: number[] = []
    for (const value of lacing) {
      current.push(...bytes.slice(bodyOffset, bodyOffset + value))
      bodyOffset += value
      if (value < 255) {
        packets.push(new Uint8Array(current))
        current = []
      }
    }
    pages.push({
      headerType: bytes[offset + 5] as number,
      granule: view.getBigUint64(6, true),
      sequence: view.getUint32(18, true),
      packets,
      crcOk: referenceCrc(page) === stored,
    })
    offset += size
  }
  return pages
}

describe("voice note recording format", () => {
  it("prefers native Ogg, then WebM (remuxed), then MP4", () => {
    expect(pickRecordingFormat(() => true)?.needsOggRemux).toBe(false)
    expect(
      pickRecordingFormat((type) => type.startsWith("audio/webm")),
    ).toMatchObject({ fileMimeType: "audio/ogg", needsOggRemux: true })
    expect(pickRecordingFormat((type) => type === "audio/mp4")).toMatchObject({
      fileMimeType: "audio/mp4",
      extension: "m4a",
    })
    expect(pickRecordingFormat(() => false)).toBeNull()
  })
})

describe("opusPacketSamples", () => {
  it("reads frame size and count from the TOC byte", () => {
    expect(opusPacketSamples(new Uint8Array([0xfc]))).toBe(960) // CELT 20 ms
    expect(opusPacketSamples(new Uint8Array([0x18]))).toBe(2880) // SILK 60 ms
    expect(opusPacketSamples(new Uint8Array([0x78]))).toBe(960) // hybrid 20 ms
    expect(opusPacketSamples(new Uint8Array([0xfd]))).toBe(1920) // 2 frames
    expect(opusPacketSamples(new Uint8Array([0xff, 0x03]))).toBe(2880) // code 3
    expect(opusPacketSamples(new Uint8Array([]))).toBe(0)
  })
})

describe("oggCrc", () => {
  it("matches the bitwise reference", () => {
    const sample = new Uint8Array(ascii("Wesal One voice note"))
    expect(oggCrc(sample)).toBe(referenceCrc(sample))
  })
})

describe("WebM to Ogg Opus", () => {
  it("extracts OpusHead and packets from unknown-size live recordings", () => {
    const result = extractOpusFromWebm(chromeLikeWebm())
    expect(Array.from(result.opusHead ?? [])).toEqual(opusHead)
    expect(result.packets.map((packet) => Array.from(packet))).toEqual([
      packetA,
      packetB,
    ])
  })

  it("writes a valid Ogg Opus stream with headers, granule and EOS", () => {
    const pages = parseOgg(webmOpusToOggOpus(chromeLikeWebm()))

    expect(pages.every((page) => page.crcOk)).toBe(true)
    expect(pages.map((page) => page.sequence)).toEqual([0, 1, 2])
    expect(pages[0]?.headerType).toBe(0x02) // beginning of stream
    expect(Array.from(pages[0]?.packets[0] ?? [])).toEqual(opusHead)
    expect(new TextDecoder().decode(pages[1]?.packets[0]?.slice(0, 8))).toBe(
      "OpusTags",
    )
    expect(pages[2]?.headerType).toBe(0x04) // end of stream
    expect(pages[2]?.granule).toBe(1920n)
    expect(pages[2]?.packets.map((packet) => Array.from(packet))).toEqual([
      packetA,
      packetB,
    ])
  })

  it("splits long recordings across pages and keeps every packet", () => {
    const packets = Array.from(
      { length: 600 },
      (_, index) => new Uint8Array([0xfc, index % 256]),
    )
    const pages = parseOgg(buildOggOpus({ opusHead: null, packets }))
    const audioPages = pages.slice(2)

    expect(audioPages.length).toBeGreaterThan(2)
    expect(pages.every((page) => page.crcOk)).toBe(true)
    expect(audioPages.flatMap((page) => page.packets)).toHaveLength(600)
    expect(audioPages.at(-1)?.granule).toBe(BigInt(600 * 960))
    expect(audioPages.at(-1)?.headerType).toBe(0x04)
    // A default OpusHead is written when the container carried none.
    expect(new TextDecoder().decode(pages[0]?.packets[0]?.slice(0, 8))).toBe(
      "OpusHead",
    )
  })

  it("rejects recordings with no audio", () => {
    expect(() => webmOpusToOggOpus(new Uint8Array([0x1a, 0x45]))).toThrow()
  })

  it("names the attached file and sets the voice-note mime type", async () => {
    const file = await toVoiceNoteFile(
      new Blob([chromeLikeWebm()]),
      {
        recorderMimeType: "audio/webm;codecs=opus",
        fileMimeType: "audio/ogg",
        extension: "ogg",
        needsOggRemux: true,
      },
      new Date("2026-11-04T21:30:00.000Z"),
    )
    expect(file.type).toBe("audio/ogg")
    expect(file.name).toBe("voice-2026-11-04T21-30-00-000Z.ogg")
    const head = new Uint8Array(await file.arrayBuffer()).slice(0, 4)
    expect(new TextDecoder().decode(head)).toBe("OggS")
  })
})
