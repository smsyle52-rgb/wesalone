/**
 * The extra request headers a presigned upload needs, decided by the storage
 * provider the URL points at.
 *
 * Azure Blob answers 400 `MissingRequiredHeader` to every upload that omits
 * `x-ms-blob-type`, while S3 and Google Cloud Storage need no extra headers at
 * all. So this returns nothing for those two on purpose: an unsigned header
 * arriving with a presigned request is exactly the kind of thing that
 * invalidates a signature, and there is no reason to risk it where nothing is
 * gained.
 */
export function presignedUploadHeaders(
  presignedUrl: string,
  contentType?: string,
): Record<string, string> {
  let url: URL
  try {
    url = new URL(presignedUrl)
  } catch {
    return {}
  }

  // `sv` + `sig` identify an Azure SAS, so a custom domain or CDN in front of
  // the account is still recognised rather than silently falling back to the
  // no-header path that fails.
  const isAzureBlob =
    url.hostname.endsWith(".blob.core.windows.net") ||
    (url.searchParams.has("sv") && url.searchParams.has("sig"))

  if (!isAzureBlob) {
    return {}
  }

  return {
    "x-ms-blob-type": "BlockBlob",
    // Left out, the blob is stored as application/octet-stream and a browser
    // later downloads the image instead of displaying it.
    ...(contentType ? { "Content-Type": contentType } : {}),
  }
}
