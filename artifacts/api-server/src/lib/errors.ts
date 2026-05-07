export class AppError extends Error {
  constructor(
    public statusCode: number,
    public messageAr: string,
    public code?: string,
  ) {
    super(messageAr);
    this.name = "AppError";
  }
}

export const errors = {
  unauthorized: () => new AppError(401, "يجب تسجيل الدخول أولاً", "UNAUTHORIZED"),
  forbidden: (msg = "ليس لديك صلاحية لهذا الإجراء") => new AppError(403, msg, "FORBIDDEN"),
  notFound: (entity = "العنصر") => new AppError(404, `${entity} غير موجود`, "NOT_FOUND"),
  badRequest: (msg: string) => new AppError(400, msg, "BAD_REQUEST"),
  conflict: (msg: string) => new AppError(409, msg, "CONFLICT"),
  businessViolation: (msg: string) => new AppError(422, msg, "BUSINESS_VIOLATION"),
  internal: () => new AppError(500, "حدث خطأ داخلي، يرجى المحاولة لاحقاً", "INTERNAL_ERROR"),
};
