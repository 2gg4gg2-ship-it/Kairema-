import { tokenFromMirroredSession } from "@shared/session-auth";

export function runtimeAuthHeaders(): Record<string, string> {
  try {
    const token = tokenFromMirroredSession(window.sessionStorage.getItem("manus-cookie"));
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
