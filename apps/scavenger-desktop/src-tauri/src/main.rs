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
            if let Some(remote_url) = remote_console_url()? {
                build_window(app, remote_url)?;
                return Ok(());
            }

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

            build_window(app, format!("http://{address}").parse()?)?;
            Ok(())
        })
        .run(tauri::generate_context!())?;
    Ok(())
}

fn remote_console_url() -> Result<Option<tauri::Url>, Box<dyn Error>> {
    let mut args = std::env::args().skip(1);
    while let Some(argument) = args.next() {
        if argument != "--controller-url" {
            continue;
        }
        let value = args
            .next()
            .ok_or_else(|| std::io::Error::other("--controller-url requires a URL"))?;
        return Ok(Some(value.parse()?));
    }
    Ok(None)
}

fn build_window(app: &mut tauri::App, url: tauri::Url) -> Result<(), Box<dyn Error>> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
        .title("GPU Scavenger")
        .inner_size(1440.0, 960.0)
        .min_inner_size(960.0, 640.0)
        .resizable(true)
        .build()?;
    Ok(())
}
