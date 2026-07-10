import type { AppError, ErrorCode } from "@voyalier/contracts";

/** True when `value` already matches the AppError shape { code, message }. */
export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value &&
    typeof (value as { code: unknown }).code === "string" &&
    typeof (value as { message: unknown }).message === "string"
  );
}

/**
 * Normalize any thrown/rejected value into an AppError. Values that are already
 * AppErrors pass through unchanged (preserving server codes and details);
 * everything else — network failures, invoke rejections, thrown strings —
 * collapses to the fallback code, `transport/failure` by default.
 */
export function toAppError(
  value: unknown,
  fallbackCode: ErrorCode = "transport/failure",
): AppError {
  if (isAppError(value)) return value;
  const message =
    value instanceof Error
      ? value.message
      : typeof value === "string"
        ? value
        : "The local core could not be reached.";
  return { code: fallbackCode, message };
}
