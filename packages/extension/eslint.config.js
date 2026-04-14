// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

const sharedTsRules = {
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
  ],
  "@typescript-eslint/no-explicit-any": "off",
  "no-empty": ["error", { allowEmptyCatch: true }],
  // Several modules declare `let x!: T` forward-refs that are captured by
  // closures constructed before the single assignment; allow those while
  // still flagging real single-assignment `let`s.
  "prefer-const": ["error", { ignoreReadBeforeAssign: true }]
};

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "coverage/**",
      ".ts-emit/**",
      "node_modules/**",
      "types/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Extension runtime code — browser + chrome only, no Node globals.
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        chrome: "readonly"
      },
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    settings: { react: { version: "detect" } },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooks
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...sharedTsRules
    }
  },
  // Tests run under Vitest + jsdom, so they need both browser and Node globals.
  {
    files: ["tests/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.vitest,
        chrome: "readonly"
      },
      parserOptions: {
        ecmaFeatures: { jsx: true }
      }
    },
    settings: { react: { version: "detect" } },
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooks
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...sharedTsRules,
      "@typescript-eslint/no-unused-vars": "off"
    }
  },
  // Build tooling — Node-only scripts executed via tsx.
  {
    files: ["scripts/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node
      }
    },
    rules: {
      ...sharedTsRules
    }
  }
);
