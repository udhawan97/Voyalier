//! City pack catalog: the curated set of downloadable local-data packs.
//!
//! A pack bundles permissively-licensed place data (Overture Maps) with a
//! *separate* CC BY-SA Wikivoyage prose layer. Each layer carries its own
//! license and attribution so credit stays honest per layer rather than being
//! flattened into one blanket notice — the licenses are genuinely different
//! (Overture is permissive; Wikivoyage is share-alike).
//!
//! This module is IO-free: it defines the catalog and validates it. Actual pack
//! contents are built by CI, hosted on GitHub Releases, and fetched + stored
//! per trip with explicit consent — none of that happens here.

use serde::{Deserialize, Serialize};

use crate::types::{AppError, ErrorCode};

/// A geographic bounding box in decimal degrees (WGS84).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundingBox {
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
}

impl BoundingBox {
    const fn new(west: f64, south: f64, east: f64, north: f64) -> Self {
        Self {
            west,
            south,
            east,
            north,
        }
    }

    /// True when the box is non-empty and within valid lon/lat ranges.
    pub fn is_valid(&self) -> bool {
        self.west < self.east
            && self.south < self.north
            && (-180.0..=180.0).contains(&self.west)
            && (-180.0..=180.0).contains(&self.east)
            && (-90.0..=90.0).contains(&self.south)
            && (-90.0..=90.0).contains(&self.north)
    }
}

/// The license and attribution for one layer of a pack. Kept per layer because
/// Overture places and Wikivoyage prose are under materially different terms.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackLayerLicense {
    /// "places" or "articles".
    pub layer: String,
    pub source: String,
    /// SPDX-style identifier where one exists.
    pub license: String,
    pub attribution: String,
}

/// Catalog metadata for one downloadable pack. Describes what a pack covers and
/// under what terms — not the pack contents themselves.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackInfo {
    pub id: String,
    pub name: String,
    pub region: String,
    pub bbox: BoundingBox,
    /// The Wikivoyage article the prose layer is built from.
    pub wikivoyage_article: String,
    /// True when the published pack is expected to include a local PMTiles
    /// archive. This lets the download UI disclose the extra payload up front.
    #[serde(default)]
    pub offline_map_available: bool,
    /// Per-layer licenses (always a permissive places layer + a share-alike
    /// articles layer).
    pub layers: Vec<PackLayerLicense>,
}

fn places_layer() -> PackLayerLicense {
    PackLayerLicense {
        layer: "places".to_owned(),
        source: "Overture Maps".to_owned(),
        license: "CDLA-Permissive-2.0".to_owned(),
        attribution: "© Overture Maps Foundation".to_owned(),
    }
}

fn articles_layer() -> PackLayerLicense {
    PackLayerLicense {
        layer: "articles".to_owned(),
        source: "Wikivoyage".to_owned(),
        license: "CC-BY-SA-3.0".to_owned(),
        attribution: "Wikivoyage contributors, CC BY-SA 3.0".to_owned(),
    }
}

fn pack(id: &str, name: &str, region: &str, article: &str, bbox: BoundingBox) -> PackInfo {
    PackInfo {
        id: id.to_owned(),
        name: name.to_owned(),
        region: region.to_owned(),
        bbox,
        wikivoyage_article: article.to_owned(),
        offline_map_available: matches!(id, "us-nashville" | "jp-kyoto" | "jp-tokyo" | "fr-paris"),
        layers: vec![places_layer(), articles_layer()],
    }
}

/// The curated catalog of available city packs.
///
/// Owner-decided required seeds: **Nashville** plus **Hawaii as four separate
/// per-island packs** (Oʻahu, Maui, Kauaʻi, and the Big Island). Bounding boxes
/// are approximate coverage extents; CI fills each pack with data clipped to its
/// box. Ordered with the required seeds first.
pub fn pack_catalog() -> Vec<PackInfo> {
    vec![
        pack(
            "us-nashville",
            "Nashville",
            "Tennessee, USA",
            "Nashville",
            BoundingBox::new(-87.06, 36.03, -86.62, 36.41),
        ),
        pack(
            "us-hi-oahu",
            "Oʻahu",
            "Hawaii, USA",
            "Oahu",
            BoundingBox::new(-158.31, 21.24, -157.62, 21.75),
        ),
        pack(
            "us-hi-maui",
            "Maui",
            "Hawaii, USA",
            "Maui",
            BoundingBox::new(-156.71, 20.57, -155.98, 21.04),
        ),
        pack(
            "us-hi-kauai",
            "Kauaʻi",
            "Hawaii, USA",
            "Kauai",
            BoundingBox::new(-159.79, 21.85, -159.29, 22.24),
        ),
        pack(
            "us-hi-hawaii-island",
            "Hawaiʻi (Big Island)",
            "Hawaii, USA",
            "Hawaii (Big Island)",
            BoundingBox::new(-156.11, 18.87, -154.79, 20.29),
        ),
        pack(
            "jp-kyoto",
            "Kyoto",
            "Japan",
            "Kyoto",
            BoundingBox::new(135.68, 34.93, 135.83, 35.10),
        ),
        pack(
            "jp-tokyo",
            "Tokyo",
            "Japan",
            "Tokyo",
            BoundingBox::new(139.56, 35.53, 139.92, 35.82),
        ),
        pack(
            "fr-paris",
            "Paris",
            "France",
            "Paris",
            BoundingBox::new(2.22, 48.81, 2.47, 48.91),
        ),
        pack(
            "gb-london",
            "London",
            "United Kingdom",
            "London",
            BoundingBox::new(-0.35, 51.38, 0.15, 51.67),
        ),
        pack(
            "us-nyc",
            "New York City",
            "New York, USA",
            "New York City",
            BoundingBox::new(-74.26, 40.49, -73.70, 40.92),
        ),
        pack(
            "us-san-francisco",
            "San Francisco",
            "California, USA",
            "San Francisco",
            BoundingBox::new(-122.52, 37.70, -122.36, 37.83),
        ),
        pack(
            "es-barcelona",
            "Barcelona",
            "Spain",
            "Barcelona",
            BoundingBox::new(2.07, 41.32, 2.23, 41.47),
        ),
        pack(
            "it-rome",
            "Rome",
            "Italy",
            "Rome",
            BoundingBox::new(12.35, 41.79, 12.62, 41.99),
        ),
        pack(
            "is-reykjavik",
            "Reykjavík",
            "Iceland",
            "Reykjavik",
            BoundingBox::new(-21.99, 64.09, -21.75, 64.18),
        ),
        pack(
            "sg-singapore",
            "Singapore",
            "Singapore",
            "Singapore",
            BoundingBox::new(103.60, 1.21, 104.04, 1.48),
        ),
        pack(
            "th-bangkok",
            "Bangkok",
            "Thailand",
            "Bangkok",
            BoundingBox::new(100.33, 13.49, 100.94, 13.96),
        ),
    ]
}

/// Resolve a pack id against the catalog, or a validation error.
pub fn validate_pack_id(id: &str) -> Result<PackInfo, AppError> {
    pack_catalog()
        .into_iter()
        .find(|info| info.id == id)
        .ok_or_else(|| {
            AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "unknown city pack",
                "field",
                "pack",
            )
        })
}

/// The GitHub Release tag pack contents are published under.
pub const PACK_RELEASE_TAG: &str = "packs-v1";

/// Hard ceiling for one offline city basemap. The app verifies this before
/// storing bytes so a compromised release cannot exhaust local disk or memory.
pub const MAX_OFFLINE_MAP_BYTES: u64 = 128 * 1024 * 1024;

/// The download URL for a pack's contents (a single JSON asset on a GitHub
/// Release). Downloading it pulls data *in*; nothing about the trip is sent.
pub fn pack_download_url(pack_id: &str) -> String {
    format!(
        "https://github.com/udhawan97/Voyalier/releases/download/{PACK_RELEASE_TAG}/{pack_id}.json"
    )
}

/// The immutable release-asset URL for a validated offline-map descriptor.
/// Downloading pulls public map data in; no trip data is sent.
pub fn offline_map_download_url(asset_name: &str) -> String {
    format!(
        "https://github.com/udhawan97/Voyalier/releases/download/{PACK_RELEASE_TAG}/{asset_name}"
    )
}

/// One place of interest inside a downloaded pack (from the Overture layer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackPlace {
    pub name: String,
    pub category: String,
    pub lat: f64,
    pub lon: f64,
}

/// One travel-notes article inside a downloaded pack (from the Wikivoyage layer).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackArticle {
    pub title: String,
    pub source_url: String,
    pub text: String,
}

/// Provenance and integrity metadata for an optional per-pack PMTiles archive.
/// This is published inside the signed/hashed pack JSON and validated before
/// the application downloads the binary asset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineMapDescriptor {
    pub asset_name: String,
    pub byte_length: u64,
    pub sha256: String,
    pub source_name: String,
    pub source_url: String,
    pub license: String,
    pub attribution: String,
    pub fetched_at: String,
    pub min_zoom: u8,
    pub max_zoom: u8,
}

/// The contents of a downloaded pack, as published by CI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackContent {
    pub pack_id: String,
    #[serde(default)]
    pub places: Vec<PackPlace>,
    #[serde(default)]
    pub articles: Vec<PackArticle>,
    #[serde(default)]
    pub offline_map: Option<OfflineMapDescriptor>,
}

/// A stored record that a pack was downloaded for a trip. Summary metadata; the
/// full contents live alongside it but are surfaced separately.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedPack {
    pub pack_id: String,
    pub name: String,
    pub region: String,
    pub place_count: u32,
    pub article_count: u32,
    pub downloaded_at: String,
    #[serde(default)]
    pub offline_map_ready: bool,
}

/// A locally stored offline basemap that can be read in bounded byte ranges.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineMapArchive {
    pub pack_id: String,
    pub name: String,
    pub bbox: BoundingBox,
    pub byte_length: u64,
    pub sha256: String,
    pub source_name: String,
    pub source_url: String,
    pub license: String,
    pub attribution: String,
    pub fetched_at: String,
    pub min_zoom: u8,
    pub max_zoom: u8,
}

/// One base64-encoded slice of a local PMTiles archive. The archive hash is the
/// stable ETag used by the PMTiles range cache.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflineMapChunk {
    pub data_base64: String,
    pub etag: String,
}

/// How strongly a trip destination matched a catalog pack.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PackMatchKind {
    /// The destination is (or contains as whole words) the pack's own name or
    /// Wikivoyage article title — e.g. "Kyoto" → `jp-kyoto`.
    Exact,
    /// The destination matched a curated alias — e.g. "NYC" → `us-nyc`.
    Alias,
    /// Only the pack's region overlapped — e.g. "Japan" → both Kyoto and Tokyo.
    Partial,
}

/// A catalog pack suggested for a trip destination, with why it matched. Built
/// entirely on-device from the compiled-in catalog; suggesting a pack sends
/// nothing and downloads nothing — that stays an explicit user action.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackSuggestion {
    pub pack: PackInfo,
    pub match_kind: PackMatchKind,
    /// The pack-side term that matched (its name, alias, or region), for display.
    pub matched_text: String,
}

/// Curated extra search terms per pack, beyond its name, region, and Wikivoyage
/// article. Lowercase ASCII; matched after normalization. Every id here MUST be
/// a real catalog id and no term may be blank — both are enforced by tests.
fn pack_aliases(pack_id: &str) -> &'static [&'static str] {
    match pack_id {
        "us-nashville" => &["music city"],
        "us-hi-oahu" => &["honolulu", "waikiki"],
        "us-hi-maui" => &["lahaina", "kahului"],
        "us-hi-kauai" => &["lihue"],
        "us-hi-hawaii-island" => &["big island", "kona", "hilo"],
        "gb-london" => &["london uk"],
        "us-nyc" => &["new york", "nyc", "manhattan", "brooklyn"],
        "us-san-francisco" => &["san francisco", "sf", "san fran"],
        "es-barcelona" => &["barca"],
        "it-rome" => &["roma"],
        "is-reykjavik" => &["reykjavik"],
        _ => &[],
    }
}

/// Region tokens too generic to imply a specific pack on their own.
fn is_region_stopword(token: &str) -> bool {
    matches!(token, "usa" | "the" | "and" | "of")
}

/// Fold one character for place matching: keep ASCII letters/digits (lowercased),
/// fold common Latin diacritics to ASCII, drop apostrophe-like marks (including
/// the Hawaiian ʻokina) with no gap, and treat everything else as a separator.
enum Fold {
    Keep(char),
    Drop,
    Sep,
}

fn fold_char(c: char) -> Fold {
    // Case-fold first, so an accented capital (Í, Ö, Ø) takes the same path as
    // its lowercase form. Matching only 'A'..='Z' sent every other uppercase
    // letter to Fold::Sep, so "REYKJAVÍK" normalized to "reykjav k" and matched
    // nothing. Destinations are user-typed free text, so this is reachable.
    let c = c.to_lowercase().next().unwrap_or(c);
    match c {
        'a'..='z' | '0'..='9' => Fold::Keep(c),
        // Apostrophe-like marks are removed without splitting the word, so
        // "Oʻahu" folds to "oahu" (matching the "Oahu" article title).
        '\'' | '`' | '\u{2018}' | '\u{2019}' | '\u{02BB}' | '\u{00B4}' => Fold::Drop,
        'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' | 'ā' => Fold::Keep('a'),
        'é' | 'è' | 'ê' | 'ë' | 'ē' => Fold::Keep('e'),
        'í' | 'ì' | 'î' | 'ï' | 'ī' => Fold::Keep('i'),
        'ó' | 'ò' | 'ô' | 'ö' | 'õ' | 'ō' | 'ø' => Fold::Keep('o'),
        'ú' | 'ù' | 'û' | 'ü' | 'ū' => Fold::Keep('u'),
        'ñ' => Fold::Keep('n'),
        'ç' => Fold::Keep('c'),
        'ß' => Fold::Keep('s'),
        _ => Fold::Sep,
    }
}

/// Normalize a place string to lowercase ASCII, space-separated tokens: fold
/// diacritics, strip the ʻokina/apostrophes, and collapse other punctuation and
/// whitespace to single spaces. "Kauaʻi, Hawaii" and "kauai hawaii" converge.
pub fn normalize_place(input: &str) -> String {
    let mut out = String::new();
    let mut prev_sep = true; // suppress a leading separator
    for c in input.chars() {
        match fold_char(c) {
            Fold::Keep(ch) => {
                out.push(ch);
                prev_sep = false;
            }
            Fold::Drop => {}
            Fold::Sep => {
                if !prev_sep {
                    out.push(' ');
                    prev_sep = true;
                }
            }
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    out
}

/// True when `term_norm` appears in `padded_dest` as a whole run of tokens.
/// `padded_dest` must be the normalized destination wrapped in single spaces.
fn phrase_in(padded_dest: &str, term_norm: &str) -> bool {
    !term_norm.is_empty() && padded_dest.contains(&format!(" {term_norm} "))
}

fn tier_rank(kind: PackMatchKind) -> u8 {
    match kind {
        PackMatchKind::Exact => 0,
        PackMatchKind::Alias => 1,
        PackMatchKind::Partial => 2,
    }
}

/// The strongest match between a destination and one pack, if any. Exact (name
/// or article) beats alias beats region-only partial.
fn classify_match(
    info: &PackInfo,
    padded_dest: &str,
    dest_tokens: &[&str],
) -> Option<(PackMatchKind, String)> {
    for term in [info.name.as_str(), info.wikivoyage_article.as_str()] {
        if phrase_in(padded_dest, &normalize_place(term)) {
            return Some((PackMatchKind::Exact, info.name.clone()));
        }
    }
    for alias in pack_aliases(&info.id) {
        if phrase_in(padded_dest, &normalize_place(alias)) {
            return Some((PackMatchKind::Alias, (*alias).to_owned()));
        }
    }
    let region_norm = normalize_place(&info.region);
    for token in region_norm.split(' ') {
        if token.len() >= 4 && !is_region_stopword(token) && dest_tokens.contains(&token) {
            return Some((PackMatchKind::Partial, info.region.clone()));
        }
    }
    None
}

/// Suggest catalog packs for a free-text destination, best match first.
///
/// Deterministic and offline: it reads only the compiled-in catalog, so it makes
/// no network request and reveals nothing about the trip. Returns every match so
/// a caller can render the ambiguous case (e.g. "Japan" → Kyoto and Tokyo) and
/// the empty vec for a no-match destination.
pub fn suggest_packs(destination: &str) -> Vec<PackSuggestion> {
    let normalized = normalize_place(destination);
    if normalized.is_empty() {
        return Vec::new();
    }
    let padded = format!(" {normalized} ");
    let dest_tokens: Vec<&str> = normalized.split(' ').collect();

    let mut suggestions: Vec<PackSuggestion> = pack_catalog()
        .into_iter()
        .filter_map(|info| {
            classify_match(&info, &padded, &dest_tokens).map(|(kind, matched_text)| {
                PackSuggestion {
                    pack: info,
                    match_kind: kind,
                    matched_text,
                }
            })
        })
        .collect();
    // Stable sort keeps catalog order within a tier.
    suggestions.sort_by_key(|suggestion| tier_rank(suggestion.match_kind));
    suggestions
}

/// Parse a downloaded pack body, verifying it is the pack we asked for. A
/// mismatched or unreadable body is a [`ErrorCode::PackDownloadFailed`].
pub fn parse_pack_content(expected_id: &str, body: &str) -> Result<PackContent, AppError> {
    let content: PackContent = serde_json::from_str(body).map_err(|_| {
        AppError::new(
            ErrorCode::PackDownloadFailed,
            "the downloaded city pack was unreadable",
        )
    })?;
    if content.pack_id != expected_id {
        return Err(AppError::new(
            ErrorCode::PackDownloadFailed,
            "the downloaded city pack did not match the requested pack",
        ));
    }
    if let Some(map) = &content.offline_map {
        let expected_asset = format!("{expected_id}.pmtiles");
        let valid_hash =
            map.sha256.len() == 64 && map.sha256.bytes().all(|byte| byte.is_ascii_hexdigit());
        let valid_source = map.source_url.starts_with("https://build.protomaps.com/")
            && map.source_url.ends_with(".pmtiles");
        let valid_fetched_at = map.fetched_at.parse::<jiff::Timestamp>().is_ok();
        if map.asset_name != expected_asset
            || map.byte_length == 0
            || map.byte_length > MAX_OFFLINE_MAP_BYTES
            || !valid_hash
            || map.source_name.trim().is_empty()
            || !valid_source
            || map.license != "ODbL-1.0"
            || map.attribution.trim().is_empty()
            || !valid_fetched_at
            || map.min_zoom > map.max_zoom
            || map.max_zoom > 22
        {
            return Err(AppError::new(
                ErrorCode::PackDownloadFailed,
                "the downloaded city pack had invalid offline-map metadata",
            ));
        }
    }
    Ok(content)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn catalog_includes_the_required_seed_cities() {
        let catalog = pack_catalog();
        let ids: HashSet<&str> = catalog.iter().map(|info| info.id.as_str()).collect();
        // Nashville plus the four Hawaii island packs are non-negotiable.
        for required in [
            "us-nashville",
            "us-hi-oahu",
            "us-hi-maui",
            "us-hi-kauai",
            "us-hi-hawaii-island",
        ] {
            assert!(ids.contains(required), "missing required pack {required}");
        }
        // Hawaii ships as four separate island packs, not one.
        assert_eq!(
            catalog
                .iter()
                .filter(|info| info.region == "Hawaii, USA")
                .count(),
            4
        );
        assert_eq!(
            catalog
                .iter()
                .filter(|info| info.offline_map_available)
                .map(|info| info.id.as_str())
                .collect::<Vec<_>>(),
            vec!["us-nashville", "jp-kyoto", "jp-tokyo", "fr-paris"]
        );
    }

    #[test]
    fn every_pack_is_well_formed_with_both_licensed_layers() {
        let catalog = pack_catalog();
        let mut seen = HashSet::new();
        for info in &catalog {
            assert!(seen.insert(info.id.clone()), "duplicate id {}", info.id);
            assert!(!info.name.is_empty());
            assert!(!info.region.is_empty());
            assert!(!info.wikivoyage_article.is_empty());
            assert!(info.bbox.is_valid(), "bad bbox for {}", info.id);
            // Exactly the permissive places layer + the share-alike prose layer.
            let layers: HashSet<&str> = info.layers.iter().map(|l| l.layer.as_str()).collect();
            assert!(layers.contains("places"), "no places layer for {}", info.id);
            assert!(
                layers.contains("articles"),
                "no articles layer for {}",
                info.id
            );
            let articles = info
                .layers
                .iter()
                .find(|l| l.layer == "articles")
                .expect("articles layer");
            assert!(
                articles.license.contains("BY-SA"),
                "Wikivoyage layer must be share-alike"
            );
            assert!(info.layers.iter().all(|l| !l.attribution.is_empty()));
        }
    }

    #[test]
    fn validate_pack_id_resolves_known_and_rejects_unknown() {
        assert_eq!(
            validate_pack_id("us-nashville").expect("known").name,
            "Nashville"
        );
        assert_eq!(
            validate_pack_id("atlantis").expect_err("unknown").code,
            ErrorCode::ValidationInvalidInput
        );
    }

    fn matched_ids(destination: &str) -> Vec<String> {
        suggest_packs(destination)
            .into_iter()
            .map(|suggestion| suggestion.pack.id)
            .collect()
    }

    #[test]
    fn every_alias_targets_a_real_pack_and_is_non_blank() {
        let catalog = pack_catalog();
        let ids: HashSet<&str> = catalog.iter().map(|info| info.id.as_str()).collect();
        // Also assert no alias maps to two different packs (would make a match
        // ambiguous for the wrong reason).
        let mut seen_alias = HashSet::new();
        for info in pack_catalog() {
            for alias in pack_aliases(&info.id) {
                assert!(!alias.trim().is_empty(), "blank alias for {}", info.id);
                assert_eq!(
                    normalize_place(alias),
                    *alias,
                    "alias {alias:?} for {} must already be normalized",
                    info.id
                );
                assert!(
                    seen_alias.insert(*alias),
                    "alias {alias:?} is shared across packs"
                );
            }
        }
        // `pack_aliases` is only ever called with catalog ids.
        assert!(ids.contains("us-nyc"));
    }

    #[test]
    fn exact_destination_suggests_its_pack_first() {
        let suggestion = &suggest_packs("Kyoto")[0];
        assert_eq!(suggestion.pack.id, "jp-kyoto");
        assert_eq!(suggestion.match_kind, PackMatchKind::Exact);
    }

    #[test]
    fn diacritics_and_okina_are_folded_when_matching() {
        // ʻokina, trailing region, and comma punctuation all normalize away.
        assert_eq!(matched_ids("Kauaʻi, Hawaii")[0], "us-hi-kauai");
        assert_eq!(matched_ids("kauai")[0], "us-hi-kauai");
        assert_eq!(matched_ids("Reykjavík")[0], "is-reykjavik");
    }

    #[test]
    fn aliases_match_at_the_alias_tier() {
        let nyc = &suggest_packs("NYC")[0];
        assert_eq!(nyc.pack.id, "us-nyc");
        assert_eq!(nyc.match_kind, PackMatchKind::Alias);
        assert_eq!(matched_ids("Big Island")[0], "us-hi-hawaii-island");
    }

    #[test]
    fn ambiguous_region_returns_all_matches_as_partial() {
        let japan = suggest_packs("Japan");
        let ids: Vec<&str> = japan.iter().map(|s| s.pack.id.as_str()).collect();
        assert!(ids.contains(&"jp-kyoto") && ids.contains(&"jp-tokyo"));
        assert!(japan.iter().all(|s| s.match_kind == PackMatchKind::Partial));

        // The four Hawaii island packs are all partial matches for "Hawaii".
        assert_eq!(matched_ids("Hawaii").len(), 4);
    }

    #[test]
    fn exact_matches_sort_ahead_of_partial_ones() {
        // "Kyoto, Japan": Kyoto is exact; Tokyo is a Japan-region partial.
        let ranked = suggest_packs("Kyoto, Japan");
        assert_eq!(ranked[0].pack.id, "jp-kyoto");
        assert_eq!(ranked[0].match_kind, PackMatchKind::Exact);
        assert!(
            ranked[1..]
                .iter()
                .all(|s| s.match_kind == PackMatchKind::Partial)
        );
    }

    #[test]
    fn no_match_and_blank_return_empty() {
        assert!(suggest_packs("Atlantis").is_empty());
        assert!(suggest_packs("   ").is_empty());
        // A bare stopword region token never matches everything.
        assert!(suggest_packs("USA").is_empty());
    }

    #[test]
    fn download_url_targets_the_release_asset() {
        let url = pack_download_url("us-nashville");
        assert!(url.contains("releases/download/packs-v1/us-nashville.json"));
    }

    #[test]
    fn parses_matching_content_and_rejects_mismatched_or_garbage() {
        let body = r#"{
            "packId": "us-nashville",
            "places": [{ "name": "Ryman Auditorium", "category": "music_venue",
                         "lat": 36.1613, "lon": -86.7784 }],
            "articles": [{ "title": "Nashville", "sourceUrl": "https://en.wikivoyage.org/wiki/Nashville",
                           "text": "Music City." }]
        }"#;
        let content = parse_pack_content("us-nashville", body).expect("content");
        assert_eq!(content.places.len(), 1);
        assert_eq!(content.articles.len(), 1);
        assert!(content.offline_map.is_none());
        assert_eq!(content.places[0].name, "Ryman Auditorium");

        // A body for a different pack is refused.
        assert_eq!(
            parse_pack_content("us-hi-maui", body)
                .expect_err("mismatch")
                .code,
            ErrorCode::PackDownloadFailed
        );
        // Unreadable bodies fail cleanly.
        assert_eq!(
            parse_pack_content("us-nashville", "not json")
                .expect_err("garbage")
                .code,
            ErrorCode::PackDownloadFailed
        );

        let mapped = r#"{
            "packId":"us-nashville","places":[],"articles":[],
            "offlineMap":{
              "assetName":"us-nashville.pmtiles","byteLength":16777216,
              "sha256":"d288f572a668f3e542c8e16e38127db8fa20c0fd2d2fe9029385b9c5c1cd5889",
              "sourceName":"Protomaps Basemap","sourceUrl":"https://build.protomaps.com/20260715.pmtiles",
              "license":"ODbL-1.0","attribution":"© OpenStreetMap contributors",
              "fetchedAt":"2026-07-16T00:27:07Z","minZoom":0,"maxZoom":15
            }
        }"#;
        assert!(
            parse_pack_content("us-nashville", mapped)
                .expect("mapped pack")
                .offline_map
                .is_some()
        );
        assert_eq!(
            parse_pack_content("us-nashville", &mapped.replace("d288", "nope"))
                .expect_err("invalid hash")
                .code,
            ErrorCode::PackDownloadFailed
        );
    }
}
