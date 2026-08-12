import { createApp } from "./app.js";
import { getConfig } from "./config.js";

const config = getConfig();
const app = createApp({ webOrigin: config.webOrigin });

async function start() {
  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

async function stop(signal: NodeJS.Signals) {
  app.log.info({ signal }, "Stopping API server");
  await app.close();
  process.exit(0);
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

void start();
