import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
    // Exclude E2E tests (run with Playwright) and build artifacts
    exclude: ["node_modules", ".next", "convex/_generated", "tests/e2e/**"],
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules", "convex/_generated", "tests"],
    },
    // Compliance tests are critical - fail fast
    bail: 1,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
