import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` throws outside a React Server environment; tests of
      // server modules run in plain Node, so it is stubbed to a no-op.
      "server-only": path.resolve(__dirname, "./src/test/serverOnlyStub.ts"),
    },
  },
});
