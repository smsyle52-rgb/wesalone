import { beforeEach, describe, expect, test, vi } from "vitest"

const { getAccessTokenMock } = vi.hoisted(() => ({
  getAccessTokenMock: vi.fn(async () => "test-access-token"),
}))

vi.mock("@google-cloud/storage", () => ({
  Storage: class {
    authClient = { getAccessToken: getAccessTokenMock }

    bucket() {
      return {
        file: () => ({}),
      }
    }
  },
}))

const fetchMock = vi.fn<typeof fetch>(
  async () => new Response("{}", { status: 200 }),
)

vi.stubEnv("S3_REGION", "us-central1")
vi.stubEnv("S3_BUCKET", "test-bucket")
vi.stubEnv("S3_ENDPOINT", "https://storage.googleapis.com")

const { isGoogleCloudStorageEndpoint, uploader } = await import("./uploader")

describe("isGoogleCloudStorageEndpoint", () => {
  beforeEach(() => {
    fetchMock.mockClear()
    getAccessTokenMock.mockClear()
    vi.stubGlobal("fetch", fetchMock)
  })

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

  test("uploads exact bytes through the GCS media endpoint", async () => {
    const audio = new Uint8Array([1, 2, 3])

    await uploader.putObject("audio/test.ogg", audio, {
      ContentType: "audio/ogg",
    })

    expect(getAccessTokenMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()

    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBeInstanceOf(URL)
    expect(String(url)).toBe(
      "https://storage.googleapis.com/upload/storage/v1/b/test-bucket/o?uploadType=media&name=audio%2Ftest.ogg",
    )
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        authorization: "Bearer test-access-token",
        "content-type": "audio/ogg",
      },
    })
    expect(new Uint8Array(init?.body as ArrayBuffer)).toEqual(audio)
  })
})
