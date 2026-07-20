//! Traveler-owned planning records. These are deliberately separate from
//! evidence-backed facts: a saved idea or manually entered activity must never
//! inherit the authority of a confirmed booking.

use serde::{Deserialize, Serialize};

use crate::{AppError, ErrorCode, PersonaWeights, Recommendation};

pub const MAX_PLANNING_LABEL_CHARS: usize = 240;
pub const MAX_PLANNING_NOTES_CHARS: usize = 20_000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterestProfile {
    pub trip_id: String,
    #[serde(flatten)]
    pub weights: PersonaWeights,
    pub updated_at: Option<String>,
}

impl InterestProfile {
    pub fn balanced(trip_id: impl Into<String>) -> Self {
        Self {
            trip_id: trip_id.into(),
            weights: PersonaWeights::balanced(),
            updated_at: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetInterestProfileInput {
    pub trip_id: String,
    #[serde(flatten)]
    pub weights: PersonaWeights,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPlace {
    pub id: String,
    pub trip_id: String,
    pub pack_id: String,
    pub source_pack_available: bool,
    pub name: String,
    pub category: String,
    pub dimension: String,
    pub lat: f64,
    pub lon: f64,
    pub source: String,
    pub license: String,
    pub reasons: Vec<String>,
    pub wildcard: bool,
    pub notes: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePlaceInput {
    pub trip_id: String,
    pub recommendation: Recommendation,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSavedPlaceInput {
    pub saved_place_id: String,
    pub notes: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackingItem {
    pub id: String,
    pub trip_id: String,
    pub label: String,
    pub checked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion_code: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddPackingItemInput {
    pub trip_id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePackingItemInput {
    pub packing_item_id: String,
    pub label: String,
    pub checked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TripItemKind {
    Activity,
    Rail,
    Transfer,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripItem {
    pub id: String,
    pub trip_id: String,
    pub kind: TripItemKind,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_place_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTripItemInput {
    pub trip_id: String,
    pub kind: TripItemKind,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_place_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTripItemInput {
    pub trip_item_id: String,
    pub kind: TripItemKind,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_place_id: Option<String>,
}

pub fn validate_packing_label(value: &str) -> Result<String, AppError> {
    validate_text(value, "label", MAX_PLANNING_LABEL_CHARS, false).map(|value| value.unwrap())
}

pub fn validate_planning_notes(value: &str) -> Result<String, AppError> {
    Ok(validate_text(value, "notes", MAX_PLANNING_NOTES_CHARS, true)?.unwrap_or_default())
}

pub fn validate_create_trip_item(
    mut input: CreateTripItemInput,
) -> Result<CreateTripItemInput, AppError> {
    input.title = validate_text(&input.title, "title", MAX_PLANNING_LABEL_CHARS, false)?.unwrap();
    input.location = validate_optional(input.location, "location", MAX_PLANNING_LABEL_CHARS)?;
    input.notes = validate_optional(input.notes, "notes", MAX_PLANNING_NOTES_CHARS)?;
    input.start_at = validate_optional(input.start_at, "startAt", 64)?;
    input.end_at = validate_optional(input.end_at, "endAt", 64)?;
    if let (Some(start), Some(end)) = (&input.start_at, &input.end_at) {
        if end < start {
            return Err(AppError::with_detail(
                ErrorCode::ValidationInvalidDateRange,
                "trip item end must not precede its start",
                "field",
                "endAt",
            ));
        }
    }
    Ok(input)
}

fn validate_optional(
    value: Option<String>,
    field: &str,
    max: usize,
) -> Result<Option<String>, AppError> {
    value
        .map(|value| validate_text(&value, field, max, true))
        .transpose()
        .map(Option::flatten)
}

fn validate_text(
    value: &str,
    field: &str,
    max: usize,
    empty_is_none: bool,
) -> Result<Option<String>, AppError> {
    let value = value.trim();
    let count = value.chars().count();
    if count == 0 {
        return if empty_is_none {
            Ok(None)
        } else {
            Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                format!("{field} is required"),
                "field",
                field,
            ))
        };
    }
    if count > max {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            format!("{field} must be at most {max} characters"),
            "field",
            field,
        ));
    }
    Ok(Some(value.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_and_normalizes_traveler_owned_planning_text() {
        let item = validate_create_trip_item(CreateTripItemInput {
            trip_id: "trip_1".to_owned(),
            kind: TripItemKind::Activity,
            title: "  Tea ceremony  ".to_owned(),
            location: Some("  Gion  ".to_owned()),
            start_at: Some("2027-04-04T15:00:00Z".to_owned()),
            end_at: None,
            notes: Some("  Ask about accessibility  ".to_owned()),
            saved_place_id: None,
        })
        .expect("valid item");

        assert_eq!(item.title, "Tea ceremony");
        assert_eq!(item.location.as_deref(), Some("Gion"));
        assert_eq!(item.notes.as_deref(), Some("Ask about accessibility"));
    }

    #[test]
    fn rejects_empty_packing_labels() {
        let error = validate_packing_label("   ").expect_err("empty label");
        assert_eq!(error.code, crate::ErrorCode::ValidationInvalidInput);
    }
}
