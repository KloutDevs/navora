import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
    },
  },
});