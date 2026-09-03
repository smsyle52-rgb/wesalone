import { describe, expect, test } from "vitest"
import {
  processStreamingText,
  processTextForImagesAndLinks,
} from "../src/core/stream"

describe("stream text processing", () => {
  test("keeps image URLs at their text position", () => {
    const parts = processTextForImagesAndLinks(
      [
        "1. *Áo sơ mi nam*",
        "- *Giá:* 340.000đ",
        "https://cdn.example.com/white-shirt.jpg",
        "",
        "2. *Áo thun Navy*",
        "- *Giá:* 230.000đ",
        "https://cdn.example.com/navy-shirt.png",
      ].join("\n"),
    )

    expect(parts).toEqual([
      "1. Áo sơ mi nam\n- Giá: 340.000đ",
      "https://cdn.example.com/white-shirt.jpg",
      "2. Áo thun Navy\n- Giá: 230.000đ",
      "https://cdn.example.com/navy-shirt.png",
    ])
  })

  test("removes markdown emphasis from text parts", () => {
    const parts = processTextForImagesAndLinks(
      "1. **Áo sơ mi nam**\n- *Giá:* 340.000đ",
    )

    expect(parts).toEqual(["1. Áo sơ mi nam\n- Giá: 340.000đ"])
  })
})

// Regression guards for the three Wesal fixes. Every case below is real text
// taken from a merchant's live WhatsApp conversation on 27 Aug 2026.
describe("Arabic reply fixes (WESAL_REPLY_FIXES)", () => {
  const PLAY_URL =
    "https://play.google.com/store/apps/details?id=com.bunyan.sanaa.byhands"

  // biome-ignore lint/suspicious/useAwait: processStreamingText takes an AsyncIterable; a fixed list of chunks has nothing to await.
  async function* streamOf(chunks: string[]) {
    for (const chunk of chunks) {
      yield chunk
    }
  }

  test("a link followed straight by an Arabic word stays a working link", () => {
    // The model emitted the URL and then restarted its answer with no space.
    // Upstream swallowed "تقدر" into the href and the customer got a dead link.
    const parts = processTextForImagesAndLinks(`${PLAY_URL}تقدر تحمّل التطبيق`)

    expect(parts[0]).toBe(PLAY_URL)
  })

  test("query strings still survive", () => {
    const parts = processTextForImagesAndLinks(
      "https://example.com/a?b=1&c=2 التفاصيل هنا",
    )

    expect(parts[0]).toBe("https://example.com/a?b=1&c=2")
  })

  test("the same answer emitted twice in one reply is sent once", async () => {
    const sent: string[] = []
    const answer = "عنواننا في صنعاء — جولة ريماس، جوار شواية العولقي"
    const closing = "إذا عندك أي استفسار آخر أنا في الخدمة"

    const { messageCount } = await processStreamingText(
      streamOf([answer, "\n\n", closing, answer, "\n\n", closing]),
      (_segment, parts) => {
        sent.push(...parts)
        return Promise.resolve()
      },
    )

    expect(sent).toEqual([answer, closing])
    expect(messageCount).toBe(2)
  })

  test("a genuinely different second paragraph is still sent", async () => {
    const sent: string[] = []

    await processStreamingText(
      streamOf(["سعر القميص 5000 ريال", "\n\n", "والتوصيل خلال يومين"]),
      (_segment, parts) => {
        sent.push(...parts)
        return Promise.resolve()
      },
    )

    expect(sent).toEqual(["سعر القميص 5000 ريال", "والتوصيل خلال يومين"])
  })

  test("a reply is never emptied — the first part always passes", async () => {
    const sent: string[] = []
    const only = "تم تحويل حالتك للموظف المختص"

    const { messageCount } = await processStreamingText(
      streamOf([only, "\n\n", only, "\n\n", only]),
      (_segment, parts) => {
        sent.push(...parts)
        return Promise.resolve()
      },
    )

    expect(sent).toEqual([only])
    expect(messageCount).toBe(1)
  })

  // Both cases below are verbatim production messages from 31 Aug 2026, after
  // the first dedupe shipped. The answer is welded to itself inside ONE
  // segment — no blank line — so nothing had been sent yet to compare against.
  test("an answer welded to itself in one segment is sent once", async () => {
    const sent: string[] = []
    const answer =
      "أهلاً بك، فول الثريا متوفر كرتون (24 علبة)، والأسعار تتحدث باستمرار ومندوب المبيعات بيعطيك السعر النهائي.\nكم الكمية (الكراتين) اللي تحتاجها؟"

    await processStreamingText(streamOf([answer, answer]), (_s, parts) => {
      sent.push(...parts)
      return Promise.resolve()
    })

    expect(sent).toEqual([answer])
  })

  test("a welded repeat with no line break at all is sent once", async () => {
    const sent: string[] = []
    const answer =
      "وصلت للأخ محمود وبنعدلها في الطباعة القادمة بإذن الله لتكون أوضح للجميع. تسلم وما قصرت."

    await processStreamingText(
      streamOf([`${answer} ${answer}`]),
      (_s, parts) => {
        sent.push(...parts)
        return Promise.resolve()
      },
    )

    expect(sent).toEqual([answer])
  })

  test("a reply that legitimately repeats a phrase is left whole", async () => {
    const sent: string[] = []
    // The catalogue answer repeats "متوفر عندنا" but is not a duplicate.
    const answer =
      "متوفر عندنا زيت الباشا وزيت الثريا. ومتوفر عندنا كذلك زيت نارجيل، أي واحد تحب؟"

    await processStreamingText(streamOf([answer]), (_s, parts) => {
      sent.push(...parts)
      return Promise.resolve()
    })

    expect(sent).toEqual([answer])
  })
})
