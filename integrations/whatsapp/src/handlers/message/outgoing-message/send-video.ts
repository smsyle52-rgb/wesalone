import type { SendVideoStepSchema } from "@chatbotx.io/flow-config"
import type { MessageHandlers } from "@chatbotx.io/sdk"
import { Video } from "whatsapp-api-js/messages"
import type { WhatsappAuthValue } from "../../../schema"
import { buildWhatsappButtonMessages } from "./shared"

/**
 * Wesal: a flow's video step. WhatsApp plays it as a video message; any
 * buttons follow in their own message, since an interactive header here only
 * carries an image.
 */
export function* convertFlowStepVideo(
  props: Parameters<
    MessageHandlers<WhatsappAuthValue, SendVideoStepSchema>["sendFlowStep"]
  >[0],
) {
  const {
    data: { step, contact },
  } = props
  yield new Video(step.url)

  const quickReplies = props.data.quickReplies ?? []
  if (step.buttons.length + quickReplies.length === 0) {
    return
  }
  for (const message of buildWhatsappButtonMessages({
    flowId: props.data.flowId,
    flowVersionId: props.data.flowVersionId,
    buttons: step.buttons,
    quickReplies,
    metadata: props.data.metadata,
    bodyText: "👆",
    contactInboxId: contact.id,
  })) {
    yield message
  }
}
