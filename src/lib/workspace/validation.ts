export const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const integer = (v: unknown, min: number, max: number) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const name = (v: unknown, max = 80) => typeof v === "string" && [...v.trim()].length >= 1 && [...v.trim()].length <= max;
const fields: Record<string, string[]> = {
  period_create: ["year", "semester"], period_activate: ["period_id"], grade_create: ["period_id", "number"],
  class_save: ["period_id", "grade_id", "classroom_id", "number", "name", "active"],
  assignment: ["period_id", "grade_id", "classroom_id", "user_id", "manager"],
  student_save: ["period_id", "grade_id", "classroom_id", "id", "number", "name", "active"],
  subject_save: ["period_id", "grade_id", "id", "name", "order", "active"],
  unit_save: ["period_id", "grade_id", "subject_id", "id", "name", "order", "active"],
  member_update: ["user_id", "name", "active"], member_reset: ["user_id"], teacher_create: ["username", "name"],
};
export function validSchoolMutation(input: unknown): input is { version: number; payload: Record<string, unknown> & { action: string } } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const root = input as Record<string, unknown>;
  if (Object.keys(root).some(k => !["version", "payload"].includes(k)) || !integer(root.version, 1, 2147483646) || !root.payload || typeof root.payload !== "object" || Array.isArray(root.payload)) return false;
  const p = root.payload as Record<string, unknown>;
  if (typeof p.action !== "string" || !Object.hasOwn(fields, p.action)) return false;
  const action = p.action, allowed = fields[action];
  if (!allowed || Object.keys(p).some(k => k !== "action" && !allowed.includes(k)) || allowed.some(k => !(k in p))) return false;
  for (const [key, value] of Object.entries(p)) {
    if (value === null && (key === "id" || key === "classroom_id" && action === "class_save" || key === "user_id" && action === "assignment")) continue;
    if ((key.endsWith("_id") || key === "id") && !uuid(value)) return false;
    if (["active", "manager"].includes(key) && typeof value !== "boolean") return false;
  }
  if ("name" in p && !name(p.name, action === "unit_save" ? 160 : 80)) return false;
  if ("year" in p && !integer(p.year, 2000, 2200)) return false;
  if ("semester" in p && !integer(p.semester, 1, 2)) return false;
  if ("number" in p && !integer(p.number, 1, action === "grade_create" ? 6 : action === "student_save" ? 999 : 99)) return false;
  if ("order" in p && !integer(p.order, 0, 9999)) return false;
  if (action === "teacher_create" && (typeof p.username !== "string" || !/^[a-z0-9._-]{4,30}$/.test(p.username))) return false;
  return true;
}
export function validProgress(input: unknown): input is { classroom_id: string; unit_id: string; completed: boolean; version: number } {
  if (!input || typeof input !== "object") return false;
  const p = input as Record<string, unknown>;
  return Object.keys(p).length === 4 && uuid(p.classroom_id) && uuid(p.unit_id) && typeof p.completed === "boolean" && integer(p.version, 0, 2147483646);
}
