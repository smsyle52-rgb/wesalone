/**
 * expire-grants.ts — job يومي idempotent لانتهاء صلاحية grants المشتراة
 *
 * ── نقطة الاستدعاء ───────────────────────────────────────────────────────
 *   POST /internal/jobs/expire-grants
 *   Header: X-Internal-Secret: <INTERNAL_SECRET>
 *
 * ── Cloud Scheduler (الآلية المعتمدة في المشروع) ─────────────────────────
 *   المصادقة: OIDC token من service account مخصص (لا X-Internal-Secret في الـheader)
 *   الخطوات (تنفيذ مرة واحدة فقط بعد النشر — لا تُنفَّذ الآن):
 *
 *   # 1. إنشاء service account مخصص (إن لم يكن موجوداً)
 *   gcloud iam service-accounts create scheduler-expire-grants \
 *     --display-name="Expire Points Grants Scheduler SA" \
 *     --project=YOUR_PROJECT_ID
 *
 *   # 2. منح الـSA صلاحية استدعاء Cloud Run
 *   gcloud run services add-iam-policy-binding api-server \
 *     --member="serviceAccount:scheduler-expire-grants@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
 *     --role="roles/run.invoker" \
 *     --region=me-central1 \
 *     --project=YOUR_PROJECT_ID
 *
 *   # 3. إنشاء Cloud Scheduler job بـOIDC (لا secret في الأمر)
 *   gcloud scheduler jobs create http expire-points-grants \
 *     --schedule="0 2 * * *" \
 *     --uri="https://YOUR_CLOUD_RUN_URL/internal/jobs/expire-grants" \
 *     --message-body='{}' \
 *     --http-method=POST \
 *     --time-zone="Asia/Riyadh" \
 *     --oidc-service-account-email="scheduler-expire-grants@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
 *     --oidc-token-audience="https://YOUR_CLOUD_RUN_URL" \
 *     --location=me-central1 \
 *     --project=YOUR_PROJECT_ID
 *
 *   # للتحديث لاحقاً: gcloud scheduler jobs update http expire-points-grants ...
 *   # للتحقق: gcloud scheduler jobs list --location=me-central1
 *
 *   endpoint /internal/jobs/expire-grants يتحقق من الـOIDC token عبر Cloud Run الـbuilt-in IAM
 *   وقت التشغيل: 02:00 بتوقيت الرياض (23:00 UTC) — بعيداً عن ذروة النشاط.
 *
 * ── ضمانات التزامن ───────────────────────────────────────────────────────
 *  - idempotent: idempotency_key UNIQUE يمنع تسجيل expiration مرتين لنفس grant
 *  - ذري: كل grant في transaction مستقلة → فشل واحد لا يوقف الباقين
 *  - تشغيل عاملَين متزامنَين آمن: الأول يُعالج، الثاني يجد status='expired' ويتخطى
 *  - لا يعالج: expired | exhausted | frozen | reversed
 *  - يستثني grants بلا expiresAt (الشهرية — لا تنتهي صلاحيتها)
 */

import { expireStaleGrants } from "../services/point-wallet";
import { logger } from "../lib/logger";

export async function runExpireGrantsJob(): Promise<{
  expired: number;
  microPointsExpiredStr: string;
  durationMs: number;
}> {
  const start = Date.now();
  logger.info("expire-grants-job: starting");

  try {
    const result = await expireStaleGrants();
    const durationMs = Date.now() - start;

    logger.info(
      { expired: result.expired, microPointsExpiredStr: result.microPointsExpiredStr, durationMs },
      "expire-grants-job: complete",
    );

    return { ...result, durationMs };
  } catch (err) {
    logger.error({ err, durationMs: Date.now() - start }, "expire-grants-job: fatal error");
    throw err;
  }
}
