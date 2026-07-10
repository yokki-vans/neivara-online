import compress from "@fastify/compress";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { registerClientHosting } from "./client-hosting.js";
import {
  isAllowedRequestOrigin,
  loadConfig,
  type AppConfig,
} from "./config.js";
import { installProductionErrorHandler } from "./error-handler.js";
import { EngineHandshakeSecurity } from "./handshake-security.js";
import { setupRealtime } from "./realtime.js";
import { registerRoutes } from "./routes.js";
import { TokenService } from "./security.js";
import { createStore, type GameStore } from "./store/index.js";
import { GameWorld, type GameIo } from "./world.js";

export interface Application {
  app: FastifyInstance;
  io: GameIo;
  world: GameWorld;
  store: GameStore;
  config: AppConfig;
}

export interface ApplicationOptions {
  config?: AppConfig;
  store?: GameStore;
  startWorld?: boolean;
  /** Explicit path enables static hosting in tests/development; null disables it. */
  clientDistPath?: string | null;
}

const PRODUCTION_CLIENT_DIST = fileURLToPath(new URL("../../client/dist/", import.meta.url));

class OriginNotAllowedError extends Error {
  readonly statusCode = 403;
  readonly code = "ORIGIN_NOT_ALLOWED";

  constructor() {
    super("Origin is not allowed");
    this.name = "OriginNotAllowedError";
  }
}

function websocketOrigins(origins: readonly string[]): string[] {
  return [...new Set(origins.map((origin) => {
    const parsed = new URL(origin);
    parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
    return parsed.origin;
  }))];
}

export async function createApplication(options: ApplicationOptions = {}): Promise<Application> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger:
      config.logLevel === "silent"
        ? false
        : {
            level: config.logLevel,
            ...(config.nodeEnv === "development"
              ? { transport: { target: "pino-pretty", options: { colorize: true } } }
              : {}),
          },
    bodyLimit: 64 * 1024,
    trustProxy: config.trustProxy,
  });

  if (config.nodeEnv === "production") installProductionErrorHandler(app);

  const store = options.store ?? createStore(config);
  if (config.nodeEnv === "production" && store.kind !== "postgres") {
    throw new Error("Production cannot start with an in-memory game store");
  }
  await store.initialize();
  const tokens = new TokenService(config.jwtSecret);

  const allowedOrigins = new Set(config.clientOrigins);

  await app.register(cors, {
    origin: (origin, callback) => {
      if (isAllowedRequestOrigin(origin, allowedOrigins)) callback(null, true);
      else callback(new OriginNotAllowedError(), false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", ...websocketOrigins(config.clientOrigins)],
        fontSrc: ["'self'", "data:"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:", "blob:"],
        manifestSrc: ["'self'"],
        mediaSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        workerSrc: ["'self'", "blob:"],
      },
    },
  });
  // mime-db marks GLB as compressible even though shipped models are already
  // densely packed. The plugin's documented opt-out avoids spending origin CPU
  // on those payloads while retaining compression for HTML/JS/CSS/JSON.
  app.addHook("onRequest", async (request) => {
    const requestPath = request.url.split("?", 1)[0]?.toLowerCase() ?? "";
    if (requestPath.endsWith(".glb")) request.headers["x-no-compression"] = "asset";
  });
  await app.register(compress, {
    threshold: 1_024,
    globalDecompression: false,
  });
  // Every mutable API route declares its own limit. Static client/model requests
  // therefore never consume an account/API IP budget during initial page load.
  await app.register(rateLimit, { global: false });

  const handshakeSecurity = new EngineHandshakeSecurity(
    config.trustProxy,
    config.clientOrigins,
  );
  const io = new Server(app.server, {
    cors: {
      origin: config.clientOrigins,
      methods: ["GET", "POST"],
    },
    transports: ["websocket", "polling"],
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 20_000,
    pingTimeout: 15_000,
    allowRequest: (request, callback) => handshakeSecurity.allowRequest(request, callback),
  }) as GameIo;
  io.engine.on("connection", (engineSocket) => {
    if (!handshakeSecurity.activate(engineSocket.request)) {
      engineSocket.close(true);
      return;
    }
    engineSocket.once("close", () => handshakeSecurity.release(engineSocket.request));
  });
  const world = new GameWorld(io, store);
  registerRoutes(app, store, tokens, world);
  setupRealtime(io, world, store, tokens, {
    maxSocketsPerAccount: config.realtimeMaxSocketsPerAccount,
  });
  const clientDistPath = options.clientDistPath === undefined
    ? config.nodeEnv === "production"
      ? PRODUCTION_CLIENT_DIST
      : null
    : options.clientDistPath;
  if (clientDistPath) await registerClientHosting(app, clientDistPath);
  if (options.startWorld !== false) world.start();

  app.addHook("onClose", async () => {
    try {
      await world.stop();
    } finally {
      io.disconnectSockets(true);
      handshakeSecurity.close();
      await store.close();
    }
  });

  return { app, io, world, store, config };
}
