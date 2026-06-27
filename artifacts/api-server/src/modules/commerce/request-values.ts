export type SingleStringParameterResult =
  | { ok: true; value: string }
  | { ok: false; reason: "missing" | "multiple" | "invalid" };

export type OptionalSingleStringParameterResult =
  | { ok: true; value: string | null }
  | { ok: false; reason: "multiple" | "invalid" };

export function requestIdAsString(value: string | number): string {
  return String(value);
}

export function requestIdOrFallback(value: unknown, fallback: string): string {
  if (typeof value === "string" || typeof value === "number") {
    return requestIdAsString(value);
  }
  return fallback;
}

export function singleStringParameter(value: unknown): SingleStringParameterResult {
  if (Array.isArray(value)) return { ok: false, reason: "multiple" };
  if (value === undefined || value === null) return { ok: false, reason: "missing" };
  if (typeof value !== "string") return { ok: false, reason: "invalid" };

  const normalized = value.trim();
  if (!normalized) return { ok: false, reason: "invalid" };
  return { ok: true, value: normalized };
}

export function optionalSingleStringParameter(value: unknown): OptionalSingleStringParameterResult {
  if (value === undefined || value === null) return { ok: true, value: null };
  const parsed = singleStringParameter(value);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason === "multiple" ? "multiple" : "invalid",
    };
  }
  return parsed;
}
