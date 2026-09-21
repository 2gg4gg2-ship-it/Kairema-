// Preconfigured storage helpers for Manus WebDev templates
// Supports both Manus Forge (legacy) and Backblaze B2 (S3-compatible) backends.

import { ENV } from "./_core/env";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

type StorageBackend = "forge" | "b2";

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

// Forge Adapter (existing implementation)
const forgeAdapter: StorageAdapter = {
  async put(relKey: string, data: Buffer | Uint8Array | string, contentType = "application/octet-stream") {
    const { forgeUrl, forgeKey } = getForgeConfig();
    const key = appendHashSuffix(normalizeKey(relKey));

    const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
    presignUrl.searchParams.set("path", key);

    const presignResp = await fetch(presignUrl, {
      headers: { Authorization: `Bearer ${forgeKey}` },
    });

    if (!presignResp.ok) {
      const msg = await presignResp.text().catch(() => presignResp.statusText);
      throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
    }

    const { url: s3Url } = (await presignResp.json()) as { url: string };
    if (!s3Url) throw new Error("Forge returned empty presign URL");

    const blob =
      typeof data === "string"
        ? new Blob([data], { type: contentType })
        : new Blob([data as any], { type: contentType });

    const uploadResp = await fetch(s3Url, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: blob,
    });

    if (!uploadResp.ok) {
      throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
    }

    return { key, url: `/manus-storage/${key}` };
  },

  async get(relKey: string) {
    const key = normalizeKey(relKey);
    return { key, url: `/manus-storage/${key}` };
  },

  async getSignedUrl(relKey: string) {
    const { forgeUrl, forgeKey } = getForgeConfig();
    const key = normalizeKey(relKey);

    const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
    getUrl.searchParams.set("path", key);

    const resp = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${forgeKey}` },
    });

    if (!resp.ok) {
      const msg = await resp.text().catch(() => resp.statusText);
      throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
    }

    const { url } = (await resp.json()) as { url: string };
    return url;
  },

  async delete(relKey: string) {
    const { forgeUrl, forgeKey } = getForgeConfig();
    const key = normalizeKey(relKey);

    const deleteUrl = new URL("v1/storage/delete", forgeUrl + "/");
    deleteUrl.searchParams.set("path", key);

    const resp = await fetch(deleteUrl, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${forgeKey}` },
    });

    if (!resp.ok) {
      const msg = await resp.text().catch(() => resp.statusText);
      throw new Error(`Storage delete failed (${resp.status}): ${msg}`);
    }

    return true;
  },

  async copy(srcKey: string, destKey: string) {
    const { forgeUrl, forgeKey } = getForgeConfig();
    const src = normalizeKey(srcKey);
    const dest = normalizeKey(destKey);

    const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
    getUrl.searchParams.set("path", src);

    const getResp = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${forgeKey}` },
    });

    if (!getResp.ok) {
      const msg = await getResp.text().catch(() => getResp.statusText);
      throw new Error(`Storage get presign failed (${getResp.status}): ${msg}`);
    }

    const { url: s3GetUrl } = (await getResp.json()) as { url: string };
    if (!s3GetUrl) throw new Error("Forge returned empty presign GET URL");

    const downloadResp = await fetch(s3GetUrl);
    if (!downloadResp.ok) {
      throw new Error(`Storage download failed (${downloadResp.status})`);
    }
    const blob = await downloadResp.blob();

    const putUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
    putUrl.searchParams.set("path", dest);

    const putResp = await fetch(putUrl, {
      headers: { Authorization: `Bearer ${forgeKey}` },
    });

    if (!putResp.ok) {
      const msg = await putResp.text().catch(() => putResp.statusText);
      throw new Error(`Storage put presign failed (${putResp.status}): ${msg}`);
    }

    const { url: s3PutUrl } = (await putResp.json()) as { url: string };
    if (!s3PutUrl) throw new Error("Forge returned empty presign PUT URL");

    const uploadResp = await fetch(s3PutUrl, {
      method: "PUT",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });

    if (!uploadResp.ok) {
      throw new Error(`Storage upload to destination failed (${uploadResp.status})`);
    }

    return { key: dest, url: `/manus-storage/${dest}` };
  },
};

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

// Storage backend selector
function getStorageBackend(): StorageBackend {
  return ENV.storageBackend;
}

function getAdapter(): StorageAdapter {
  const backend = getStorageBackend();
  switch (backend) {
    case "b2":
      return b2Adapter;
    case "forge":
    default:
      return forgeAdapter;
  }
}

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY",
    );
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

// Public API - uses selected backend
export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  return getAdapter().put(relKey, data, contentType);
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  return getAdapter().get(relKey);
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  return getAdapter().getSignedUrl(relKey);
}

export async function storageDelete(relKey: string): Promise<boolean> {
  return getAdapter().delete(relKey);
}

export async function storageCopy(srcKey: string, destKey: string): Promise<{ key: string; url: string }> {
  return getAdapter().copy(srcKey, destKey);
}

// Export backend type for testing
export type { StorageBackend };
export function getCurrentBackend(): StorageBackend {
  return getStorageBackend();
}