import { describe, expect, test } from "vitest"
import { presignedUploadHeaders } from "../upload-headers"

const azureSas =
  "https://stexample.blob.core.windows.net/uploads/a/b?sv=2024-11-04&sp=cw&sig=abc"

describe("presignedUploadHeaders", () => {
  test("asks Azure for a block blob, which it refuses the upload without", () => {
    expect(presignedUploadHeaders(azureSas)["x-ms-blob-type"]).toBe("BlockBlob")
  })

  test("recognises an Azure SAS served from a custom domain", () => {
    expect(
      presignedUploadHeaders("https://cdn.example.com/uploads/a?sv=1&sig=x"),
    ).toHaveProperty("x-ms-blob-type")
  })

  test("sets the content type so images are displayed, not downloaded", () => {
    expect(presignedUploadHeaders(azureSas, "image/png")["Content-Type"]).toBe(
      "image/png",
    )
  })

  test("omits the content type when the caller has none", () => {
    expect(presignedUploadHeaders(azureSas)).not.toHaveProperty("Content-Type")
  })

  test("adds nothing to an S3 upload, whose signature covers its headers", () => {
    expect(
      presignedUploadHeaders(
        "https://s3.amazonaws.com/bucket/a?X-Amz-Signature=abc",
        "image/png",
      ),
    ).toEqual({})
  })

  test("adds nothing to a Google Cloud Storage upload", () => {
    expect(
      presignedUploadHeaders(
        "https://storage.googleapis.com/bucket/a?X-Goog-Signature=abc",
      ),
    ).toEqual({})
  })

  test("returns nothing rather than throwing on an unparseable url", () => {
    expect(presignedUploadHeaders("not a url")).toEqual({})
  })
})
