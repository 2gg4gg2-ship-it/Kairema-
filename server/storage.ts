// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.

import { ENV } from "./_core/env";

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

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = appendHashSuffix(normalizeKey(relKey));

  // 1. Get presigned PUT URL from Forge
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

  // 2. PUT file directly to S3
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
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
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
}

export async function storageDelete(relKey: string): Promise<boolean> {
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
}

export async function storageCopy(srcKey: string, destKey: string): Promise<{ key: string; url: string }> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const src = normalizeKey(srcKey);
  const dest = normalizeKey(destKey);

  // 1. Get presigned GET URL for source
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

  // 2. Download from source
  const downloadResp = await fetch(s3GetUrl);
  if (!downloadResp.ok) {
    throw new Error(`Storage download failed (${downloadResp.status})`);
  }
  const blob = await downloadResp.blob();

  // 3. Get presigned PUT URL for destination
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

  // 4. Upload to destination
  const uploadResp = await fetch(s3PutUrl, {
    method: "PUT",
    headers: { "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });

  if (!uploadResp.ok) {
    throw new Error(`Storage upload to destination failed (${uploadResp.status})`);
  }

  return { key: dest, url: `/manus-storage/${dest}` };
}
