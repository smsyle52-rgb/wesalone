import type { NextFunction, Request, Response } from "express";
import type { AuthenticatedRequest } from "../lib/types";

export function extendCommerceSession(req: Request, _res: Response, next: NextFunction) {
  const authReq = req as AuthenticatedRequest;
  const list = authReq.sessionUser?.permissions;
  if (list) {
    if (list.includes("products:read")) list.push("inventory:read");
    if (list.includes("products:update")) list.push("inventory:manage", "inventory:adjust");
    if (list.includes("payments:confirm")) list.push("payments:refund");
    authReq.sessionUser.permissions = [...new Set(list)];
  }
  next();
}
