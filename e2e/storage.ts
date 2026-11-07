import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { E2E_S3_BUCKET, S3_ENDPOINT } from "./env";

/**
 * Creates the e2e evidence bucket in the local MinIO if it is missing. Compose creates only
 * the dev bucket; e2e keeps its files apart because the demo spec's reset deletes every
 * evidence object in its bucket.
 */
export async function ensureE2eBucket(): Promise<void> {
  const s3 = new S3Client({
    endpoint: S3_ENDPOINT,
    region: "eu-central-1",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.MINIO_ROOT_USER ?? "",
      secretAccessKey: process.env.MINIO_ROOT_PASSWORD ?? "",
    },
  });
  try {
    await s3.send(new HeadBucketCommand({ Bucket: E2E_S3_BUCKET }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: E2E_S3_BUCKET }));
    } catch (error) {
      if (!(error instanceof BucketAlreadyOwnedByYou)) throw error;
    }
  } finally {
    s3.destroy();
  }
}
