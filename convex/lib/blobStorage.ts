"use node";

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type ClientScopedBlobKind =
  | "deliverables"
  | "quotations"
  | "contracts"
  | "invoices"
  | "finanzas";

export type BuildKeyArgs =
  | {
      orgId: string;
      clientId: string;
      kind: ClientScopedBlobKind;
      suffix: string;
    }
  | { orgId: string; kind: "branding"; suffix: string };

const SEGMENT_REJECT = /[\\/]|\.\./;

function assertSegment(name: string, value: string): void {
  if (!value || value.trim() !== value || SEGMENT_REJECT.test(value)) {
    throw new Error(
      `blobStorage.buildKey: invalid ${name} "${value}" — must be non-empty and contain no slashes or ".."`,
    );
  }
}

function assertSuffix(suffix: string): void {
  if (!suffix || suffix.startsWith("/") || suffix.includes("..")) {
    throw new Error(
      `blobStorage.buildKey: invalid suffix "${suffix}" — must be non-empty, not start with "/", and contain no ".."`,
    );
  }
}

export function buildKey(args: BuildKeyArgs): string {
  assertSegment("orgId", args.orgId);
  assertSuffix(args.suffix);
  if (args.kind === "branding") {
    return `${args.orgId}/branding/${args.suffix}`;
  }
  assertSegment("clientId", args.clientId);
  return `${args.orgId}/${args.clientId}/${args.kind}/${args.suffix}`;
}

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const endpoint = process.env.RAILWAY_BUCKET_ENDPOINT;
  const accessKeyId = process.env.RAILWAY_BUCKET_KEY;
  const secretAccessKey = process.env.RAILWAY_BUCKET_SECRET;
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "blobStorage: missing one or more of RAILWAY_BUCKET_ENDPOINT, RAILWAY_BUCKET_KEY, RAILWAY_BUCKET_SECRET",
    );
  }
  cachedClient = new S3Client({
    endpoint,
    region: process.env.RAILWAY_BUCKET_REGION || "auto",
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
  return cachedClient;
}

function getBucketName(): string {
  const name = process.env.RAILWAY_BUCKET_NAME;
  if (!name) {
    throw new Error("blobStorage: RAILWAY_BUCKET_NAME is not set");
  }
  return name;
}

export async function uploadBlob(args: {
  buffer: Uint8Array | Buffer;
  key: string;
  contentType: string;
}): Promise<{ bucketKey: string; etag: string | undefined }> {
  const out = await getClient().send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: args.key,
      Body: args.buffer,
      ContentType: args.contentType,
    }),
  );
  return { bucketKey: args.key, etag: out.ETag };
}

export async function signedDownloadUrl(args: {
  bucketKey: string;
  expiresSec?: number;
}): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: args.bucketKey,
  });
  return getSignedUrl(getClient(), command, {
    expiresIn: args.expiresSec ?? 60 * 60 * 24 * 7,
  });
}

export async function deleteBlob(bucketKey: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: getBucketName(),
      Key: bucketKey,
    }),
  );
}

export async function blobExists(bucketKey: string): Promise<boolean> {
  try {
    await getClient().send(
      new HeadObjectCommand({
        Bucket: getBucketName(),
        Key: bucketKey,
      }),
    );
    return true;
  } catch (err) {
    const name = (err as { name?: string })?.name;
    const httpStatus = (err as { $metadata?: { httpStatusCode?: number } })
      ?.$metadata?.httpStatusCode;
    if (name === "NotFound" || name === "NoSuchKey" || httpStatus === 404) {
      return false;
    }
    throw err;
  }
}
