import { chatWithRoleStream } from "../server/providers";

const neutralPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JZVYAAAAASUVORK5CYII=";
const startedAt = Date.now();
let deltaChars = 0;

try {
  const result = await chatWithRoleStream(
    "context",
    [{ role: "user", content: "Опиши, есть ли прикреплённое изображение. Ответь одним коротким предложением." }],
    { imageUrls: [neutralPng] },
    (delta) => { deltaChars += delta.length; },
  );
  console.log(JSON.stringify({
    event: "v6-n.role-stream-vision-probe",
    outcome: "pass",
    provider: result.provider,
    fallbackUsed: result.fallbackUsed,
    deltaChars,
    responsePresent: result.content.length > 0,
    latencyMs: Date.now() - startedAt,
  }));
} catch (error) {
  const status = error instanceof Error && "status" in error
    ? (error as Error & { status?: { category?: string; http?: number | null } }).status
    : undefined;
  console.log(JSON.stringify({
    event: "v6-n.role-stream-vision-probe",
    outcome: "degraded",
    category: status?.category ?? "UNKNOWN",
    http: status?.http ?? null,
    latencyMs: Date.now() - startedAt,
  }));
}
