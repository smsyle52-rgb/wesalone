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
