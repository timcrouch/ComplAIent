import { Readable } from "node:stream";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/** Injection token of the evidence object store. */
export const OBJECT_STORE = Symbol("OBJECT_STORE");

export interface ObjectStore {
  /** Stores the body; the store checks it against `sha256Base64` and refuses a mismatch. */
  put(
    key: string,
    body: Readable,
    opts: { contentType: string; sha256Base64: string; size: number },
  ): Promise<void>;
  get(key: string): Promise<Readable>;
  /** Only for an object whose database row was never written (orphan cleanup). */
  delete(key: string): Promise<void>;
  /** Resolves when the bucket can be reached (readiness); `signal` cancels the request. */
  head(signal?: AbortSignal): Promise<void>;
  close(): void;
}

/** The store computed another SHA-256 than the one sent: nothing was stored. */
export class ObjectStoreChecksumError extends Error {
  override readonly name = "ObjectStoreChecksumError";
}

/** No object under the key (it was never stored, or was removed at the store). */
export class ObjectMissingError extends Error {
  override readonly name = "ObjectMissingError";
}

/** The S3 settings of `storageConfig` (P3-R15). */
export type StorageSettings = {
  S3_ENDPOINT: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_FORCE_PATH_STYLE: boolean;
};

/** S3 error names for a body that does not match its checksum (AWS and MinIO). */
const CHECKSUM_ERRORS = new Set(["BadDigest", "XAmzContentChecksumMismatch", "InvalidDigest"]);

/** An S3-compatible store (MinIO locally) for one bucket. */
export function createS3ObjectStore(config: StorageSettings): ObjectStore {
  const bucket = config.S3_BUCKET;
  const client = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    // Checksums are the ones we send (SHA-256) and the ones we ask for, nothing implicit.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  return {
    async put(key, body, opts) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentLength: opts.size,
            ContentType: opts.contentType,
            ChecksumSHA256: opts.sha256Base64,
            // Evidence is immutable: never overwrite an existing object.
            IfNoneMatch: "*",
          }),
        );
      } catch (error) {
        if (error instanceof Error && CHECKSUM_ERRORS.has(error.name))
          throw new ObjectStoreChecksumError("The stored object's checksum did not match");
        throw error;
      }
    },
    async get(key) {
      // ChecksumMode makes the SDK verify the stored SHA-256 while the body streams.
      let res;
      try {
        res = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: "ENABLED" }),
        );
      } catch (error) {
        if (error instanceof Error && error.name === "NoSuchKey")
          throw new ObjectMissingError("The object is missing");
        throw error;
      }
      if (!(res.Body instanceof Readable)) throw new Error("The object store returned no body");
      return res.Body;
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async head(signal) {
      await client.send(
        new HeadBucketCommand({ Bucket: bucket }),
        signal === undefined ? {} : { abortSignal: signal },
      );
    },
    close() {
      client.destroy();
    },
  };
}
