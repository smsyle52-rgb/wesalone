export class ChatbotXException extends Error {
  code = "systemError"
  httpStatusCode = 400

  constructor(message: string, code?: string, httpStatusCode?: number) {
    super(message)

    this.name = this.constructor.name
    if (code) {
      this.code = code
    }
    if (httpStatusCode) {
      this.httpStatusCode = httpStatusCode
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ChatbotXException)
    }
  }
}

export const notFoundException = (message: string) =>
  new ChatbotXException(message, "notFound", 404)

export const channelDuplicatedException = () =>
  new ChatbotXException(
    "This account is already connected to another workspace.",
    "channelDuplicated",
  )

export const insufficientStockException = () =>
  new ChatbotXException(
    "Requested quantity is not available in stock.",
    "insufficientStock",
    409,
  )

export const orderStateConflictException = (message: string) =>
  new ChatbotXException(message, "orderStateConflict", 409)

export const paymentAlreadyProcessedException = () =>
  new ChatbotXException(
    "This payment event has already been processed.",
    "paymentAlreadyProcessed",
    409,
  )

export const invalidWebhookSignatureException = () =>
  new ChatbotXException(
    "Invalid webhook signature.",
    "invalidWebhookSignature",
    400,
  )

export const paymentMismatchException = (message: string) =>
  new ChatbotXException(message, "paymentMismatch", 400)
