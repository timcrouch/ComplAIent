export const CONTROL_CATEGORIES = [
  "governance",
  "privacy",
  "suppliers",
  "assets",
  "access",
  "people",
  "physical",
  "operations",
  "resilience",
  "incidents",
  "development",
  "ai_governance",
] as const;

export type ControlCategory = (typeof CONTROL_CATEGORIES)[number];

/** Control code prefix to category. A code's prefix must match its category. */
export const CONTROL_CODE_PREFIX_CATEGORY = {
  GOV: "governance",
  PRV: "privacy",
  SUP: "suppliers",
  AST: "assets",
  ACC: "access",
  PPL: "people",
  PHY: "physical",
  OPS: "operations",
  RES: "resilience",
  INC: "incidents",
  DEV: "development",
  AIG: "ai_governance",
} as const satisfies Record<string, ControlCategory>;

export const CONTROL_CODE_PATTERN = /^(GOV|PRV|SUP|AST|ACC|PPL|PHY|OPS|RES|INC|DEV|AIG)-\d{2}$/;

export function controlCategoryForCode(code: string): ControlCategory | undefined {
  const prefix = code.split("-")[0] as keyof typeof CONTROL_CODE_PREFIX_CATEGORY;
  return CONTROL_CODE_PREFIX_CATEGORY[prefix];
}
