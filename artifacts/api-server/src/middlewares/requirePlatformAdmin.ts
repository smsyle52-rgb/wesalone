import type { Response } from "express";
import type { AuthenticatedRequest } from "../lib/types";
import { env } from "../lib/env";

/**
 * يسمح فقط لمديري المنصة (بريدهم في PLATFORM_ADMIN_EMAILS).
 * مختلف عن requireOwner الذي يتحقق من دور workspace.
 * يُستخدم للعمليات العابرة للـworkspaces (اعتماد طلبات شحن، إدارة حزم، تعديلات مالية).
 */
export function requirePlatformAdmin(req: AuthenticatedRequest, res: Response): boolean {
  if (env.PLATFORM_ADMIN_EMAILS.length === 0) {
    res.status(503).json({ error: "PLATFORM_ADMIN_EMAILS غير مضبوط في بيئة الخادم" });
    return false;
  }
  const email = req.sessionUser.email?.toLowerCase() ?? "";
  if (env.PLATFORM_ADMIN_EMAILS.includes(email)) return true;
  res.status(403).json({ error: "هذه العملية مقتصرة على مديري المنصة" });
  return false;
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (env.PLATFORM_ADMIN_EMAILS.length === 0) return false;
  return env.PLATFORM_ADMIN_EMAILS.includes(email?.toLowerCase() ?? "");
}
