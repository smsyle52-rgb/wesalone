import { runAI, type AiRunInput, type AiRunOutput } from "./ai-provider";

const AGENT_EXECUTION_BRIDGE_PROMPT = `
تعليمات تنفيذية خاصة بمسار أدوات الوكيل:
- إرجاع tool_calls لا ينفّذ الإجراء مباشرة؛ الخادم هو الذي يتحقق وينفّذ بعد الاستجابة.
- قاعدة عدم ادعاء التنفيذ تعني: لا تقل إن الإجراء اكتمل إلا إذا أدرجت tool_call مطابقاً في نفس JSON.
- أعد كائن JSON صالحاً فقط، بلا Markdown وبلا أي نص قبل JSON أو بعده.
- يجب أن يحتوي الكائن دائماً على reply كنص وtool_calls كمصفوفة.
- عندما لا تحتاج أداة، أعد tool_calls كمصفوفة فارغة.
- لا تؤكد أو ترفض الدفعات؛ استخدم فقط log_payment_claim لتسجيل ادعاء معلّق.
`.trim();

export async function runAgentExecutionAI(input: AiRunInput): Promise<AiRunOutput> {
  const messages = input.messages.map((message) =>
    message.role === "system"
      ? { ...message, content: `${message.content}\n\n${AGENT_EXECUTION_BRIDGE_PROMPT}` }
      : message,
  );

  const output = await runAI({
    ...input,
    messages,
    taskType: "extract",
  });

  if (output.provider === "mock" || output.fallbackUsed) {
    throw new Error("AGENT_EXECUTION_PROVIDER_FALLBACK");
  }

  return output;
}

export function isStructuredAgentEnvelope(content: string): boolean {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end <= start) return false;

  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
    return typeof parsed.reply === "string" && Array.isArray(parsed.tool_calls);
  } catch {
    return false;
  }
}
