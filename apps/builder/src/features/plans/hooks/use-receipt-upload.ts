"use client"

import { presignedUploadHeaders } from "@chatbotx.io/ui/lib/upload-headers"
import { useCallback } from "react"

export type ReceiptUploadResult = {
  fileId: string
}

export type ReceiptUploadErrorCode =
  | "unsupportedType"
  | "tooLarge"
  | "presignFailed"
  | "uploadFailed"

export class ReceiptUploadError extends Error {
  code: ReceiptUploadErrorCode
  constructor(code: ReceiptUploadErrorCode) {
    super(code)
    this.code = code
  }
}

const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
])
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024

/**
 * Uploads a payment receipt through ChatbotX's own presigned-upload flow
 * (type "generic", scoped under workspaces/{workspaceId}/...) — mirrors
 * features/import/hooks/use-presigned-upload.ts, which is typed too
 * narrowly (subType: ImportType) to reuse directly for a non-import upload.
 * Returns only a fileId; the server re-verifies ownership, type, and size
 * from the actual stored object before ever accepting it on a submission.
 */
export function useReceiptUpload(workspaceId: string) {
  const upload = useCallback(
    async (file: File): Promise<ReceiptUploadResult> => {
      if (!ALLOWED_RECEIPT_MIME_TYPES.has(file.type)) {
        throw new ReceiptUploadError("unsupportedType")
      }
      if (file.size > MAX_RECEIPT_BYTES) {
        throw new ReceiptUploadError("tooLarge")
      }

      const uniqueName = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`
      const path = `workspaces/${workspaceId}/subscription-payment-receipts/${uniqueName}`

      const presignResponse = await fetch("/api/presigned-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "generic",
          subType: "generic",
          workspaceId,
          path,
          fileName: file.name,
          mimeType: file.type,
        }),
      })
      if (!presignResponse.ok) {
        throw new ReceiptUploadError("presignFailed")
      }
      const { fileId, presignedPostUrl } = (await presignResponse.json()) as {
        fileId: string
        presignedPostUrl: string
      }

      const uploadResponse = await fetch(presignedPostUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type,
          ...presignedUploadHeaders(presignedPostUrl),
        },
        body: file,
      })
      if (!uploadResponse.ok) {
        throw new ReceiptUploadError("uploadFailed")
      }

      return { fileId }
    },
    [workspaceId],
  )

  return { upload }
}
