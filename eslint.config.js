import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["**/node_modules/", "**/dist/", "test-results/", "playwright-report/"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // Node code: the server, the root scripts and configs, the meta and browser tests.
    files: ["**/*.{ts,tsx,js}"],
    languageOptions: { globals: globals.node },
  },
  {
    // Browser code: the renderer and the web app see no Node globals.
    files: ["engine/**", "web/**"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["**/*.{ts,tsx,js}"],
    rules: {
      // AC15: the environment is read in server/src/config.ts and validated at boot; nowhere else.
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read the environment only in server/src/config.ts (docs/invariants.md).",
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["server/src/config.ts"],
    rules: { "no-restricted-properties": "off" },
  },
);
