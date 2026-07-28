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

use crate::types::SourceLink;

/// When the curated tables below were last read against their sources by hand.
/// Shown to the traveler beside every quoted entry path.
const CURATED_AS_OF: &str = "2026-07-28";

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

/// The entry path a destination publishes for a nationality.
///
/// Canada's own framing is an exception list: the eTA-eligible and exempt
/// nationalities are enumerated, and its guidance states that citizens of
/// countries not on those lists need a visitor visa. Defaulting a valid,
/// unlisted code to `VisaRequired` therefore quotes that structure rather than
/// inferring past it — and it is the safe direction, costing a traveler a check
/// rather than a denied boarding. Invalid codes, uncurated destinations, and
/// nationalities Canada publishes conditions for all yield `Unknown`.
pub fn entry_path(destination_iso2: &str, nationality_iso2: &str) -> EntryPathQuote {
    let unknown = |url: &str| EntryPathQuote {
        path: EntryPath::Unknown,
        source_name: IRCC.to_owned(),
        source_url: url.to_owned(),
        curated_as_of: CURATED_AS_OF.to_owned(),
        language: LANGUAGE.to_owned(),
    };

    if destination_iso2 != "CA" || !is_iso2(nationality_iso2) {
        return unknown(CA_CHECK);
    }
    if CA_CONDITIONAL.contains(&nationality_iso2) {
        return unknown(CA_CHECK);
    }

    let path = if CA_EXEMPT.contains(&nationality_iso2) {
        EntryPath::Exempt
    } else if CA_ETA_ELIGIBLE.contains(&nationality_iso2) {
        EntryPath::ElectronicAuthorization
    } else {
        EntryPath::VisaRequired
    };

    EntryPathQuote {
        path,
        source_name: IRCC.to_owned(),
        source_url: CA_BY_COUNTRY.to_owned(),
        curated_as_of: CURATED_AS_OF.to_owned(),
        language: LANGUAGE.to_owned(),
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
    let quote = entry_path(destination_iso2, nationality_iso2);
    match quote.path {
        EntryPath::VisaRequired => Some(canada_visitor_visa(nationality_iso2, quote)),
        EntryPath::ElectronicAuthorization => Some(canada_eta(nationality_iso2, quote)),
        EntryPath::Exempt | EntryPath::Unknown => None,
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
    fn journeys() -> Vec<VisaJourney> {
        ["IN", "GB", "NG", "JP"]
            .iter()
            .filter_map(|nationality| visa_journey("CA", nationality))
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

    #[test]
    fn every_curated_link_is_a_well_formed_official_url() {
        for journey in journeys() {
            assert!(journey.entry_path.source_url.starts_with("https://"));
            for link in all_links(&journey) {
                assert!(
                    link.url.starts_with("https://www.canada.ca/"),
                    "off-domain or insecure curated link: {}",
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
            let mut seen = Vec::new();
            for document in journey.steps.iter().flat_map(|step| &step.documents) {
                assert!(
                    document.id.starts_with("ca."),
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
            let quote = entry_path("CA", code);
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
    fn exempt_and_unknown_yield_no_journey() {
        assert_eq!(entry_path("CA", "US").path, EntryPath::Exempt);
        assert!(visa_journey("CA", "US").is_none());

        // Conditions published rather than an answer: never resolved for them.
        assert_eq!(entry_path("CA", "MX").path, EntryPath::Unknown);
        assert!(visa_journey("CA", "MX").is_none());

        // Uncurated destination, and malformed codes.
        assert_eq!(entry_path("FR", "IN").path, EntryPath::Unknown);
        assert!(visa_journey("FR", "IN").is_none());
        for malformed in ["", "i", "in", "IND", "I1"] {
            assert_eq!(entry_path("CA", malformed).path, EntryPath::Unknown);
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
