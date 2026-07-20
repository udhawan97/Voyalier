//! Deterministic, transparent recommendations over a trip's downloaded pack
//! places. Each place is scored by how well its category matches the traveler's
//! persona weights; the scoring is a simple, explainable rule — never a model —
//! and every result carries its source, license, score, and "because" reasons.
//!
//! Recommendations are suggestions drawn from open place data (Overture), not
//! high-stakes facts: they are never authoritative for prices, hours, or safety.

use serde::{Deserialize, Serialize};

use crate::{AppError, ErrorCode, packs::PackPlace};

/// The persona dimensions a traveler can weight (each 0.0–1.0). Presets in the
/// UI map onto these; the contract only ever carries the weights.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonaWeights {
    pub food: f64,
    pub culture: f64,
    pub nature: f64,
    pub nightlife: f64,
    pub shopping: f64,
}

impl PersonaWeights {
    /// An even interest across every dimension.
    pub fn balanced() -> Self {
        Self {
            food: 0.5,
            culture: 0.5,
            nature: 0.5,
            nightlife: 0.5,
            shopping: 0.5,
        }
    }

    /// Validate weights received over a public contract. Persisted profiles
    /// reject invalid values instead of silently clamping traveler input.
    pub fn validate(self) -> Result<Self, AppError> {
        let valid = [
            self.food,
            self.culture,
            self.nature,
            self.nightlife,
            self.shopping,
        ]
        .into_iter()
        .all(|weight| weight.is_finite() && (0.0..=1.0).contains(&weight));
        if valid {
            Ok(self)
        } else {
            Err(AppError::with_detail(
                ErrorCode::ValidationInvalidInput,
                "interest weights must be finite numbers from zero to one",
                "field",
                "weights",
            ))
        }
    }

    fn clamped(self) -> Self {
        let c = |value: f64| value.clamp(0.0, 1.0);
        Self {
            food: c(self.food),
            culture: c(self.culture),
            nature: c(self.nature),
            nightlife: c(self.nightlife),
            shopping: c(self.shopping),
        }
    }

    fn weight_of(&self, dimension: Dimension) -> f64 {
        match dimension {
            Dimension::Food => self.food,
            Dimension::Culture => self.culture,
            Dimension::Nature => self.nature,
            Dimension::Nightlife => self.nightlife,
            Dimension::Shopping => self.shopping,
        }
    }
}

impl Default for PersonaWeights {
    fn default() -> Self {
        Self::balanced()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Dimension {
    Food,
    Culture,
    Nature,
    Nightlife,
    Shopping,
}

impl Dimension {
    fn label(self) -> &'static str {
        match self {
            Dimension::Food => "food",
            Dimension::Culture => "culture",
            Dimension::Nature => "nature",
            Dimension::Nightlife => "nightlife",
            Dimension::Shopping => "shopping",
        }
    }
}

/// Map an Overture-style category to a persona dimension by keyword, or `None`
/// if it doesn't clearly belong to one (those places are not recommended).
fn dimension_for(category: &str) -> Option<Dimension> {
    let c = category.to_ascii_lowercase();
    let has = |needles: &[&str]| needles.iter().any(|needle| c.contains(needle));
    if has(&[
        "restaurant",
        "cafe",
        "coffee",
        "food",
        "bakery",
        "eatery",
        "bistro",
    ]) {
        Some(Dimension::Food)
    } else if has(&[
        "museum", "gallery", "art", "histor", "landmark", "monument", "theatre", "theater",
        "cultural", "heritage",
    ]) {
        Some(Dimension::Culture)
    } else if has(&[
        "park",
        "garden",
        "beach",
        "trail",
        "hiking",
        "viewpoint",
        "nature",
        "forest",
        "mountain",
        "lake",
    ]) {
        Some(Dimension::Nature)
    } else if has(&[
        "bar",
        "club",
        "pub",
        "nightlife",
        "lounge",
        "brewery",
        "winery",
    ]) {
        Some(Dimension::Nightlife)
    } else if has(&["shop", "store", "retail", "market", "mall", "boutique"]) {
        Some(Dimension::Shopping)
    } else {
        None
    }
}

/// A recommended place, with the provenance and reasoning behind its rank.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    /// The downloaded pack that supplied this place.
    pub pack_id: String,
    pub name: String,
    pub category: String,
    /// The persona dimension the place matched.
    pub dimension: String,
    pub lat: f64,
    pub lon: f64,
    pub source: String,
    pub license: String,
    /// Transparent 0.0–1.0 score (the matched dimension's weight).
    pub score: f64,
    /// Human-readable "because" reasons.
    pub reasons: Vec<String>,
    /// A deliberately-different pick, surfaced for serendipity.
    pub wildcard: bool,
}

/// A pack place paired with the pack that supplied it. The attribution is kept
/// outside `PackPlace` because pack files declare provenance once at the pack
/// level rather than duplicating it in every place row.
#[derive(Debug, Clone, PartialEq)]
pub struct AttributedPackPlace {
    pub pack_id: String,
    pub place: PackPlace,
}

/// Rank a pack's places against `weights`, returning up to `limit` results,
/// highest score first. Places whose category matches no dimension, or whose
/// dimension weight is zero, are excluded. One pick from a dimension other than
/// the top result's is flagged as a wildcard.
pub fn recommend_places(
    places: &[PackPlace],
    weights: &PersonaWeights,
    limit: usize,
) -> Vec<Recommendation> {
    let attributed: Vec<AttributedPackPlace> = places
        .iter()
        .cloned()
        .map(|place| AttributedPackPlace {
            pack_id: String::new(),
            place,
        })
        .collect();
    recommend_attributed_places(&attributed, weights, limit)
}

/// Rank places while preserving the pack that supplied every result.
pub fn recommend_attributed_places(
    places: &[AttributedPackPlace],
    weights: &PersonaWeights,
    limit: usize,
) -> Vec<Recommendation> {
    let weights = weights.clamped();
    let mut scored: Vec<Recommendation> = places
        .iter()
        .filter_map(|attributed| {
            let place = &attributed.place;
            let dimension = dimension_for(&place.category)?;
            let score = weights.weight_of(dimension);
            if score <= 0.0 {
                return None;
            }
            Some(Recommendation {
                pack_id: attributed.pack_id.clone(),
                name: place.name.clone(),
                category: place.category.clone(),
                dimension: dimension.label().to_owned(),
                lat: place.lat,
                lon: place.lon,
                source: "Overture Maps".to_owned(),
                license: "CDLA-Permissive-2.0".to_owned(),
                score,
                reasons: vec![format!("Matches your interest in {}", dimension.label())],
                wildcard: false,
            })
        })
        .collect();

    // Deterministic order: score desc, then name asc for stable ties.
    scored.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.name.cmp(&b.name))
    });
    scored.truncate(limit);

    // Flag one pick from a different dimension than the top result as a wildcard.
    if let Some(top_dimension) = scored.first().map(|rec| rec.dimension.clone()) {
        if let Some(wild) = scored.iter_mut().find(|rec| rec.dimension != top_dimension) {
            wild.wildcard = true;
            wild.reasons
                .push("A change of pace from your top picks".to_owned());
        }
    }

    scored
}

#[cfg(test)]
mod tests {
    use super::*;

    fn place(name: &str, category: &str) -> PackPlace {
        PackPlace {
            name: name.to_owned(),
            category: category.to_owned(),
            lat: 36.16,
            lon: -86.78,
        }
    }

    #[test]
    fn scores_by_weight_and_excludes_unmatched_or_zero_weight() {
        let places = vec![
            place("Blue Note", "jazz_bar"),
            place("Hattie B's", "restaurant"),
            place("Frist Museum", "art_museum"),
            place("City Hall", "government_building"), // no dimension → excluded
            place("Green Park", "public_park"),
        ];
        let weights = PersonaWeights {
            food: 1.0,
            culture: 0.8,
            nature: 0.0, // zero → excluded
            nightlife: 0.6,
            shopping: 0.0,
        };
        let recs = recommend_places(&places, &weights, 10);

        let names: Vec<&str> = recs.iter().map(|r| r.name.as_str()).collect();
        // Food (1.0) ranks first; nature (0.0) and the unmatched place are gone.
        assert_eq!(names.first(), Some(&"Hattie B's"));
        assert!(!names.contains(&"Green Park"));
        assert!(!names.contains(&"City Hall"));
        assert_eq!(recs.len(), 3);
        // Every rec carries provenance and a reason.
        assert!(recs.iter().all(|r| r.source == "Overture Maps"));
        assert!(recs.iter().all(|r| !r.reasons.is_empty()));
        // The top pick is food; a non-food pick is the wildcard.
        assert_eq!(recs[0].dimension, "food");
        let wild = recs.iter().find(|r| r.wildcard).expect("a wildcard");
        assert_ne!(wild.dimension, "food");
    }

    #[test]
    fn empty_when_nothing_matches_or_all_weights_zero() {
        let places = vec![place("Hattie B's", "restaurant")];
        let all_zero = PersonaWeights {
            food: 0.0,
            culture: 0.0,
            nature: 0.0,
            nightlife: 0.0,
            shopping: 0.0,
        };
        assert!(recommend_places(&places, &all_zero, 10).is_empty());
        assert!(recommend_places(&[], &PersonaWeights::balanced(), 10).is_empty());
    }

    #[test]
    fn respects_the_limit_and_is_deterministic() {
        let places: Vec<PackPlace> = (0..20)
            .map(|i| place(&format!("Cafe {i:02}"), "cafe"))
            .collect();
        let recs = recommend_places(&places, &PersonaWeights::balanced(), 5);
        assert_eq!(recs.len(), 5);
        // Ties broken by name → stable, deterministic order.
        assert_eq!(recs[0].name, "Cafe 00");
        assert_eq!(recs[4].name, "Cafe 04");
    }

    #[test]
    fn rejects_interest_weights_outside_the_contract_range() {
        let invalid = PersonaWeights {
            food: 1.1,
            ..PersonaWeights::balanced()
        };

        let error = invalid.validate().expect_err("weight above one");
        assert_eq!(error.code, crate::ErrorCode::ValidationInvalidInput);
    }

    #[test]
    fn attributed_recommendations_preserve_the_originating_pack() {
        let places = vec![AttributedPackPlace {
            pack_id: "city-nashville".to_owned(),
            place: place("Frist Museum", "art_museum"),
        }];

        let recommendations = recommend_attributed_places(&places, &PersonaWeights::balanced(), 10);

        assert_eq!(recommendations[0].pack_id, "city-nashville");
    }
}
