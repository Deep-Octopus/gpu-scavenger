use std::net::SocketAddr;
use std::path::PathBuf;

use clap::{Parser, Subcommand, ValueEnum};
use scavenger_controller::web;
use scavenger_controller::{
    ControllerService, EnqueueOptions, EnqueueTask, TaskStore, TlsServerConfig,
};

#[derive(Debug, Parser)]
#[command(name = "scavenger-controller")]
#[command(about = "Small durable controller for GPU-Scavenger MVP")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum TaskPolicyArg {
    Stateless,
    Checkpointed,
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
        #[arg(long)]
        enrollment_token_file: Option<PathBuf>,
        #[arg(long)]
        web_listen: Option<SocketAddr>,
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
        #[arg(long, value_enum, default_value_t = TaskPolicyArg::Stateless)]
        policy: TaskPolicyArg,
        #[arg(long)]
        checkpoint_path: Option<String>,
        #[arg(long, default_value_t = 30_000)]
        checkpoint_deadline_ms: u64,
    },
    List {
        #[arg(long, default_value = "/tmp/gpu-scavenger/controller.sqlite3")]
        db: PathBuf,
    },
    Status {
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
            enrollment_token_file,
            web_listen,
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
            let service =
                ControllerService::new(store).with_enrollment_token_file(enrollment_token_file);
            if let Some(web_listen) = web_listen {
                let web_service = service.clone();
                tokio::spawn(async move {
                    if let Err(error) = web::serve(web_service, web_listen).await {
                        eprintln!("web console error: {error}");
                    }
                });
            }
            service.serve(listen, tls).await?;
        }
        Command::Enqueue {
            db,
            task_id,
            device_uuid,
            program,
            arg,
            workdir,
            output_path,
            policy,
            checkpoint_path,
            checkpoint_deadline_ms,
        } => {
            let store = TaskStore::open(db)?;
            let queued_id = task_id.clone();
            if matches!(policy, TaskPolicyArg::Stateless) {
                store.enqueue(
                    &task_id,
                    &device_uuid,
                    &program,
                    &arg,
                    workdir.as_deref(),
                    output_path.as_deref(),
                )?;
            } else {
                store.enqueue_with_policy(EnqueueTask {
                    task_id,
                    device_uuid,
                    program,
                    args: arg,
                    workdir,
                    output_path,
                    options: EnqueueOptions {
                        policy: 1,
                        checkpoint_path,
                        checkpoint_deadline_ms,
                    },
                })?;
            }
            println!("queued {queued_id}");
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
        Command::Status { db } => {
            let store = TaskStore::open(db)?;
            let service = ControllerService::new(store);
            let snapshot = service.snapshot().map_err(std::io::Error::other)?;
            println!("{}", serde_json::to_string_pretty(&snapshot)?);
        }
    }
    Ok(())
}
