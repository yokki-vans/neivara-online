import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { Server } from "socket.io";
import type { AppConfig } from "./config.js";
import { loadConfig } from "./config.js";
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

  const isAllowedOrigin = (origin: string | undefined): boolean =>
    !origin || config.clientOrigins.includes(origin.replace(/\/$/, ""));

  await app.register(cors, {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) callback(null, true);
      else callback(new Error("Origin is not allowed"), false);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Idempotency-Key"],
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { global: true, max: 180, timeWindow: "1 minute" });

  const handshakeSecurity = new EngineHandshakeSecurity(config.trustProxy);
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
