import { Router } from "express";
import { requireSession } from "../../middlewares/requireSession";
import legacyReadRouter from "./legacy-commerce-read.routes";
import legacyOrderAdapterRouter from "./legacy-commerce-order-adapter.routes";
import legacyPaymentAdapterRouter from "./legacy-commerce-payment-adapter.routes.js";

const router = Router();
router.use(requireSession);
router.use(legacyReadRouter);
router.use(legacyOrderAdapterRouter);
router.use(legacyPaymentAdapterRouter);

export default router;
