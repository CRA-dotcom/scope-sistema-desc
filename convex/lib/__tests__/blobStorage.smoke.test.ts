import { describe, it, expect } from "vitest";
import {
  buildKey,
  uploadBlob,
  signedDownloadUrl,
  deleteBlob,
  blobExists,
} from "../blobStorage";

const hasCreds =
  !!process.env.RAILWAY_BUCKET_ENDPOINT &&
  !!process.env.RAILWAY_BUCKET_KEY &&
  !!process.env.RAILWAY_BUCKET_SECRET &&
  !!process.env.RAILWAY_BUCKET_NAME;

describe.skipIf(!hasCreds)("blobStorage smoke (real Railway bucket)", () => {
  const orgId = "smoke-org";
  const clientId = "smoke-client";
  const stamp = Date.now();
  const key = buildKey({
    orgId,
    clientId,
    kind: "deliverables",
    suffix: `smoke-${stamp}.txt`,
  });
  const payload = Buffer.from(
    `hello-railway-${stamp}-${Math.random().toString(36).slice(2)}`,
    "utf-8",
  );

  it("uploads a blob and returns bucketKey + etag", async () => {
    const result = await uploadBlob({
      buffer: payload,
      key,
      contentType: "text/plain",
    });
    expect(result.bucketKey).toBe(key);
    expect(typeof result.etag === "string" || result.etag === undefined).toBe(
      true,
    );
  });

  it("blobExists returns true after upload", async () => {
    expect(await blobExists(key)).toBe(true);
  });

  it("signedDownloadUrl returns a fetchable https URL whose body matches", async () => {
    const url = await signedDownloadUrl({ bucketKey: key, expiresSec: 60 });
    expect(url).toMatch(/^https?:\/\//);
    const res = await fetch(url);
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toBe(payload.toString("utf-8"));
  });

  it("deleteBlob removes the object", async () => {
    await deleteBlob(key);
    expect(await blobExists(key)).toBe(false);
  });
});

describe("blobStorage smoke skip notice", () => {
  it.skipIf(hasCreds)("auto-skips when RAILWAY_BUCKET_* env vars missing", () => {
    expect(hasCreds).toBe(false);
  });
});
