import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "output/**",
      "coverage/**",
      "node_modules/**",
      ".playwright-mcp/**",
      "artifacts/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    extends: [tseslint.configs.disableTypeChecked],
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: [
      "src/**/*.{ts,tsx,mts,cts}",
      "analytics-server/**/*.{ts,tsx,mts,cts}",
      "e2e/**/*.{ts,tsx,mts,cts}",
      "playwright.config.ts",
    ],
  })),
  {
    files: [
      "src/**/*.{ts,tsx,mts,cts}",
      "analytics-server/**/*.{ts,tsx,mts,cts}",
      "e2e/**/*.{ts,tsx,mts,cts}",
      "playwright.config.ts",
    ],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.webextensions,
        chrome: "readonly",
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-base-to-string": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      "no-useless-escape": "off",
    },
  },
  eslintConfigPrettier,
);
