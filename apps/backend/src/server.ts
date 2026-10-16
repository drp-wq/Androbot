import Fastify from "fastify";
import { loadRuntimeConfig } from "@solana-system/shared";

export function createServer() {
  const config = loadRuntimeConfig();
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug",
      redact: ["req.headers.authorization", "req.headers.cookie"]
    }
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "backend",
    network: config.network,
    tradingEnabled: false,
    timestamp: new Date().toISOString()
  }));

  app.get("/ready", async () => ({
    ready: true,
    tradingEnabled: false,
    note: "Milestone 1 has no execution or signing capability."
  }));

  return app;
}

const isEntrypoint = process.argv[1]?.replaceAll("\\", "/").endsWith("/src/server.ts")
  || process.argv[1]?.replaceAll("\\", "/").endsWith("/dist/server.js");

if (isEntrypoint) {
  const app = createServer();
  const config = loadRuntimeConfig();
  app.listen({ host: config.backendHost, port: config.backendPort }).catch((error: unknown) => {
    app.log.error(error, "Backend failed to start");
    process.exitCode = 1;
  });
}
