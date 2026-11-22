/** Public surface of the storage module: object storage for file bytes. */
export { S3Store, type S3Config } from "./s3.store.js";
export { s3ConfigFromEnv, type AttachmentStorage } from "./storage.config.js";
