use std::path::PathBuf;
use std::time::Duration;

use clap::{Parser, Subcommand};
use scavenger_agent::agent::{self, AgentConfig, AgentTlsConfig};
use scavenger_agent::claim::ClaimFile;
use scavenger_agent::probe::NvmlProbe;
use scavenger_core::GpuProbe;

#[derive(Debug, Parser)]
#[command(name = "scavenger-agent")]
#[command(about = "Host-first Linux NVIDIA worker agent")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Run {
        #[arg(long, default_value = "http://127.0.0.1:50051")]
        controller: String,
        #[arg(long)]
        agent_id: Option<String>,
        #[arg(long, default_value = "/tmp/gpu-scavenger/claim")]
        claim_path: PathBuf,
        #[arg(long, default_value_t = 250)]
        poll_ms: u64,
        #[arg(long)]
        tls_ca: Option<PathBuf>,
        #[arg(long)]
        tls_cert: Option<PathBuf>,
        #[arg(long)]
        tls_key: Option<PathBuf>,
        #[arg(long, default_value = "localhost")]
        tls_domain: String,
        #[arg(long)]
        enrollment_token_file: Option<PathBuf>,
    },
    Probe,
    Claim {
        #[arg(long, default_value = "/tmp/gpu-scavenger/claim")]
        path: PathBuf,
        #[arg(long, default_value = "operator claim")]
        reason: String,
    },
    Unclaim {
        #[arg(long, default_value = "/tmp/gpu-scavenger/claim")]
        path: PathBuf,
    },
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    match cli.command {
        Command::Run {
            controller,
            agent_id,
            claim_path,
            poll_ms,
            tls_ca,
            tls_cert,
            tls_key,
            tls_domain,
            enrollment_token_file,
        } => {
            if tls_cert.is_some() != tls_key.is_some() {
                return Err("--tls-cert and --tls-key must be provided together".into());
            }
            if tls_ca.is_none() && (tls_cert.is_some() || tls_key.is_some()) {
                return Err("--tls-ca is required when client TLS is enabled".into());
            }
            let id = agent_id.unwrap_or_else(default_agent_id);
            agent::run(AgentConfig {
                controller,
                agent_id: id,
                claim_path: ClaimFile::new(claim_path),
                poll_interval: Duration::from_millis(poll_ms.max(50)),
                tls: tls_ca.map(|ca| AgentTlsConfig {
                    ca,
                    certificate: tls_cert,
                    private_key: tls_key,
                    domain: tls_domain,
                }),
                enrollment_token: enrollment_token_file,
            })
            .await?;
        }
        Command::Probe => probe()?,
        Command::Claim { path, reason } => ClaimFile::new(path).activate(&reason)?,
        Command::Unclaim { path } => ClaimFile::new(path).deactivate()?,
    }
    Ok(())
}

fn probe() -> Result<(), Box<dyn std::error::Error>> {
    let probe = NvmlProbe::new()?;
    for device in probe.inventory()? {
        let snapshot = probe.query_snapshot(&device)?;
        println!(
            "{} free={} total={} util={} processes={}",
            snapshot.device.uuid,
            snapshot.free_memory_bytes,
            snapshot.total_memory_bytes,
            snapshot.utilization_gpu_percent,
            snapshot.processes.len()
        );
        for process in snapshot.processes {
            println!(
                "  pid={} kind={:?} memory={} cgroup={:?}",
                process.identity.pid,
                process.kind,
                process.used_memory_bytes,
                process.identity.cgroup_id
            );
        }
    }
    Ok(())
}

fn default_agent_id() -> String {
    std::fs::read_to_string("/etc/hostname")
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "scavenger-agent".to_string())
}
