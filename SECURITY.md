# Security policy

## Supported release

Security fixes target the latest release and the default branch. This project
is an MVP; do not expose the Controller or Web console to an untrusted network
without TLS/mTLS, enrollment controls, and an access boundary appropriate for
your environment.

## Reporting a vulnerability

Please do not open a public issue for an undisclosed vulnerability. Contact the
maintainer privately through the GitHub repository's security advisory flow and
include:

- the affected commit or release;
- a minimal reproduction or proof of concept;
- the host, protocol, or package boundary involved;
- the impact and any known mitigation.

Do not include private keys, enrollment tokens, customer data, or unrelated
workload logs in a report.

## Operational safety

The Agent is designed to manage only scopes and processes it created. A report
that demonstrates interference with unrelated host work is treated as a
high-priority ownership-boundary issue.
