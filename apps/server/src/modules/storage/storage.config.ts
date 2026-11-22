import type { S3Config } from "./s3.store.js";

/** Where new attachment bytes go: the attachment_data table in Postgres, or the S3 bucket. */
export type AttachmentStorage = "db" | "s3";

/**
 * The AWS S3 bucket for attachments, from the S3_* variables, or null when S3_BUCKET isn't set
 * (then files stay in Postgres, as before).
 */
export function s3ConfigFromEnv(): S3Config | null {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return null;
  const region = process.env.S3_REGION;
  if (!region) throw new Error("S3_REGION is not set (needed with S3_BUCKET)");
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!accessKeyId !== !secretAccessKey) {
    throw new Error("Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither (to use the default AWS credentials)");
  }
  return {
    bucket,
    region,
    credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    prefix: process.env.S3_PREFIX ?? "attachments/",
  };
}
