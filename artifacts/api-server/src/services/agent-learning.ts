import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db, learnedAnswersTable } from "@workspace/db";

function queryWords(query: string): string[] {
  return query
    .split(/\s+/)
    .map((word) => word.replace(/[؟?,.;:!]/g, "").trim())
    .filter((word) => word.length > 2)
    .slice(0, 5);
}

export async function loadLearnedContext(workspaceId: string, query: string): Promise<{ context: string; sources: string[] }> {
  const words = queryWords(query);
  if (words.length === 0) return { context: "", sources: [] };
  const matches = await db
    .select()
    .from(learnedAnswersTable)
    .where(and(
      eq(learnedAnswersTable.workspaceId, workspaceId),
      eq(learnedAnswersTable.status, "active"),
      or(...words.flatMap((word) => [
        ilike(learnedAnswersTable.questionPattern, `%${word}%`),
        ilike(learnedAnswersTable.bestAnswer, `%${word}%`),
      ]))!,
    ))
    .orderBy(desc(learnedAnswersTable.confidence), desc(learnedAnswersTable.createdAt))
    .limit(3);

  if (matches.length === 0) return { context: "", sources: [] };

  await db.update(learnedAnswersTable)
    .set({ useCount: sql`${learnedAnswersTable.useCount} + 1`, lastUsedAt: new Date() })
    .where(or(...matches.map((match) => eq(learnedAnswersTable.id, match.id)))!);

  const lines = matches.map((answer, index) => (
    `[${index + 1}] سؤال مشابه: ${answer.questionPattern}\nرد ناجح سابق: ${answer.bestAnswer}`
  ));
  return {
    context: `\n\nأمثلة على ردود ناجحة سابقة:\n${lines.join("\n---\n")}`,
    sources: matches.map((answer) => `تعلم سابق: ${answer.questionPattern}`),
  };
}
