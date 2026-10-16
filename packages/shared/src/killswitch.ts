import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

export const KILLSWITCH_STATE_FILENAME = "killswitch-state.json";

/**
 * Name suffix for the "armed" sentinel. Once any killswitch state has been
 * written, the sentinel exists. If the state file is deleted afterwards, the lock
 * is treated as locked (fail closed) instead of silently resetting to unlocked.
 */
export const KILLSWITCH_ARMED_SUFFIX = ".armed";

/** Error code returned when an armed lock file was deleted out from under us. */
export const KILLSWITCH_STATE_MISSING_ERROR = "killswitch_state_missing";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

/**
 * Durable killswitch lock state. `changedAt` must be a parseable timestamp so a
 * corrupt file is rejected rather than trusted.
 */
export const KillswitchStateSchema = z
  .object({
    locked: z.boolean(),
    reason: z.string().nullable(),
    changedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), "changedAt must be a valid timestamp")
  })
  .strict();

export type KillswitchState = z.infer<typeof KillswitchStateSchema>;

/**
 * Result of reading the lock. `ok: false` means the file was unreadable or
 * malformed, which callers must treat as locked (fail closed).
 */
export type KillswitchLockRead =
  | { readonly ok: true; readonly state: KillswitchState }
  | { readonly ok: false; readonly error: string };

export function resolveKillswitchStatePath(stateDir: string, filename = KILLSWITCH_STATE_FILENAME): string {
  return join(stateDir, filename);
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isEexist(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

export function resolveKillswitchArmedPath(path: string): string {
  return `${path}${KILLSWITCH_ARMED_SUFFIX}`;
}

/**
 * True when the armed sentinel exists. An unreadable sentinel (any error other
 * than ENOENT) is treated as armed so that a permissions change cannot silently
 * downgrade the fail-closed guarantee.
 */
async function armedSentinelExists(path: string): Promise<boolean> {
  try {
    await stat(resolveKillswitchArmedPath(path));
    return true;
  } catch (error) {
    return !isEnoent(error);
  }
}

/**
 * Reads the durable killswitch lock. A missing file means "no lock has been
 * requested yet" and is treated as unlocked, *unless* the lock has previously
 * been armed — in that case a deleted lock file is locked (fail closed) so that
 * removing state cannot clear an engaged killswitch. Any other read error or
 * schema mismatch returns `ok: false` so the caller fails closed.
 */
export async function readKillswitchLock(path: string): Promise<KillswitchLockRead> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      if (await armedSentinelExists(path)) {
        return { ok: false, error: KILLSWITCH_STATE_MISSING_ERROR };
      }
      return { ok: true, state: { locked: false, reason: null, changedAt: new Date(0).toISOString() } };
    }
    return { ok: false, error: "killswitch_state_unreadable" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "killswitch_state_malformed" };
  }

  const result = KillswitchStateSchema.safeParse(parsed);
  if (!result.success) return { ok: false, error: "killswitch_state_malformed" };
  return { ok: true, state: result.data };
}

/**
 * True when trading must be halted. Unreadable or malformed lock state counts as
 * locked, so a tampered or corrupt file can never silently re-enable trading.
 */
export function isKillswitchLocked(read: KillswitchLockRead): boolean {
  return !read.ok || read.state.locked;
}

async function armKillswitch(path: string): Promise<void> {
  try {
    await writeFile(resolveKillswitchArmedPath(path), "", { flag: "wx", mode: FILE_MODE });
  } catch (error) {
    if (!isEexist(error)) throw error;
  }
}

/**
 * Atomically writes the killswitch state: a temp file in the same directory is
 * written and then renamed over the target, so a crash mid-write can never leave
 * truncated JSON. The file is created with `0600` and an armed sentinel is
 * recorded so that a later deletion of the state file fails closed.
 */
export async function writeKillswitchState(path: string, state: KillswitchState): Promise<KillswitchState> {
  await mkdir(dirname(path), { recursive: true, mode: DIR_MODE });
  const serialized = `${JSON.stringify(state, null, 2)}\n`;
  const tempPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, serialized, { encoding: "utf8", mode: FILE_MODE });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await armKillswitch(path);
  return state;
}

/**
 * Reads or initializes the killswitch state for the monitor process. If no state
 * has ever been written, an unlocked state is written (and armed) atomically. If
 * the state file was deleted after arming, a locked state is returned instead of
 * silently recreating an unlocked one. A malformed file throws (fail closed).
 */
export async function ensureKillswitchState(path: string): Promise<KillswitchState> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      if (await armedSentinelExists(path)) {
        return { locked: true, reason: KILLSWITCH_STATE_MISSING_ERROR, changedAt: new Date().toISOString() };
      }
      const initial: KillswitchState = { locked: false, reason: null, changedAt: new Date().toISOString() };
      await writeKillswitchState(path, initial);
      return initial;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid killswitch state file: not valid JSON.");
  }
  const result = KillswitchStateSchema.safeParse(parsed);
  if (!result.success) throw new Error("Invalid killswitch state file schema.");
  return result.data;
}

export async function persistKillswitchLock(path: string, reason: string): Promise<KillswitchState> {
  return writeKillswitchState(path, { locked: true, reason, changedAt: new Date().toISOString() });
}

export async function persistKillswitchUnlock(path: string): Promise<KillswitchState> {
  return writeKillswitchState(path, { locked: false, reason: null, changedAt: new Date().toISOString() });
}
