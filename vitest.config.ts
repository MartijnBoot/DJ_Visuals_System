import { defineConfig } from "vitest/config";

const ignored = ["**/node_modules/**", "**/dist/**", "tests/browser/**"];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["**/*.test.ts"],
          exclude: [...ignored, "**/*.int.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["**/*.int.test.ts"],
          exclude: ignored,
        },
      },
    ],
  },
});
