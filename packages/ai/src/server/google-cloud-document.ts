import { GoogleAuth } from "google-auth-library"
import { env } from "../keys"
import { getActivePlatformAiCapability } from "./platform-provider"

const CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform"

type DocumentAiResponse = {
  document?: { text?: string }
}

export async function parsePlatformDocument(props: {
  content: Uint8Array
  mimeType: string
  signal?: AbortSignal
}): Promise<null | string> {
  const capability = await getActivePlatformAiCapability("documentParsing")
  if (capability?.provider !== "googleCloud") {
    return null
  }

  const processorId = env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID
  if (!processorId) {
    throw new Error(
      "Google Document AI is selected but GOOGLE_DOCUMENT_AI_PROCESSOR_ID is not configured",
    )
  }

  const location =
    env.GOOGLE_DOCUMENT_AI_LOCATION ?? capability.location ?? "us"
  const auth = new GoogleAuth({ scopes: [CLOUD_PLATFORM_SCOPE] })
  const client = await auth.getClient()
  const authHeaders = await client.getRequestHeaders()
  const requestHeaders: Record<string, string> = {}
  authHeaders.forEach((value, key) => {
    requestHeaders[key] = value
  })
  const endpoint = `https://${location}-documentai.googleapis.com/v1/projects/${capability.projectId}/locations/${location}/processors/${processorId}:process`
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      ...requestHeaders,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      rawDocument: {
        content: Buffer.from(props.content).toString("base64"),
        mimeType: props.mimeType,
      },
    }),
    signal: props.signal,
  })

  if (!response.ok) {
    throw new Error(`Google Document AI failed (${response.status})`)
  }

  const payload = (await response.json()) as DocumentAiResponse
  const text = payload.document?.text?.trim()
  if (!text) {
    throw new Error("Google Document AI returned no readable text")
  }
  return text
}
