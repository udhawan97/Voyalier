fn start_local_api() {
    tauri::async_runtime::spawn(async {
        let address = "127.0.0.1:8787";
        match tokio::net::TcpListener::bind(address).await {
            Ok(listener) => {
                if let Err(error) = axum::serve(listener, voyalier_server::app()).await {
                    tracing::error!(%error, "Voyalier local API stopped unexpectedly");
                }
            }
            Err(error) => {
                tracing::error!(%error, %address, "Voyalier could not bind its local API");
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_| {
            start_local_api();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Voyalier");
}
