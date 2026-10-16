import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

interface KillSwitchState {
  readonly locked: boolean;
  readonly reason: string | null;
  readonly changedAt: string;
}

function statePath(): string {
  return resolve(process.env.KILLSWITCH_STATE_PATH ?? ".local/killswitch-state.json");
}

async function readState(path: string): Promise<KillSwitchState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null || !("locked" in parsed) ||
        typeof parsed.locked !== "boolean" || !("reason" in parsed) ||
        !(typeof parsed.reason === "string" || parsed.reason === null) ||
        !("changedAt" in parsed) || typeof parsed.changedAt !== "string") {
      throw new Error("Invalid killswitch state file schema.");
    }
    return parsed as KillSwitchState;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      const initial: KillSwitchState = { locked: false, reason: null, changedAt: new Date().toISOString() };
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(initial, null, 2)}\n`, { flag: "wx" }).catch(async (writeError: unknown) => {
        if (!(typeof writeError === "object" && writeError !== null && "code" in writeError && writeError.code === "EEXIST")) {
          throw writeError;
        }
      });
      return initial;
    }
    throw error;
  }
}

export async function runOnce(path = statePath()): Promise<KillSwitchState> {
  const state = await readState(path);
  process.stdout.write(`${JSON.stringify({ service: "killswitch", mode: "monitor-only", ...state })}\n`);
  return state;
}

const isEntrypoint = process.argv[1]?.replaceAll("\\", "/").endsWith("/src/main.ts")
  || process.argv[1]?.replaceAll("\\", "/").endsWith("/dist/main.js");

if (isEntrypoint) {
  runOnce().catch((error: unknown) => {
    process.stderr.write(`Killswitch startup failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    process.exitCode = 1;
  });
}
