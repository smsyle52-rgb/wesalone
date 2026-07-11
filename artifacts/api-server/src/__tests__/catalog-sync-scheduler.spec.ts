import { describe, expect, it } from "vitest";
import { isSourceDue } from "../services/catalog-sync-scheduler";

describe("catalog sync scheduler — isSourceDue", () => {
  const now = new Date("2026-07-11T12:00:00.000Z");
  const intervalMs = 6 * 60 * 60_000; // يماثل CATALOG_SYNC_INTERVAL_MINUTES=360 في cloudbuild.yaml

  it("is always due when the source has never synced", () => {
    expect(isSourceDue(null, intervalMs, now)).toBe(true);
  });

  it("is not due when the last sync happened well within the interval", () => {
    const lastSyncedAt = new Date(now.getTime() - 60 * 60_000); // ساعة واحدة مضت
    expect(isSourceDue(lastSyncedAt, intervalMs, now)).toBe(false);
  });

  it("is not due one millisecond before the interval fully elapses", () => {
    const lastSyncedAt = new Date(now.getTime() - intervalMs + 1);
    expect(isSourceDue(lastSyncedAt, intervalMs, now)).toBe(false);
  });

  it("is due exactly when the interval has fully elapsed", () => {
    const lastSyncedAt = new Date(now.getTime() - intervalMs);
    expect(isSourceDue(lastSyncedAt, intervalMs, now)).toBe(true);
  });

  it("is due when the last sync is older than the interval", () => {
    const lastSyncedAt = new Date(now.getTime() - (intervalMs + 60_000));
    expect(isSourceDue(lastSyncedAt, intervalMs, now)).toBe(true);
  });
});
