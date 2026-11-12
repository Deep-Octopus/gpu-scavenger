# Changelog

## 0.1.0 — MVP

The first distributable MVP includes:

- Linux/NVIDIA stateless task scheduling with durable SQLite WAL state;
- idempotent submission, lease epochs, multi-Agent dispatch, reconnect and
  requeue behavior;
- host Claim, release verification, degraded and quarantined health states;
- enrollment tokens, TLS/mTLS, certificate reload, and bounded reconnects;
- Web operator console and a macOS Tauri shell with remote Controller mode;
- reproducible Linux x86_64 runtime bundle with install and lifecycle scripts.

Acceptance evidence is recorded under [`docs/`](docs/).
