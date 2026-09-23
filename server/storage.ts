// Preconfigured storage helpers for Manus WebDev templates
// B2 (Backblaze B2 / S3-compatible) storage backend.

import { ENV } from "./_core/env";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

interface StorageAdapter {
  put(relKey: string, data: Buffer | Uint8Array | string, contentType: string): Promise<{ key: string; url: string }>;
  get(relKey: string): Promise<{ key: string; url: string }>;
  getSignedUrl(relKey: string): Promise<string>;
  delete(relKey: string): Promise<boolean>;
  copy(srcKey: string, destKey: string): Promise<{ key: string; url: string }>;
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

// B2 Adapter (S3-compatible)
let b2Client: S3Client | null = null;

function getB2Client(): S3Client {
  if (b2Client) return b2Client;

  const { b2Endpoint, b2Region, b2KeyId, b2ApplicationKey, b2Bucket } = ENV;

  if (!b2Endpoint || !b2Region || !b2KeyId || !b2ApplicationKey || !b2Bucket) {
    throw new Error(
      "B2 storage config missing: set B2_ENDPOINT, B2_REGION, B2_BUCKET, B2_KEY_ID, B2_APPLICATION_KEY",
    );
  }

  b2Client = new S3Client({
    endpoint: b2Endpoint,
    region: b2Region,
    credentials: {
      accessKeyId: b2KeyId,
      secretAccessKey: b2ApplicationKey,
    },
    forcePathStyle: true, // Required for B2
  });

  return b2Client;
}

function getB2Bucket(): string {
  const bucket = ENV.b2Bucket;
  if (!bucket) throw new Error("B2_BUCKET not configured");
  return bucket;
}

function getPublicUrl(key: string): string {
  // For B2, we return the proxy URL pattern. The actual download goes through /manus-storage/*
  // which will be handled by storageProxy.ts
  return `/manus-storage/${key}`;
}

function getSignedUrlForKey(key: string, expiresIn = 3600): Promise<string> {
  const client = getB2Client();
  const bucket = getB2Bucket();
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client, command, { expiresIn });
}

const b2Adapter: StorageAdapter = {
  async put(relKey: string, data: Buffer | Uint8Array | string, contentType = "application/octet-stream") {
    const client = getB2Client();
    const bucket = getB2Bucket();
    const key = appendHashSuffix(normalizeKey(relKey));

    const body = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);

    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );

    return { key, url: getPublicUrl(key) };
  },

  async get(relKey: string) {
    const key = normalizeKey(relKey);
    return { key, url: getPublicUrl(key) };
  },

  async getSignedUrl(relKey: string) {
    const key = normalizeKey(relKey);
    return getSignedUrlForKey(key, 3600); // 1 hour default
  },

  async delete(relKey: string) {
    const client = getB2Client();
    const bucket = getB2Bucket();
    const key = normalizeKey(relKey);

    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );

    return true;
  },

  async copy(srcKey: string, destKey: string) {
    const client = getB2Client();
    const bucket = getB2Bucket();
    const src = normalizeKey(srcKey);
    const dest = normalizeKey(destKey);

    // Verify source exists
    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: bucket,
          Key: src,
        }),
      );
    } catch {
      throw new Error(`Source object not found: ${src}`);
    }

    // Copy within B2
    await client.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${src}`,
        Key: dest,
      }),
    );

    return { key: dest, url: getPublicUrl(dest) }
  },
};

// Public API - B2 backend only
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  return b2Adapter.put(relKey, data, contentType);
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  return b2Adapter.get(relKey);
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  return b2Adapter.getSignedUrl(relKey);
}

export async function storageDelete(relKey: string): Promise<boolean> {
  return b2Adapter.delete(relKey);
}

export async function storageCopy(srcKey: string, destKey: string): Promise<{ key: string; url: string }> {
  return b2Adapter.copy(srcKey, destKey);
}