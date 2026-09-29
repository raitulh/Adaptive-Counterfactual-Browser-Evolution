/**
 * Client mirror of the backend password rules (app/auth/schemas.py `check_password_strength`,
 * `ChangePasswordRequest`): 10–256 characters mixing at least three of lowercase, uppercase,
 * digits and symbols. The backend re-validates; this only gives early feedback.
 */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;

export interface PasswordChecks {
  length: boolean;
  lower: boolean;
  upper: boolean;
  digit: boolean;
  symbol: boolean;
  classes: number;
  ok: boolean;
}

export function passwordChecks(value: string): PasswordChecks {
  const lower = /\p{Ll}/u.test(value);
  const upper = /\p{Lu}/u.test(value);
  const digit = /\p{Nd}/u.test(value);
  // Python's `not c.isalnum()` — anything that is not a letter or digit (Unicode aware).
  const symbol = /[^\p{L}\p{N}]/u.test(value);
  const classes = [lower, upper, digit, symbol].filter(Boolean).length;
  const length = value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
  return { length, lower, upper, digit, symbol, classes, ok: length && classes >= 3 };
}
