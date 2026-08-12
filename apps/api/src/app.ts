import cors from "@fastify/cors";
import Fastify from "fastify";

import { getConfig } from "./config.js";

type CreateAppOptions = {
  logger?: boolean;
  webOrigin?: string;
};

export function createApp(options: CreateAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const webOrigin = options.webOrigin ?? getConfig().webOrigin;

  void app.register(cors, {
    origin: webOrigin,
    credentials: true,
    methods: ["GET", "POST", "DELETE", "OPTIONS"]
  });

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            required: ["status", "service"],
            properties: {
              status: { type: "string" },
              service: { type: "string" }
            }
          }
        }
      }
    },
    async () => ({ status: "ok", service: "api" })
  );

  return app;
}
