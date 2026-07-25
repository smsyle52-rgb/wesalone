import { beforeAll, describe, expect, test, vi } from "vitest"

beforeAll(() => {
  vi.stubEnv("S3_REGION", "us-central1")
  vi.stubEnv("S3_BUCKET", "test-bucket")
})

const { isGoogleCloudStorageEndpoint } = await import("./uploader")

describe("isGoogleCloudStorageEndpoint", () => {
  test("selects native Google auth for the production endpoint", () => {
    expect(isGoogleCloudStorageEndpoint("https://storage.googleapis.com")).toBe(
      true,
    )
  })

  test("keeps S3-compatible deployments on the existing client", () => {
    expect(isGoogleCloudStorageEndpoint("http://localhost:9000")).toBe(false)
  })

  test("rejects lookalike hostnames", () => {
    expect(
      isGoogleCloudStorageEndpoint("https://storage.googleapis.com.invalid"),
    ).toBe(false)
  })
})
