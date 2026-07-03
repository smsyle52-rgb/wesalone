import { Router, type IRouter } from "express";
import healthRouter from "./health";
import webhookMetaRouter from "../modules/webhooks/meta.routes";
import authRouter from "../modules/auth/auth.routes";
import workspaceRouter from "../modules/workspace/workspace.routes";
import usersRouter from "../modules/users/users.routes";
import auditRouter from "../modules/audit/audit.routes";
import contactsRouter from "../modules/contacts/contacts.routes";
import conversationsRouter from "../modules/conversations/conversations.routes";
import ticketsRouter from "../modules/tickets/tickets.routes";
import tasksRouter from "../modules/tasks/tasks.routes";
import followupsRouter from "../modules/followups/followups.routes";
import opportunitiesRouter from "../modules/opportunities/opportunities.routes";
import ordersRouter from "../modules/orders/orders.routes";
import paymentsRouter from "../modules/payments/payments.routes";
import paymentMethodsRouter from "../modules/payments/payment-methods.routes";
import exchangeRatesRouter from "../modules/payments/exchange-rates.routes";
import dashboardRouter from "../modules/dashboard/dashboard.routes";
import channelsRouter from "../modules/channels/channels.routes";
import debtsRouter from "../modules/debts/debts.routes";
import integrationsRouter from "../modules/integrations/integrations.routes";
import knowledgeRouter from "../modules/knowledge/knowledge.routes";
import aiRouter from "../modules/ai/ai.routes";
import approvalsRouter from "../modules/approvals/approvals.routes";
import analyticsRouter from "../modules/analytics/analytics.routes";
import reportsRouter from "../modules/reports/reports.routes";
import productsRouter from "../modules/products/products.routes";
import uploadsRouter from "../modules/uploads/uploads.routes";
import pointsRouter from "../modules/points/points.routes";
import adminRouter from "../modules/admin/admin.routes";
import templatesRouter from "../modules/templates/templates.routes";
import whatsappBusinessProfileRouter from "../modules/whatsapp-management/whatsapp-business-profile.routes";
import inboxSupportRouter from "../modules/inbox/inbox-support.routes";
import { apiLimiter, webhookLimiter } from "../lib/rateLimiter";
import { requireVerifiedEmail } from "../middlewares/requireVerifiedEmail";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/webhooks", webhookLimiter, webhookMetaRouter);
router.use(apiLimiter);
router.use("/auth", authRouter);
router.use(requireVerifiedEmail);
router.use("/workspace", workspaceRouter);
router.use("/users", usersRouter);
router.use("/audit-logs", auditRouter);
router.use("/contacts", contactsRouter);
router.use("/conversations", conversationsRouter);
// اكتُشف بالاختبار الحيّ (3 يوليو): هذه الوحدة (بث SSE اللحظي /inbox/stream + الردود
// السريعة + العروض المحفوظة + قواعد SLA + ساعات العمل) مبنية بالكامل وجداولها موجودة
// في migrate-phase345.sql، لكنها لم تُسجَّل هنا قط — 404 دائم على أربعة endpoints،
// والتحديث اللحظي كان يعتمد على polling فقط بصمت (لا خطأ ظاهر للتاجر). خلافاً لوحدة
// commerce (غير مسجَّلة عمداً بسبب انجراف سكيمة)، هذه الجداول مؤكَّدة موجودة — التسجيل آمن.
router.use(inboxSupportRouter);
router.use("/tickets", ticketsRouter);
router.use("/tasks", tasksRouter);
router.use("/followups", followupsRouter);
router.use("/opportunities", opportunitiesRouter);
// HOTFIX: the commerce module (products/orders/payments/inventory re-architecture) is intentionally
// UNMOUNTED. Its routes were registered before the working ones and shadowed them, while querying
// tables (inventory_movements/stock_locations/product_variants/inventory_reservations) that are NOT
// present in production — the schema was never merged into scripts/migrate-phase345.sql — causing
// 500s on /products and /payments. Re-enable ONLY after that schema is applied and the system is
// tested end-to-end. The module files remain in the repo, dormant. See launch plan §5.2.
router.use("/orders", ordersRouter);
router.use("/payments", paymentsRouter);
router.use("/payment-methods", paymentMethodsRouter);
router.use("/exchange-rates", exchangeRatesRouter);
router.use("/dashboard", dashboardRouter);
router.use("/channels", channelsRouter);
router.use("/debts", debtsRouter);
router.use("/integrations", integrationsRouter);
router.use("/knowledge", knowledgeRouter);
router.use("/ai", aiRouter);
router.use("/approvals", approvalsRouter);
router.use("/analytics", analyticsRouter);
router.use("/reports", reportsRouter);
router.use("/products", productsRouter);
router.use("/uploads", uploadsRouter);
router.use("/points", pointsRouter);
router.use("/admin", adminRouter);
router.use("/templates", templatesRouter);
router.use("/whatsapp-management", whatsappBusinessProfileRouter);

export default router;
