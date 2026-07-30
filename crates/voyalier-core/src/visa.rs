//! Curated visa **preparation** guidance: what an authority calls each step, what
//! that means in plain language, and the ways people commonly get it wrong.
//!
//! This module never decides whether a traveler needs a visa. Per ADR-0006 the
//! split is absolute: every factual claim about a requirement is a link, and
//! every sentence authored here is either a translation of the authority's own
//! term or a caution about an execution mistake. A curated string that asserts a
//! fee, a processing time, an eligibility outcome, or an amount of money is a
//! defect, not a feature.
//!
//! IO-free, and deliberately so — `canada.ca` returns HTTP 403 to automated
//! fetches and IRCC publishes no machine-readable feed, so the `AdviceFetcher`
//! seam does not apply. Curated content is compiled in and resolved fresh on
//! every read, following `tipping.rs`, so a corrected row never freezes into a
//! stored snapshot.

use serde::{Deserialize, Serialize};

use crate::types::{AppError, ErrorCode, SourceLink};

/// When Canada's curated tables were last read against IRCC by hand.
/// Shown to the traveler beside every quoted entry path.
const CURATED_AS_OF: &str = "2026-07-28";

/// When Japan's curated tables were last read against MOFA by hand.
///
/// Per destination rather than shared: a re-read of one authority says nothing
/// about the other, and one date covering both would age Japan's table every
/// time Canada's was checked.
const JP_CURATED_AS_OF: &str = "2026-07-30";

/// Content language of the curated prose, so the interface can mark it up rather
/// than let a non-English reader assume it was translated.
const LANGUAGE: &str = "en";

/// Which door a traveler goes through, as published by the destination.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EntryPath {
    /// The destination publishes this nationality as needing a visa.
    VisaRequired,
    /// An electronic authorization rather than a full visa.
    ElectronicAuthorization,
    /// Neither is published for this nationality.
    Exempt,
    /// Not curated, or the destination publishes conditions rather than an
    /// answer. A first-class result: the traveler gets official links and no
    /// journey, and nothing guesses on their behalf.
    Unknown,
}

/// An entry path together with where it was read from and when. Quoted, never
/// derived — the source is carried so a reader can check it rather than trust us.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryPathQuote {
    pub path: EntryPath,
    pub source_name: String,
    pub source_url: String,
    pub curated_as_of: String,
    pub language: String,
}

/// One document a step asks for, in the traveler's terms rather than the form's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisaDocument {
    /// Stable across curation edits — traveler progress is keyed on it.
    pub id: String,
    pub label: String,
    pub plain_explanation: String,
    /// The specific ways people get this document wrong.
    pub gotchas: Vec<String>,
    pub links: Vec<SourceLink>,
}

/// One step of an application.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisaStep {
    pub id: String,
    /// 1-based position. Contiguous within a journey.
    pub ordinal: u8,
    pub title: String,
    /// What the authority calls this, when its term differs from plain language.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authority_term: Option<String>,
    pub plain_explanation: String,
    pub documents: Vec<VisaDocument>,
    pub links: Vec<SourceLink>,
}

/// A curated route from one nationality to one destination.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisaJourney {
    pub destination_iso2: String,
    pub nationality_iso2: String,
    pub route_label: String,
    pub entry_path: EntryPathQuote,
    pub steps: Vec<VisaStep>,
    pub curated_as_of: String,
    pub language: String,
}

/// Traveler notes on one visa document. Unicode characters, not bytes.
pub const MAX_VISA_NOTE_CHARS: usize = 2_000;

/// One traveler-owned tick or note.
///
/// Following ADR-0005 a row exists only after an explicit action: the curated
/// checklist is computed output and never stores itself, exactly as a
/// `PackingSuggestion` never becomes a `PackingItem` on its own.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisaPrepItem {
    pub document_id: String,
    pub checked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    pub updated_at: String,
}

/// The traveler's own tally of visa preparation, for the readiness line.
///
/// Attributed to them in the copy that renders it, never to Voyalier: per
/// ADR-0006 the entry-requirements readiness item stays `NotChecked` forever and
/// stays out of the overall rollup. This exists so the item can report what the
/// traveler said without ever implying Voyalier agrees.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisaSelfReport {
    pub done: u32,
    pub total: u32,
}

/// The resolved journey and the traveler's progress, returned together so a
/// caller cannot pair a journey with another trip's checkboxes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VisaPrep {
    pub trip_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nationality_iso2: Option<String>,
    /// The passport this trip would prefill with, from the traveler's most
    /// recent choice on another trip. A suggestion for the picker only -- never
    /// applied on their behalf, because a trip may not be for them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggested_nationality_iso2: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entry_path: Option<EntryPathQuote>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub journey: Option<VisaJourney>,
    pub items: Vec<VisaPrepItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetVisaNationalityInput {
    pub trip_id: String,
    pub nationality_iso2: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetVisaItemProgressInput {
    pub trip_id: String,
    pub document_id: String,
    pub checked: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

/// Normalize and check a nationality code, so storage never holds a code the
/// resolver would then refuse to read.
pub fn validate_nationality(code: &str) -> Result<String, AppError> {
    let normalized = code.trim().to_ascii_uppercase();
    if is_iso2(&normalized) {
        Ok(normalized)
    } else {
        Err(AppError::new(
            ErrorCode::ValidationInvalidInput,
            "nationality must be an ISO-3166-1 alpha-2 code",
        ))
    }
}

/// Check a traveler's note against the shared limit, counting characters.
pub fn validate_visa_note(note: &str) -> Result<(), AppError> {
    if note.chars().count() > MAX_VISA_NOTE_CHARS {
        return Err(AppError::new(
            ErrorCode::ValidationInvalidInput,
            "note is too long",
        ));
    }
    Ok(())
}

// ---- Canada: sources ------------------------------------------------------

const IRCC: &str = "Immigration, Refugees and Citizenship Canada";
const CA_CHECK: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/check-visa-eta.html";
const CA_BY_COUNTRY: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/entry-requirements-country.html";
const CA_ETA_ELIGIBILITY: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/eligibility.html";
const CA_ETA_X: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/eligibility/eta-x.html";
const CA_ETA_APPLY: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/apply.html";
const CA_GUIDE_5256: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/guide-5256-applying-visitor-visa-temporary-resident-visa.html";
const CA_IMM_5257: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html";
const CA_IMM_5484: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5484.html";
const CA_IMM_5645: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5645.html";
const CA_PHOTO: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/temporary-resident-visa-application-photograph-specifications.html";
const CA_BIOMETRICS: &str =
    "https://www.canada.ca/en/immigration-refugees-citizenship/services/biometrics.html";
const CA_FIND_VAC: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/contact-ircc/offices/find-visa-application-centre.html";
const CA_PROCESSING: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-processing-times.html";
const CA_STATUS: &str = "https://www.canada.ca/en/immigration-refugees-citizenship/services/application/check-status.html";

/// Nationalities Canada publishes as visa-exempt, needing an electronic travel
/// authorization to fly rather than a visitor visa.
const CA_ETA_ELIGIBLE: &[&str] = &[
    "AD", "AE", "AT", "AU", "BB", "BE", "BG", "BN", "BS", "CH", "CL", "CY", "CZ", "DE", "DK", "EE",
    "ES", "FI", "FR", "GB", "GR", "HK", "HR", "HU", "IE", "IL", "IS", "IT", "JP", "KR", "LI", "LT",
    "LU", "LV", "MC", "MT", "NL", "NO", "NZ", "PG", "PL", "PT", "RO", "SB", "SE", "SG", "SI", "SK",
    "SM", "TW", "VA", "WS",
];

/// Nationalities Canada publishes as needing neither a visa nor an eTA.
const CA_EXEMPT: &[&str] = &["US"];

/// Nationalities where Canada publishes **conditions** rather than a single
/// answer. Resolving these to a path would be inventing one, so they resolve to
/// `Unknown` and the traveler is sent to the official check.
const CA_CONDITIONAL: &[&str] = &["MX"];

// ---- Japan: sources ------------------------------------------------------

const MOFA: &str = "Ministry of Foreign Affairs of Japan";
const JP_VISA_INDEX: &str = "https://www.mofa.go.jp/j_info/visit/visa/index.html";
const JP_NOVISA: &str = "https://www.mofa.go.jp/j_info/visit/visa/short/novisa.html";
const JP_SHORT_OTHER: &str = "https://www.mofa.go.jp/j_info/visit/visa/short/other_visa.html";
const JP_PROCEDURE_CHART: &str = "https://www.mofa.go.jp/j_info/visit/visa/process/short.html";
const JP_CRITERIA: &str = "https://www.mofa.go.jp/j_info/visit/visa/procedure/issuance.html";
const JP_EVISA: &str = "https://www.mofa.go.jp/j_info/visit/visa/visaonline.html";
const JP_FORM: &str = "https://www.mofa.go.jp/files/000124525.pdf";
const JP_ITINERARY: &str = "https://www.mofa.go.jp/files/000262548.pdf";
const JP_GUARANTEE: &str = "https://www.mofa.go.jp/files/000262545.pdf";
const JP_INVITATION: &str = "https://www.mofa.go.jp/files/000137089.pdf";
const JP_MISSIONS: &str = "https://www.mofa.go.jp/about/emb_cons/over/index.html";
const JP_FEES: &str = "https://www.mofa.go.jp/j_info/visit/visa/procedure/pagewe_000001_00391.html";
const JP_PROCESSING: &str = "https://www.mofa.go.jp/j_info/visit/visa/procedure/day.html";

/// Nationalities and regions Japan publishes as exempt from a short-stay visa
/// **without attaching a condition**.
///
/// Fifty-six of the seventy-four entries on MOFA's table. The stay length
/// differs across them — fifteen days, thirty, ninety — but that is a limit on
/// the stay rather than a condition on the exemption, so those entries belong
/// here. So do the entries carrying MOFA's note 8, which governs *extending* a
/// stay past ninety days and likewise does not condition the exemption itself.
const JP_EXEMPT: &[&str] = &[
    "AD", "AR", "AT", "AU", "BE", "BG", "BN", "BS", "CA", "CH", "CL", "CR", "CY", "CZ", "DE", "DK",
    "DO", "EE", "ES", "FI", "FR", "GB", "GR", "GT", "HN", "HR", "HU", "IE", "IL", "IS", "IT", "KR",
    "LI", "LT", "LU", "LV", "MC", "MK", "MT", "MU", "MX", "NL", "NO", "NZ", "PL", "PT", "RO", "SE",
    "SG", "SI", "SK", "SM", "SR", "SV", "TN", "US",
];

/// Nationalities and regions whose exemption Japan publishes **with a
/// condition** — a passport type, a prior registration, or a passport vintage.
///
/// The remaining eighteen entries on the table. Each resolves to
/// [`EntryPath::Unknown`]: Voyalier cannot see which passport a traveler holds,
/// and answering "exempt" for someone whose passport does not meet the
/// condition is the failure that would put them at a boarding gate without a
/// visa. They get MOFA's own page and no journey.
const JP_CONDITIONAL: &[&str] = &[
    "AE", "BB", "BR", "HK", "ID", "LS", "MO", "ME", "MY", "PA", "PE", "PY", "QA", "RS", "TH", "TR",
    "TW", "UY",
];

fn link(label: &str, url: &str) -> SourceLink {
    SourceLink {
        label: label.to_owned(),
        url: url.to_owned(),
    }
}

/// True for a syntactically valid ISO-3166-1 alpha-2 code.
fn is_iso2(code: &str) -> bool {
    code.len() == 2 && code.bytes().all(|byte| byte.is_ascii_uppercase())
}

/// The entry path a destination publishes for a nationality, or `None` when
/// nothing is curated for that destination.
///
/// Canada's own framing is an exception list: the eTA-eligible and exempt
/// nationalities are enumerated, and its guidance states that citizens of
/// countries not on those lists need a visitor visa. Defaulting a valid,
/// unlisted code to `VisaRequired` therefore quotes that structure rather than
/// inferring past it — and it is the safe direction, costing a traveler a check
/// rather than a denied boarding.
///
/// `None` and `Unknown` are different answers and the distinction is the whole
/// point of the return type. `Unknown` says a named authority governs this trip
/// and does not publish a single answer for this passport; `None` says Voyalier
/// has no authority to name at all. Collapsing the second into the first is what
/// let Canada's authority stand in for every other destination on earth — see
/// the 2026-07-29 amendment to ADR-0006.
pub fn entry_path(destination_iso2: &str, nationality_iso2: &str) -> Option<EntryPathQuote> {
    match destination_iso2 {
        "CA" => canada_entry_path(nationality_iso2),
        "JP" => japan_entry_path(nationality_iso2),
        // Anywhere else is uncurated. Quoting one of these authorities for a
        // destination it does not govern would put a government with no
        // connection to the trip in front of the traveler, under the words "the
        // official source".
        _ => None,
    }
}

fn canada_entry_path(nationality_iso2: &str) -> Option<EntryPathQuote> {
    let unknown = |url: &str| EntryPathQuote {
        path: EntryPath::Unknown,
        source_name: IRCC.to_owned(),
        source_url: url.to_owned(),
        curated_as_of: CURATED_AS_OF.to_owned(),
        language: LANGUAGE.to_owned(),
    };

    // Both of these are still Canada's trip to answer for, so IRCC is still the
    // authority to name: a code we cannot read, and one whose conditions IRCC
    // publishes rather than resolves, both land on its own eligibility checker.
    if !is_iso2(nationality_iso2) || CA_CONDITIONAL.contains(&nationality_iso2) {
        return Some(unknown(CA_CHECK));
    }

    let path = if CA_EXEMPT.contains(&nationality_iso2) {
        EntryPath::Exempt
    } else if CA_ETA_ELIGIBLE.contains(&nationality_iso2) {
        EntryPath::ElectronicAuthorization
    } else {
        EntryPath::VisaRequired
    };

    Some(EntryPathQuote {
        path,
        source_name: IRCC.to_owned(),
        source_url: CA_BY_COUNTRY.to_owned(),
        curated_as_of: CURATED_AS_OF.to_owned(),
        language: LANGUAGE.to_owned(),
    })
}

/// Japan's published door for a nationality.
///
/// MOFA's structure is the same shape as Canada's — an enumerated exemption
/// table, with its visa pages stating that everyone else needs one — so an
/// unlisted code resolves to `VisaRequired`, which quotes that structure rather
/// than inferring past it, and errs toward a traveler making one extra check
/// rather than toward a denied boarding.
///
/// Japan publishes **no electronic authorization**. JAPAN eVISA is an online
/// channel for the same short-stay visa and is keyed on the applicant's country
/// of *residence*, not their nationality, so it is a link inside the
/// visa-required journey and never an [`EntryPath::ElectronicAuthorization`].
fn japan_entry_path(nationality_iso2: &str) -> Option<EntryPathQuote> {
    let quote = |path: EntryPath, url: &str| EntryPathQuote {
        path,
        source_name: MOFA.to_owned(),
        source_url: url.to_owned(),
        curated_as_of: JP_CURATED_AS_OF.to_owned(),
        language: LANGUAGE.to_owned(),
    };

    // A code we cannot read, and one whose exemption MOFA conditions on a
    // passport type or a prior registration, are both still Japan's trip to
    // answer for — so MOFA stays the named authority and its own table is where
    // the traveler is sent.
    if !is_iso2(nationality_iso2) || JP_CONDITIONAL.contains(&nationality_iso2) {
        return Some(quote(EntryPath::Unknown, JP_NOVISA));
    }

    if JP_EXEMPT.contains(&nationality_iso2) {
        Some(quote(EntryPath::Exempt, JP_NOVISA))
    } else {
        Some(quote(EntryPath::VisaRequired, JP_VISA_INDEX))
    }
}

/// What biometrics are, and where to give them.
///
/// The design called for per-nationality application-centre pointers, but IRCC
/// publishes one centre finder covering every country rather than per-country
/// pages. Branching on nationality here would have produced fifteen rows that
/// all resolved to the same URL — a distinction the source does not make, and
/// one the traveler would have had to discover was empty.
fn biometrics_links() -> Vec<SourceLink> {
    vec![
        link("IRCC — Biometrics: who needs to give them", CA_BIOMETRICS),
        link("IRCC — Find a visa application centre", CA_FIND_VAC),
    ]
}

/// The curated route for a nationality into a destination, or `None` when the
/// pair is not curated or the destination publishes conditions rather than an
/// answer.
pub fn visa_journey(destination_iso2: &str, nationality_iso2: &str) -> Option<VisaJourney> {
    let quote = entry_path(destination_iso2, nationality_iso2)?;
    match (destination_iso2, quote.path) {
        ("CA", EntryPath::VisaRequired) => Some(canada_visitor_visa(nationality_iso2, quote)),
        ("CA", EntryPath::ElectronicAuthorization) => Some(canada_eta(nationality_iso2, quote)),
        ("JP", EntryPath::VisaRequired) => Some(japan_short_term_stay(nationality_iso2, quote)),
        _ => None,
    }
}

/// Japan's six-step short-term-stay visa route, applied for from abroad.
///
/// Step 5 carries the two mistakes that cost the most: applying to the wrong
/// mission, and expecting to sort it out on arrival. Neither is a requirement
/// Voyalier is asserting — both are MOFA's own published procedure, restated
/// plainly, with the page beside them.
fn japan_short_term_stay(nationality_iso2: &str, quote: EntryPathQuote) -> VisaJourney {
    let steps = vec![
        step(
            "jp.sts.01-door",
            1,
            "Check which door is yours",
            Some("short-term stay"),
            "Short-term stay covers tourism, business, and visiting friends or relatives, with no \
             paid work. Japan publishes a table of the countries and regions it exempts from a \
             visa for this; for several of them the exemption depends on the kind of passport you \
             hold, or on registering it with a Japanese mission first. Read your own row before \
             you assume either way.",
            Vec::new(),
            vec![
                link("MOFA — Exemption of visa (short-term stay)", JP_NOVISA),
                link("MOFA — Visa", JP_VISA_INDEX),
                link(
                    "MOFA — Procedure chart for short-term stay",
                    JP_PROCEDURE_CHART,
                ),
            ],
        ),
        step(
            "jp.sts.02-passport",
            2,
            "Your passport",
            None,
            "Japan's published criteria start here: a valid passport, and the right to return to \
             the country you are a national or a resident of. Settle this before the rest, because \
             the form is filled in from it.",
            vec![document(
                "jp.sts.passport.current",
                "A valid passport",
                "The biographic page is what the application is built from.",
                &[
                    "Renewing mid-application means redoing parts of it. If your passport is near \
                     expiry, renew before you apply rather than after.",
                ],
                vec![link("MOFA — Criteria of visa issuance", JP_CRITERIA)],
            )],
            vec![link("MOFA — Criteria of visa issuance", JP_CRITERIA)],
        ),
        step(
            "jp.sts.03-form",
            3,
            "The form and the photograph",
            Some("visa application form"),
            "MOFA publishes the form itself, in several languages. Fill it in and print it rather \
             than writing over a scan, and take the photograph specification your mission \
             publishes to the photographer rather than asking for a passport photo.",
            vec![document(
                "jp.sts.form.application",
                "Visa application form",
                "MOFA's own form, with your photograph attached to it.",
                &[
                    "Requirements are set by the mission that will receive your application, so \
                     check its page as well as this one — they do differ.",
                ],
                vec![link("MOFA — Visa application form (PDF)", JP_FORM)],
            )],
            vec![link("MOFA — Visa application documents", JP_SHORT_OTHER)],
        ),
        step(
            "jp.sts.04-purpose",
            4,
            "What the trip actually is",
            None,
            "This is where you show the trip is what you say it is. MOFA publishes a form for the \
             itinerary; where someone in Japan is receiving you, it publishes forms for them too. \
             Which of these you need depends on why you are going, and the mission's page is what \
             says which.",
            vec![
                document(
                    "jp.sts.purpose.itinerary",
                    "Travel itinerary",
                    "Day by day: where you will be, and what you are there for.",
                    &[
                        "An itinerary that does not line up with your bookings or your dates is \
                         worse than a sparse one.",
                    ],
                    vec![link("MOFA — Travel itinerary (PDF)", JP_ITINERARY)],
                ),
                document(
                    "jp.sts.purpose.invitation",
                    "Letter of invitation, if someone in Japan is receiving you",
                    "Written by the person or organisation inviting you, on MOFA's form.",
                    &[
                        "The inviting party sends these to you, not to the ministry or the \
                         mission — keep a copy of everything they send.",
                    ],
                    vec![link("MOFA — Letter of invitation (PDF)", JP_INVITATION)],
                ),
                document(
                    "jp.sts.purpose.guarantee",
                    "Letter of guarantee, where one is asked for",
                    "A named guarantor in Japan, on MOFA's form.",
                    &[
                        "Being invited and being guaranteed are different roles, and a trip may \
                         need both or neither.",
                    ],
                    vec![link("MOFA — Letter of guarantee (PDF)", JP_GUARANTEE)],
                ),
            ],
            vec![link("MOFA — Visa application documents", JP_SHORT_OTHER)],
        ),
        step(
            "jp.sts.05-where",
            5,
            "Where you apply",
            Some("the Diplomatic Mission with jurisdiction over your place of residence"),
            "Not the nearest Japanese mission — the one whose jurisdiction covers where you live. \
             Applications go to it, to an accredited agency or visa application centre it names, \
             or online where that is offered. Two things worth knowing before you plan around it: \
             a Japanese visa cannot be obtained on arrival, and it cannot be applied for from \
             inside Japan. Online application is offered to people *resident* in a specific list \
             of countries, which is not the same as being a national of one, so check the list \
             against where you live.",
            vec![document(
                "jp.sts.where.mission",
                "Your mission's own document list",
                "The embassy, consulate-general, or consular office with jurisdiction over your \
                 residence publishes what it wants and how it wants it delivered.",
                &[
                    "Its list overrides the general one. Where the two differ, the mission's is \
                     the one being applied to your file.",
                ],
                vec![
                    link("MOFA — Embassies and consulates", JP_MISSIONS),
                    link("MOFA — JAPAN eVISA", JP_EVISA),
                ],
            )],
            vec![
                link("MOFA — Embassies and consulates", JP_MISSIONS),
                link("MOFA — JAPAN eVISA", JP_EVISA),
                link("MOFA — Visa fees", JP_FEES),
                link("MOFA — Visa processing time", JP_PROCESSING),
            ],
        ),
        step(
            "jp.sts.06-after",
            6,
            "After it is issued",
            Some("landing permission"),
            "A visa is one of the requirements for entering Japan, and it is not by itself \
             permission to enter. Landing permission is granted at the port of entry by an \
             immigration officer, and what it lets you do while you are there is the status of \
             residence written on it. This matters for a second reason: people often say \"visa\" \
             when they mean status of residence, and those are handled by different bodies, so \
             the answer you find depends on which one you are actually asking about.",
            Vec::new(),
            vec![
                link("MOFA — Visa", JP_VISA_INDEX),
                link("MOFA — Criteria of visa issuance", JP_CRITERIA),
            ],
        ),
    ];

    VisaJourney {
        destination_iso2: "JP".to_owned(),
        nationality_iso2: nationality_iso2.to_owned(),
        route_label: "Short-term stay visa (Japan)".to_owned(),
        entry_path: quote,
        steps,
        curated_as_of: JP_CURATED_AS_OF.to_owned(),
        language: LANGUAGE.to_owned(),
    }
}

fn step(
    id: &str,
    ordinal: u8,
    title: &str,
    authority_term: Option<&str>,
    plain: &str,
    documents: Vec<VisaDocument>,
    links: Vec<SourceLink>,
) -> VisaStep {
    VisaStep {
        id: id.to_owned(),
        ordinal,
        title: title.to_owned(),
        authority_term: authority_term.map(str::to_owned),
        plain_explanation: plain.to_owned(),
        documents,
        links,
    }
}

fn document(
    id: &str,
    label: &str,
    plain: &str,
    gotchas: &[&str],
    links: Vec<SourceLink>,
) -> VisaDocument {
    VisaDocument {
        id: id.to_owned(),
        label: label.to_owned(),
        plain_explanation: plain.to_owned(),
        gotchas: gotchas.iter().map(|text| (*text).to_owned()).collect(),
        links,
    }
}

/// The eight-step visitor visa (temporary resident visa) route from outside
/// Canada. Step 1 is deliberately a question: Canada publishes a far cheaper
/// alternative for citizens of *some* visa-required countries, the eligible list
/// is short and it moves, and a traveler who qualifies but never checks pays for
/// a full visa they did not need. Voyalier raises it and links the list. It does
/// not answer it.
fn canada_visitor_visa(nationality_iso2: &str, quote: EntryPathQuote) -> VisaJourney {
    let steps = vec![
        step(
            "ca.trv.01-need",
            1,
            "Do you even need one?",
            None,
            "Before anything else: Canada lets citizens of some visa-required countries apply for \
             an electronic travel authorization instead of a visitor visa, if they have held a \
             Canadian visa in the past ten years or hold a valid United States non-immigrant visa. \
             The list of eligible countries is short and it changes. Check whether your passport is \
             on it before you start — the two routes cost and take very different amounts.",
            Vec::new(),
            vec![
                link("IRCC — Check if you need a visa or an eTA", CA_CHECK),
                link(
                    "IRCC — eTA for citizens of some visa-required countries",
                    CA_ETA_X,
                ),
                link("IRCC — Entry requirements by country", CA_BY_COUNTRY),
            ],
        ),
        step(
            "ca.trv.02-passport",
            2,
            "Your passport",
            None,
            "Everything else is built on this, so settle it first. Check how much validity you have \
             left and how many blank pages, and dig out your old passports — the application asks \
             about travel you may only be able to evidence from them.",
            vec![
                document(
                    "ca.trv.passport.current",
                    "Your current passport",
                    "The biographic page is what gets copied into the application.",
                    &[
                        "Renewing mid-application means redoing parts of it. If your passport is \
                       close to expiry, renew before you apply, not after.",
                    ],
                    vec![link("IRCC — Guide 5256", CA_GUIDE_5256)],
                ),
                document(
                    "ca.trv.passport.old",
                    "Old passports, if you have them",
                    "Your travel history lives in the stamps.",
                    &["Travel you cannot evidence is still travel you must declare."],
                    Vec::new(),
                ),
            ],
            vec![link("IRCC — Guide 5256", CA_GUIDE_5256)],
        ),
        step(
            "ca.trv.03-photo",
            3,
            "Photo",
            Some("photograph specifications"),
            "Canada publishes its own photo specification, and it is not the same as your national \
             passport photo specification. Take the specification to the photographer rather than \
             asking for a passport photo.",
            vec![document(
                "ca.trv.photo.digital",
                "A photo meeting Canada's specification",
                "Full front view of the head, face centred, top of the shoulders included, plain \
                 light background, taken in the last six months.",
                &[
                    "Dimensions and head height differ from most national passport photo rules. A \
                     reused passport photo is one of the most common reasons an application comes \
                     back.",
                    "Both copies must be identical, and taken at the same sitting.",
                ],
                vec![link(
                    "IRCC — Temporary resident visa photograph specifications",
                    CA_PHOTO,
                )],
            )],
            vec![link("IRCC — Photograph specifications", CA_PHOTO)],
        ),
        step(
            "ca.trv.04-funds",
            4,
            "Prove you can pay for the trip",
            Some("proof of means of financial support"),
            "The point is not that the money is there today — it is that it has been there. A \
             balance that appeared shortly before you applied reads as borrowed for the \
             application, and that is one of the most common reasons a visitor application is \
             refused. Canada publishes no fixed amount for visitors; it has to be enough for your \
             stay and credibly yours.",
            vec![
                document(
                    "ca.trv.funds.statements",
                    "Bank statements covering several months",
                    "Continuous statements, stamped or signed by the bank, every page rather than \
                     a summary screenshot.",
                    &[
                        "A large deposit shortly before you apply needs a letter explaining where it \
                       came from, or it works against you rather than for you.",
                    ],
                    vec![link("IRCC — Document checklist IMM 5484", CA_IMM_5484)],
                ),
                document(
                    "ca.trv.funds.sponsor",
                    "If someone else is paying",
                    "Their bank statements, their identification, and a letter saying exactly what \
                     they are covering.",
                    &[
                        "An invitation letter is not a legal sponsorship and does not replace your \
                       own evidence. Send both.",
                    ],
                    vec![link("IRCC — Guide 5256", CA_GUIDE_5256)],
                ),
                document(
                    "ca.trv.funds.income",
                    "Proof of income",
                    "Tax returns, salary slips, or business records — they tie the balance to \
                     something that recurs.",
                    &[],
                    Vec::new(),
                ),
            ],
            vec![
                link("IRCC — Guide 5256", CA_GUIDE_5256),
                link("IRCC — Document checklist IMM 5484", CA_IMM_5484),
            ],
        ),
        step(
            "ca.trv.05-ties",
            5,
            "Prove you'll come back",
            Some("ties to your home country"),
            "An officer is asking one question here: what pulls you home? Answer it with documents \
             rather than assertions. What counts varies with your life — a job, studies, \
             dependents, property, a business.",
            vec![
                document(
                    "ca.trv.ties.employment",
                    "Employment or study evidence",
                    "A letter confirming your position and that your leave is approved, or proof \
                     of enrolment.",
                    &[
                        "A leave approval that ends before your return date undercuts the point it \
                       is making.",
                    ],
                    Vec::new(),
                ),
                document(
                    "ca.trv.ties.other",
                    "Anything else that anchors you",
                    "Property papers, business registration, dependents' documents.",
                    &[],
                    Vec::new(),
                ),
                document(
                    "ca.trv.ties.purpose",
                    "Why you are going, and your plan",
                    "An itinerary, and an invitation letter if you are visiting someone.",
                    &[],
                    vec![link("IRCC — Guide 5256", CA_GUIDE_5256)],
                ),
            ],
            vec![link("IRCC — Guide 5256", CA_GUIDE_5256)],
        ),
        step(
            "ca.trv.06-forms",
            6,
            "Fill the forms",
            Some("IMM 5257 and IMM 5645"),
            "This step has a trap that costs more applications than any rule does. IMM 5257 is a \
             PDF that has to be opened in Adobe Reader and validated — pressing Validate generates \
             a barcode page. Filled in a browser's built-in PDF viewer it looks complete, produces \
             no barcode, and is rejected.",
            vec![
                document(
                    "ca.trv.forms.imm5257",
                    "IMM 5257 — application for a visitor visa",
                    "The main form.",
                    &[
                        "Open it in Adobe Reader, not in your browser. Press Validate when you \
                         finish, and confirm a barcode page appears.",
                        "Answer every question. Blank fields are treated as incomplete rather than \
                         as not applicable.",
                    ],
                    vec![link("IRCC — IMM 5257", CA_IMM_5257)],
                ),
                document(
                    "ca.trv.forms.imm5645",
                    "IMM 5645 — family information",
                    "Details of your immediate family, whether or not they are travelling.",
                    &[
                        "It asks about family who are not coming with you too. Leaving them out is a \
                       discrepancy.",
                    ],
                    vec![link("IRCC — IMM 5645", CA_IMM_5645)],
                ),
                document(
                    "ca.trv.forms.checklist",
                    "IMM 5484 — document checklist",
                    "Canada's own checklist. Assemble in the order it gives.",
                    &[],
                    vec![link("IRCC — IMM 5484", CA_IMM_5484)],
                ),
            ],
            vec![
                link("IRCC — IMM 5257", CA_IMM_5257),
                link("IRCC — Guide 5256", CA_GUIDE_5256),
            ],
        ),
        step(
            "ca.trv.07-submit",
            7,
            "Submit, pay, and give biometrics",
            Some("biometrics"),
            "Submit through an IRCC account and pay the fees. Most applicants between 14 and 79 \
             then give fingerprints and a photo at a visa application centre. Biometrics last ten \
             years — if you gave them for an earlier Canadian application you may not need to \
             repeat them, so check before booking an appointment.",
            {
                let mut documents = vec![document(
                    "ca.trv.submit.account",
                    "An IRCC account, and the fees paid",
                    "Fees are paid as part of submitting.",
                    &[
                        "Check current fees on IRCC's own page rather than from any third-hand \
                       figure — Voyalier does not quote them.",
                    ],
                    vec![link("IRCC — Guide 5256", CA_GUIDE_5256)],
                )];
                documents.push(document(
                    "ca.trv.submit.biometrics",
                    "Biometrics appointment",
                    "You get a letter telling you to give biometrics, and a limited window to do \
                     it in.",
                    &[
                        "The window is thirty days from the date on the letter.",
                        "Check whether your existing biometrics are still valid before you book.",
                    ],
                    biometrics_links(),
                ));
                documents
            },
            biometrics_links(),
        ),
        step(
            "ca.trv.08-decision",
            8,
            "Wait, then send your passport",
            Some("passport request"),
            "Track the application and watch for requests. If it is approved you are asked to send \
             your passport in so the visa can be placed in it — that request is what people call a \
             PPR. Do not make unchangeable travel arrangements before you have the passport back.",
            vec![
                document(
                    "ca.trv.decision.requests",
                    "Answer any request for more documents",
                    "Requests come with their own deadline, which is usually short.",
                    &["A missed deadline is treated as a refusal to provide, not as a delay."],
                    vec![link("IRCC — Check your application status", CA_STATUS)],
                ),
                document(
                    "ca.trv.decision.passport",
                    "Send your passport when asked",
                    "The visa is physically placed in the passport.",
                    &[],
                    vec![link("IRCC — Find a visa application centre", CA_FIND_VAC)],
                ),
            ],
            vec![
                link("IRCC — Check processing times", CA_PROCESSING),
                link("IRCC — Check your application status", CA_STATUS),
            ],
        ),
    ];

    VisaJourney {
        destination_iso2: "CA".to_owned(),
        nationality_iso2: nationality_iso2.to_owned(),
        route_label: "Visitor visa (temporary resident visa)".to_owned(),
        entry_path: quote,
        steps,
        curated_as_of: CURATED_AS_OF.to_owned(),
        language: LANGUAGE.to_owned(),
    }
}

/// The short route for visa-exempt nationalities flying to Canada.
fn canada_eta(nationality_iso2: &str, quote: EntryPathQuote) -> VisaJourney {
    let steps = vec![
        step(
            "ca.eta.01-need",
            1,
            "Check the eTA actually covers your trip",
            None,
            "An electronic travel authorization is for flying to Canada. Arriving by land or sea is \
             a different case, and so is transiting. Confirm which applies to you before you pay \
             for anything.",
            Vec::new(),
            vec![
                link("IRCC — Check if you need a visa or an eTA", CA_CHECK),
                link("IRCC — eTA eligibility", CA_ETA_ELIGIBILITY),
            ],
        ),
        step(
            "ca.eta.02-passport",
            2,
            "Your passport",
            None,
            "The authorization is linked electronically to one passport. Renewing it after you \
             apply means applying again.",
            vec![document(
                "ca.eta.passport.current",
                "The passport you will actually travel on",
                "Apply with the passport you will carry, not one you are about to replace.",
                &["The link is to the passport number. A new passport needs a new eTA."],
                vec![link("IRCC — How to apply for an eTA", CA_ETA_APPLY)],
            )],
            vec![link("IRCC — How to apply for an eTA", CA_ETA_APPLY)],
        ),
        step(
            "ca.eta.03-apply",
            3,
            "Apply and pay",
            None,
            "The application is short and online. Use Canada's own site — paid intermediary sites \
             rank well in search results and charge substantially more for the same thing.",
            vec![document(
                "ca.eta.apply.form",
                "The online application",
                "Completed on IRCC's own site.",
                &[
                    "Apply only through the official Government of Canada page. Look-alike sites \
                     charge a markup for forwarding the same application.",
                    "Most approvals arrive quickly, but not all. Do not leave it to the airport.",
                ],
                vec![link("IRCC — How to apply for an eTA", CA_ETA_APPLY)],
            )],
            vec![link("IRCC — How to apply for an eTA", CA_ETA_APPLY)],
        ),
    ];

    VisaJourney {
        destination_iso2: "CA".to_owned(),
        nationality_iso2: nationality_iso2.to_owned(),
        route_label: "Electronic travel authorization (eTA)".to_owned(),
        entry_path: quote,
        steps,
        curated_as_of: CURATED_AS_OF.to_owned(),
        language: LANGUAGE.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every curated journey, for rules that must hold across all of them.
    /// Every curated journey, so the guard tests below cover each destination
    /// rather than only the first one that was written.
    fn journeys() -> Vec<VisaJourney> {
        [("CA", "IN"), ("CA", "GB"), ("CA", "NG"), ("CA", "JP")]
            .iter()
            .chain([("JP", "CN"), ("JP", "IN"), ("JP", "NG")].iter())
            .filter_map(|(destination, nationality)| visa_journey(destination, nationality))
            .collect()
    }

    fn all_links(journey: &VisaJourney) -> Vec<&SourceLink> {
        journey
            .steps
            .iter()
            .flat_map(|step| {
                step.links
                    .iter()
                    .chain(step.documents.iter().flat_map(|document| &document.links))
            })
            .collect()
    }

    /// The one domain and the one id prefix a destination's curation may use.
    ///
    /// Keyed per destination rather than shared, so a Japanese step that links
    /// canada.ca — or a Canadian document id on a Japanese step — fails here.
    /// That cross-contamination is the exact thing ADR-0006 exists to stop, and
    /// it is the mistake a second destination makes possible for the first time.
    fn official_domain_and_prefix(destination_iso2: &str) -> (&'static str, &'static str) {
        match destination_iso2 {
            "CA" => ("https://www.canada.ca/", "ca."),
            "JP" => ("https://www.mofa.go.jp/", "jp."),
            other => panic!("no official domain recorded for {other}"),
        }
    }

    #[test]
    fn every_curated_link_is_a_well_formed_official_url() {
        for journey in journeys() {
            let (domain, _) = official_domain_and_prefix(&journey.destination_iso2);
            assert!(journey.entry_path.source_url.starts_with(domain));
            for link in all_links(&journey) {
                assert!(
                    link.url.starts_with(domain),
                    "off-domain or insecure curated link in {}: {}",
                    journey.route_label,
                    link.url
                );
                assert!(!link.label.is_empty(), "unlabelled link: {}", link.url);
            }
        }
    }

    #[test]
    fn steps_are_contiguously_ordered_from_one() {
        for journey in journeys() {
            for (index, step) in journey.steps.iter().enumerate() {
                assert_eq!(
                    step.ordinal,
                    u8::try_from(index + 1).expect("journeys are short"),
                    "ordinals must be contiguous from 1 in {}",
                    journey.route_label
                );
                assert!(!step.title.is_empty());
                assert!(!step.plain_explanation.is_empty());
            }
        }
    }

    #[test]
    fn document_ids_are_unique_and_destination_prefixed() {
        for journey in journeys() {
            let (_, prefix) = official_domain_and_prefix(&journey.destination_iso2);
            let mut seen = Vec::new();
            for document in journey.steps.iter().flat_map(|step| &step.documents) {
                assert!(
                    document.id.starts_with(prefix),
                    "document id must be destination-prefixed: {}",
                    document.id
                );
                assert!(
                    !seen.contains(&document.id),
                    "duplicate document id: {}",
                    document.id
                );
                seen.push(document.id.clone());
            }
        }
    }

    #[test]
    fn every_country_code_resolves_without_panicking() {
        let table = include_str!("data/countries.tsv");
        for line in table.lines().filter(|line| !line.is_empty()) {
            let code = line.split('\t').next().expect("tsv rows carry a code");
            let quote = entry_path("CA", code).expect("Canada is curated");
            // Resolution is total: a code either gets a path or an honest Unknown.
            assert_eq!(quote.curated_as_of, CURATED_AS_OF);
            assert_eq!(quote.language, LANGUAGE);
            assert!(!quote.source_url.is_empty());
        }
    }

    #[test]
    fn visa_required_nationality_gets_the_eight_step_route() {
        let journey = visa_journey("CA", "IN").expect("India is visa-required for Canada");
        assert_eq!(journey.entry_path.path, EntryPath::VisaRequired);
        assert_eq!(journey.steps.len(), 8);
        // The high-value branch must be first: a traveler who qualifies for the
        // cheaper route and never checks pays for a visa they did not need.
        assert_eq!(journey.steps[0].id, "ca.trv.01-need");
        assert!(
            journey.steps[0]
                .links
                .iter()
                .any(|link| link.url == CA_ETA_X),
            "step 1 must link the eligibility list it refuses to answer"
        );
    }

    #[test]
    fn visa_exempt_nationality_gets_the_short_route() {
        let journey = visa_journey("CA", "JP").expect("Japan is eTA-eligible for Canada");
        assert_eq!(journey.entry_path.path, EntryPath::ElectronicAuthorization);
        assert_eq!(journey.steps.len(), 3);
    }

    #[test]
    fn an_uncurated_destination_names_no_authority() {
        // ADR-0006, amended 2026-07-29 and again 2026-07-30. A curated
        // destination must not stand in as the authority for any other one: a
        // London -> Tokyo trip was once told to confirm its case at canada.ca.
        for destination in ["FR", "GB", "", "CAN", "ca", "jp"] {
            assert!(
                entry_path(destination, "IN").is_none(),
                "{destination} is not curated, so there is no authority to name"
            );
        }

        // Each curated destination answers for every nationality — including
        // the ones it publishes conditions for and codes it cannot read at all
        // — and names its *own* authority when it does.
        for nationality in ["IN", "US", "MX", "", "i", "IND", "I1"] {
            let canada = entry_path("CA", nationality).expect("Canada is curated");
            assert_eq!(canada.source_name, IRCC);
            assert!(canada.source_url.starts_with("https://www.canada.ca/"));

            let japan = entry_path("JP", nationality).expect("Japan is curated");
            assert_eq!(japan.source_name, MOFA);
            assert!(japan.source_url.starts_with("https://www.mofa.go.jp/"));
        }
    }

    #[test]
    fn japan_quotes_mofas_table_including_its_conditional_rows() {
        // The three doors MOFA actually publishes. There is no electronic
        // authorization anywhere in them: JAPAN eVISA is a channel for the same
        // visa, keyed on residence rather than nationality.
        assert_eq!(
            entry_path("JP", "GB").expect("uk").path,
            EntryPath::Exempt,
            "the UK is on MOFA's exemption table"
        );
        assert_eq!(
            entry_path("JP", "CN").expect("china").path,
            EntryPath::VisaRequired,
            "a country absent from the table needs a visa"
        );
        // Thailand's exemption is conditional on holding an ICAO ePassport, and
        // Voyalier cannot see which passport a traveler holds. Answering
        // "exempt" here is what would put someone at a gate without a visa.
        assert_eq!(
            entry_path("JP", "TH").expect("thailand").path,
            EntryPath::Unknown
        );
        assert_eq!(
            entry_path("JP", "TW").expect("taiwan").path,
            EntryPath::Unknown
        );

        for nationality in JP_EXEMPT {
            assert_eq!(
                entry_path("JP", nationality).expect("exempt").path,
                EntryPath::Exempt,
                "{nationality} is on the unconditional side of the table"
            );
            assert!(
                visa_journey("JP", nationality).is_none(),
                "{nationality} needs no journey"
            );
        }
        for nationality in JP_CONDITIONAL {
            assert_eq!(
                entry_path("JP", nationality).expect("conditional").path,
                EntryPath::Unknown,
                "{nationality} carries a condition MOFA publishes"
            );
            assert!(visa_journey("JP", nationality).is_none());
        }

        // MOFA publishes seventy-four exempt countries and regions. The split
        // between conditional and unconditional is ours; the total is theirs,
        // so it is pinned — a row lost while re-reading the table shows up here.
        assert_eq!(JP_EXEMPT.len() + JP_CONDITIONAL.len(), 74);
        for code in JP_EXEMPT.iter().chain(JP_CONDITIONAL) {
            assert!(is_iso2(code), "not an ISO2 code: {code}");
            assert!(
                !(JP_EXEMPT.contains(code) && JP_CONDITIONAL.contains(code)),
                "{code} cannot be both"
            );
        }
    }

    #[test]
    fn japan_visa_required_gets_the_short_term_stay_route() {
        let journey = visa_journey("JP", "CN").expect("China is visa-required for Japan");
        assert_eq!(journey.destination_iso2, "JP");
        assert_eq!(journey.steps.len(), 6);
        assert_eq!(journey.curated_as_of, JP_CURATED_AS_OF);

        // The two mistakes that cost the most are named where they happen.
        let where_step = &journey.steps[4];
        assert!(
            where_step
                .plain_explanation
                .contains("cannot be obtained on arrival")
        );
        assert!(
            where_step
                .plain_explanation
                .contains("jurisdiction covers where you live")
        );

        // eVISA is a link inside the journey, never an entry path of its own.
        assert!(all_links(&journey).iter().any(|link| link.url == JP_EVISA));
        assert_ne!(
            journey.entry_path.path,
            EntryPath::ElectronicAuthorization,
            "Japan publishes no electronic authorization"
        );
    }

    #[test]
    fn exempt_and_unknown_yield_no_journey() {
        let path = |nationality| {
            entry_path("CA", nationality)
                .expect("Canada is curated")
                .path
        };

        assert_eq!(path("US"), EntryPath::Exempt);
        assert!(visa_journey("CA", "US").is_none());

        // Conditions published rather than an answer: never resolved for them.
        assert_eq!(path("MX"), EntryPath::Unknown);
        assert!(visa_journey("CA", "MX").is_none());

        // Uncurated destination: no quote at all, so no journey either.
        assert!(entry_path("FR", "IN").is_none());
        assert!(visa_journey("FR", "IN").is_none());
        for malformed in ["", "i", "in", "IND", "I1"] {
            assert_eq!(path(malformed), EntryPath::Unknown);
        }
    }

    #[test]
    fn curated_prose_never_quotes_a_fee_or_a_processing_time() {
        // ADR-0006 makes this a defect rather than a style note, so it is a test
        // rather than a review habit.
        for journey in journeys() {
            let prose = journey
                .steps
                .iter()
                .flat_map(|step| {
                    std::iter::once(step.plain_explanation.clone()).chain(
                        step.documents.iter().flat_map(|document| {
                            std::iter::once(document.plain_explanation.clone())
                                .chain(document.gotchas.iter().cloned())
                        }),
                    )
                })
                .collect::<String>();
            assert!(
                !prose.contains('$'),
                "curated prose must not quote a fee: {}",
                journey.route_label
            );
            for banned in ["CAD", "business days", "weeks to process"] {
                assert!(
                    !prose.contains(banned),
                    "curated prose must not quote {banned}"
                );
            }
        }
    }

    #[test]
    fn biometrics_pointers_define_and_locate() {
        let links = biometrics_links();
        assert_eq!(links.len(), 2, "always a definition and a place to go");
    }
}
