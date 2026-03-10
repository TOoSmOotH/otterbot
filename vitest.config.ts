import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@otterbot/shared": resolve(__dirname, "packages/shared/src/index.ts"),
    },
  },
  test: {
    globals: true,
    include: ["packages/*/src/**/*.test.{ts,tsx}", "modules/*/src/**/*.test.{ts,tsx}"],
  },
});
