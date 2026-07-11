//! Emit the city-pack catalog as JSON on stdout.
//!
//! The CI pack-build pipeline consumes this so the list of packs (ids, bounding
//! boxes, Wikivoyage articles, and per-layer licenses) has exactly one source of
//! truth — this crate — and never drifts from the running app.
//!
//! Run with: `cargo run -p voyalier-core --example pack_catalog`

fn main() {
    let catalog = voyalier_core::pack_catalog();
    let json = serde_json::to_string_pretty(&catalog).expect("serialize catalog");
    println!("{json}");
}
