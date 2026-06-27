import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies the x-hub-signature-256 HMAC sent by Meta on every webhook POST.
 * Exported so contract tests can verify accept/reject behavior without HTTP.
 * Identical logic to the inline verifyMetaSignature in meta.routes.ts — one source of truth.
 */
export function verifyMetaHmac(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const signatureHex = signatureHeader.slice("sha256=".length);
  if (!/^[a-fA-F0-9]+$/.test(signatureHex)) return false;
  const expectedHex = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(signatureHex, "hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export function makeMetaSignature(rawBody: Buffer, secret: string): string {
  const hex = createHmac("sha256", secret).update(rawBody).digest("hex");
  return `sha256=${hex}`;
}
