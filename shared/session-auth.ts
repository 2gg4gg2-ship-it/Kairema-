import { COOKIE_NAME } from "./const";

export function tokenFromMirroredSession(raw: string | null | undefined) {
  if (!raw) return null;
  const prefix = `${COOKIE_NAME}=`;
  const pair = raw.split(";").find((item) => item.trim().startsWith(prefix));
  const token = pair?.trim().slice(prefix.length).trim();
  return token || null;
}
