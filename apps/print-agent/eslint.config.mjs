import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "prints/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  // Tests assert on known fixtures.
  { files: ["tests/**/*.ts"], rules: { "@typescript-eslint/no-non-null-assertion": "off" } },
);
