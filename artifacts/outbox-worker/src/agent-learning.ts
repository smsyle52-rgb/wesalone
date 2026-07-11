import type pino from "pino";
import { pool } from "@workspace/db";

const SENSITIVE_PATTERN = /(ضمان|سياسة|خصم|سعر خاص|استرجاع|استبدال|دفع)/;

function sensitivityFor(text: string): "simple" | "sensitive" {
  return SENSITIVE_PATTERN.test(text) ? "sensitive" : "simple";
}

export async function mineLearnedAnswers(logger: pino.Logger): Promise<number> {
  const feedbackRows = await pool.query<{
    workspace_id: string;
    question: string;
    answer: string;
  }>(`
    SELECT r.workspace_id,
           LEFT(COALESCE(u.content, ''), 500) AS question,
           LEFT(COALESCE(a.content, ''), 4000) AS answer
    FROM ai_feedback f
    JOIN ai_runs r ON r.id = f.ai_run_id
    LEFT JOIN LATERAL (
      SELECT content FROM ai_messages
      WHERE ai_run_id = r.id AND role = 'user'
      ORDER BY created_at DESC LIMIT 1
    ) u ON true
    LEFT JOIN LATERAL (
      SELECT content FROM ai_messages
      WHERE ai_run_id = r.id AND role = 'assistant'
      ORDER BY created_at DESC LIMIT 1
    ) a ON true
    WHERE f.rating = 'positive'
      AND r.task_type = 'draft_reply'
      AND COALESCE(u.content, '') <> ''
      AND COALESCE(a.content, '') <> ''
    ORDER BY f.created_at DESC
    LIMIT 50
  `);

  let upserts = 0;
  for (const row of feedbackRows.rows) {
    const sensitivity = sensitivityFor(`${row.question} ${row.answer}`);
    await pool.query(`
      INSERT INTO learned_answers (workspace_id, question_pattern, best_answer, source, topic_sensitivity, status, confidence)
      VALUES ($1, $2, $3, 'feedback', $4, $5, 0.85)
      ON CONFLICT DO NOTHING
    `, [row.workspace_id, row.question, row.answer, sensitivity, sensitivity === "simple" ? "active" : "pending_review"]);
    upserts += 1;
  }

  const resolvedRows = await pool.query<{
    workspace_id: string;
    question: string;
    answer: string;
  }>(`
    SELECT c.workspace_id,
           LEFT(COALESCE(in_msg.content, ''), 500) AS question,
           LEFT(COALESCE(out_msg.content, ''), 4000) AS answer
    FROM conversations c
    JOIN LATERAL (
      SELECT content FROM messages
      WHERE conversation_id = c.id AND direction = 'inbound'
      ORDER BY created_at DESC LIMIT 1
    ) in_msg ON true
    JOIN LATERAL (
      SELECT content FROM messages
      WHERE conversation_id = c.id AND direction = 'outbound' AND is_ai_draft = false
      ORDER BY created_at DESC LIMIT 1
    ) out_msg ON true
    WHERE c.status IN ('resolved', 'closed')
      AND COALESCE(in_msg.content, '') <> ''
      AND COALESCE(out_msg.content, '') <> ''
    ORDER BY c.updated_at DESC
    LIMIT 50
  `);

  for (const row of resolvedRows.rows) {
    const sensitivity = sensitivityFor(`${row.question} ${row.answer}`);
    await pool.query(`
      INSERT INTO learned_answers (workspace_id, question_pattern, best_answer, source, topic_sensitivity, status, confidence)
      VALUES ($1, $2, $3, 'resolved', $4, $5, 0.72)
      ON CONFLICT DO NOTHING
    `, [row.workspace_id, row.question, row.answer, sensitivity, sensitivity === "simple" ? "active" : "pending_review"]);
    upserts += 1;
  }

  if (upserts > 0) logger.info({ upserts }, "Agent learning mined candidate answers");
  return upserts;
}

// =============================================================
// مزامنة ميتا — الطور 3ب (11 يوليو 2026): تنقيب سؤال/جواب من سجل واتساب التاريخي
// (Coexistence) في wa_history_messages (staging، عبّأه meta.routes.ts handleHistoryEvent)
// نحو نفس learned_answers، بنفس بوابة الحساسية أعلاه + قيد إضافي: أي سعر تاريخي حسّاس
// دائماً (الكتالوج/المخزون هو مصدر السعر الوحيد — مبدأ مقفل، مذكرة مزامنة ميتا).
// =============================================================

const QUESTION_WORDS = ["كم", "هل", "متى", "وين", "أين", "كيف", "بكم"];

// "يبدو كسؤال": يحوي علامة استفهام (عربي أو لاتيني) أو يبدأ بأداة استفهام شائعة
// بالفصحى/اللهجة اليمنية. تقريب متعمد بسيط — ليس تحليلاً لغوياً، فقط فلتر أول رخيص
// قبل مطابقة الرد. مُصدَّرة لتبقى قابلة للاختبار مستقبلاً (outbox-worker بلا إطار
// اختبار حالياً — انظر تقرير التنفيذ).
export function isQuestionLike(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (trimmed.includes("؟") || trimmed.includes("?")) return true;
  return QUESTION_WORDS.some((word) => trimmed.startsWith(word));
}

// أسعار تاريخية يجب ألا تُفعَّل تلقائياً أبداً — الكتالوج/المخزون هو مصدر السعر
// الوحيد (مبدأ مقفل). أي رد يذكر رقماً بجانب رمز عملة يُصنَّف حسّاساً دائماً، بصرف
// النظر عن SENSITIVE_PATTERN النصي أعلاه.
const PRICE_PATTERN = /\d[\d,.]*\s*(ريال|ر\.ي|ر\.س|YER|SAR|USD|\$)/;

export function isPriceSensitive(text: string): boolean {
  return PRICE_PATTERN.test(text);
}

function isHistoryAnswerSensitive(question: string, answer: string): boolean {
  return sensitivityFor(`${question} ${answer}`) === "sensitive" || isPriceSensitive(answer);
}

export async function mineHistoryAnswers(logger: pino.Logger): Promise<number> {
  // كل الفلترة البنيوية (mined_at/direction/طول المحتوى) + "أول رد لاحق ضمن 24 ساعة"
  // في SQL واحد عبر LATERAL (نفس نمط resolvedRows أعلاه)؛ "يبدو كسؤال" يبقى في JS
  // (isQuestionLike) ليكون دالة نقيّة موثّقة بدل تكرار regex عربي داخل نص SQL.
  const candidates = await pool.query<{
    question_id: string;
    workspace_id: string;
    question: string;
    answer: string | null;
  }>(`
    SELECT
      q.id AS question_id,
      q.workspace_id,
      LEFT(q.content, 500) AS question,
      LEFT(a.content, 4000) AS answer
    FROM wa_history_messages q
    LEFT JOIN LATERAL (
      SELECT content
      FROM wa_history_messages reply
      WHERE reply.workspace_id = q.workspace_id
        AND reply.customer_wa_id = q.customer_wa_id
        AND reply.direction = 'outbound'
        AND reply.message_timestamp IS NOT NULL
        AND reply.message_timestamp > q.message_timestamp
        AND reply.message_timestamp <= q.message_timestamp + interval '24 hours'
        AND reply.content IS NOT NULL
        AND length(reply.content) BETWEEN 20 AND 4000
      ORDER BY reply.message_timestamp ASC
      LIMIT 1
    ) a ON true
    WHERE q.mined_at IS NULL
      AND q.direction = 'inbound'
      AND q.content IS NOT NULL
      AND length(q.content) BETWEEN 10 AND 500
      AND q.message_timestamp IS NOT NULL
    ORDER BY q.message_timestamp ASC
    LIMIT 200
  `);

  let learned = 0;
  const examinedIds: string[] = [];

  for (const row of candidates.rows) {
    examinedIds.push(row.question_id);

    // لا رد لاحق ضمن 24 ساعة، أو النص لا يبدو سؤالاً فعلياً — يُعلَّم "نُظر فيه" أدناه
    // بلا إدراج (لا نعيد فحصه لاحقاً، ولا نخترع رداً).
    if (!row.answer || !isQuestionLike(row.question)) continue;

    const sensitive = isHistoryAnswerSensitive(row.question, row.answer);
    const inserted = await pool.query(`
      INSERT INTO learned_answers (workspace_id, question_pattern, best_answer, source, topic_sensitivity, status, confidence)
      VALUES ($1, $2, $3, 'history', $4, $5, 0.70)
      ON CONFLICT DO NOTHING
    `, [row.workspace_id, row.question, row.answer, sensitive ? "sensitive" : "simple", sensitive ? "pending_review" : "active"]);
    if ((inserted.rowCount ?? 0) > 0) learned += 1;
  }

  // يُعلَّم كل صف فُحص هذه الدورة — طابَق رداً أم لا، بدا سؤالاً أم لا — لتفادي إعادة
  // فحصه للأبد؛ منفصل عن نجاح/فشل الإدراج (ON CONFLICT DO NOTHING أعلاه idempotent أصلاً).
  if (examinedIds.length > 0) {
    await pool.query(`UPDATE wa_history_messages SET mined_at = now() WHERE id = ANY($1::uuid[])`, [examinedIds]);
  }

  if (learned > 0) logger.info({ learned, examined: examinedIds.length }, "Mined WhatsApp history into learned answers");
  return learned;
}
