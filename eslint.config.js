import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/node_modules/**",
      "**/.vite/**",
      "**/playwright-report/**",
      "**/test-results/**",
      "packages/scomm-pubkey/**",
      "packages/scomm-pubkey-protocol/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "no-console": ["warn", { allow: ["warn", "error", "info", "debug"] }],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "better-auth",
              message: "Use @2key/browser-sdk. Do not import Better Auth in the add-in.",
            },
            {
              name: "better-auth/client",
              message: "Use @2key/browser-sdk. Do not import Better Auth in the add-in.",
            },
            {
              name: "@scomm-office/billing",
              message: "Deleted. Use @2key/browser-sdk.",
            },
          ],
        },
      ],
    },
  },
  eslintConfigPrettier,
);
