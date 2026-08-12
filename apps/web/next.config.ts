import { resolve } from "node:path";

import { config } from "dotenv";
import type { NextConfig } from "next";

config({
  path: resolve(process.cwd(), "../../.env"),
  quiet: true
});

const nextConfig: NextConfig = {
  reactStrictMode: true
};

export default nextConfig;
