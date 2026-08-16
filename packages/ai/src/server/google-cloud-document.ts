/**
 * Document AI is not provisioned in the Azure migration. Returning `null`
 * deliberately delegates to the caller's local/workspace fallback instead of
 * silently attempting the retired Google production integration.
 */
export function parsePlatformDocument(_props: {
  content: Uint8Array
  mimeType: string
  signal?: AbortSignal
}): Promise<null | string> {
  return Promise.resolve(null)
}
