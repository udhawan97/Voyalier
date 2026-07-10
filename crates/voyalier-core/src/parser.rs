use serde_json::Value;

use crate::{
    DocumentKind, ExtractionMethod, FactPayload, FactType, FieldSpan, WarningCode,
    validate_fact_payload,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedDocument {
    pub kind: DocumentKind,
    pub raw_content: String,
}

impl NormalizedDocument {
    pub fn new(kind: DocumentKind, raw_content: impl Into<String>) -> Self {
        Self {
            kind,
            raw_content: raw_content.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedCandidate {
    pub fact_type: FactType,
    pub payload: FactPayload,
    pub method: ExtractionMethod,
    pub field_spans: Vec<FieldSpan>,
    pub warnings: Vec<WarningCode>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParserDiagnostic {
    pub code: String,
    pub message: String,
}

impl ParserDiagnostic {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ParserOutcome {
    pub candidates: Vec<ParsedCandidate>,
    pub warnings: Vec<ParserDiagnostic>,
}

pub trait ConfirmationParser {
    fn id(&self) -> &'static str;
    fn version(&self) -> &'static str;
    fn parse(&self, document: &NormalizedDocument) -> ParserOutcome;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct JsonLdParser;

impl ConfirmationParser for JsonLdParser {
    fn id(&self) -> &'static str {
        "jsonld"
    }

    fn version(&self) -> &'static str {
        "v1"
    }

    fn parse(&self, document: &NormalizedDocument) -> ParserOutcome {
        let raw = document.raw_content.as_str();
        if raw.trim().is_empty() {
            return ParserOutcome {
                candidates: Vec::new(),
                warnings: vec![ParserDiagnostic::new(
                    "empty_document",
                    "document contained no parseable content",
                )],
            };
        }

        let scripts = find_jsonld_scripts(raw);
        let mut outcome = ParserOutcome::default();
        if scripts.is_empty() {
            outcome.warnings.push(ParserDiagnostic::new(
                "missing_jsonld",
                "no application/ld+json scripts were found",
            ));
            return outcome;
        }

        for script in scripts {
            if script.truncated {
                outcome.warnings.push(ParserDiagnostic::new(
                    "truncated_html",
                    "JSON-LD script tag was missing its closing tag",
                ));
                continue;
            }

            let parsed = match serde_json::from_str::<Value>(script.content) {
                Ok(value) => value,
                Err(_) => {
                    outcome.warnings.push(ParserDiagnostic::new(
                        "invalid_jsonld",
                        "JSON-LD script could not be parsed",
                    ));
                    continue;
                }
            };

            let mut reservations = Vec::new();
            collect_reservations(&parsed, &mut reservations);
            for reservation in reservations {
                if type_matches(reservation, "FlightReservation") {
                    if let Some(candidate) = flight_candidate(raw, reservation) {
                        outcome.candidates.push(candidate);
                    }
                } else if type_matches(reservation, "LodgingReservation") {
                    if let Some(candidate) = lodging_candidate(raw, reservation) {
                        outcome.candidates.push(candidate);
                    }
                }
            }
        }

        outcome
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct PlaintextParser;

impl ConfirmationParser for PlaintextParser {
    fn id(&self) -> &'static str {
        "plaintext"
    }

    fn version(&self) -> &'static str {
        "v1"
    }

    fn parse(&self, document: &NormalizedDocument) -> ParserOutcome {
        let raw = document.raw_content.as_str();
        if raw.trim().is_empty() {
            return ParserOutcome {
                candidates: Vec::new(),
                warnings: vec![ParserDiagnostic::new(
                    "empty_document",
                    "document contained no parseable content",
                )],
            };
        }

        let mut payload = FactPayload {
            confirmation_code: find_confirmation_code(raw),
            ..FactPayload::default()
        };
        let mut field_spans = Vec::new();

        if let Some((departure, arrival)) = find_iata_pair(raw) {
            payload.departure_airport_iata = Some(departure);
            payload.arrival_airport_iata = Some(arrival);
        }

        let local_datetimes = find_local_datetimes(raw);
        if let Some(first) = local_datetimes.first() {
            payload.departure_local = Some(first.clone());
        }
        if let Some(second) = local_datetimes.get(1) {
            payload.arrival_local = Some(second.clone());
        }

        add_payload_spans(raw, &payload, FactType::FlightSegment, &mut field_spans);

        if payload.confirmation_code.is_none()
            && payload.departure_airport_iata.is_none()
            && payload.arrival_airport_iata.is_none()
            && payload.departure_local.is_none()
            && payload.arrival_local.is_none()
        {
            return ParserOutcome::default();
        }

        let mut warnings = Vec::new();
        if payload.departure_airport_iata.is_none() || payload.arrival_airport_iata.is_none() {
            warnings.push(WarningCode::MissingLocations);
        }
        if payload.departure_local.is_none() {
            warnings.push(WarningCode::MissingDates);
        }
        if validate_fact_payload(FactType::FlightSegment, &payload).is_err() {
            warnings.push(WarningCode::AmbiguousDateFormat);
        }

        ParserOutcome {
            candidates: vec![ParsedCandidate {
                fact_type: FactType::FlightSegment,
                payload,
                method: ExtractionMethod::Inferred,
                field_spans,
                warnings,
            }],
            warnings: Vec::new(),
        }
    }
}

struct JsonLdScript<'a> {
    content: &'a str,
    truncated: bool,
}

fn find_jsonld_scripts(raw: &str) -> Vec<JsonLdScript<'_>> {
    let lower = raw.to_lowercase();
    let mut scripts = Vec::new();
    let mut cursor = 0;
    while let Some(relative_start) = lower[cursor..].find("<script") {
        let script_start = cursor + relative_start;
        let Some(relative_tag_end) = lower[script_start..].find('>') else {
            scripts.push(JsonLdScript {
                content: "",
                truncated: true,
            });
            break;
        };
        let tag_end = script_start + relative_tag_end;
        let header = &lower[script_start..=tag_end];
        let content_start = tag_end + 1;
        let Some(relative_close) = lower[content_start..].find("</script>") else {
            if header.contains("application/ld+json") {
                scripts.push(JsonLdScript {
                    content: &raw[content_start..],
                    truncated: true,
                });
            }
            break;
        };
        let close_start = content_start + relative_close;
        if header.contains("application/ld+json") {
            scripts.push(JsonLdScript {
                content: &raw[content_start..close_start],
                truncated: false,
            });
        }
        cursor = close_start + "</script>".len();
    }
    scripts
}

fn collect_reservations<'a>(value: &'a Value, reservations: &mut Vec<&'a Value>) {
    match value {
        Value::Array(items) => {
            for item in items {
                collect_reservations(item, reservations);
            }
        }
        Value::Object(object) => {
            if type_matches(value, "FlightReservation") || type_matches(value, "LodgingReservation")
            {
                reservations.push(value);
            }
            if let Some(graph) = object.get("@graph") {
                collect_reservations(graph, reservations);
            }
            for nested in object.values() {
                if nested.get("@type").is_some() || nested.get("@graph").is_some() {
                    collect_reservations(nested, reservations);
                }
            }
        }
        _ => {}
    }
}

fn type_matches(value: &Value, expected: &str) -> bool {
    let Some(kind) = value.get("@type") else {
        return false;
    };
    match kind {
        Value::String(kind) => kind == expected || kind.ends_with(&format!(":{expected}")),
        Value::Array(kinds) => kinds.iter().any(|kind| {
            kind.as_str()
                .map(|kind| kind == expected || kind.ends_with(&format!(":{expected}")))
                .unwrap_or(false)
        }),
        _ => false,
    }
}

fn flight_candidate(raw: &str, reservation: &Value) -> Option<ParsedCandidate> {
    let flight = reservation.get("reservationFor").unwrap_or(reservation);
    let airline = flight.get("airline").or_else(|| reservation.get("airline"));
    let mut payload = FactPayload {
        airline_name: airline.and_then(|value| string_at(value, "name")),
        airline_iata: airline
            .and_then(|value| string_at(value, "iataCode"))
            .or_else(|| airline.and_then(|value| string_at(value, "iata_code"))),
        flight_number: string_at(flight, "flightNumber"),
        departure_airport_iata: flight
            .get("departureAirport")
            .and_then(|value| string_at(value, "iataCode")),
        arrival_airport_iata: flight
            .get("arrivalAirport")
            .and_then(|value| string_at(value, "iataCode")),
        departure_local: string_at(flight, "departureTime").map(to_local_wall_clock),
        arrival_local: string_at(flight, "arrivalTime").map(to_local_wall_clock),
        confirmation_code: string_at(reservation, "reservationNumber")
            .or_else(|| string_at(reservation, "confirmationNumber")),
        passenger_name: reservation
            .get("underName")
            .and_then(|value| string_at(value, "name")),
        ..FactPayload::default()
    };

    trim_payload_strings(&mut payload);
    if validate_fact_payload(FactType::FlightSegment, &payload).is_err() {
        return None;
    }

    let mut field_spans = Vec::new();
    add_payload_spans(raw, &payload, FactType::FlightSegment, &mut field_spans);

    let mut warnings = Vec::new();
    if payload.departure_airport_iata.is_none() || payload.arrival_airport_iata.is_none() {
        warnings.push(WarningCode::MissingLocations);
    }
    if payload.departure_local.is_none() || payload.arrival_local.is_none() {
        warnings.push(WarningCode::MissingDates);
    }

    Some(ParsedCandidate {
        fact_type: FactType::FlightSegment,
        payload,
        method: ExtractionMethod::Structured,
        field_spans,
        warnings,
    })
}

fn lodging_candidate(raw: &str, reservation: &Value) -> Option<ParsedCandidate> {
    let lodging = reservation.get("reservationFor").unwrap_or(reservation);
    let mut payload = FactPayload {
        property_name: string_at(lodging, "name"),
        address: lodging.get("address").and_then(value_to_plain_string),
        checkin_date: string_at(reservation, "checkinDate")
            .or_else(|| string_at(reservation, "checkinTime"))
            .map(to_date_only),
        checkout_date: string_at(reservation, "checkoutDate")
            .or_else(|| string_at(reservation, "checkoutTime"))
            .map(to_date_only),
        confirmation_code: string_at(reservation, "reservationNumber")
            .or_else(|| string_at(reservation, "confirmationNumber")),
        guest_name: reservation
            .get("underName")
            .and_then(|value| string_at(value, "name")),
        ..FactPayload::default()
    };

    trim_payload_strings(&mut payload);
    if validate_fact_payload(FactType::LodgingStay, &payload).is_err() {
        return None;
    }

    let mut field_spans = Vec::new();
    add_payload_spans(raw, &payload, FactType::LodgingStay, &mut field_spans);

    let mut warnings = Vec::new();
    if payload.checkin_date.is_none() || payload.checkout_date.is_none() {
        warnings.push(WarningCode::MissingDates);
    }

    Some(ParsedCandidate {
        fact_type: FactType::LodgingStay,
        payload,
        method: ExtractionMethod::Structured,
        field_spans,
        warnings,
    })
}

fn string_at(value: &Value, key: &str) -> Option<String> {
    value.get(key)?.as_str().map(ToOwned::to_owned)
}

fn value_to_plain_string(value: &Value) -> Option<String> {
    match value {
        Value::String(value) => Some(value.clone()),
        Value::Object(object) => {
            if let Some(street) = object.get("streetAddress").and_then(Value::as_str) {
                return Some(street.to_owned());
            }
            let parts = [
                "streetAddress",
                "addressLocality",
                "addressRegion",
                "postalCode",
                "addressCountry",
            ]
            .iter()
            .filter_map(|key| object.get(*key).and_then(Value::as_str))
            .collect::<Vec<_>>();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join(", "))
            }
        }
        _ => None,
    }
}

fn to_local_wall_clock(value: String) -> String {
    if value.len() >= 16 {
        value[..16].to_owned()
    } else {
        value
    }
}

fn to_date_only(value: String) -> String {
    if value.len() >= 10 {
        value[..10].to_owned()
    } else {
        value
    }
}

fn trim_payload_strings(payload: &mut FactPayload) {
    for text in [
        &mut payload.airline_name,
        &mut payload.airline_iata,
        &mut payload.flight_number,
        &mut payload.departure_airport_iata,
        &mut payload.arrival_airport_iata,
        &mut payload.departure_local,
        &mut payload.arrival_local,
        &mut payload.confirmation_code,
        &mut payload.passenger_name,
        &mut payload.property_name,
        &mut payload.address,
        &mut payload.checkin_date,
        &mut payload.checkout_date,
        &mut payload.guest_name,
    ]
    .into_iter()
    .flatten()
    {
        *text = text.trim().to_owned();
    }
}

fn add_payload_spans(
    raw: &str,
    payload: &FactPayload,
    fact_type: FactType,
    field_spans: &mut Vec<FieldSpan>,
) {
    let values: Vec<(&str, Option<&str>)> = match fact_type {
        FactType::FlightSegment => vec![
            ("payload.airlineName", payload.airline_name.as_deref()),
            ("payload.airlineIata", payload.airline_iata.as_deref()),
            ("payload.flightNumber", payload.flight_number.as_deref()),
            (
                "payload.departureAirportIata",
                payload.departure_airport_iata.as_deref(),
            ),
            (
                "payload.arrivalAirportIata",
                payload.arrival_airport_iata.as_deref(),
            ),
            ("payload.departureLocal", payload.departure_local.as_deref()),
            ("payload.arrivalLocal", payload.arrival_local.as_deref()),
            (
                "payload.confirmationCode",
                payload.confirmation_code.as_deref(),
            ),
            ("payload.passengerName", payload.passenger_name.as_deref()),
        ],
        FactType::LodgingStay => vec![
            ("payload.propertyName", payload.property_name.as_deref()),
            ("payload.address", payload.address.as_deref()),
            ("payload.checkinDate", payload.checkin_date.as_deref()),
            ("payload.checkoutDate", payload.checkout_date.as_deref()),
            (
                "payload.confirmationCode",
                payload.confirmation_code.as_deref(),
            ),
            ("payload.guestName", payload.guest_name.as_deref()),
        ],
    };

    for (field_path, maybe_value) in values {
        if let Some(value) = maybe_value {
            if value.is_empty() {
                continue;
            }
            if let Some(span) = span_for_value(raw, field_path, value) {
                field_spans.push(span);
            }
        }
    }
}

fn span_for_value(raw: &str, field_path: &str, value: &str) -> Option<FieldSpan> {
    let byte_start = raw.find(value).or_else(|| {
        serde_json::to_string(value)
            .ok()
            .and_then(|quoted| raw.find(&quoted))
    })?;
    let char_start = raw[..byte_start].chars().count();
    let char_end = char_start + value.chars().count();
    Some(FieldSpan {
        field_path: field_path.to_owned(),
        start: char_start,
        end: char_end,
        excerpt: excerpt(raw, char_start, char_end),
    })
}

fn excerpt(raw: &str, start: usize, end: usize) -> String {
    let chars: Vec<char> = raw.chars().collect();
    let excerpt_start = start.saturating_sub(40);
    let excerpt_end = (end + 40).min(chars.len());
    let snippet = chars[excerpt_start..excerpt_end].iter().collect::<String>();
    strip_tags_and_collapse(&snippet)
}

fn strip_tags_and_collapse(value: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    let mut previous_space = false;
    for character in value.chars() {
        match character {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                if !previous_space {
                    output.push(' ');
                    previous_space = true;
                }
            }
            character if in_tag => {
                let _ = character;
            }
            character if character.is_whitespace() => {
                if !previous_space {
                    output.push(' ');
                    previous_space = true;
                }
            }
            character => {
                output.push(character);
                previous_space = false;
            }
        }
    }
    output.trim().to_owned()
}

fn find_confirmation_code(raw: &str) -> Option<String> {
    for line in raw.lines() {
        let lower = line.to_lowercase();
        if !lower.contains("confirmation") && !lower.contains("confirm code") {
            continue;
        }
        for token in line.split(|character: char| {
            character.is_whitespace() || matches!(character, ':' | '#' | '=' | '-')
        }) {
            let token = token.trim_matches(|character: char| !character.is_ascii_alphanumeric());
            let uppercase_count = token
                .chars()
                .filter(|character| character.is_ascii_uppercase() || character.is_ascii_digit())
                .count();
            if token.len() >= 5 && uppercase_count == token.len() {
                return Some(token.to_owned());
            }
        }
    }
    None
}

fn find_iata_pair(raw: &str) -> Option<(String, String)> {
    let chars: Vec<(usize, char)> = raw.char_indices().collect();
    let mut index = 0;
    while index + 6 < chars.len() {
        if !is_iata_at(&chars, index) {
            index += 1;
            continue;
        }
        let first = chars[index..index + 3]
            .iter()
            .map(|(_, character)| *character)
            .collect::<String>();
        let mut cursor = index + 3;
        while cursor < chars.len() && chars[cursor].1.is_whitespace() {
            cursor += 1;
        }
        if cursor >= chars.len() || (chars[cursor].1 != '-' && chars[cursor].1 != '→') {
            index += 1;
            continue;
        }
        cursor += 1;
        while cursor < chars.len() && chars[cursor].1.is_whitespace() {
            cursor += 1;
        }
        if is_iata_at(&chars, cursor) {
            let second = chars[cursor..cursor + 3]
                .iter()
                .map(|(_, character)| *character)
                .collect::<String>();
            return Some((first, second));
        }
        index += 1;
    }
    None
}

fn is_iata_at(chars: &[(usize, char)], index: usize) -> bool {
    if index + 3 > chars.len() {
        return false;
    }
    let before_ok = index == 0 || !chars[index - 1].1.is_ascii_alphabetic();
    let after_ok = index + 3 == chars.len() || !chars[index + 3].1.is_ascii_alphabetic();
    before_ok
        && after_ok
        && chars[index..index + 3]
            .iter()
            .all(|(_, character)| character.is_ascii_uppercase())
}

fn find_local_datetimes(raw: &str) -> Vec<String> {
    let chars: Vec<(usize, char)> = raw.char_indices().collect();
    let mut found = Vec::new();
    let mut index = 0;
    while index + 16 <= chars.len() {
        let candidate = chars[index..index + 16]
            .iter()
            .map(|(_, character)| *character)
            .collect::<String>();
        if is_local_datetime(&candidate) {
            found.push(candidate);
            index += 16;
        } else {
            index += 1;
        }
    }
    found
}

fn is_local_datetime(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 16
        && bytes[0..4].iter().all(u8::is_ascii_digit)
        && bytes[4] == b'-'
        && bytes[5..7].iter().all(u8::is_ascii_digit)
        && bytes[7] == b'-'
        && bytes[8..10].iter().all(u8::is_ascii_digit)
        && bytes[10] == b'T'
        && bytes[11..13].iter().all(u8::is_ascii_digit)
        && bytes[13] == b':'
        && bytes[14..16].iter().all(u8::is_ascii_digit)
}
