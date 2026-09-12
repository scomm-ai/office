/** This directory issues 11-character OTP codes (see `client.enrollMsk`/`verifyEnroll`). */
export const OTP_CODE_LENGTH = 11;

/** OTP codes are shown/typed with separators (e.g. "abc-def-ghi"); strip them before storing or measuring length. */
export function normalizeOtpCode(value: string): string {
  return value.replace(/[-\s]/g, "");
}

/** Whether a (possibly separator-formatted) OTP input is long enough to submit. */
export function isOtpCodeComplete(value: string): boolean {
  return normalizeOtpCode(value).length >= OTP_CODE_LENGTH;
}
