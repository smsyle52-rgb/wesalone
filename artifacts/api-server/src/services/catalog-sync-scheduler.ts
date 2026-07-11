import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { catalogSourcesTable, db, type CatalogSource } from "@workspace/db";
import { logger } from "../lib/logger";
import { syncCatalogSource } from "./meta-catalog-sync";

/**
 * catalog-sync-scheduler.ts — إعادة مزامنة دورية لمصادر الكتالوج، تعمل داخل api-server نفسه
 * (وليس outbox-worker).
 *
 * لماذا هنا وليس في العامل (worker):
 * - مزامنة الكتالوج المجدولة كانت تعيش في outbox-worker وحُذفت هناك بتاريخ 16 يونيو، فبقيت
 *   أحداث catalog.sync.requested تُصدَر بلا أي مستهلك يعالجها — لا خطأ ظاهر، فقط كتالوجات
 *   لا تتحدّث أبداً بعد أول مزامنة يدوية أو تلقائية عند الربط.
 * - api-server يعمل بـ min-instances=1 و max-instances=1 (انظر cloudbuild.yaml)، فمؤقّت داخلي
 *   بسيط (setInterval) آمن هنا تحديداً: نسخة واحدة فقط تعمل دائماً، فلا تعدّد نُسخ يعني عدّة
 *   مؤقّتات متوازية تتزاحم على نفس المصادر أو تكرّر العمل.
 * - كل مزامنة عبر syncCatalogSource هي upsert idempotent (onConflictDoUpdate على المفتاح
 *   الطبيعي) — فتشغيل مزدوج عرَضي أثناء canary أو إعادة نشر لا يفسد البيانات، فقط عمل مكرَّر
 *   غير ضار.
 */

const DEFAULT_INTERVAL_MINUTES = 0; // "0" أو غير مضبوط = معطّل
const MIN_JITTER_MS = 2 * 60_000;
const MAX_JITTER_MS = 4 * 60_000;
const BATCH_LIMIT = 20;

let syncTickInProgress = false; // حارس تداخل التكات — راجع runTick

/**
 * دالة نقيّة (لا قاعدة بيانات، لا وقت نظام ضمني) تقرّر هل مصدر معيّن مستحقّ لإعادة المزامنة.
 * تُستخدم كإعادة تحقّق "query-free" بعد جلب الدفعة من قاعدة البيانات: الدفعة صغيرة (حد
 * BATCH_LIMIT) فالتكلفة شبه معدومة، وتحمينا من أي فارق زمني بسيط بين لحظة بناء شرط SQL
 * ولحظة معالجة كل مصدر داخل نفس التك. مُصدَّرة أيضاً لتغطيتها باختبار وحدة مستقل.
 */
export function isSourceDue(lastSyncedAt: Date | null, intervalMs: number, now: Date): boolean {
  if (lastSyncedAt === null) return true;
  return now.getTime() - lastSyncedAt.getTime() >= intervalMs;
}

function parseIntervalMinutes(): number {
  const raw = process.env.CATALOG_SYNC_INTERVAL_MINUTES;
  if (!raw || !raw.trim()) return DEFAULT_INTERVAL_MINUTES;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INTERVAL_MINUTES;
  return parsed;
}

function randomJitterMs(): number {
  return MIN_JITTER_MS + Math.random() * (MAX_JITTER_MS - MIN_JITTER_MS);
}

async function fetchDueSources(intervalMs: number, now: Date): Promise<CatalogSource[]> {
  const cutoff = new Date(now.getTime() - intervalMs);
  return db.select()
    .from(catalogSourcesTable)
    .where(and(
      eq(catalogSourcesTable.status, "active"),
      or(
        isNull(catalogSourcesTable.lastSyncedAt),
        lt(catalogSourcesTable.lastSyncedAt, cutoff),
      ),
    ))
    .orderBy(sql`${catalogSourcesTable.lastSyncedAt} asc nulls first`)
    .limit(BATCH_LIMIT);
}

async function runTick(intervalMs: number): Promise<void> {
  if (syncTickInProgress) {
    logger.warn("catalog-sync-scheduler: previous tick still running, skipping this tick");
    return;
  }
  syncTickInProgress = true;
  const tickStartedAt = Date.now();
  let succeeded = 0;
  let failed = 0;
  let checked = 0;

  try {
    const candidates = await fetchDueSources(intervalMs, new Date());
    const dueSources = candidates.filter((source) => isSourceDue(source.lastSyncedAt, intervalMs, new Date()));
    checked = dueSources.length;

    for (const source of dueSources) {
      try {
        const result = await syncCatalogSource(source);
        if (result.status === "failed") {
          failed += 1;
          logger.warn(
            { sourceId: source.id, workspaceId: source.workspaceId, error: result.error },
            "catalog-sync-scheduler: source sync failed",
          );
        } else {
          succeeded += 1;
          logger.info(
            { sourceId: source.id, workspaceId: source.workspaceId, status: result.status, itemsSynced: result.itemsSynced },
            "catalog-sync-scheduler: source synced",
          );
        }
      } catch (err) {
        failed += 1;
        logger.warn(
          { err, sourceId: source.id, workspaceId: source.workspaceId },
          "catalog-sync-scheduler: source sync threw unexpectedly",
        );
      }
    }

    logger.info(
      { checked, succeeded, failed, durationMs: Date.now() - tickStartedAt },
      "catalog-sync-scheduler: tick complete",
    );
  } catch (err) {
    logger.error({ err }, "catalog-sync-scheduler: tick failed before syncing any source");
  } finally {
    syncTickInProgress = false;
  }
}

/**
 * تُستدعى مرّة واحدة بعد بدء الاستماع في index.ts. لا تفعل شيئاً إن كانت المزامنة الدورية
 * معطّلة (القيمة الافتراضية) أو أثناء الاختبارات.
 */
export function startCatalogSyncScheduler(): void {
  // تعطيل صريح أثناء الاختبارات: لا نريد setTimeout/setInterval حقيقيَين يعملان في الخلفية
  // ويُبقيان عملية vitest حيّة أو يلامسان قاعدة بيانات غير مهيّأة لبيئة الاختبار.
  if (process.env.NODE_ENV === "test") return;

  const intervalMinutes = parseIntervalMinutes();
  if (intervalMinutes <= 0) {
    logger.info(
      { raw: process.env.CATALOG_SYNC_INTERVAL_MINUTES ?? null },
      "catalog-sync-scheduler disabled (CATALOG_SYNC_INTERVAL_MINUTES unset/invalid)",
    );
    return;
  }

  const intervalMs = intervalMinutes * 60_000;
  const jitterMs = randomJitterMs();
  logger.info(
    { intervalMinutes, jitterMs: Math.round(jitterMs) },
    "catalog-sync-scheduler enabled — first tick scheduled after startup jitter",
  );

  setTimeout(() => {
    void runTick(intervalMs);
    setInterval(() => {
      void runTick(intervalMs);
    }, intervalMs);
  }, jitterMs);
}
