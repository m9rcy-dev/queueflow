import baseConfig from "../../eslint.config.base.mjs";

export default [
  ...baseConfig,
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    languageOptions: {
      sourceType: "commonjs",
    },
  },
];
