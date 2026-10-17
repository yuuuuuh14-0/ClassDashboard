import type { GradeSnapshot } from "@/lib/grade-admin/types";
export type Period = { id: string; academic_year: number; semester: number; status: "draft" | "active" | "archived" };
export type SchoolMember = { user_id: string; username: string; display_name: string; is_active: boolean; role: "teacher" | "school_admin"; password_change_required: boolean };
export type SchoolClass = { id: string; grade_id: string; class_number: number; name: string; is_active: boolean };
export type SchoolSubject = { id: string; grade_id: string; name: string; sort_order: number; is_active: boolean };
export type SchoolUnit = { id: string; grade_id: string; subject_id: string; title: string; sort_order: number; is_active: boolean };
export type SchoolStudent = { id: string; grade_id: string; classroom_id: string; student_number: number; name: string; is_active: boolean };
export type SchoolSnapshot = {
  school: { id: string; name: string; version: number }; period_id: string | null; periods: Period[];
  members: SchoolMember[]; grades: { id: string; grade_number: number }[]; classrooms: SchoolClass[];
  assignments: { classroom_id: string; user_id: string; id: string }[];
  managers: { grade_id: string; user_id: string }[]; subjects: SchoolSubject[]; units: SchoolUnit[]; students: SchoolStudent[]; updated_at: string;
};
export type TeacherSnapshot = {
  choices: (Period & { name: string; school_name: string })[];
  snapshot: (Omit<GradeSnapshot, "context" | "classrooms"> & {
    context: Omit<GradeSnapshot["context"], "status"> & { status: Period["status"] };
    classrooms: (Omit<GradeSnapshot["classrooms"][number], "student_count"> & { student_count: number | null; progress_versions: Record<string, number> })[];
  }) | null;
};
