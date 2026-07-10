//! Domain types and deterministic product rules for Voyalier.
//!
//! This crate deliberately has no dependency on the web or desktop shells.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

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

/// The minimum information required to start a trip Blueprint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
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
        let trip = Self {
            id: Uuid::new_v4(),
            origin: origin.into().trim().to_owned(),
            destination: destination.into().trim().to_owned(),
            start_date: start_date.into().trim().to_owned(),
            end_date: end_date.into().trim().to_owned(),
        };

        if trip.origin.is_empty() {
            return Err(TripDraftError::MissingOrigin);
        }
        if trip.destination.is_empty() {
            return Err(TripDraftError::MissingDestination);
        }
        if trip.start_date.is_empty() || trip.end_date.is_empty() {
            return Err(TripDraftError::MissingDates);
        }

        Ok(trip)
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TripDraftError {
    #[error("origin is required")]
    MissingOrigin,
    #[error("destination is required")]
    MissingDestination,
    #[error("start and end dates are required")]
    MissingDates,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_a_trimmed_trip_draft() {
        let trip =
            TripDraft::new(" Chicago ", " Kyoto ", "2027-04-01", "2027-04-10").expect("valid trip");

        assert_eq!(trip.origin, "Chicago");
        assert_eq!(trip.destination, "Kyoto");
    }

    #[test]
    fn rejects_a_missing_destination() {
        let error = TripDraft::new("Chicago", " ", "2027-04-01", "2027-04-10")
            .expect_err("destination must be required");

        assert_eq!(error, TripDraftError::MissingDestination);
    }
}
