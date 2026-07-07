import { db, sectorProfilesTable, workspacesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// هوية القطاع للوكيل — كانت حبيسة مسار الاقتراح اليدوي (ai.routes) بينما المسار الحي
// (runAgentReply) يرد بلا أي وعي قطاعي رغم أن sector_profiles مبذورة والوكلاء يحملون
// sectorKey. نُقلت هنا (وحدة lib مشتركة) ليستهلكها المساران دون دورة استيراد
// (ai.routes يستورد agent-reply أصلاً). السلوك مطابق حرفياً للنسخة الأصلية.

type SectorAgentLike = {
  sectorKey?: string | null;
  sectorBehaviorOverrides?: Record<string, unknown> | null;
} | null;

function compactJson(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return JSON.stringify(value);
}

export async function loadSectorAgentContext(
  workspaceId: string,
  agent: SectorAgentLike,
): Promise<string> {
  const sectorKey = agent?.sectorKey || "services_general";
  const [profile] = await db.select().from(sectorProfilesTable).where(eq(sectorProfilesTable.sectorKey, sectorKey)).limit(1);
  const [workspace] = await db.select({ settings: workspacesTable.settings }).from(workspacesTable).where(eq(workspacesTable.id, workspaceId)).limit(1);
  const workspaceSettings = workspace?.settings && typeof workspace.settings === "object" ? workspace.settings as Record<string, unknown> : {};
  const workspaceSectorNote = typeof workspaceSettings.sector_note === "string" ? workspaceSettings.sector_note : "";
  if (!profile) return "";
  return [
    "هوية القطاع وأسلوب الخدمة:",
    `القطاع: ${profile.nameAr}`,
    `الوصف: ${profile.descriptionAr}`,
    `المعرفة العامة للقطاع: ${compactJson(profile.baseKnowledge)}`,
    `أسلوب الخدمة المطلوب: ${compactJson(profile.behaviorProfile)}`,
    `هدف التفاعل الناجح: ${compactJson(profile.serviceGoals)}`,
    `النبرة الافتراضية: ${profile.defaultTone}`,
    `حدود القطاع: ${compactJson(profile.guardrails)}`,
    agent?.sectorBehaviorOverrides && Object.keys(agent.sectorBehaviorOverrides).length > 0
      ? `تخصيصات التاجر لأسلوب الخدمة: ${compactJson(agent.sectorBehaviorOverrides)}`
      : "",
    workspaceSectorNote ? `ملاحظة التاجر عن نشاطه: ${workspaceSectorNote}` : "",
  ].filter(Boolean).join("\n");
}
