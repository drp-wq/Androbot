# Handoff: Solana Autonomous Trading System

## Purpose
Continue this project in a new ChatGPT conversation. This file captures the user-provided requirements, architectural review, decisions, current scaffold contents, verification status, and next milestone. It contains a concise engineering rationale and project context, not private hidden chain-of-thought.

## User's project goal
Build an autonomous Solana trading system with:
- Solana Anchor on-chain program
- Node.js backend with 24/7 DEX scanning, anti-rug verification, Jupiter/Jito execution, SQLite WAL initially and PostgreSQL later
- AI manager for market regime classification, risk sizing, position monitoring, and dynamic exits
- Next.js App Router dashboard with portfolio/PnL/telemetry/manual controls
- Telegram Mini App and bot with `/status`, `/pause`, `/panic`
- React Native/Expo client, push notifications, iOS Live Activities/Dynamic Island
- Independent multi-layer emergency killswitch

## Defaults from the user
- Devnet first; mainnet only behind explicit config.
- Bot hot wallet with hard-capped balance; sweep profits to cold wallet.
- No user private keys on backend.
- Never put raw private keys in `.env` or Git.
- Use encrypted local development keystore and KMS/HSM-style signer interface in production.
- pnpm workspaces + Turborepo.
- Workspace areas: `programs/`, `apps/backend`, `apps/web`, `apps/tma`, `apps/mobile`, `packages/shared`, `packages/risk`, `packages/ai`; the generated scaffold also includes `apps/killswitch`.
- Build order: monorepo/CI, Anchor program, backend core, killswitch, AI manager, web, Telegram/TMA, mobile/Live Activities.

## Non-negotiable safety requirements
- Hard limits in backend and on-chain program: max position size, max daily loss, max open positions, max slippage.
- AI may tighten limits only, never bypass or loosen them.
- Independent killswitch triggers: daily-loss cap, RPC failure streak, on-chain/database drift, manual panic.
- On trigger: halt scanner, cancel pending orders, attempt position exits, lock state until human unlock; never claim an exit succeeded until confirmed on-chain.
- Anchor account validation: owner, signer, PDA seeds/bump, `has_one`, constraints, checked math, rent exemption, safe account closure, typed errors, validated CPIs.
- Anti-rug checks: mint authority revoked, freeze authority revoked, LP burned/locked, top-holder concentration below threshold, sell simulation passes, minimum liquidity. Fail closed on RPC errors/ambiguous data.
- Execution: simulate before send, priority fee/slippage caps, optional Jito bundles, idempotent order IDs and retry-safe transaction tracking.
- Persistence: SQLite WAL, atomic transactions, write-ahead intent before each trade.
- Telegram: user-ID allowlist, server-side initData signature validation, rate limits, confirmation for destructive actions.
- Clearly state memecoin trading is adversarial and there is no profit guarantee.

## Architectural review already provided
1. Eight subsystems should be built in milestones with test gates.
2. On-chain program cannot independently verify off-chain market facts; use explicit trusted-input/state models.
3. Signer abstraction, encrypted dev keystore, production KMS/HSM adapter, strict authorization.
4. Token verification must include Token-2022 extensions, token program ownership, evidence provenance, liquidity and holder concentration—not just mint/freeze authority.
5. Durable idempotency, write-ahead intent, signature tracking, reconciliation after ambiguous RPC outcomes.
6. Simulate, cap priority fees, bounded retries; Jito is Solana-specific; Flashbots is primarily Ethereum.
7. Killswitch must be separate and durable; do not report positions closed until confirmed.
8. SQLite WAL + single-writer discipline first; PostgreSQL transactional locking before horizontal scaling.
9. AI is advisory; deterministic risk controls can reject any trade.
10. Validate Telegram initData on server and authorize every privileged API; do not trust client-reported PnL/wallet/permissions.
11. Push notifications and Live Activities are best-effort UI, not safety infrastructure.
12. Pin tool versions, strict TypeScript, Rust checks, dependency scans, lockfile.
13. Add health checks, bounded retries, audit logs, secret redaction, and explicit mainnet approval gate.
14. This assistant can generate files/commands but cannot directly operate the user's local VS Code or GitHub without an authorized integration.
15. Start with monorepo, shared contracts, risk primitives, CI; no real-fund execution until security controls are validated.

## Generated milestone 1 scaffold
The ZIP includes a generated monorepo with:
- root pnpm workspace and Turborepo configuration
- strict TypeScript base config and ESLint flat config
- GitHub Actions CI workflow
- Docker Compose PostgreSQL service for local integration work
- `.env.example` and `.gitignore` excluding `.env`, key files, keystores, wallets, DB files
- `Anchor.toml` and minimal Rust Anchor crate
- `packages/shared`: Zod runtime config, mainnet gate, typed signer interface, audit event and trade intent schema
- `packages/risk`: deterministic risk limit validation and tests
- `packages/ai`: conservative rule-based market regime classifier and tests
- `apps/backend`: Fastify health/readiness server; explicitly no trading or signing
- `apps/killswitch`: monitor-only state-file process; not a full operational killswitch
- `apps/web`: Next.js read-only dashboard shell
- `apps/tma`: Next.js read-only Mini App shell
- `apps/mobile`: Expo informational shell
- tests for shared config, risk rules, AI regime classifier, backend health, and killswitch state initialization

## Current coding state (2026-10-16)
- Milestone 2 coding has started in `programs/vault/src/lib.rs`.
- The Anchor program now defines a per-authority PDA config, initialization, SOL deposits, authority-only withdrawals preserving the rent-exempt minimum, validated risk-policy updates, and pause/unpause authorization (executor can pause; only authority can unpause).
- Risk policy validation rejects zero position/daily-loss/open-position limits and slippage outside 1–1,000 basis points. The policy values for daily loss/open positions are stored as configuration only; the program does not yet independently account for trades or positions.
- Seven Rust unit tests cover valid policy and invalid limits. They have **not** been executed because this environment has no `cargo` or Anchor CLI installed, and package-registry network access failed.
- `Anchor.toml` test script now points at `cargo test --manifest-path programs/vault/Cargo.toml`.
- README now documents the implementation and its scope boundaries.

## Important current limitations
- This is not a complete trading vault yet: no DEX CPI or swap instruction, no SPL-token custody, and no on-chain portfolio/daily-loss/open-position accounting. `paused` is recorded state, not yet an execution gate because no swap instruction exists.
- No DEX scanner, anti-rug verifier, transaction execution, signer implementation, SQLite persistence, real killswitch actions, Telegram bot/auth, wallet connection, push, or Live Activities are implemented yet.
- Do not present this scaffold as production-ready or as capable of trading.
- No DEX scanner, anti-rug verifier, transaction execution, signer implementation, SQLite persistence, real killswitch actions, Telegram bot/auth, wallet connection, push, or Live Activities are implemented yet.
- Do not present this scaffold as production-ready or as capable of trading.
- Full package installation/build/test was not run in the prior environment because package registry access was unavailable. Run all checks locally and fix any failures before proceeding.
- The project archive was generated at `/mnt/data/solana-autonomous-trading-milestone-1.zip` before this handoff file was added. This new handoff archive includes the handoff document.

## First commands in the new environment
```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cargo check --manifest-path programs/vault/Cargo.toml
```

If `pnpm install` fails due to version/platform issues, fix and record the actual environment/version details rather than assuming tests passed.

## Suggested next steps
1. Get this folder into the intended GitHub repository (the connected GitHub account returned zero accessible repositories during the latest check; no repo was modified remotely).
2. In an environment with Rust/Cargo and Anchor installed, run `cargo fmt --check` and `cargo test --manifest-path programs/vault/Cargo.toml`; fix any actual compiler/test errors.
3. Add local-validator integration tests for initialize, PDA/account substitution, authority/executor authorization, pause/unpause, deposit, rent reserve, and withdrawal edge cases.
4. Threat-model the custody design before adding any DEX CPI. Do not claim daily loss/open positions are on-chain enforced until position state and trade execution are actually accounted for in the program.
5. Keep mainnet and real-fund execution disabled until review and explicit approval.

## GitHub workflow
The README contains commands to initialize Git, commit, set a GitHub remote, and push. The user must replace the example remote URL and authenticate with GitHub. Do not include secrets or keypair files in commits.

## Status update: audit hardening (branch `feat/safety-hardening`)

An end-to-end read-only audit found that the paper/simulation system is already
implemented and verified, not a bare milestone-2 scaffold. The following hardening was
added on branch `feat/safety-hardening` (branched from `feat/safety-completion`):

1. **Execution-request validation at the router boundary** — `validateExecutionRequest`
   in `packages/engine/src/validation.ts`, enforced in `PaperExecutionRouter` (fail closed).
2. **Killswitch path consistency** — the monitor's default state/heartbeat paths now derive
   from `STATE_DIR`, matching the backend instead of hardcoding `.local/...`.
3. **`.env` loading** — `loadEnvFileIfPresent()` (uses `process.loadEnvFile`, real env wins)
   called at the backend and killswitch entrypoints so `cp .env.example .env` works.
4. **Offline secret scanner** — `scripts/scan-secrets.mjs` + `pnpm security:scan`, wired
   into CI, replacing the narrow `.env`-only check.
5. **Android deployment path** — PWA icon in the web manifest, `apps/mobile/eas.json`
   profiles, and documented native build (unverified).
6. **Backend integration test** — real HTTP surface with the autonomous loop: panic is
   token-gated, writes a durable lock, halts reported trading, `resume()` cannot clear it,
   and only an operator unlock re-enables.

Verified in this environment: `pnpm lint` 9/9, `pnpm typecheck` 13/13, `pnpm test` 71 pass
(engine 32, shared 19, backend 12, killswitch 8), `pnpm build` 9/9, `pnpm security:scan`
pass. Rust/Anchor tests remain **unverified** (no `cargo`/Anchor CLI here). Nothing was
pushed.
