import type { AiSettingsDto } from "@isms/contracts";

export const ANNA = {
  id: "0b9f5f4e-5d0a-4c55-9a43-9a4f7f0d1c2e",
  displayName: "Anna Admin",
};

/** A saved key (ends in WXYZ), both privacy switches on, no models yet, AI off. */
export function aiSettings(overrides: Partial<AiSettingsDto> = {}): AiSettingsDto {
  return {
    enabled: false,
    euOnly: true,
    zeroRetention: true,
    key: {
      set: true,
      last4: "WXYZ",
      setBy: ANNA,
      setAt: "2026-11-05T09:30:00.000Z",
      readable: true,
    },
    models: { conversation: null, controls: null, frameworks: null },
    readiness: { ready: false, reason: "disabled" },
    secretsKeyConfigured: true,
    provider: "mock",
    nonEuRoutingAllowed: false,
    ...overrides,
  };
}

export const OFFERED = [
  { id: "mock/isms-test", name: "Test model" },
  { id: "mock/other", name: "Other model" },
];
