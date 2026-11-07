export default {
  printWidth: 100,
  singleQuote: false,
  trailingComma: "all",
  semi: true,
  overrides: [
    {
      // Framework content keeps one requirement per line, so long frameworks stay under 500 lines.
      files: "../control-library/content/frameworks/*.json",
      options: { printWidth: 180 },
    },
  ],
};
