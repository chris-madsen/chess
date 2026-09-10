import js from "@eslint/js";
import globals from "globals";
import importPlugin from "eslint-plugin-import";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import { fileURLToPath } from "url";

export default [
  {
    ignores: ["node_modules/**", "dist/**", "coverage/**"]
  },
  js.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: fileURLToPath(new URL(".", import.meta.url)),
        warnOnUnsupportedTypeScriptVersion: false,
        EXPERIMENTAL_useProjectService: {
          defaultProject: "tsconfig.json"
        }
      },
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_"
      }]
    }
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },
    plugins: {
      import: importPlugin
    },
    rules: {
      "no-console": ["warn", { "allow": ["warn", "error", "log"] }]
    }
  }
];
