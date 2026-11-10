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
}

export const AI_VOICE_REPLY_WORKSPACES: Readonly<
  Record<string, AiVoiceReplyConfig>
> = {
  // ملكة سبأ: صوت الموظفة ملاك، مستنسخ من كل تسجيلاتها بموافقة الشركة.
  "11767468508764852": { elevenLabsVoiceId: "0AulIHZ1bpx87MDMNlci" },
}

export const getAiVoiceReplyConfig = (
  workspaceId: string | null | undefined,
): AiVoiceReplyConfig | null =>
  (workspaceId && AI_VOICE_REPLY_WORKSPACES[String(workspaceId)]) || null

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
  "ردك هذا سيتحول إلى رسالة صوتية يسمعها العميل. اكتبه كلامًا منطوقًا طبيعيًا كأنك موظف يمني يسجّل رسالة صوتية في واتساب: جمل قصيرة متصلة باللهجة اليمنية (صنعاني)، واستخدم كلمات يمنية مثل: ايش، مش، ذلحين، عاد، قدك، با (للمستقبل)، العروق، أيوه، خلاص، ولا تستخدم كلمات خليجية مثل: وش، مو، الحين، لين، زين. بدون قوائم أو ترقيم أو رموز أو إيموجي أو روابط. اكتب الأسعار بالكلمات كما تُنطق. إذا احتجت إرسال رقم حساب أو رقم هاتف فضعه وحده في سطر مستقل في آخر الرد ليُرسل نصًا."
