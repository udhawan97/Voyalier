//! Active severe-weather alerts from the US National Weather Service.
//!
//! `api.weather.gov` is keyless and public domain. This module is IO-free.
//!
//! An alert is carried verbatim and linked to its own page — Voyalier never
//! summarizes one into a verdict. Two filters matter and both are correctness,
//! not hygiene: the feed really does publish `status: "Test"` broadcasts
//! alongside real ones (observed live, 1 of 426 nationwide), and a response
//! that is not the feed is an error rather than "no alerts". Rendering a test
//! tornado warning as real, or an outage as all-clear, are both false safety
//! claims.

use serde::{Deserialize, Serialize};

use crate::types::{AppError, ErrorCode};

/// The most alerts to carry for one destination, bounding a busy day.
const MAX_ALERTS: usize = 20;

/// One active NWS alert, in the source's own words.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherAlert {
    /// e.g. "Flood Warning". Verbatim.
    pub event: String,
    /// Source-native: Extreme | Severe | Moderate | Minor | Unknown.
    pub severity: String,
    pub headline: String,
    /// The source's own area wording, e.g. "Uvalde, TX".
    pub area: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub onset: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ends: Option<String>,
    pub sender: String,
    pub url: String,
}

fn unreadable_source() -> AppError {
    AppError::new(
        ErrorCode::WeatherFetchFailed,
        "the weather source returned something Voyalier could not read",
    )
}

/// Parse an `api.weather.gov/alerts/active` GeoJSON response.
///
/// An empty `features` array is a real answer: nothing is happening there.
/// Anything without a `features` array is not the feed we asked for.
pub fn parse_nws_alerts(json: &str) -> Result<Vec<WeatherAlert>, AppError> {
    let value: serde_json::Value = serde_json::from_str(json).map_err(|_| unreadable_source())?;
    let features = value
        .get("features")
        .and_then(|field| field.as_array())
        .ok_or_else(unreadable_source)?;

    let mut alerts = Vec::new();
    for feature in features {
        if alerts.len() >= MAX_ALERTS {
            break;
        }
        let Some(properties) = feature.get("properties") else {
            continue;
        };
        let text = |key: &str| {
            properties
                .get(key)
                .and_then(|field| field.as_str())
                .unwrap_or_default()
                .to_owned()
        };
        // Test, Exercise, Draft and System broadcasts are not real warnings.
        if text("status") != "Actual" {
            continue;
        }
        let id = text("id");
        alerts.push(WeatherAlert {
            event: text("event"),
            severity: {
                let severity = text("severity");
                if severity.is_empty() {
                    "Unknown".to_owned()
                } else {
                    severity
                }
            },
            headline: text("headline"),
            area: text("areaDesc"),
            onset: properties
                .get("onset")
                .and_then(|field| field.as_str())
                .map(str::to_owned),
            ends: properties
                .get("ends")
                .and_then(|field| field.as_str())
                .map(str::to_owned),
            sender: text("senderName"),
            url: format!("https://api.weather.gov/alerts/{id}"),
        });
    }
    Ok(alerts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_active_alerts_and_drops_test_broadcasts() {
        // Shaped like the real feed, which really does carry Test alerts.
        let json = r#"{"type": "FeatureCollection", "features": [
          {"properties": {"id": "urn:oid:1", "event": "Flood Warning", "severity": "Severe",
            "headline": "Flood Warning issued July 17 at 1:58AM CDT by NWS Austin/San Antonio TX",
            "areaDesc": "Uvalde, TX", "onset": "2026-07-17T01:58:00-05:00",
            "ends": "2026-07-18T03:12:00-05:00", "senderName": "NWS Austin/San Antonio TX",
            "status": "Actual", "messageType": "Update"}},
          {"properties": {"id": "urn:oid:2", "event": "Tornado Warning", "severity": "Extreme",
            "headline": "TEST tornado warning", "areaDesc": "Nowhere, TX",
            "senderName": "NWS Test", "status": "Test", "messageType": "Alert"}}
        ]}"#;
        let alerts = parse_nws_alerts(json).expect("parsed");
        // A test broadcast rendered as real is a false safety claim.
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].event, "Flood Warning");
        assert_eq!(alerts[0].severity, "Severe");
        assert_eq!(alerts[0].area, "Uvalde, TX");
        assert_eq!(alerts[0].sender, "NWS Austin/San Antonio TX");
        assert_eq!(
            alerts[0].onset.as_deref(),
            Some("2026-07-17T01:58:00-05:00")
        );
        assert_eq!(alerts[0].ends.as_deref(), Some("2026-07-18T03:12:00-05:00"));
        assert_eq!(alerts[0].url, "https://api.weather.gov/alerts/urn:oid:1");
    }

    #[test]
    fn no_alerts_is_a_valid_answer_but_a_non_feed_is_not() {
        let empty = parse_nws_alerts(r#"{"type": "FeatureCollection", "features": []}"#)
            .expect("an empty collection is a valid answer");
        assert!(empty.is_empty());
        // Reporting an outage as "no alerts" would turn it into an all-clear.
        assert!(parse_nws_alerts("<html>503</html>").is_err());
        assert!(parse_nws_alerts(r#"{"error": "nope"}"#).is_err());
    }

    #[test]
    fn a_missing_severity_is_unknown_rather_than_absent() {
        // The live feed's most common severity is literally "Unknown"; a blank
        // one must not read as calm.
        let json = r#"{"features": [{"properties": {"id": "urn:oid:3",
            "event": "Special Weather Statement", "areaDesc": "Travis, TX",
            "senderName": "NWS", "status": "Actual"}}]}"#;
        let alerts = parse_nws_alerts(json).expect("parsed");
        assert_eq!(alerts[0].severity, "Unknown");
        assert_eq!(alerts[0].onset, None);
    }
}
