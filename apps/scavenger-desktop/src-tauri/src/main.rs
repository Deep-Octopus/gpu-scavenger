use std::error::Error;
use std::net::TcpListener;
use std::time::Duration;

use scavenger_controller::{web, ControllerService, TaskStore};
use tauri::Manager;
use tauri::WebviewUrl;
use tauri::WebviewWindowBuilder;

fn main() {
    if let Err(error) = run() {
        eprintln!("scavenger desktop error: {error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Box<dyn Error + Send + Sync>> {
    tauri::Builder::default()
        .setup(|app| {
            let database = app.path().app_data_dir()?.join("controller.sqlite3");
            let service = ControllerService::new(TaskStore::open(database)?);
            tauri::async_runtime::spawn(service.clone().run_scheduler());

            let std_listener = TcpListener::bind("127.0.0.1:0")?;
            std_listener.set_nonblocking(true)?;
            let address = std_listener.local_addr()?;
            let (ready_sender, ready_receiver) =
                std::sync::mpsc::sync_channel::<Result<(), String>>(0);
            tauri::async_runtime::spawn(async move {
                let listener = match tokio::net::TcpListener::from_std(std_listener) {
                    Ok(listener) => listener,
                    Err(error) => {
                        let _ = ready_sender.send(Err(error.to_string()));
                        return;
                    }
                };
                let _ = ready_sender.send(Ok(()));
                if let Err(error) = web::serve_with_listener(service, listener).await {
                    eprintln!("desktop web console error: {error}");
                }
            });
            let ready = ready_receiver
                .recv_timeout(Duration::from_secs(2))
                .map_err(|error| format!("web console did not start: {error}"))?;
            ready.map_err(std::io::Error::other)?;

            let url = format!("http://{address}").parse()?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("GPU Scavenger")
                .inner_size(1440.0, 960.0)
                .min_inner_size(960.0, 640.0)
                .resizable(true)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())?;
    Ok(())
}
