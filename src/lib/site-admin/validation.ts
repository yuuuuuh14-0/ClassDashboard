import type { AdminMutation } from "./types";

export function parseAdminMutation(input: unknown): AdminMutation | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const allowed = value.action === "create_school" ? ["action", "name"]
    : value.action === "save_school" ? ["action", "id", "name", "version", "active"]
      : value.action === "set_manager" ? ["action", "id", "user_id", "version", "assign"] : [];
  if (!allowed.length || Object.keys(value).some(key => !allowed.includes(key))) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (value.action !== "set_manager" && (!name || [...name].length > 80)) return null;
  if (value.action === "create_school") return { action: value.action, name };
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof value.id !== "string" || !uuid.test(value.id) || typeof value.version !== "number"
    || !Number.isSafeInteger(value.version) || value.version < 1 || value.version > 2_147_483_647) return null;
  if (value.action === "save_school") {
    if ("active" in value && typeof value.active !== "boolean") return null;
    return { action: value.action, id: value.id, name, version: value.version, ...(typeof value.active === "boolean" ? { active: value.active } : {}) };
  }
  if (typeof value.user_id !== "string" || !uuid.test(value.user_id) || typeof value.assign !== "boolean") return null;
  return { action: "set_manager", id: value.id, user_id: value.user_id, version: value.version, assign: value.assign };
}
