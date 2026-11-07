import tooling from "@isms/tooling/eslint";

export default [
  ...tooling,
  {
    // Nest modules and providers are decorated classes with no members of their own.
    rules: { "@typescript-eslint/no-extraneous-class": ["error", { allowWithDecorator: true }] },
  },
];
