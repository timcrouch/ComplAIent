# ADR-0011: Local embeddings for control retrieval

Status: Accepted (2026-11-05)

## Context

Control suggestions (P3-R11) pick candidates from the control library by meaning, not by keyword: a risk about a stolen laptop should find the control about encrypting devices. That needs text embeddings for the library and for each risk. A risk describes weaknesses in the customer's own security, so its text is sensitive. The spec (§11) decides that embeddings are computed **inside the installation**, with a small open model and no Python service.

## Decision

- **Model.** `Xenova/all-MiniLM-L6-v2`, the ONNX export of `sentence-transformers/all-MiniLM-L6-v2`. Licence: Apache-2.0.
  - It gives 384-dimensional vectors. We use mean pooling and normalise them to unit length, so cosine distance is the measure.
  - **Pinned** to commit `751bff37182d3f1213fa05d7196b954e230abad9`. The four files the pipeline reads (`config.json`, `tokenizer.json`, `tokenizer_config.json`, `onnx/model.onnx`) are listed with their sha256 in `packages/ai/src/model-files.ts`.
  - The stored model id is `Xenova/all-MiniLM-L6-v2@<revision>`, so moving to a new revision re-embeds the library.
- **Runtime: transformers.js on WebAssembly.** `@huggingface/transformers` `4.3.1`, pinned exactly, runs the `feature-extraction` pipeline with `dtype: "fp32"`.
  - transformers.js's Node build hard-wires `onnxruntime-node`, a native binding that is glibc only and so cannot load on the Alpine images. `pnpm-workspace.yaml` therefore overrides two of its dependencies:
    - `onnxruntime-node` with `onnxruntime-web@1.30.0`;
    - its prerelease `onnxruntime-web` with the same stable `1.30.0`.
  - The pipeline's `cpu` device then runs ONNX Runtime's WebAssembly backend. The embedder checks at load time that the runtime is the web one, so a missing override fails loudly instead of silently loading a native binding.
  - transformers.js would set the `.wasm` location to a CDN by default. The embedder always points it at the files of the installed `onnxruntime-web` package, so no code is fetched at run time.
  - Speed is ample: about 150 ms for 32 control texts with 4 threads, and the library is embedded once per change.
  - The library is loaded on first use (dynamic import), so importing `@isms/ai` (the API does) never loads it.
  - It is an optional peer of `@isms/ai` and a dependency of `@isms/worker`, so the API image does not carry it.
  - The worker image stays on `node:26.13-alpine3.24` and passes the Trivy gate (R29). transformers.js still installs `sharp`, which it imports for image tasks we do not use; sharp ships musl prebuilds, so it loads.
- **User text never leaves the installation for embedding.** Risk text is embedded in the worker process. The only network traffic is the download of the pinned public model files from Hugging Face. No text is sent with it.
- **Downloading is ours, not transformers.js's.**
  - transformers.js always runs with remote models off and reads the model from an absolute local directory, `<EMBEDDINGS_CACHE_DIR>/<repo>/<revision>`.
  - Outside production, the embedder downloads any missing file from `https://huggingface.co/<repo>/resolve/<revision>/<file>`. It checks each file's sha256 before writing it and fails on a mismatch.
  - With `NODE_ENV=production`, it never downloads. It verifies the files against their sha256 and fails if any is missing or altered.
- **Build time.**
  - `Dockerfile.worker` runs `dist/fetch-model.js` in the builder stage. That script downloads and verifies the model into the image's `EMBEDDINGS_CACHE_DIR` (`/app/.cache/models`), then loads it the way production does.
  - Compose and production must not override `EMBEDDINGS_CACHE_DIR`. The `.env.example` value is for local development only.
  - In local development, the default `.cache/models` is relative to the working directory and gitignored.
  - CI caches the repository's `.cache/models` with `actions/cache`. The cache key covers `model-files.ts` and the transformers.js version.
- **Storage and retrieval.**
  - `ControlEmbedding` holds one `vector(384)` per control, with the model id and a sha256 `contentHash` of the embedded text (code, title, description, guidance).
  - `ensureLibraryEmbedded` embeds only controls with no row, another model or another hash. The worker runs it as the `library.embed` job at every start.
  - `nearestControls` orders by `embedding <=> $1::vector`. The vector is passed as a bind parameter in pgvector's text form, never spliced into SQL.
  - Both run as the app role.
- **Embeddings are derived data.** They can be deleted and rebuilt at any time from the library. They are not audited, not versioned and not backed up for their own sake.
- **Retries can repeat a paid call.** `risk.suggest_controls` is retried by BullMQ on an unexpected error. If the error comes after the AI call succeeded (while storing suggestions or setting the outcome), the retry makes a second, paid AI call. It also leaves the first `AiInteraction` with outcome `none`. This is accepted: such errors are rare, each call is recorded, and suggestions are replaced, not duplicated. The risk stays `pending` until the last attempt, which marks it `failed`.
- **Tests.** Unit and integration tests use a deterministic hash embedder (`createHashEmbedder`, `test/hash-384`, exported from `@isms/ai/testing` only). One integration test runs the real model on the WebAssembly runtime.

## Consequences

- No embedding API key, no extra service, no native ONNX binding, and no user text sent out to compute embeddings.
- The worker image carries the model (about 96 MB) and the WebAssembly runtime.
- A new model revision means:
  - updating `MODEL_REVISION` and the file hashes;
  - the library re-embeds on the next start.

  A model with a different dimension needs a migration.

- The two overrides must be revisited whenever transformers.js is upgraded.
