# ADR-0009: AI gateway, provider routing and AI data handling

Status: Accepted (2026-11-05)

## Context

The risk slice uses a language model in three places: a guided conversation that turns a reported concern into a draft risk, control suggestions for a risk, and framework suggestions during organisation setup. The customers are regulated organisations, mostly German financial services. What they type can describe weaknesses in their own security, so it is sensitive. It must not be kept or trained on by a model host, it should stay in the EU, and nothing the model says may become an official record without a person deciding (spec §11). Each installation brings its own OpenRouter key, entered by an administrator at runtime (spec §11.1).

## Decision

- **One gateway package, `@isms/ai`.** It is framework-free (no NestJS, no pino), so the API and the BullMQ worker share one readiness, provider and recording path (`createGateway`). It may depend only on `@isms/database`, `@isms/domain` and `@isms/config` (dependency-cruiser rule `ai-allowed-packages`).
  - Business modules call **typed purposes** only: `concern_turn`, `control_suggestion`, `framework_suggestion`, and `connection_test` for the admin screen. Each purpose has its own Zod output schema and its own configured model (`MODEL_KEY_BY_PURPOSE`: conversation, controls, frameworks; the connection test uses the conversation model, or the first listed model). No business code sees a provider SDK, a base URL or the key.
  - The provider interface (`AiProvider`) has two implementations: OpenRouter, and a deterministic mock.
- **EU routing and zero retention on every call (P3-R8).**
  - With EU-only on, the adapter calls OpenRouter's in-region base URL `https://eu.openrouter.ai/api/v1`, available on OpenRouter's Business and Enterprise plans. Otherwise it calls `https://openrouter.ai/api/v1`.
  - Every request sends `provider: { zdr: true, data_collection: "deny", require_parameters: true }`. `zdr: true` restricts routing to zero-data-retention endpoints; `data_collection: "deny"` excludes hosts that store or train on prompts; `require_parameters` excludes hosts that would silently ignore the structured-output schema.
  - The model list comes from `GET {base}/endpoints/zdr` (OpenRouter's list of ZDR endpoints), so only models with a zero-retention endpoint can be chosen.
  - The gateway refuses every call while either privacy setting is off (readiness `privacyOff`), so a non-EU or non-ZDR request is never sent. If the owner's plan lacks EU routing, the connection test says so (`noEndpoint` or `auth`), and AI stays off.
- **Provider selection (P3-R9).** `AI_PROVIDER` is `openrouter` (default) or `mock`. The mock is **refused at startup when `NODE_ENV=production`** (`assertNotMockInProduction`). Integration and e2e tests use the mock; unit tests use fake `fetch` implementations. CI makes no real calls.
- **The provider key is sealed (P3-R10).**
  - AES-256-GCM, layout `0x01 | iv(12) | tag(16) | ciphertext`, with the additional authenticated data `isms:ai-settings:openrouter-key:v1`, stored in `AiSettings.sealedKey`. The encryption key is `AI_SECRETS_KEY` (base64 of exactly 32 bytes) from the environment or secret store, never the database.
  - `AI_SECRETS_KEY` is optional. Without it, a stored key reads as `secretsKeyMissing` and saving a key is refused. After the secrets key changes, the stored key cannot be opened (`keyUnreadable`) and must be entered again; rotation tooling is Plan 4.
  - The plaintext key exists only in memory, while building a provider. It is never written to logs, errors, API responses, audit payloads or `AiInteraction`. `ProviderError` and `SecretUnreadableError` messages are fixed per kind and never carry a response body or the key. Only `keyLast4`, who set it and when are shown.
- **Readiness** is checked in this order: `secretsKeyMissing` (only when a key is stored), `noKey`, `keyUnreadable`, `privacyOff`, `disabled`, `noModel`. The connection test ignores the master switch and the model choice, never privacy.
- **Structured output, one retry, then the manual path.** The JSON Schema sent as `response_format` (`strict: true`) is generated from the purpose's Zod schema and must be strict: every object closed and every property required (nullable, not optional). Invalid JSON or a schema mismatch is retried once with the same request. A provider error is never retried. After that the caller falls back to the manual path with a clear message (form, manual controls, manual frameworks). Every workflow works with AI off.
- **What `AiInteraction` stores.** One row per call: purpose, provider, model, routing (`baseUrl`, `zdr`, `dataCollection`, and the upstream host when reported), the request (system prompt and messages), the last raw response, status (`ok`, `invalid_output`, `provider_error`, `refused`), attempts, duration, the actor, the linked object, and later the outcome (`pending`, `accepted`, `rejected`, `partial`) and the number of discarded suggestions.
  - The app role may `INSERT` and `SELECT`, and may `UPDATE` only `outcome` and `discardedCount`. It cannot change the request or response, delete rows or truncate the table (migration `20261105000100_ai_gateway`, grants test).
  - **Who may read it:** holders of `ai.transcripts.read` (administrator, CISO and auditor), and reporters for their own conversations through ownership (P3-R1). Suggestions are recorded here, not in `AuditEvent`. The people's decisions on them are audited (P3-R11).
- **Prompts carry no unauthorised data.** System prompts hold only what every member may read: the organisation profile, site names and the control library, referenced by our code and title (no ISO text). User text and retrieved content go into user-role messages inside delimiters, never into the system prompt, and are treated as untrusted. Embeddings are computed inside the installation (spec §11), so user text is not sent out for embedding.
- **Operational logs carry no content.** The gateway accepts an optional logger and logs only event names, purpose, status, attempts, durations, the interaction id and the provider error kind. Prompts, responses and the key are never logged.
- **AI never changes anything official.** Its output is stored as suggestions, drafts or estimates. A person's explicit, audited action turns it into a record.

## Consequences

- One place enforces privacy routing, so a new purpose cannot bypass it; it adds a schema, a model key and a mock reply.
- Installations without an OpenRouter plan that offers EU routing cannot use AI with EU-only on; the product still works without it.
- `AiInteraction` keeps sensitive text in the database for review and accountability. Its retention and export follow the audit trail's later retention work, and access is limited by `ai.transcripts.read`.
- Losing or changing `AI_SECRETS_KEY` means re-entering the provider key, not data loss.
- Strict schemas constrain how purposes are modelled (no optional fields), in exchange for structured output that compatible hosts enforce.
