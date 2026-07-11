use std::collections::BTreeMap;

use jiff::civil::{Date, DateTime};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

pub const MAX_LOCATION_LEN: usize = 120;
pub const MAX_DOCUMENT_CHARS: usize = 1_000_000;

/// User-visible intelligence capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum IntelligenceMode {
    Local,
    OnDeviceAi,
    CloudAi,
    OfflineSnapshot,
}

/// Explicit readiness state. `NotChecked` must never be rendered as `Clear`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadinessStatus {
    NotChecked,
    Clear,
    Monitor,
    ActionNeeded,
    Critical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TripStatus {
    Draft,
    Active,
    Archived,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trip {
    pub id: String,
    pub title: String,
    pub origin: String,
    pub destination: String,
    pub start_date: String,
    pub end_date: String,
    pub status: TripStatus,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripSummary {
    #[serde(flatten)]
    pub trip: Trip,
    pub confirmed_fact_count: u32,
    pub pending_candidate_count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripDetail {
    pub trip: Trip,
    pub confirmed_facts: Vec<ConfirmedFact>,
    pub pending_candidate_count: u32,
    /// Deterministic, advisory cross-segment checks over the confirmed facts.
    /// Always present; empty when the itinerary is coherent. Never blocks confirmation.
    pub itinerary_conflicts: Vec<ItineraryConflict>,
    /// Deterministic plan-completeness rollup (logistics only, no sourced/entry data).
    pub readiness: ReadinessSummary,
}

/// Which deterministic plan-completeness check a readiness item reports on.
///
/// Logistics checks are deterministic. `EntryRequirements` is a link-only,
/// reference item that never asserts or clears requirements. Sourced readiness
/// (health, safety, weather) is a later milestone; it is never LLM-authored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReadinessCheck {
    ScheduleConflicts,
    LodgingCoverage,
    PendingReview,
    EntryRequirements,
}

/// A labelled link to an authoritative external source. URLs are curated in
/// code, never derived from untrusted input or a model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLink {
    pub label: String,
    pub url: String,
}

/// A single readiness check with its status and a plain-language explanation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessItem {
    pub id: ReadinessCheck,
    pub status: ReadinessStatus,
    pub title: String,
    pub detail: String,
    /// Curated official-source links, when the item points the traveler outward
    /// instead of asserting anything. Additive; omitted on the wire when empty.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub links: Vec<SourceLink>,
}

/// The overall readiness rollup plus the per-check items it was derived from.
/// `status` is the worst item; an empty plan is `NotChecked`, never `Clear`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadinessSummary {
    pub status: ReadinessStatus,
    pub items: Vec<ReadinessItem>,
}

/// The kind of cross-segment issue found in a trip's confirmed itinerary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItineraryConflictKind {
    /// Two flight segments occupy overlapping time — physically impossible.
    FlightOverlap,
    /// Two lodging stays cover the same night — likely a double booking.
    LodgingOverlap,
    /// One or more nights inside the trip window have no lodging booked.
    LodgingGap,
}

/// How strongly a conflict should be surfaced. Advisory only.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictSeverity {
    /// Worth knowing; not necessarily wrong (e.g. an overnight-flight night with no room).
    Notice,
    /// Almost certainly a mistake to resolve (e.g. two flights at once).
    Warning,
}

/// A single deterministic finding about the confirmed itinerary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItineraryConflict {
    pub kind: ItineraryConflictKind,
    pub severity: ConflictSeverity,
    pub message: String,
    /// Confirmed-fact ids involved (sorted). Empty for window-level findings like gaps.
    pub fact_ids: Vec<String>,
    /// For date-range findings (gaps): first affected night, ISO `YYYY-MM-DD`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    /// For date-range findings (gaps): last affected night inclusive, ISO `YYYY-MM-DD`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactType {
    FlightSegment,
    LodgingStay,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FactPayload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub airline_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub airline_iata: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flight_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub departure_airport_iata: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrival_airport_iata: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub departure_local: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arrival_local: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confirmation_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passenger_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub property_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkin_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checkout_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guest_name: Option<String>,
}

impl FactPayload {
    pub fn flight_field_paths() -> &'static [&'static str] {
        &[
            "payload.airlineName",
            "payload.airlineIata",
            "payload.flightNumber",
            "payload.departureAirportIata",
            "payload.arrivalAirportIata",
            "payload.departureLocal",
            "payload.arrivalLocal",
            "payload.confirmationCode",
            "payload.passengerName",
        ]
    }

    pub fn lodging_field_paths() -> &'static [&'static str] {
        &[
            "payload.propertyName",
            "payload.address",
            "payload.checkinDate",
            "payload.checkoutDate",
            "payload.confirmationCode",
            "payload.guestName",
        ]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExtractionMethod {
    Structured,
    Inferred,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CandidateStatus {
    Pending,
    Confirmed,
    Rejected,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WarningCode {
    MissingDates,
    MissingLocations,
    AmbiguousDateFormat,
    PastDate,
    OutsideTripWindow,
    UnrecognizedAirportCode,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSpan {
    pub field_path: String,
    pub start: usize,
    pub end: usize,
    pub excerpt: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateFact {
    pub id: String,
    pub trip_id: String,
    pub document_id: String,
    pub parser_run_id: String,
    pub fact_type: FactType,
    pub payload: FactPayload,
    pub method: ExtractionMethod,
    pub field_spans: Vec<FieldSpan>,
    pub warnings: Vec<WarningCode>,
    pub status: CandidateStatus,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmedFact {
    pub id: String,
    pub trip_id: String,
    pub fact_type: FactType,
    pub payload: FactPayload,
    pub method: ExtractionMethod,
    pub candidate_id: Option<String>,
    pub corrected_fields: Vec<String>,
    pub confirmed_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentKind {
    PastedText,
    Html,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDocument {
    pub id: String,
    pub trip_id: String,
    pub kind: DocumentKind,
    pub label: String,
    pub content_hash: String,
    pub char_count: u32,
    pub imported_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub document: SourceDocument,
    pub parser_run_id: String,
    pub candidates: Vec<CandidateFact>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthResponse {
    pub status: String,
    pub service: String,
    pub version: String,
    pub intelligence_mode: IntelligenceMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCode {
    #[serde(rename = "validation/invalid_input")]
    ValidationInvalidInput,
    #[serde(rename = "validation/invalid_date_range")]
    ValidationInvalidDateRange,
    #[serde(rename = "trip/not_found")]
    TripNotFound,
    #[serde(rename = "candidate/not_found")]
    CandidateNotFound,
    #[serde(rename = "candidate/already_resolved")]
    CandidateAlreadyResolved,
    #[serde(rename = "fact/not_found")]
    FactNotFound,
    #[serde(rename = "document/too_large")]
    DocumentTooLarge,
    #[serde(rename = "document/duplicate")]
    DocumentDuplicate,
    #[serde(rename = "document/empty")]
    DocumentEmpty,
    #[serde(rename = "storage/failure")]
    StorageFailure,
    #[serde(rename = "transport/failure")]
    TransportFailure,
    #[serde(rename = "internal/unexpected")]
    InternalUnexpected,
}

impl ErrorCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ValidationInvalidInput => "validation/invalid_input",
            Self::ValidationInvalidDateRange => "validation/invalid_date_range",
            Self::TripNotFound => "trip/not_found",
            Self::CandidateNotFound => "candidate/not_found",
            Self::CandidateAlreadyResolved => "candidate/already_resolved",
            Self::FactNotFound => "fact/not_found",
            Self::DocumentTooLarge => "document/too_large",
            Self::DocumentDuplicate => "document/duplicate",
            Self::DocumentEmpty => "document/empty",
            Self::StorageFailure => "storage/failure",
            Self::TransportFailure => "transport/failure",
            Self::InternalUnexpected => "internal/unexpected",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Error)]
#[serde(rename_all = "camelCase")]
#[error("{code:?}: {message}")]
pub struct AppError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<BTreeMap<String, String>>,
}

impl AppError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            details: None,
        }
    }

    pub fn with_detail(
        code: ErrorCode,
        message: impl Into<String>,
        key: impl Into<String>,
        value: impl Into<String>,
    ) -> Self {
        let mut details = BTreeMap::new();
        details.insert(key.into(), value.into());
        Self {
            code,
            message: message.into(),
            details: Some(details),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTripInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub origin: String,
    pub destination: String,
    pub start_date: String,
    pub end_date: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTripInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_date: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_date: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDocumentInput {
    pub trip_id: String,
    pub kind: DocumentKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmCandidateInput {
    pub candidate_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edited_payload: Option<FactPayload>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddManualFactInput {
    pub trip_id: String,
    pub fact_type: FactType,
    pub payload: FactPayload,
}

/// The minimum information required to start a trip Blueprint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripDraft {
    pub id: Uuid,
    pub origin: String,
    pub destination: String,
    pub start_date: String,
    pub end_date: String,
}

impl TripDraft {
    pub fn new(
        origin: impl Into<String>,
        destination: impl Into<String>,
        start_date: impl Into<String>,
        end_date: impl Into<String>,
    ) -> Result<Self, TripDraftError> {
        let origin = trim_required(origin, "origin").map_err(TripDraftError::Validation)?;
        let destination =
            trim_required(destination, "destination").map_err(TripDraftError::Validation)?;
        let start_date = start_date.into().trim().to_owned();
        let end_date = end_date.into().trim().to_owned();
        validate_date_range(&start_date, &end_date).map_err(TripDraftError::Validation)?;

        Ok(Self {
            id: Uuid::new_v4(),
            origin,
            destination,
            start_date,
            end_date,
        })
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TripDraftError {
    #[error("{0}")]
    Validation(AppError),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedTripInput {
    pub title: String,
    pub origin: String,
    pub destination: String,
    pub start_date: String,
    pub end_date: String,
}

pub fn validate_create_trip(input: CreateTripInput) -> Result<ValidatedTripInput, AppError> {
    let origin = trim_required(input.origin, "origin")?;
    let destination = trim_required(input.destination, "destination")?;
    validate_date_range(&input.start_date, &input.end_date)?;
    let title = input
        .title
        .map(|title| title.trim().to_owned())
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| format!("{origin} -> {destination}"));

    Ok(ValidatedTripInput {
        title,
        origin,
        destination,
        start_date: input.start_date.trim().to_owned(),
        end_date: input.end_date.trim().to_owned(),
    })
}

pub fn validate_update_trip(
    current: &Trip,
    input: UpdateTripInput,
) -> Result<ValidatedTripInput, AppError> {
    let origin = match input.origin {
        Some(origin) => trim_required(origin, "origin")?,
        None => current.origin.clone(),
    };
    let destination = match input.destination {
        Some(destination) => trim_required(destination, "destination")?,
        None => current.destination.clone(),
    };
    let start_date = input
        .start_date
        .unwrap_or_else(|| current.start_date.clone());
    let end_date = input.end_date.unwrap_or_else(|| current.end_date.clone());
    validate_date_range(&start_date, &end_date)?;
    let title = input
        .title
        .map(|title| title.trim().to_owned())
        .filter(|title| !title.is_empty())
        .unwrap_or_else(|| current.title.clone());

    Ok(ValidatedTripInput {
        title,
        origin,
        destination,
        start_date: start_date.trim().to_owned(),
        end_date: end_date.trim().to_owned(),
    })
}

pub fn validate_document_content(content: &str) -> Result<u32, AppError> {
    let char_count = content.chars().count();
    if char_count == 0 {
        return Err(AppError::new(ErrorCode::DocumentEmpty, "document is empty"));
    }
    if char_count > MAX_DOCUMENT_CHARS {
        return Err(AppError::new(
            ErrorCode::DocumentTooLarge,
            "document exceeds the 1,000,000 character limit",
        ));
    }
    Ok(char_count as u32)
}

pub fn validate_fact_payload(fact_type: FactType, payload: &FactPayload) -> Result<(), AppError> {
    match fact_type {
        FactType::FlightSegment => validate_flight_payload(payload),
        FactType::LodgingStay => validate_lodging_payload(payload),
    }
}

pub fn changed_payload_fields(original: &FactPayload, edited: &FactPayload) -> Vec<String> {
    let mut changed = Vec::new();
    for (path, left, right) in payload_field_values(original, edited) {
        if left != right {
            changed.push(path.to_owned());
        }
    }
    changed
}

pub fn now_rfc3339() -> String {
    jiff::Timestamp::now().to_string()
}

pub fn new_id(prefix: &str) -> String {
    format!("{prefix}_{}", Uuid::new_v4().simple())
}

fn trim_required(value: impl Into<String>, field: &str) -> Result<String, AppError> {
    let value = value.into().trim().to_owned();
    if value.is_empty() {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            format!("{field} is required"),
            "field",
            field,
        ));
    }
    if value.chars().count() > MAX_LOCATION_LEN {
        return Err(AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            format!("{field} must be 120 characters or fewer"),
            "field",
            field,
        ));
    }
    Ok(value)
}

fn validate_date_range(start_date: &str, end_date: &str) -> Result<(), AppError> {
    let start = parse_date(start_date, "startDate")?;
    let end = parse_date(end_date, "endDate")?;
    if start > end {
        return Err(AppError::new(
            ErrorCode::ValidationInvalidDateRange,
            "startDate must be on or before endDate",
        ));
    }
    Ok(())
}

fn parse_date(value: &str, field: &str) -> Result<Date, AppError> {
    value.trim().parse::<Date>().map_err(|_| {
        AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "invalid date",
            "field",
            field,
        )
    })
}

fn parse_local_datetime(value: &str, field: &str) -> Result<DateTime, AppError> {
    value.trim().parse::<DateTime>().map_err(|_| {
        AppError::with_detail(
            ErrorCode::ValidationInvalidInput,
            "invalid local date-time",
            "field",
            field,
        )
    })
}

fn validate_flight_payload(payload: &FactPayload) -> Result<(), AppError> {
    if payload.property_name.is_some()
        || payload.address.is_some()
        || payload.checkin_date.is_some()
        || payload.checkout_date.is_some()
        || payload.guest_name.is_some()
    {
        return Err(AppError::new(
            ErrorCode::ValidationInvalidInput,
            "flight_segment payload contains lodging fields",
        ));
    }
    if let Some(value) = &payload.departure_local {
        parse_local_datetime(value, "departureLocal")?;
    }
    if let Some(value) = &payload.arrival_local {
        parse_local_datetime(value, "arrivalLocal")?;
    }
    Ok(())
}

fn validate_lodging_payload(payload: &FactPayload) -> Result<(), AppError> {
    if payload.airline_name.is_some()
        || payload.airline_iata.is_some()
        || payload.flight_number.is_some()
        || payload.departure_airport_iata.is_some()
        || payload.arrival_airport_iata.is_some()
        || payload.departure_local.is_some()
        || payload.arrival_local.is_some()
        || payload.passenger_name.is_some()
    {
        return Err(AppError::new(
            ErrorCode::ValidationInvalidInput,
            "lodging_stay payload contains flight fields",
        ));
    }
    let checkin = match &payload.checkin_date {
        Some(value) => Some(parse_date(value, "checkinDate")?),
        None => None,
    };
    let checkout = match &payload.checkout_date {
        Some(value) => Some(parse_date(value, "checkoutDate")?),
        None => None,
    };
    if let (Some(checkin), Some(checkout)) = (checkin, checkout) {
        if checkin > checkout {
            return Err(AppError::new(
                ErrorCode::ValidationInvalidDateRange,
                "checkinDate must be on or before checkoutDate",
            ));
        }
    }
    Ok(())
}

fn payload_field_values<'a>(
    original: &'a FactPayload,
    edited: &'a FactPayload,
) -> Vec<(&'static str, &'a Option<String>, &'a Option<String>)> {
    vec![
        (
            "payload.airlineName",
            &original.airline_name,
            &edited.airline_name,
        ),
        (
            "payload.airlineIata",
            &original.airline_iata,
            &edited.airline_iata,
        ),
        (
            "payload.flightNumber",
            &original.flight_number,
            &edited.flight_number,
        ),
        (
            "payload.departureAirportIata",
            &original.departure_airport_iata,
            &edited.departure_airport_iata,
        ),
        (
            "payload.arrivalAirportIata",
            &original.arrival_airport_iata,
            &edited.arrival_airport_iata,
        ),
        (
            "payload.departureLocal",
            &original.departure_local,
            &edited.departure_local,
        ),
        (
            "payload.arrivalLocal",
            &original.arrival_local,
            &edited.arrival_local,
        ),
        (
            "payload.confirmationCode",
            &original.confirmation_code,
            &edited.confirmation_code,
        ),
        (
            "payload.passengerName",
            &original.passenger_name,
            &edited.passenger_name,
        ),
        (
            "payload.propertyName",
            &original.property_name,
            &edited.property_name,
        ),
        ("payload.address", &original.address, &edited.address),
        (
            "payload.checkinDate",
            &original.checkin_date,
            &edited.checkin_date,
        ),
        (
            "payload.checkoutDate",
            &original.checkout_date,
            &edited.checkout_date,
        ),
        (
            "payload.guestName",
            &original.guest_name,
            &edited.guest_name,
        ),
    ]
}
