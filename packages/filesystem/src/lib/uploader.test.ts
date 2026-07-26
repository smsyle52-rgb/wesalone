import { describe, expect, test, vi } from "vitest"

const { fileSaveMock } = vi.hoisted(() => ({
  fileSaveMock: vi.fn(async () => undefined),
}))

vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    bucket() {
      return {
        file: () => ({ save: fileSaveMock }),
      }
    }
  },
}))

vi.stubEnv("S3_REGION", "us-central1")
vi.stubEnv("S3_BUCKET", "test-bucket")
vi.stubEnv("S3_ENDPOINT", "https://storage.googleapis.com")

const { isGoogleCloudStorageEndpoint, uploader } = await import("./uploader")

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

  test("disables unreliable native GCS checksum validation for byte uploads", async () => {
    const audio = new Uint8Array([1, 2, 3])

    await uploader.putObject("audio/test.ogg", audio, {
      ContentType: "audio/ogg",
    })

    expect(fileSaveMock).toHaveBeenCalledWith(audio, {
      metadata: { contentType: "audio/ogg" },
      resumable: false,
      validation: false,
    })
  })
})
