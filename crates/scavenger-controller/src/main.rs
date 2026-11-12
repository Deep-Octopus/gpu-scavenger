mod server;
mod store;

use std::net::SocketAddr;
use std::path::PathBuf;

use clap::{Parser, Subcommand};
use server::{ControllerService, TlsServerConfig};
use store::TaskStore;

#[derive(Debug, Parser)]
#[command(name = "scavenger-controller")]
#[command(about = "Small durable controller for GPU-Scavenger MVP")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Serve {
        #[arg(long, default_value = "/tmp/gpu-scavenger/controller.sqlite3")]
        db: PathBuf,
        #[arg(long, default_value = "127.0.0.1:50051")]
        listen: SocketAddr,
        #[arg(long)]
        tls_cert: Option<PathBuf>,
        #[arg(long)]
        tls_key: Option<PathBuf>,
        #[arg(long)]
        tls_client_ca: Option<PathBuf>,
    },
    Enqueue {
        #[arg(long, default_value = "/tmp/gpu-scavenger/controller.sqlite3")]
        db: PathBuf,
        #[arg(long)]
        task_id: String,
        #[arg(long)]
        device_uuid: String,
        #[arg(long)]
        program: String,
        #[arg(long)]
        arg: Vec<String>,
        #[arg(long)]
        workdir: Option<String>,
        #[arg(long)]
        output_path: Option<String>,
    },
    List {
        #[arg(long, default_value = "/tmp/gpu-scavenger/controller.sqlite3")]
        db: PathBuf,
    },
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let cli = Cli::parse();
    match cli.command {
        Command::Serve {
            db,
            listen,
            tls_cert,
            tls_key,
            tls_client_ca,
        } => {
            if tls_cert.is_some() != tls_key.is_some() {
                return Err("--tls-cert and --tls-key must be provided together".into());
            }
            if tls_cert.is_none() && tls_client_ca.is_some() {
                return Err("--tls-client-ca requires --tls-cert and --tls-key".into());
            }
            let store = TaskStore::open(db)?;
            let tls = tls_cert
                .zip(tls_key)
                .map(|(certificate, private_key)| TlsServerConfig {
                    certificate,
                    private_key,
                    client_ca: tls_client_ca,
                });
            ControllerService::new(store).serve(listen, tls).await?;
        }
        Command::Enqueue {
            db,
            task_id,
            device_uuid,
            program,
            arg,
            workdir,
            output_path,
        } => {
            let store = TaskStore::open(db)?;
            store.enqueue(
                &task_id,
                &device_uuid,
                &program,
                &arg,
                workdir.as_deref(),
                output_path.as_deref(),
            )?;
            println!("queued {task_id}");
        }
        Command::List { db } => {
            let store = TaskStore::open(db)?;
            for task in store.list()? {
                println!(
                    "{} {} {} {}",
                    task.task_id, task.status, task.device_uuid, task.program
                );
            }
        }
    }
    Ok(())
}
