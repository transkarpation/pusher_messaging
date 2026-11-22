import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface S3Config {
  bucket: string;
  region: string;
  /** Unset: the AWS SDK's default credential chain (env, profile, instance role). */
  credentials?: { accessKeyId: string; secretAccessKey: string };
  /** Prepended to every object key, e.g. "attachments/". */
  prefix: string;
}

/** Objects in one AWS S3 bucket, addressed by key. */
export class S3Store {
  private readonly client: S3Client;

  constructor(readonly config: S3Config) {
    this.client = new S3Client({
      region: config.region,
      credentials: config.credentials,
    });
  }

  async put(key: string, data: Buffer, contentType: string) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: this.fullKey(key), Body: data, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: this.fullKey(key) }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }

  /** Deletes the objects; missing ones are ignored. */
  async delete(keys: string[]) {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.config.bucket,
          Delete: { Objects: batch.map((k) => ({ Key: this.fullKey(k) })), Quiet: true },
        }),
      );
    }
  }

  private fullKey(key: string) {
    return this.config.prefix + key;
  }
}
