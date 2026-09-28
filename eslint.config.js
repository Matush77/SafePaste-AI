import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["dist/", "node_modules/", "test-results/", "store-assets/", "conversation-transcript.html"]
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module"
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error"
    }
  },
  {
    files: ["src/**/*.js", "tests/harness/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser, chrome: "readonly" }
    }
  },
  {
    // Unit tests run DOM code under jsdom; e2e tests run code inside the page.
    files: ["tests/unit/**/*.js", "tests/e2e/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser, chrome: "readonly" }
    }
  },
  {
    files: ["scripts/**/*.js", "tests/**/*.js", "*.config.js"],
    ignores: ["tests/harness/**"],
    languageOptions: {
      globals: { ...globals.node }
    }
  }
];
