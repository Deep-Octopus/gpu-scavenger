# Engineering Constitution

## 1. Scope and change discipline

- Keep the product boundary explicit. Do not add speculative features, flags, configuration, compatibility layers, or abstractions without a current user-facing need.
- Prefer small, reversible changes that can be reviewed and validated independently.
- Keep control flow in domain code and keep I/O, networking, process management, and platform calls at the edges.
- Add an abstraction only when it removes a real dependency boundary or makes a required behavior easier to verify. Prefer concrete types and functions for local logic.
- Every bounded resource must have an explicit limit: channels, queues, retries, request bodies, artifact sizes, and timeouts. Never introduce an unbounded channel or queue.

## 2. Reliability and safety

- Long-running services must propagate errors explicitly and fail closed when ownership, identity, authorization, or resource state is uncertain.
- Do not use `.unwrap()`, `.expect()`, `panic!()`, or equivalent process-wide termination in daemon and service paths. Convert failures into typed errors or an explicit state transition.
- Never identify or stop external work by PID alone, process name, GPU index, memory usage, or other ambiguous signals. Use stable identity plus an owned boundary such as a cgroup, container, or job object.
- External systems are shared by default. Use least privilege, narrow paths, reversible operations, and read-only inspection before mutation. Do not perform global cleanup, driver resets, service reloads, or process termination without explicit ownership.
- Secrets, private keys, tokens, and generated credentials must not enter source control, logs, fixtures, screenshots, or public artifacts.

## 3. TigerStyle implementation rules

- Keep functions short enough to review in one pass; use guard clauses and early returns to limit nesting and branching.
- Keep source files focused and split modules before they become difficult to reason about. Avoid large generated or hand-written blobs in core logic.
- Name states, events, identities, and ownership boundaries precisely. Do not hide state transitions in side effects or implicit defaults.
- Make retries bounded and observable. Include a reason and relevant identity in operational errors without leaking secrets.
- Avoid shell-string command construction. Pass executables, arguments, environment values, and working directories as structured data.

## 4. Testing and validation

- Test behavior that protects correctness, safety, data integrity, or recovery. Do not add tests for trivial getters/setters, empty mocks, configuration plumbing, or visual snapshots unless they catch a real regression.
- Prefer focused table-driven tests for pure state transitions and identity/ownership algorithms.
- Use integration or end-to-end checks only where a unit test cannot prove the boundary, such as process cleanup, protocol interoperability, persistence, or release verification.
- Keep tests deterministic, bounded, and independent of other users, machines, or network services. Never treat a mock result as evidence about a real external resource.
- Run the repository's required format, lint, and test commands before committing. If a check is unavailable, record the reason and the remaining risk.

## 5. UI and user-facing surfaces

- Treat user-facing interfaces as product work: define the audience, information hierarchy, states, accessibility, responsive behavior, and error recovery before implementation.
- Use the designated design skill for visual work. Avoid generic template styling, decorative motion, inaccessible contrast, and fake data that could be mistaken for live state.
- Every interactive surface needs loading, empty, error, disabled, and reduced-motion behavior where applicable.

## 6. Git and delivery

- Keep one independently reviewable feature or behavior change per commit. Use a short imperative commit subject and explain material trade-offs in the body when needed.
- Do not mix formatting churn, generated build output, credentials, unrelated refactors, or abandoned experiments into a feature commit.
- Before a commit, inspect the diff, verify the changed files, run the relevant checks, and record remote or platform evidence separately from local unit-test evidence.
- Documentation must distinguish implemented behavior, verified behavior, assumptions, and known limitations.
