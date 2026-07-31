/**
 * Maps a better-auth error to a translated, user-facing message.
 *
 * The auth forms used to surface `error.message` directly, which is
 * better-auth's own English string ("Invalid email or password") — shown
 * verbatim inside a fully Arabic UI. A merchant reading that has no idea
 * whether their password was wrong or the platform was broken.
 *
 * Keyed on `error.code`, not on the English text: the code is the stable
 * contract (@better-auth/core BASE_ERROR_CODES), the message is display copy
 * that can change between releases.
 */

type AuthErrorLike = {
  code?: string | null
  message?: string | null
}

/** better-auth error code -> key under the `auth` message namespace. */
const CODE_TO_KEY: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "errorInvalidEmailOrPassword",
  INVALID_PASSWORD: "errorInvalidEmailOrPassword",
  EMAIL_NOT_VERIFIED: "errorEmailNotVerified",
  USER_NOT_FOUND: "errorUserNotFound",
  USER_ALREADY_EXISTS: "errorUserAlreadyExists",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "errorUserAlreadyExists",
  INVALID_EMAIL: "errorInvalidEmail",
  PASSWORD_TOO_SHORT: "errorPasswordTooShort",
  PASSWORD_TOO_LONG: "errorPasswordTooLong",
  INVALID_TOKEN: "errorInvalidToken",
  TOKEN_EXPIRED: "errorTokenExpired",
  SESSION_EXPIRED: "errorSessionExpired",
}

export const EMAIL_NOT_VERIFIED_CODE = "EMAIL_NOT_VERIFIED"

export function isEmailNotVerified(error: AuthErrorLike | null | undefined) {
  return error?.code === EMAIL_NOT_VERIFIED_CODE
}

/**
 * @param t a `useTranslations("auth")` instance.
 * Falls back to a generic translated message rather than the raw English one:
 * an unrecognised code is still better shown as "something went wrong" in the
 * user's own language than as an untranslated internal string.
 */
export function authErrorMessage(
  error: AuthErrorLike | null | undefined,
  t: (key: string) => string,
): string {
  const key = error?.code ? CODE_TO_KEY[error.code] : undefined
  return t(key ?? "errorGeneric")
}
