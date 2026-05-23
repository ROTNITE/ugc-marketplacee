import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type PresignedUpload = {
  uploadUrl: string;
  publicUrl: string;
  expiresAt: Date;
  fields?: Record<string, string>;
};

export type MediaStorage = {
  createUploadUrl(input: {
    mimeType: string;
    sizeBytes: number;
    userId: string;
  }): Promise<PresignedUpload>;
};

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm"];

export function assertUploadAllowed(input: { mimeType: string; sizeBytes: number }) {
  if (!ALLOWED_MIME.includes(input.mimeType)) {
    throw new Error(`Unsupported mime type: ${input.mimeType}`);
  }
  if (input.sizeBytes <= 0 || input.sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error("File size out of range");
  }
}

/**
 * Dev impl: writes uploads to ./uploads on the local filesystem and returns
 * a URL pointing at a future /uploads/local endpoint. Use this for local
 * end-to-end testing without an S3 bucket.
 */
export class LocalDiskStorage implements MediaStorage {
  constructor(
    private readonly baseDir: string = join(process.cwd(), "uploads"),
    private readonly publicBaseUrl: string = "http://localhost:4000/uploads/local"
  ) {}

  async createUploadUrl(input: {
    mimeType: string;
    sizeBytes: number;
    userId: string;
  }): Promise<PresignedUpload> {
    assertUploadAllowed(input);
    await mkdir(this.baseDir, { recursive: true });
    const id = randomUUID();
    await writeFile(join(this.baseDir, `${id}.meta`), JSON.stringify(input));
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    return {
      uploadUrl: `${this.publicBaseUrl}/${id}`,
      publicUrl: `${this.publicBaseUrl}/${id}`,
      expiresAt,
      fields: { "x-ugc-user": input.userId }
    };
  }
}

/**
 * S3 / S3-compatible presigned PUT URL via raw SigV4. Activates when
 * S3_BUCKET + S3_ACCESS_KEY_ID + S3_SECRET_ACCESS_KEY are set. Skips the
 * aws-sdk dependency. For production volume, swap for
 * @aws-sdk/s3-request-presigner.
 */
export class S3Storage implements MediaStorage {
  constructor(
    private readonly bucket: string,
    private readonly region: string,
    private readonly accessKeyId: string,
    private readonly secretAccessKey: string,
    private readonly endpoint?: string
  ) {}

  async createUploadUrl(input: {
    mimeType: string;
    sizeBytes: number;
    userId: string;
  }): Promise<PresignedUpload> {
    assertUploadAllowed(input);
    const key = `uploads/${input.userId}/${randomUUID()}`;
    const expires = 15 * 60;
    const endpoint =
      this.endpoint ?? `https://${this.bucket}.s3.${this.region}.amazonaws.com`;
    const uploadUrl = signPutUrl({
      region: this.region,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      key,
      expires,
      endpoint
    });
    return {
      uploadUrl,
      publicUrl: `${endpoint}/${key}`,
      expiresAt: new Date(Date.now() + expires * 1000)
    };
  }
}

export function signPutUrl(input: {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  key: string;
  expires: number;
  endpoint: string;
}): string {
  const now = new Date();
  const amzDate =
    now
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "")
      .slice(0, 15) + "Z";
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${input.region}/s3/aws4_request`;
  const algorithm = "AWS4-HMAC-SHA256";

  const params: Record<string, string> = {
    "X-Amz-Algorithm": algorithm,
    "X-Amz-Credential": `${input.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(input.expires),
    "X-Amz-SignedHeaders": "host"
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(params[k] ?? "")}`)
    .join("&");

  const host = new URL(input.endpoint).host;
  const canonicalUri = `/${input.key.split("/").map(encodeURIComponent).join("/")}`;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD"
  ].join("\n");

  const stringToSign = [
    algorithm,
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, "s3");
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmacHex(kSigning, stringToSign);

  return `${input.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer, value: string): string {
  return createHmac("sha256", key).update(value).digest("hex");
}
