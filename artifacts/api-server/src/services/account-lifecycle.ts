import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { authTokensTable, db, usersTable } from "@workspace/db";
import { sendSystemEmail } from "./notifications";
import { logger } from "../lib/logger";

type TokenType = "email_verification" | "password_reset";

function publicBaseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? process.env.APP_BASE_URL ?? "http://localhost:5173").replace(/\/$/, "");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function createAuthToken(userId: string, type: TokenType, expiresInMs: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + expiresInMs);
  await db.insert(authTokensTable).values({
    userId,
    type,
    tokenHash: hashToken(token),
    expiresAt,
  });
  return token;
}

export async function sendVerificationEmail(user: { id: string; email: string; name?: string | null }): Promise<void> {
  const token = await createAuthToken(user.id, "email_verification", 24 * 60 * 60 * 1000);
  const link = `${publicBaseUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  await sendSystemEmail(user.email, {
    type: "auth.email_verification",
    titleAr: "تأكيد بريدك في وصال ون",
    bodyAr: `مرحباً ${user.name ?? ""}، اضغط الرابط لتأكيد بريدك الإلكتروني في وصال ون.`,
    link,
  }).catch((err) => logger.warn({ err, userId: user.id }, "Verification email failed"));
}

export async function sendPasswordResetEmail(user: { id: string; email: string; name?: string | null }): Promise<void> {
  const token = await createAuthToken(user.id, "password_reset", 60 * 60 * 1000);
  const link = `${publicBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  await sendSystemEmail(user.email, {
    type: "auth.password_reset",
    titleAr: "استعادة كلمة المرور",
    bodyAr: `مرحباً ${user.name ?? ""}، استخدم الرابط التالي لتعيين كلمة مرور جديدة. ينتهي الرابط خلال ساعة.`,
    link,
  }).catch((err) => logger.warn({ err, userId: user.id }, "Password reset email failed"));
}

export async function consumeAuthToken(token: string, type: TokenType): Promise<{ userId: string } | null> {
  const [row] = await db
    .select({ id: authTokensTable.id, userId: authTokensTable.userId })
    .from(authTokensTable)
    .where(and(
      eq(authTokensTable.tokenHash, hashToken(token)),
      eq(authTokensTable.type, type),
      isNull(authTokensTable.usedAt),
      gt(authTokensTable.expiresAt, new Date()),
    ))
    .limit(1);

  if (!row) return null;

  await db.update(authTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(authTokensTable.id, row.id));

  return { userId: row.userId };
}

export async function markEmailVerified(userId: string): Promise<void> {
  await db.update(usersTable).set({ emailVerified: true, updatedAt: new Date() }).where(eq(usersTable.id, userId));
}
