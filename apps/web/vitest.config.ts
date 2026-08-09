import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    // Required for @testing-library/react auto-cleanup between tests.
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules", ".next", "e2e"],
    server: {
      deps: {
        // passkey-kit and its SDK deps ship raw TypeScript; Vitest must
        // transform them (Node's loader refuses to type-strip node_modules).
        // Needed by the http-backend seam test, which imports the real
        // wallet-service buildServer (whose derivation path pulls passkey-kit).
        // Mirrors next.config transpilePackages + wallet-service's vitest.
        inline: ["passkey-kit", "passkey-kit-sdk", "sac-sdk"],
      },
    },
  },
});
