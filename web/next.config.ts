import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// Next loads web/.env; also support the CLI's root .env without exposing it to bundling.
try {
  process.loadEnvFile?.(fileURLToPath(new URL("../.env", import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const config: NextConfig = {
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "sharp", "exifr"],
  outputFileTracingRoot: fileURLToPath(new URL("..", import.meta.url)),
  // Keep the existing ESM library and its native PDF/image dependencies in Node.
  webpack(config) {
    config.externals.push({ "@liedar": `import ${new URL("../dist/index.js", import.meta.url).href}` });
    return config;
  },
};
export default config;
