//! Closed schema for the desktop updater's plaintext metadata (ADR-0022).
use crate::{AppError, ErrorCode};

/// Existing key whitespace normalization is retained; no other key is public.
pub fn validate_updater_setting_key(raw: &str) -> Result<&str, AppError> {
    match raw.trim() {
        key @ ("updater.auto_check_consent"
        | "updater.skipped_version"
        | "updater.staged_version"
        | "updater.last_seen_version") => Ok(key),
        _ => Err(invalid("key")),
    }
}

/// Consent is explicit; versions retain their exact spelling, or clear with "".
pub fn validate_updater_setting_value(key: &str, value: &str) -> Result<(), AppError> {
    let key = validate_updater_setting_key(key)?;
    let valid = if key == "updater.auto_check_consent" {
        matches!(value, "yes" | "no")
    } else {
        value.is_empty() || (value.chars().count() <= 128 && semver::Version::parse(value).is_ok())
    };
    if valid { Ok(()) } else { Err(invalid("value")) }
}

fn invalid(field: &str) -> AppError {
    // Never echo rejected content, which could be an accidentally supplied secret.
    AppError::with_detail(
        ErrorCode::ValidationInvalidInput,
        "invalid updater setting",
        "field",
        field,
    )
}
