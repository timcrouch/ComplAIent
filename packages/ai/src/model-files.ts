import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** The embedding model, pinned to one commit of its Hugging Face repository (ADR-0011). */
export const MODEL_REPO = "Xenova/all-MiniLM-L6-v2";
export const MODEL_REVISION = "751bff37182d3f1213fa05d7196b954e230abad9";

export type ModelFile = { path: string; sha256: string };

/** Every file the fp32 feature-extraction pipeline reads, with its expected sha256. */
export const MODEL_FILES: readonly ModelFile[] = [
  {
    path: "config.json",
    sha256: "7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7",
  },
  {
    path: "tokenizer.json",
    sha256: "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
  },
  {
    path: "tokenizer_config.json",
    sha256: "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
  },
  {
    path: "onnx/model.onnx",
    sha256: "759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e",
  },
];

export class ModelIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelIntegrityError";
  }
}

/** Where the pinned model lives under the cache directory: `<cacheDir>/<repo>/<revision>`. */
export function modelDirectory(cacheDir: string): string {
  return join(cacheDir, MODEL_REPO, MODEL_REVISION);
}

export function modelUrl(path: string): string {
  return `https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${path}`;
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

async function hashOf(file: string): Promise<string | null> {
  try {
    return sha256(await readFile(file));
  } catch {
    return null;
  }
}

/** Throws ModelIntegrityError unless every file is present with its expected sha256. */
export async function verifyFiles(dir: string, files: readonly ModelFile[]): Promise<void> {
  for (const file of files) {
    const actual = await hashOf(join(dir, file.path));
    if (actual === null) throw new ModelIntegrityError(`Model file missing: ${file.path}`);
    if (actual !== file.sha256) {
      throw new ModelIntegrityError(`Model file does not match its pinned sha256: ${file.path}`);
    }
  }
}

export type FetchVerifiedOptions = {
  dir: string;
  files: readonly ModelFile[];
  urlFor: (path: string) => string;
  fetchImpl?: typeof fetch;
};

/**
 * Downloads each file that is missing or altered, checks its sha256 before writing it (via a
 * temporary file and a rename), and fails on any mismatch. Only public model weights are fetched.
 */
export async function fetchVerifiedFiles(options: FetchVerifiedOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  for (const file of options.files) {
    const target = join(options.dir, file.path);
    if ((await hashOf(target)) === file.sha256) continue;
    const response = await fetchImpl(options.urlFor(file.path));
    if (!response.ok) {
      throw new ModelIntegrityError(
        `Model file download failed (${String(response.status)}): ${file.path}`,
      );
    }
    const data = new Uint8Array(await response.arrayBuffer());
    if (sha256(data) !== file.sha256) {
      throw new ModelIntegrityError(
        `Downloaded model file does not match its pinned sha256: ${file.path}`,
      );
    }
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.download`;
    try {
      await writeFile(temporary, data);
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

/** Downloads (if needed) and verifies the pinned model; returns its directory. */
export async function downloadModel(cacheDir: string, fetchImpl?: typeof fetch): Promise<string> {
  const dir = modelDirectory(cacheDir);
  await fetchVerifiedFiles({
    dir,
    files: MODEL_FILES,
    urlFor: modelUrl,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  return dir;
}

/** Verifies the pinned model without any network access; returns its directory. */
export async function verifyModel(cacheDir: string): Promise<string> {
  const dir = modelDirectory(cacheDir);
  await verifyFiles(dir, MODEL_FILES);
  return dir;
}
