import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import {
  createJsonLogger,
  isKillswitchLocked,
  loadRuntimeConfig,
  persistKillswitchLock,
  readKillswitchLock,
  type RuntimeConfig,
  type StructuredLogger
} from "@solana-system/shared";
import { buildTradingStack, type TradingStack } from "./bootstrap.js";

export interface ServerOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly autostart?: boolean;
}

function tokenMatches(provided: string | undefined, expected: string | undefined): boolean {
  if (provided === undefined || expected === undefined) return false;
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) return header.slice("Bearer ".length);
  const custom = request.headers["x-control-token"];
  if (typeof custom === "string") return custom;
  return undefined;
}

export function createServer(options: ServerOptions = {}): FastifyInstance {
  const env = options.env ?? process.env;
  const config: RuntimeConfig = loadRuntimeConfig(env);
  const logger: StructuredLogger = createJsonLogger(config.nodeEnv === "production" ? "info" : "debug");

  const app = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug",
      redact: ["req.headers.authorization", "req.headers.cookie", "req.headers['x-control-token']"]
    },
    bodyLimit: 16 * 1024
  });

  const stack: TradingStack = buildTradingStack(config, logger, env);

  const authorizeControl = (request: FastifyRequest, reply: FastifyReply): boolean => {
    if (!config.enableControlApi) {
      void reply.code(403).send({ error: "control_api_disabled", detail: "Set ENABLE_CONTROL_API=true and CONTROL_API_TOKEN to allow control actions." });
      return false;
    }
    if (!tokenMatches(bearerToken(request), config.controlApiToken)) {
      void reply.code(401).send({ error: "unauthorized" });
      return false;
    }
    return true;
  };

  app.get("/health", async () => ({
    status: "ok",
    service: "backend",
    network: config.network,
    mode: config.tradingMode,
    tradingEnabled: false,
    liveExecutionEnabled: false,
    timestamp: new Date().toISOString()
  }));

  app.get("/ready", async () => {
    const lock = await readKillswitchLock(config.killswitchStatePath);
    const locked = isKillswitchLocked(lock);
    return {
      ready: !locked,
      locked,
      lockReason: !lock.ok ? lock.error : lock.state.reason,
      mode: config.tradingMode,
      note: locked
        ? "Killswitch lock is engaged. Trading is halted until the lock is explicitly cleared."
        : "Paper mode is the default. Live execution is disabled until a reviewed signer and DEX router exist."
    };
  });

  app.get("/api/status", async () => stack.trader.status());

  app.get("/api/events", async () => ({ events: stack.trader.getEvents() }));

  app.get("/api/portfolio", async () => {
    const status = stack.trader.status();
    return {
      cashLamports: status.cashLamports,
      equityLamports: status.equityLamports,
      realizedPnlLamports: status.realizedPnlLamports,
      feesPaidLamports: status.feesPaidLamports,
      dailyLossLamports: status.dailyLossLamports,
      openPositions: status.openPositions,
      positions: status.positions
    };
  });

  app.get("/api/markets", async () => {
    const quotes = await Promise.all(
      stack.markets.map(async (mint) => {
        try {
          return await stack.market.getQuote(mint);
        } catch {
          return null;
        }
      })
    );
    return {
      markets: quotes
        .filter((quote) => quote !== null)
        .map((quote) => ({
          mint: quote.mint,
          symbol: quote.symbol,
          priceLamports: quote.priceLamports.toString(),
          liquidityLamports: quote.liquidityLamports.toString(),
          lpBurnedOrLocked: quote.lpBurnedOrLocked,
          updatedAt: quote.updatedAt
        }))
    };
  });

  app.get("/api/ledger", async (request) => {
    const query = request.query as { limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? "100") || 100, 1), 500);
    const entries = await stack.ledger.readAll();
    return { entries: entries.slice(-limit) };
  });

  app.post("/api/control/pause", async (request, reply) => {
    if (!authorizeControl(request, reply)) return reply;
    const reason = (request.body as { reason?: string } | undefined)?.reason ?? "manual_pause";
    stack.trader.pause(reason);
    return { paused: true, reason };
  });

  app.post("/api/control/resume", async (request, reply) => {
    if (!authorizeControl(request, reply)) return reply;
    stack.trader.resume();
    return { paused: false };
  });

  app.post("/api/control/panic", async (request, reply) => {
    if (!authorizeControl(request, reply)) return reply;
    const reason = (request.body as { reason?: string } | undefined)?.reason ?? "manual_panic";
    stack.trader.panic(reason);
    await persistKillswitchLock(config.killswitchStatePath, `panic:${reason}`);
    return { paused: true, locked: true, reason };
  });

  if (options.autostart !== false) {
    const runTick = (): void => {
      void stack.trader.tick().catch((error: unknown) => {
        app.log.error({ err: error instanceof Error ? error.message : "unknown" }, "trader tick failed");
      });
    };
    // Tick immediately so the independent killswitch lock is honored at startup.
    runTick();
    const timer = setInterval(runTick, config.scannerIntervalMs);
    app.addHook("onClose", async () => {
      clearInterval(timer);
    });
  }

  return app;
}

const isEntrypoint =
  process.argv[1]?.replaceAll("\\", "/").endsWith("/src/server.ts") ||
  process.argv[1]?.replaceAll("\\", "/").endsWith("/dist/server.js");

if (isEntrypoint) {
  const config = loadRuntimeConfig();
  const app = createServer();
  app
    .listen({ host: config.backendHost, port: config.backendPort })
    .then(() => {
      app.log.info({ mode: config.tradingMode, network: config.network }, "backend listening");
    })
    .catch((error: unknown) => {
      app.log.error(error, "Backend failed to start");
      process.exitCode = 1;
    });
}
