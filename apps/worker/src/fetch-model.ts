import { resolve } from "node:path";
import { createLocalEmbedder, downloadModel } from "@isms/ai";
import { embeddingsConfig, loadConfig } from "@isms/config";

/**
 * Image build step only: downloads the embedding model pinned to MODEL_REVISION into
 * EMBEDDINGS_CACHE_DIR, failing if any file's sha256 differs from the pinned one, then loads it
 * the way production does (no network). Public weights only; no user data (ADR-0011).
 */
const cacheDir = resolve(loadConfig(embeddingsConfig).EMBEDDINGS_CACHE_DIR);
const dir = await downloadModel(cacheDir);
const embedder = createLocalEmbedder({ cacheDir, nodeEnv: "production" });
const [vector] = await embedder.embed(["warm-up"]);
if (vector?.length !== embedder.dimensions) throw new Error("The model did not load");
process.stdout.write(`${embedder.model} verified in ${dir}\n`);
