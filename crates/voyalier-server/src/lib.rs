use axum::{
    Json, Router,
    http::{HeaderValue, Method, header},
    routing::get,
};
use serde::Serialize;
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use voyalier_core::IntelligenceMode;

#[derive(Debug, Serialize)]
struct HealthResponse {
    status: &'static str,
    service: &'static str,
    version: &'static str,
    intelligence_mode: IntelligenceMode,
}

#[derive(Debug, Serialize)]
struct MetaResponse {
    name: &'static str,
    tagline: &'static str,
    api_version: &'static str,
}

pub fn app() -> Router {
    let cors = CorsLayer::new()
        .allow_origin([
            HeaderValue::from_static("http://127.0.0.1:5173"),
            HeaderValue::from_static("http://localhost:5173"),
            HeaderValue::from_static("tauri://localhost"),
            HeaderValue::from_static("http://tauri.localhost"),
        ])
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION]);

    Router::new()
        .route("/api/health", get(health))
        .route("/api/v1/meta", get(meta))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        service: "voyalier-server",
        version: env!("CARGO_PKG_VERSION"),
        intelligence_mode: IntelligenceMode::Local,
    })
}

async fn meta() -> Json<MetaResponse> {
    Json(MetaResponse {
        name: "Voyalier",
        tagline: "From scattered plans to one clear journey.",
        api_version: "v1",
    })
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, http::Request};
    use serde_json::Value;
    use tower::ServiceExt;

    use super::*;

    #[tokio::test]
    async fn health_endpoint_is_explicitly_local() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("response");

        assert_eq!(response.status(), 200);

        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("body");
        let json: Value = serde_json::from_slice(&body).expect("json");
        assert_eq!(json["status"], "ok");
        assert_eq!(json["intelligence_mode"], "local");
    }
}
