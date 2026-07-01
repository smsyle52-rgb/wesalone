import type { Request } from "express";

export interface SessionUser {
  userId: string;
  activeWorkspaceId: string;
  activeMembershipId: string;
  permissions: string[];
  roleSlugs: string[];
  name: string;
  email: string;
  emailVerified?: boolean;
  isPlatformAdmin?: boolean;
}

declare module "express-session" {
  interface SessionData {
    user: SessionUser;
  }
}

export interface AuthenticatedRequest extends Request {
  sessionUser: SessionUser;
}
