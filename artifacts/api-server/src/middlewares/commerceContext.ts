import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "../lib/types";

export function hydrateCommerceContext(req: Request, _res: Response, next: NextFunction) {
  const authReq = req as AuthenticatedRequest;
  const current = authReq.sessionUser?.permissions;
  if (current) {
    const capabilities = new Set(current);
    if (capabilities.has("products:read")) capabilities.add("inventory:read");
    if (capabilities.has("products:update")) {
      capabilities.add("inventory:manage");
      capabilities.add("inventory:adjust");
    }
    if (capabilities.has("payments:confirm")) capabilities.add("payments:refund");
    authReq.sessionUser.permissions = [...capabilities];
  }
  next();
}
