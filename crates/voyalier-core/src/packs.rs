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

/// The download URL for a pack's contents (a single JSON asset on a GitHub
/// Release). Downloading it pulls data *in*; nothing about the trip is sent.
pub fn pack_download_url(pack_id: &str) -> String {
    format!(
        "https://github.com/udhawan97/Voyalier/releases/download/{PACK_RELEASE_TAG}/{pack_id}.json"
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

/// The contents of a downloaded pack, as published by CI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackContent {
    pub pack_id: String,
    #[serde(default)]
    pub places: Vec<PackPlace>,
    #[serde(default)]
    pub articles: Vec<PackArticle>,
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
    }
}
