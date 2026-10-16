import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

export const KILLSWITCH_STATE_FILENAME = "killswitch-state.json";

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

/**
 * Reads the durable killswitch lock. A missing file means "no lock has been
 * requested yet" and is treated as unlocked. Any read error or schema mismatch
 * returns `ok: false` so the caller fails closed.
 */
export async function readKillswitchLock(path: string): Promise<KillswitchLockRead> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
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

export async function writeKillswitchState(path: string, state: KillswitchState): Promise<KillswitchState> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

export async function persistKillswitchLock(path: string, reason: string): Promise<KillswitchState> {
  return writeKillswitchState(path, { locked: true, reason, changedAt: new Date().toISOString() });
}

export async function persistKillswitchUnlock(path: string): Promise<KillswitchState> {
  return writeKillswitchState(path, { locked: false, reason: null, changedAt: new Date().toISOString() });
}
