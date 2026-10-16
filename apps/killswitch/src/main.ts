import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface KillSwitchState {
  readonly locked: boolean;
  readonly reason: string | null;
  readonly changedAt: string;
}

export interface Heartbeat {
  readonly paused: boolean;
  readonly pauseReason: string | null;
  readonly dailyLossLamports: string;
  readonly maxDailyLossLamports: string;
  readonly rpcFailureStreak: number;
  readonly updatedAt: string;
}

export interface KillSwitchOptions {
  readonly maxStalenessMs: number;
}

export interface KillSwitchDecision {
  readonly shouldLock: boolean;
  readonly reason: string;
  readonly detail: string;
}

function isKillSwitchState(value: unknown): value is KillSwitchState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate["locked"] === "boolean" &&
    (typeof candidate["reason"] === "string" || candidate["reason"] === null) &&
    typeof candidate["changedAt"] === "string"
  );
}

function parseHeartbeat(value: unknown): Heartbeat | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const paused = candidate["paused"];
  const pauseReason = candidate["pauseReason"];
  const dailyLoss = candidate["dailyLossLamports"];
  const maxDailyLoss = candidate["maxDailyLossLamports"];
  const streak = candidate["rpcFailureStreak"];
  const updatedAt = candidate["updatedAt"];
  if (typeof paused !== "boolean") return null;
  if (!(typeof pauseReason === "string" || pauseReason === null)) return null;
  if (typeof dailyLoss !== "string" || typeof maxDailyLoss !== "string") return null;
  if (typeof streak !== "number" || !Number.isSafeInteger(streak)) return null;
  if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) return null;
  return { paused, pauseReason, dailyLossLamports: dailyLoss, maxDailyLossLamports: maxDailyLoss, rpcFailureStreak: streak, updatedAt };
}

/**
 * Pure, deterministic killswitch trigger evaluation. It fails closed: a malformed
 * heartbeat or an unparseable loss value locks trading rather than ignoring it.
 */
export function evaluateKillSwitch(
  heartbeat: Heartbeat | null,
  manualLock: boolean,
  now: Date,
  options: KillSwitchOptions
): KillSwitchDecision {
  if (manualLock) {
    return { shouldLock: true, reason: "manual_lock", detail: "lock requested by operator" };
  }
  if (heartbeat === null) {
    return { shouldLock: false, reason: "no_heartbeat", detail: "no heartbeat observed yet" };
  }
  if (heartbeat.paused && heartbeat.pauseReason !== null && heartbeat.pauseReason.startsWith("panic")) {
    return { shouldLock: true, reason: heartbeat.pauseReason, detail: "trader reported a panic" };
  }
  if (heartbeat.pauseReason === "rpc_failure_streak") {
    return { shouldLock: true, reason: "rpc_failure_streak", detail: "repeated RPC connectivity failures" };
  }

  let dailyLoss: bigint;
  let maxDailyLoss: bigint;
  try {
    dailyLoss = BigInt(heartbeat.dailyLossLamports);
    maxDailyLoss = BigInt(heartbeat.maxDailyLossLamports);
  } catch {
    return { shouldLock: true, reason: "heartbeat_invalid", detail: "daily loss values are not valid integers" };
  }
  if (maxDailyLoss > 0n && dailyLoss >= maxDailyLoss) {
    return { shouldLock: true, reason: "daily_loss_limit", detail: `${dailyLoss} >= ${maxDailyLoss}` };
  }

  const age = now.getTime() - Date.parse(heartbeat.updatedAt);
  if (age > options.maxStalenessMs) {
    return { shouldLock: true, reason: "heartbeat_stale", detail: `heartbeat is ${age}ms old` };
  }
  return { shouldLock: false, reason: "healthy", detail: "all triggers clear" };
}

export function statePath(): string {
  return resolve(process.env.KILLSWITCH_STATE_PATH ?? ".local/killswitch-state.json");
}

export function heartbeatPath(): string {
  return resolve(process.env.KILLSWITCH_HEARTBEAT_PATH ?? ".local/trader-status.json");
}

async function readState(path: string): Promise<KillSwitchState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isKillSwitchState(parsed)) throw new Error("Invalid killswitch state file schema.");
    return parsed;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      const initial: KillSwitchState = { locked: false, reason: null, changedAt: new Date().toISOString() };
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(initial, null, 2)}\n`, { flag: "wx" }).catch((writeError: unknown) => {
        if (!(typeof writeError === "object" && writeError !== null && "code" in writeError && writeError.code === "EEXIST")) {
          throw writeError;
        }
      });
      return initial;
    }
    throw error;
  }
}

async function readHeartbeat(path: string): Promise<Heartbeat | null> {
  try {
    return parseHeartbeat(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return null;
    }
    return null;
  }
}

async function writeState(path: string, state: KillSwitchState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export interface RunOnceOptions {
  readonly heartbeatPath?: string;
  readonly maxStalenessMs?: number;
  readonly now?: Date;
  readonly unlock?: boolean;
}

export async function runOnce(path = statePath(), options: RunOnceOptions = {}): Promise<KillSwitchState> {
  const existing = await readState(path);

  if (options.unlock === true) {
    const unlocked: KillSwitchState = { locked: false, reason: null, changedAt: new Date().toISOString() };
    await writeState(path, unlocked);
    process.stdout.write(`${JSON.stringify({ service: "killswitch", mode: "monitor", action: "unlocked", ...unlocked })}\n`);
    return unlocked;
  }

  const heartbeat = await readHeartbeat(options.heartbeatPath ?? heartbeatPath());
  const decision = evaluateKillSwitch(heartbeat, existing.locked, options.now ?? new Date(), {
    maxStalenessMs: options.maxStalenessMs ?? Number(process.env.KILLSWITCH_MAX_STALENESS_MS ?? "30000")
  });

  let state = existing;
  if (decision.shouldLock && !existing.locked) {
    state = { locked: true, reason: decision.reason, changedAt: new Date().toISOString() };
    await writeState(path, state);
  }

  process.stdout.write(
    `${JSON.stringify({
      service: "killswitch",
      mode: "monitor",
      locked: state.locked,
      reason: state.reason,
      changedAt: state.changedAt,
      lastDecision: decision.reason,
      detail: decision.detail
    })}\n`
  );
  return state;
}

const isEntrypoint =
  process.argv[1]?.replaceAll("\\", "/").endsWith("/src/main.ts") ||
  process.argv[1]?.replaceAll("\\", "/").endsWith("/dist/main.js");

if (isEntrypoint) {
  const unlock = process.argv.includes("--unlock");
  runOnce(statePath(), { unlock }).catch((error: unknown) => {
    process.stderr.write(`Killswitch startup failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
