import { Router, type NextFunction, type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../../lib/types";
import inventoryRouter from "./inventory.routes";

const router = Router();

router.use((req: Request, _res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  const permissions = authReq.sessionUser?.permissions;
  if (permissions) {
    const granted = new Set(permissions);
    if (granted.has("products:read")) granted.add("inventory:read");
    if (granted.has("products:update")) {
      granted.add("inventory:manage");
      granted.add("inventory:adjust");
    }
    authReq.sessionUser.permissions = [...granted];
  }
  next();
});

router.use(inventoryRouter);

export default router;
