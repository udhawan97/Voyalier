use std::{
    env,
    fs::{File, OpenOptions},
    io::{Read, Write},
    net::SocketAddr,
    path::PathBuf,
    sync::Arc,
};

use tracing::info;
use tracing_subscriber::EnvFilter;

const INTEGRATION_KYOTO_PACK: &str = r#"{
  "packId": "jp-kyoto",
  "places": [
    { "name": "Nishiki Market", "category": "restaurant", "lat": 35.005, "lon": 135.764 },
    { "name": "Kyoto Station Gallery", "category": "art_museum", "lat": 34.9858, "lon": 135.7588 },
    { "name": "Maruyama Park", "category": "public_park", "lat": 35.0037, "lon": 135.7808 }
  ],
  "articles": []
}"#;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_env("VOYALIER_LOG").unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    // One maintenance subcommand, and it deliberately never opens a database or
    // binds a port: the accounts it removes belong to workspaces whose database
    // is gone, so there is nothing to open (ADR-0017).
    let argument = env::args().nth(1);
    if let Some(command) = argument.as_deref() {
        return match command {
            "vault-prune" => run_vault_prune(env::args().any(|arg| arg == "--apply")),
            other => Err(format!(
                "unknown command {other:?}; the only one is `vault-prune [--apply]`"
            )
            .into()),
        };
    }

    let integration = env::var("VOYALIER_INTEGRATION_TEST").as_deref() == Ok("1");
    let bearer = launch_bearer(integration)?;
    let bind =
        env::var("VOYALIER_BIND").unwrap_or_else(|_| voyalier_server::DEFAULT_BIND.to_owned());
    let requested: SocketAddr = bind.parse()?;
    let (listener, address) = bind_loopback(requested).await?;
    let service = if integration {
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
            Arc::new(
                voyalier_app::FakeFetcher::offline().route("jp-kyoto.json", INTEGRATION_KYOTO_PACK),
            ),
            Arc::new(voyalier_app::MemorySecretStore::default()),
        )?
    } else {
        voyalier_app::AppService::open_default()?
    };

    publish_source_address(address, integration)?;
    info!(%address, "Voyalier local API ready");
    // The bound address, not a constant: the router derives its Host
    // allowlist from it, so a chosen port stays answerable.
    axum::serve(listener, voyalier_server::app(service, address, bearer))
        .with_graceful_shutdown(shutdown_signal())
        .await?;

    Ok(())
}

fn launch_bearer(integration: bool) -> Result<String, Box<dyn std::error::Error>> {
    let bearer = if integration {
        env::var("VOYALIER_TEST_API_TOKEN").map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "integration mode requires VOYALIER_TEST_API_TOKEN",
            )
        })?
    } else {
        read_anonymous_pipe("VOYALIER_CREDENTIAL_FD")?
    };
    if bearer.len() != 64 || !bearer.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "launch credential must be 32 bytes encoded as hexadecimal",
        )
        .into());
    }
    Ok(bearer)
}

#[cfg(unix)]
fn read_anonymous_pipe(variable: &str) -> Result<String, Box<dyn std::error::Error>> {
    let descriptor: u32 = env::var(variable)?.parse()?;
    let mut input = File::open(format!("/dev/fd/{descriptor}"))?.take(129);
    let mut value = String::new();
    input.read_to_string(&mut value)?;
    if value.len() > 128 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "launch credential exceeded its maximum size",
        )
        .into());
    }
    Ok(value.trim_end().to_owned())
}

#[cfg(not(unix))]
fn read_anonymous_pipe(_variable: &str) -> Result<String, Box<dyn std::error::Error>> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "the managed source-browser launcher requires anonymous pipes",
    )
    .into())
}

fn publish_source_address(
    address: SocketAddr,
    integration: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    if integration {
        return Ok(());
    }
    #[cfg(unix)]
    {
        let descriptor: u32 = env::var("VOYALIER_BOOTSTRAP_FD")?.parse()?;
        let mut output = OpenOptions::new()
            .write(true)
            .open(format!("/dev/fd/{descriptor}"))?;
        writeln!(output, "http://{address}")?;
        output.flush()?;
        Ok(())
    }
    #[cfg(not(unix))]
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "the managed source-browser launcher requires anonymous pipes",
    )
    .into())
}

/// Remove the keychain accounts of workspaces whose database no longer exists.
///
/// ADR-0017 gives every data directory its own vault key and copies the old one
/// in so nothing becomes unreadable. Copying is why this exists: the copies
/// outlive the workspaces, `SecretStore` cannot enumerate, and so a traveler who
/// has tried a few data directories is carrying a key apiece with no way to see
/// or remove them.
///
/// Reports by default and removes only with `--apply`, because the failure this
/// could cause — deleting a key a living workspace still needs — is the one
/// ADR-0017 exists to prevent.
fn run_vault_prune(apply: bool) -> Result<(), Box<dyn std::error::Error>> {
    let mode = if apply {
        voyalier_app::PruneMode::Delete
    } else {
        voyalier_app::PruneMode::DryRun
    };
    let report = voyalier_app::prune_default_vault_accounts(mode)?;

    for workspace in &report.kept {
        println!(
            "keeping  {} ({} account(s))",
            workspace.database,
            workspace.accounts.len()
        );
    }
    if report.removed.is_empty() {
        println!("Nothing to prune.");
    }
    for workspace in &report.removed {
        let verb = if apply { "removed" } else { "would remove" };
        println!("{verb} {}", workspace.database);
        for account in &workspace.accounts {
            println!("    {account}");
        }
    }
    if !apply && !report.removed.is_empty() {
        println!("\nNothing was changed. Re-run with --apply to remove them.");
    }
    // Said plainly rather than left to be discovered: the registry only knows
    // about workspaces opened since it existed, so an older orphan is invisible
    // here and has to be removed by hand.
    println!(
        "\nOnly workspaces opened since this version can be listed — the OS keychain\ncannot be enumerated, so anything older is invisible to this command."
    );
    Ok(())
}

/// Bind the development API only on loopback and return the address the OS
/// actually chose. The latter is load-bearing when `VOYALIER_BIND` asks for
/// port zero: the router's Host allowlist must contain the assigned port, not
/// the requested zero.
async fn bind_loopback(
    requested: SocketAddr,
) -> std::io::Result<(tokio::net::TcpListener, SocketAddr)> {
    if !requested.ip().is_loopback() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "VOYALIER_BIND must use a loopback address (127.0.0.1 or ::1)",
        ));
    }
    let listener = tokio::net::TcpListener::bind(requested).await?;
    let address = listener.local_addr()?;
    Ok((listener, address))
}

async fn shutdown_signal() {
    if let Err(error) = tokio::signal::ctrl_c().await {
        tracing::error!(%error, "failed to install shutdown handler");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_zero_port_uses_the_address_the_listener_actually_bound() {
        let requested: SocketAddr = "127.0.0.1:0".parse().expect("address");
        let (_listener, actual) = bind_loopback(requested).await.expect("bind");

        assert!(actual.ip().is_loopback());
        assert_ne!(actual.port(), 0);
    }

    #[tokio::test]
    async fn a_non_loopback_bind_is_rejected_before_listening() {
        let requested: SocketAddr = "0.0.0.0:8787".parse().expect("address");
        let error = bind_loopback(requested).await.expect_err("reject");

        assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
        assert!(error.to_string().contains("loopback"));
    }
}
