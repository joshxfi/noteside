import { defineConfig } from "vitest/config";

// Unit tests target pure modules (no DOM), so the default node environment is
// enough — no jsdom, no CM6. CM6/component flows are for a future e2e suite.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
