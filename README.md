# Solana Autonomous Trading System

Devnet-first monorepo for a Solana trading system. This milestone establishes workspace tooling, shared contracts, deterministic risk primitives, a small backend health service, a separate safety daemon skeleton, frontend shells, and CI.

> **Risk warning:** Memecoin trading is adversarial. Honeypots, rug pulls, MEV, sandwiching, stale data, and transaction failures can cause total loss. This software is not a profit guarantee. Milestone 1 does not execute trades or manage real funds.

## Safety defaults

- `NETWORK=devnet`; mainnet requires explicit configuration and a future reviewed gate.
- No private keys in environment files, source, logs, or Git.
- Backend and UI are not authorized to trade in this milestone.
- SQLite WAL is the intended initial persistence mode. PostgreSQL is provided for integration testing and later services.
- Any unavailable/ambiguous safety signal must fail closed.

## Requirements

- Node.js 20+
- pnpm 9+
- Rust stable
- Solana CLI and Anchor CLI for later on-chain milestones
- Docker Compose v2 (optional, for PostgreSQL)

## Install

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
cp .env.example .env
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Development

```bash
pnpm --filter @solana-system/backend dev
pnpm --filter @solana-system/killswitch dev
pnpm --filter @solana-system/web dev
pnpm --filter @solana-system/tma dev
pnpm --filter @solana-system/mobile start
```

The backend health endpoint defaults to `http://127.0.0.1:8787/health`. The killswitch process is deliberately non-trading in this milestone; it monitors a local lock-state file and reports state. It does not sign transactions or close positions.

## PostgreSQL (optional)

```bash
docker compose up -d postgres
docker compose ps
docker compose logs -f postgres
```

SQLite WAL support and application persistence arrive in milestone 3. Do not interpret the presence of PostgreSQL in Compose as production-ready database operations.

## Devnet setup for later Anchor milestone

```bash
solana config set --url devnet
solana balance
anchor --version
```

Only create a development keypair if you understand where the file is stored. Never commit keypair files.

## Git

```bash
git init
git add .
git commit -m "chore: bootstrap monorepo and CI"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USER/YOUR_REPOSITORY.git
git push -u origin main
```

Create the GitHub repository first. Replace the remote URL with your own repository. The push command requires your own GitHub authentication.

## Milestone 1 acceptance

- `pnpm install` completes and creates `pnpm-lock.yaml`.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.
- Backend health endpoint returns JSON and no secrets.
- The safety daemon starts independently and can read its lock-state file.
- CI runs on pull requests and pushes.
- No private key or `.env` file is tracked.

## Explicit limitations

The Anchor vault, DEX scanner, anti-rug verifier, execution router, trading AI, Telegram bot, and mobile Live Activities are not implemented in milestone 1. They are subsequent milestones, not silently simulated by this scaffold.

## Milestone 2 — Anchor vault program (in progress)

The initial Anchor program now defines a per-authority PDA vault and its on-chain policy configuration. It supports initialization, SOL deposits, authority-only withdrawals that preserve rent exemption, policy updates, and a pause state that the authority or configured executor can set to paused. Only the authority can unpause. Risk-policy inputs are validated and slippage is capped at 1,000 basis points (10%).

Run the program's Rust unit tests with:

```bash
cargo test --manifest-path programs/vault/Cargo.toml
```

**Important scope boundary:** this milestone does not yet execute DEX swaps, custody SPL tokens, or independently measure portfolio-wide daily loss/open positions. Those limits are stored as policy metadata but cannot be truthfully described as fully enforced by this program until trade execution and position accounting are implemented on-chain. The `paused` flag is currently a state control; no swap instruction exists yet. Do not deploy this program for real funds before local-validator integration tests, security review, and an explicit mainnet release gate.
