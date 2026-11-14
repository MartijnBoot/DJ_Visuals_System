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
          // No per-test time limit (B-08 PD18): every test here spawns the real server and
          // asserts what it does, never how fast; under load 32 of 51 exceeded the default 5 s.
          // A hang ends at the CI job's own limit. The unit project keeps the default.
          testTimeout: 0,
        },
      },
    ],
  },
});
