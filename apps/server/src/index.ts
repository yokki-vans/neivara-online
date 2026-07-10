import "dotenv/config";
import { createApplication } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app } = await createApplication({ config });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info({ port: config.port }, "Neivara server is ready");
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
