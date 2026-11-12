/**
 * Wesal: workspaces whose AI agent answers a customer's voice note with a voice
 * note (platform text-to-speech, sent as a WhatsApp voice message). Text
 * messages are still answered with text, and anything the customer must copy
 * (account or phone numbers) is always sent as text next to the voice note.
 *
 * `elevenLabsVoiceId` speaks with a cloned voice on ElevenLabs (used first when
 * the server has an ElevenLabs key). `voice` overrides the platform's Google
 * voice (a Chirp3-HD voice name, e.g. "ar-XA-Chirp3-HD-Charon"), which is the
 * fallback.
 */
export type AiVoiceReplyConfig = {
  voice?: string
  elevenLabsVoiceId?: string
  /**
   * Text messages may be answered with a voice note too: the agent marks the
   * replies it wants spoken with `AI_VOICE_CHOICE_MARKER`, so the conversation
   * mixes voice and text.
   */
  mixed?: boolean
}

export const AI_VOICE_REPLY_WORKSPACES: Readonly<
  Record<string, AiVoiceReplyConfig>
> = {
  // ملكة سبأ: صوت "سلمى" من مكتبة أصوات ElevenLabs (اختيار الإدارة).
  "11767468508764852": {
    elevenLabsVoiceId: "a1KZUXKFVFDOb33I1uqr",
    mixed: true,
  },
}

/**
 * Reads the server's `AI_VOICE_REPLY_ELEVENLABS_VOICES` setting: a JSON object
 * of workspace id to ElevenLabs voice id, so a workspace's voice can be changed
 * without a new release. Anything malformed is ignored.
 */
export const parseElevenLabsVoiceOverrides = (
  raw: string | null | undefined,
): Record<string, string> => {
  if (!raw?.trim()) {
    return {}
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] =>
          typeof entry[1] === "string" && entry[1].trim() !== "",
      ),
    )
  } catch {
    return {}
  }
}

export const getAiVoiceReplyConfig = (
  workspaceId: string | null | undefined,
  elevenLabsVoiceOverrides?: string | null,
): AiVoiceReplyConfig | null => {
  const config =
    (workspaceId && AI_VOICE_REPLY_WORKSPACES[String(workspaceId)]) || null
  if (!config) {
    return null
  }
  const voiceId = parseElevenLabsVoiceOverrides(elevenLabsVoiceOverrides)[
    String(workspaceId)
  ]
  return voiceId ? { ...config, elevenLabsVoiceId: voiceId } : config
}

/** Lines a customer has to read or copy: account, wallet and phone numbers. */
const COPYABLE_NUMBER = /\d[\d\s\-()]{6,}\d/

/**
 * Splits an agent reply into what is spoken and what must stay text. Lines
 * holding an account or phone number stay text; the rest is spoken.
 */
export const splitVoiceReply = (
  text: string,
): { spoken: string; textOnly: string } => {
  const spoken: string[] = []
  const textOnly: string[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      continue
    }
    ;(COPYABLE_NUMBER.test(line) ? textOnly : spoken).push(line.trim())
  }
  return { spoken: spoken.join("\n"), textOnly: textOnly.join("\n") }
}

/**
 * Appended to the agent's context when its reply will be spoken, so the text
 * reads naturally aloud.
 */
export const AI_VOICE_REPLY_INSTRUCTION =
  "ردك هذا سيتحول إلى رسالة صوتية يسمعها العميل. اكتبه كلامًا منطوقًا طبيعيًا بنفس شخصيتك في التعليمات كأنك تسجّل رسالة صوتية في واتساب: جمل قصيرة متصلة باللهجة اليمنية (صنعاني)، واستخدم كلمات يمنية مثل: ايش، مش، ذلحين، عاد، قدك، با (للمستقبل)، العروق، أيوه، خلاص، ولا تستخدم كلمات خليجية مثل: وش، مو، الحين، لين، زين. بدون قوائم أو ترقيم أو رموز أو إيموجي أو روابط. اكتب الأسعار بالكلمات كما تُنطق. إذا احتجت إرسال رقم حساب أو رقم هاتف فضعه وحده في سطر مستقل في آخر الرد ليُرسل نصًا."

/** Starts a reply the agent chose to send as a voice note (mixed mode). */
export const AI_VOICE_CHOICE_MARKER = "[صوت]"

/**
 * Appended to the agent's context in mixed mode, when the customer wrote text:
 * the agent picks, reply by reply, whether to speak or to write.
 */
export const AI_VOICE_CHOICE_INSTRUCTION = `تقدر ترد على العميل برسالة صوتية أو برسالة مكتوبة، وأنت تختار حسب الموقف عشان تكون المحادثة خليط طبيعي بين الصوت والنص.
- إذا اخترت يكون ردك صوت: ابدأ الرد بالوسم ${AI_VOICE_CHOICE_MARKER} في أول سطر، ثم اكتب الرد كلامًا منطوقًا طبيعيًا بنفس شخصيتك ولهجتك، جمل قصيرة متصلة، بدون قوائم أو ترقيم أو رموز أو إيموجي أو روابط، والأسعار بالكلمات كما تُنطق.
- الصوت يناسب: الترحيب الأول، شرح التشخيص وسبب المشكلة وعلاجها، الطمأنة والإقناع والتعاطف.
- النص (بدون الوسم) يناسب: الأسعار والإجمالي، أرقام الحسابات والهواتف، ملخص الطلب، خطوات الاستخدام المرقمة، والردود القصيرة جدًا.
- لا ترسل أكثر من ردين صوتيين ورا بعض، ولا تخلي كل الردود نص.`

/**
 * Reads the agent's choice in mixed mode: whether the reply opens with the
 * voice marker, and the reply without any marker.
 */
export const takeVoiceChoice = (
  text: string,
): { voice: boolean; text: string } => {
  const trimmed = text.trimStart()
  const voice = trimmed.startsWith(AI_VOICE_CHOICE_MARKER)
  return {
    voice,
    text: stripVoiceChoiceMarker(text),
  }
}

/** Removes every voice marker from a reply or a part of one. */
export const stripVoiceChoiceMarker = (text: string): string =>
  text.split(AI_VOICE_CHOICE_MARKER).join("").trim()
