# Solana Autonomous Trading System

Devnet-first monorepo for an autonomous Solana trading system. It runs a complete,
deterministic **paper/simulation** trading loop end to end: market data ingestion,
Solana connectivity abstraction, AI market-regime classification, a strategy engine,
portfolio and position accounting, deterministic risk controls, an append-only ledger,
and a monitoring API with an Android-friendly operations dashboard.

> **Risk warning:** Memecoin trading is adversarial. Honeypots, rug pulls, MEV,
> sandwiching, stale data, and transaction failures can cause total loss. This
> software is a research and simulation tool. It is **not** a profit guarantee and
> it does not submit real transactions in its default configuration.

## Safety defaults

- `TRADING_MODE=paper` is the default. Paper mode is offline and never signs or submits.
- `NETWORK=devnet` by default. Mainnet requires `MAINNET_TRADING_ENABLED=true`.
- Live mode additionally requires `NETWORK=mainnet`, the explicit
  `LIVE_TRADING_ACK=I_UNDERSTAND_LIVE_TRADING_IS_UNSAFE`, and a configured market feed.
- Even in live mode the execution router **rejects every order** until a reviewed signer
  and DEX router are integrated. Live execution is not implemented.
- The control API is disabled unless `ENABLE_CONTROL_API=true` and a `CONTROL_API_TOKEN`
  is set; it fails closed otherwise.
- Any missing, ambiguous, or invalid safety signal (RPC error, malformed market data,
  unparseable risk value) fails closed.
- No private keys, seed phrases, RPC secrets, or exchange credentials belong in this
  repository. `.env` is git-ignored; `.env.example` contains only non-secret defaults.

## Requirements

- Node.js 20+ and pnpm 9+
- Rust stable + Solana/Anchor CLI only for the on-chain program
- Docker Compose v2 (optional, PostgreSQL integration work only)

## Install and verify

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

## Run the paper trading system

```bash
# 1. Backend: paper trader + monitoring API on http://127.0.0.1:8787
pnpm --filter @solana-system/backend dev

# 2. Optional: independent killswitch monitor (separate process)
pnpm --filter @solana-system/killswitch dev

# 3. Dashboard: http://127.0.0.1:3000
pnpm --filter @solana-system/web dev
```

The backend starts the autonomous loop immediately using the deterministic simulated
market. State is written under `.local/` (`ledger.jsonl`, `trader-status.json`,
`killswitch-state.json`), which is git-ignored.

### Monitoring API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness, mode, network |
| GET | `/ready` | Readiness |
| GET | `/api/status` | Portfolio, positions, risk limits, pause state |
| GET | `/api/portfolio` | Cash, equity, realized PnL, positions |
| GET | `/api/markets` | Latest quotes |
| GET | `/api/events` | Recent trader events |
| GET | `/api/ledger` | Recent write-ahead intents/fills |
| POST | `/api/control/pause` | Pause (requires control token) |
| POST | `/api/control/resume` | Resume (requires control token) |
| POST | `/api/control/panic` | Pause + write durable killswitch lock (requires control token) |

## Architecture

```
programs/vault          Anchor vault program (SOL custody + policy state, milestone 2)
packages/shared         Config validation, safety gates, structured logging, contracts
packages/risk           Deterministic risk limits, sizing and daily-loss math
packages/ai             Conservative rule-based market-regime classifier
packages/engine         Market data, Solana client, safety, strategy, portfolio,
                        ledger, execution router, autonomous trader
apps/backend            Fastify orchestrator + monitoring/control API
apps/killswitch         Independent monitor: daily loss, stale heartbeat, panic
apps/web                Next.js responsive dashboard (Android-friendly web / PWA)
apps/tma                Telegram Mini App shell (read-only)
apps/mobile             Expo informational shell
```

### Paper pipeline

1. `MarketDataSource` produces quotes and price history (simulated by default).
2. `SolanaClient` yields token facts and sell simulation (paper substitute by default).
3. `verifyTokenSafety` applies anti-rug policy and fails closed.
4. `packages/ai` classifies the market regime.
5. `MomentumStrategy` proposes buy/sell/hold and a confidence weight.
6. `packages/risk` computes size and validates every limit.
7. A write-ahead intent is appended to the ledger before execution.
8. `PaperExecutionRouter` applies capped adverse slippage and fees; only paper fills.
9. `Portfolio` updates positions and realized PnL; the heartbeat is refreshed.

## Using it from Android

The practical deliverable is the **mobile-web / PWA dashboard** (`apps/web`), not a native
Android build: the system already ships a Next.js responsive UI, and a native app would
add a build toolchain without adding safety value. The Expo shell (`apps/mobile`) remains
informational and can be built to an APK later.

To use it from an Android phone on the same network:

```bash
# 1. Allow the backend to accept LAN connections
BACKEND_HOST=0.0.0.0 pnpm --filter @solana-system/backend dev

# 2. Point the dashboard at your computer's LAN IP and bind it
NEXT_PUBLIC_BACKEND_URL=http://192.168.1.20:8787 pnpm --filter @solana-system/web dev -- -H 0.0.0.0
```

Then open `http://192.168.1.20:3000` in Chrome on Android and choose "Add to Home screen"
to install it as a PWA. Replace `192.168.1.20` with your computer's address. Do not expose
the control API to untrusted networks.

## Killswitch

`apps/killswitch` runs independently of the trader. It reads the trader heartbeat and locks
state on: manual lock/panic, panic pause, repeated RPC failures, daily-loss limit breach, a
stale heartbeat, or a malformed heartbeat. Locks are durable and require an explicit
`--unlock`. It never reports a position as closed, because it does not execute trades.

```bash
pnpm --filter @solana-system/killswitch dev
pnpm --filter @solana-system/killswitch start -- --unlock
```

## Anchor vault program (milestone 2)

The Anchor program defines a per-authority PDA vault and its on-chain policy configuration:
initialization, SOL deposits, authority-only withdrawals that preserve rent exemption,
validated policy updates, and pause/unpause (executor may pause; only authority may unpause).
Slippage is capped at 1,000 bps (10%).

```bash
cargo test --manifest-path programs/vault/Cargo.toml
```

**Scope boundary:** the program stores daily-loss and position-count limits as policy
metadata, but does not yet execute DEX swaps, custody SPL tokens, or independently account
for portfolio-wide daily loss and open positions. Do not deploy it for real funds before
local-validator integration tests, a security review, and an explicit mainnet release gate.

## Not implemented (do not assume otherwise)

Real DEX/swap execution, SPL-token custody, signer/keystore and KMS integration, Telegram
bot authentication, push notifications, and iOS Live Activities. Live execution rejects all
orders. The Expo app is informational.

## Git

```bash
git remote add origin https://github.com/YOUR_GITHUB_USER/YOUR_REPOSITORY.git
git push -u origin main
```
