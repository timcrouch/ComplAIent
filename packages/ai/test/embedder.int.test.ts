import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createLocalEmbedder } from "../src/embedder.js";
import { downloadModel, MODEL_REVISION } from "../src/model-files.js";

// The real model: downloaded once into the repository's .cache/models (CI caches it). Only the
// public model weights are fetched; no text leaves the machine.
const cacheDir = resolve(
  import.meta.dirname,
  "../../..",
  process.env.EMBEDDINGS_CACHE_DIR ?? ".cache/models",
);

function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

// Outside production the embedder downloads on first use; done once up front so each test stands alone.
beforeAll(async () => {
  await downloadModel(cacheDir);
}, 180_000);

describe("local embedder", () => {
  it("the local model returns 384 normalised dimensions and ranks a related sentence above an unrelated one", async () => {
    const embedder = createLocalEmbedder({ cacheDir });
    expect(embedder.model).toBe(`Xenova/all-MiniLM-L6-v2@${MODEL_REVISION}`);
    expect(embedder.dimensions).toBe(384);
    const [query, related, unrelated] = await embedder.embed([
      "A stolen laptop exposes customer records because its disk is not encrypted.",
      "Encrypt the storage of laptops and portable devices.",
      "The canteen serves soup on Tuesdays.",
    ]);
    if (!query || !related || !unrelated) throw new Error("missing vectors");
    for (const v of [query, related, unrelated]) {
      expect(v).toBeInstanceOf(Float32Array);
      expect(v).toHaveLength(384);
      expect(Math.sqrt(dot(v, v))).toBeCloseTo(1, 4);
    }
    expect(dot(query, related)).toBeGreaterThan(dot(query, unrelated));
  }, 180_000);

  it("in production, reads the model from the cache directory and never fetches it", async () => {
    const offline = createLocalEmbedder({ cacheDir, nodeEnv: "production" });
    const [vector] = await offline.embed(["Back up the payroll database."]);
    expect(vector).toHaveLength(384);

    const empty = createLocalEmbedder({
      cacheDir: resolve(import.meta.dirname, "no-such-model-cache"),
      nodeEnv: "production",
    });
    await expect(empty.embed(["x"])).rejects.toThrow(/model file/i);
  }, 60_000);

  it("runs on the local WASM runtime, never on a native binding or a CDN", async () => {
    await createLocalEmbedder({ cacheDir }).embed(["warm-up"]);
    const { env } = await import("@huggingface/transformers");
    const onnx = env.backends.onnx as {
      versions?: Record<string, string>;
      wasm?: { wasmPaths?: unknown };
    };
    expect(onnx.versions?.["web"]).toBeDefined();
    expect(onnx.versions?.["node"]).toBeUndefined();
    const paths = String(onnx.wasm?.wasmPaths);
    expect(paths).not.toMatch(/^https?:/);
    expect(paths).toContain("onnxruntime-web");
  }, 60_000);

  it("returns no vectors for no texts", async () => {
    expect(await createLocalEmbedder({ cacheDir }).embed([])).toEqual([]);
  });
});
