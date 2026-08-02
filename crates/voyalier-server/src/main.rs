use std::{env, net::SocketAddr, path::PathBuf, sync::Arc};

use tracing::info;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("VOYALIER_LOG").unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let bind =
        env::var("VOYALIER_BIND").unwrap_or_else(|_| voyalier_server::DEFAULT_BIND.to_owned());
    let address: SocketAddr = bind.parse()?;
    let listener = tokio::net::TcpListener::bind(address).await?;
    let service = if env::var("VOYALIER_INTEGRATION_TEST").as_deref() == Ok("1") {
        // The live contract gate must not prompt or block on a developer's OS
        // keychain. Keep this seam test-only and require its disposable data
        // directory explicitly so it cannot silently become a production mode.
        let data_dir = env::var_os("VOYALIER_DATA_DIR").ok_or_else(|| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "VOYALIER_INTEGRATION_TEST requires VOYALIER_DATA_DIR",
            )
        })?;
        voyalier_app::AppService::open_path_with_deps(
            PathBuf::from(data_dir).join("voyalier.sqlite3"),
            Arc::new(voyalier_app::FakeFetcher::offline()),
            Arc::new(voyalier_app::MemorySecretStore::default()),
        )?
    } else {
        voyalier_app::AppService::open_default()?
    };

    info!(%address, "Voyalier local API ready");
    // The bound address, not a constant: the router derives its Host
    // allowlist from it, so a chosen port stays answerable.
    axum::serve(listener, voyalier_server::app(service, address))
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::error!(%error, "failed to install shutdown handler");
    }
}
