use std::{env, net::SocketAddr};

use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("VOYALIER_LOG").unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let bind = env::var("VOYALIER_BIND").unwrap_or_else(|_| "127.0.0.1:8787".to_owned());
    let address: SocketAddr = bind.parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    let service = voyalier_app::AppService::open_default()?;

    info!(%address, "Voyalier local API ready");
    axum::serve(listener, voyalier_server::app(service))
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::error!(%error, "failed to install shutdown handler");
    }
}
