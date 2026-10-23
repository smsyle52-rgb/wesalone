import {
  type Context,
  defaultMimeTypeForFileType,
  type FileType,
  getMediaStoragePrefix,
  type IncomingAttachment,
  resolveIncomingFileType,
} from "@chatbotx.io/sdk"
import { createId } from "@chatbotx.io/utils"
import {
  storeIncomingImage,
  toStoredMediaFields,
} from "@chatbotx.io/utils/store-incoming-image"
import fetch from "cross-fetch"
import { rescue } from "../exception"
import { instagramBusinessClient } from "../lib/http-client"
import type {
  InstagramAttachment,
  InstagramAuthValue,
  InstagramMessageAttachment,
  InstagramSendMessageResponse,
} from "../schema"

export const uploadAttachment = (
  auth: InstagramAuthValue,
  url: string,
  type: FileType,
): Promise<InstagramSendMessageResponse> => {
  const endpoint = `${auth.metadata.version}/${auth.metadata.pageId}/message_attachments`

  return rescue(endpoint, () =>
    instagramBusinessClient.post<InstagramSendMessageResponse>(endpoint, {
      headers: {
        Authorization: `Bearer ${auth.tokens.accessToken}`,
      },
      json: {
        platform: "instagram",
        message: {
          attachment: {
            type,
            payload: {
              url,
              is_reusable: true,
            } as InstagramMessageAttachment["payload"],
          },
        },
      },
    }),
  )
}

export const getMessageAttachmentEntity = async ({
  ctx,
  attachment,
}: {
  ctx: Context<InstagramAuthValue>
  attachment: InstagramAttachment
}): Promise<IncomingAttachment | undefined> => {
  if (!attachment.payload.url) {
    throw new Error("No attachment URL found")
  }
  const response = await fetch(attachment.payload.url as string, {
    headers: {
      Authorization: `Bearer ${ctx.auth.tokens.accessToken}`,
      "User-Agent": "node",
    },
  })
  if (!(response.ok && response.body)) {
    throw new Error(
      `Failed to download attachment (status ${response.status} ${response.statusText}): ${attachment.payload.url}`,
    )
  }

  // Type from the webhook's declared kind, not only the CDN header: Meta
  // serves voice clips as application/octet-stream, which would file them as
  // `file` and keep them away from speech-to-text.
  const headerMimeType = response.headers.get("content-type")
  const fileType = resolveIncomingFileType(headerMimeType, attachment.type)
  const mimeType = headerMimeType ?? defaultMimeTypeForFileType(fileType)
  const isPhotoMessage = attachment.type === "image"
  const stored = await storeIncomingImage({
    uploader: ctx.uploader,
    key: `${getMediaStoragePrefix(ctx)}/${createId()}`,
    bytes: await response.arrayBuffer(),
    mimeType,
    profile: isPhotoMessage ? "media" : "original",
    acl: "public-read",
  })

  return {
    sourceId: createId(),
    isPhotoMessage,
    fileType,
    ...toStoredMediaFields(stored),
  }
}
