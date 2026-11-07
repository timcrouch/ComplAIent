import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { downloadModel, MODEL_REPO, MODEL_REVISION, verifyModel } from "./model-files.js";

export const EMBEDDING_DIMENSIONS = 384;
/** Stored with each embedding: a new revision re-embeds the library. */
export const LOCAL_EMBEDDING_MODEL = `${MODEL_REPO}@${MODEL_REVISION}`;

/**
 * Turns text into unit-length vectors inside the installation. No implementation may send text
 * to a remote service (spec §11, ADR-0011).
 */
export interface Embedder {
  readonly model: string;
  readonly dimensions: 384;
  embed(texts: string[]): Promise<Float32Array[]>;
}

/** The text a library control is embedded from: our code, title, description and guidance. */
export function controlEmbeddingText(c: {
  code: string;
  title: string;
  description: string;
  guidance: string[];
}): string {
  return [`${c.code} ${c.title}`, c.description, ...c.guidance].join("\n");
}

/** sha256 hex of the embedded text; a changed hash means the stored vector is stale. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean"; normalize: true },
) => Promise<{ dims: number[]; data: ArrayLike<number> }>;

export type LocalEmbedderOptions = {
  cacheDir: string;
  /** Defaults to process.env.NODE_ENV. In production the model is never downloaded. */
  nodeEnv?: string | undefined;
};

type OnnxEnv = { versions?: Record<string, string>; wasm?: { wasmPaths?: unknown } };

/**
 * The directory of the ONNX runtime transformers.js actually loads. The workspace overrides its
 * `onnxruntime-node` dependency with `onnxruntime-web` (pnpm-workspace.yaml), so the runtime is
 * WebAssembly with no native binding; its .wasm files are served from that package on disk.
 */
function localWasmDirectory(): string {
  const require = createRequire(import.meta.url);
  const transformers = require.resolve("@huggingface/transformers");
  const runtime = createRequire(transformers).resolve("onnxruntime-node");
  const dir = dirname(runtime);
  if (!existsSync(join(dir, "ort-wasm-simd-threaded.wasm"))) {
    throw new Error("The WebAssembly ONNX runtime is not installed (onnxruntime-web override)");
  }
  return `${dir}${sep}`;
}

/**
 * transformers.js `feature-extraction` with all-MiniLM-L6-v2 pinned to MODEL_REVISION (mean
 * pooling, normalised), on the WebAssembly ONNX runtime. The library is loaded on first use, so
 * importing @isms/ai (the API does) never loads it. transformers.js itself never fetches: outside
 * production the pinned files are downloaded and checked against their sha256 here, and in
 * production they must already be in the cache directory (the image carries them).
 */
export function createLocalEmbedder(options: LocalEmbedderOptions): Embedder {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;
  let extractor: Promise<FeatureExtractor> | undefined;

  async function load(): Promise<FeatureExtractor> {
    const dir =
      nodeEnv === "production"
        ? await verifyModel(options.cacheDir)
        : await downloadModel(options.cacheDir);
    const transformers = await import("@huggingface/transformers");
    const onnx = transformers.env.backends.onnx as OnnxEnv;
    if (!onnx.versions?.["web"] || onnx.versions["node"]) {
      throw new Error("transformers.js must run on the WebAssembly ONNX runtime");
    }
    // Never the CDN default transformers.js would otherwise set.
    if (onnx.wasm) onnx.wasm.wasmPaths = localWasmDirectory();
    transformers.env.allowRemoteModels = false;
    transformers.env.allowLocalModels = true;
    transformers.env.useFSCache = false;
    // An absolute directory is read as a local model path, not as a Hub id.
    const pipe = await transformers.pipeline("feature-extraction", dir, {
      dtype: "fp32",
      device: "cpu",
    });
    return pipe as unknown as FeatureExtractor;
  }

  return {
    model: LOCAL_EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts) {
      if (texts.length === 0) return [];
      extractor ??= load().catch((error: unknown) => {
        extractor = undefined;
        throw error;
      });
      const output = await (await extractor)(texts, { pooling: "mean", normalize: true });
      const [rows, width] = output.dims;
      if (rows !== texts.length || width !== EMBEDDING_DIMENSIONS) {
        throw new Error("The embedding model returned an unexpected shape");
      }
      const data = Float32Array.from(output.data);
      return texts.map((_, i) =>
        data.slice(i * EMBEDDING_DIMENSIONS, (i + 1) * EMBEDDING_DIMENSIONS),
      );
    },
  };
}

function normalise(vector: Float32Array): Float32Array {
  let norm = 0;
  for (const x of vector) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) {
    // An empty text still gets a unit vector, so cosine distance stays defined.
    vector[0] = 1;
    return vector;
  }
  for (let i = 0; i < vector.length; i += 1) vector[i] = (vector[i] ?? 0) / norm;
  return vector;
}

/**
 * Tests only: deterministic token hashing into 384 dimensions, normalised. Equal texts give equal
 * vectors, and texts sharing words are closer than texts sharing none.
 */
export function createHashEmbedder(): Embedder {
  return {
    model: "test/hash-384",
    dimensions: EMBEDDING_DIMENSIONS,
    embed(texts) {
      return Promise.resolve(
        texts.map((text) => {
          const vector = new Float32Array(EMBEDDING_DIMENSIONS);
          for (const token of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
            if (token.length === 0) continue;
            const digest = createHash("sha256").update(token).digest();
            const index = digest.readUInt32BE(0) % EMBEDDING_DIMENSIONS;
            vector[index] = (vector[index] ?? 0) + ((digest[4] ?? 0) & 1 ? 1 : -1);
          }
          return normalise(vector);
        }),
      );
    },
  };
}
