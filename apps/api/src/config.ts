import { fileURLToPath } from "node:url";

import { config } from "dotenv";

config({
  path: fileURLToPath(new URL("../../../.env", import.meta.url)),
  quiet: true
});

const DEFAULT_PORT = 3001;

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535.");
  }

  return port;
}

export function getConfig() {
  return {
    host: process.env.API_HOST ?? "127.0.0.1",
    port: readPort(process.env.API_PORT),
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000"
  };
}
