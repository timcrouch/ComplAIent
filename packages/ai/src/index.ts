export { openSecret, sealSecret, SecretUnreadableError } from "./secret-box.js";
export {
  ProviderError,
  type AiProvider,
  type ChatMessage,
  type CompletionRequest,
  type CompletionResult,
  type ProviderErrorKind,
  type ProviderRouting,
} from "./provider.js";
// Not exported: createOpenRouterProvider and runStructured. App code calls the gateway
// (createGateway), so no call can skip readiness or the privacy routing (ADR-0009).
export { OPENROUTER_EU_BASE_URL, OPENROUTER_GLOBAL_BASE_URL } from "./openrouter.js";
export {
  createMockProvider,
  MOCK_AUTH_MARKER,
  MOCK_INVALID_MARKER,
  MOCK_MODEL,
  type MockProviderOptions,
} from "./mock-provider.js";
export {
  aiReadiness,
  MODEL_KEY_BY_PURPOSE,
  type AiCallPurpose,
  type AiReadiness,
  type ConnectionTestReadiness,
  type AiReadinessReason,
  privacyHolds,
  type ReadinessOptions,
} from "./readiness.js";
export { toStrictJsonSchema, type RunResult, type StructuredCall } from "./structured.js";
export {
  defaultAiSettings,
  type AiCallStatus,
  type AiLogger,
  type AiModelKey,
  type AiModels,
  type AiOutcome,
  type AiPurpose,
  type AiSettingsRow,
  type AiStore,
  type InteractionRecord,
  type InteractionRouting,
} from "./store.js";
export { createPrismaAiStore, parseModels, type AiStoreDb } from "./prisma-store.js";
export {
  AiKeyUnavailableError,
  CONNECTION_TEST_PROMPT,
  createGateway,
  type AiGateway,
  type ConnectionTestReason,
  type ConnectionTestResult,
  type GatewayCall,
  type GatewayOptions,
  type GatewayRunResult,
  type ProviderName,
} from "./gateway.js";
export {
  contentHash,
  controlEmbeddingText,
  createLocalEmbedder,
  EMBEDDING_DIMENSIONS,
  LOCAL_EMBEDDING_MODEL,
  type Embedder,
  type LocalEmbedderOptions,
} from "./embedder.js";
export {
  ensureLibraryEmbedded,
  nearestControls,
  type NearestControl,
  type RetrievalDb,
} from "./retrieval.js";
export {
  buildControlSuggestionPrompt,
  CANDIDATE_COUNT,
  ControlSuggestionOutput,
  MAX_SUGGESTIONS,
  suggestControlsForRisk,
  type SuggestControlsDeps,
  type SuggestControlsResult,
  type SuggestionGateway,
} from "./purposes/control-suggestion.js";
export {
  buildConcernTurnPrompt,
  CONCERN_ASSET_TYPES,
  ConcernDraftOutput,
  concernTranscript,
  ConcernTurnOutput,
  concernTurnSchema,
  MAX_CONCERN_QUESTIONS,
  type ConcernAssetType,
  type ConcernPromptInput,
} from "./purposes/concern-turn.js";
export { MOCK_ESTIMATE_REASONING } from "./mock/concern-turn.js";
export {
  buildFrameworkSuggestionPrompt,
  FrameworkSuggestionOutput,
  selectFrameworkSuggestions,
  type CatalogEntry,
  type FrameworkSuggestion,
  type OrganisationProfileText,
} from "./purposes/framework-suggestion.js";
export { MOCK_FRAMEWORK_REASONING } from "./mock/framework-suggestion.js";
export {
  allowedNumbers,
  buildPostureSummaryPrompt,
  guardText,
  PostureSummaryOutput,
  type BoardFactsInput,
} from "./purposes/posture-summary.js";
export { MOCK_BAD_NUMBER_MARKER } from "./mock/posture-summary.js";
export {
  buildControlTestStepsPrompt,
  ControlTestStepsOutput,
  type ControlText,
} from "./purposes/control-test-steps.js";
export {
  AiActClassificationOutput,
  buildAiActClassificationPrompt,
  type AiSystemProfileText,
} from "./purposes/ai-act-classification.js";
export {
  AiActGuidanceOutput,
  buildAiActGuidancePrompt,
  type AiActGuidanceInput,
} from "./purposes/ai-act-guidance.js";
export { MOCK_AI_ACT_RATIONALE } from "./mock/ai-act.js";
export { wrapUntrusted } from "./untrusted.js";
export {
  downloadModel,
  MODEL_REPO,
  MODEL_REVISION,
  ModelIntegrityError,
  verifyModel,
} from "./model-files.js";
