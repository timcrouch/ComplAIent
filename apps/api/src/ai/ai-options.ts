import type { AiProvider, AiSettingsRow, ProviderName } from "@isms/ai";

export type AiModuleOptions = {
  /** AI_SECRETS_KEY (32 bytes); without it no provider key can be saved or opened (P3-R10). */
  secretsKey: Buffer | undefined;
  /** AI_PROVIDER (P3-R9). */
  provider: ProviderName;
  /** AI_ALLOW_NON_EU_ROUTING: development only; EU-only routing may be off (zero retention may not). */
  allowNonEuRouting?: boolean;
  /** Test seam: builds the provider instead of OpenRouter or the mock. */
  providerFactory?: (settings: AiSettingsRow, apiKey: string) => AiProvider;
};

export const AI_OPTIONS = Symbol("AI_OPTIONS");
