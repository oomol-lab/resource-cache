import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["html", "text", "json-summary", "json"],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
        perFile: true,
      },
    },
    execArgv: ["--expose-gc"],
  },
});
