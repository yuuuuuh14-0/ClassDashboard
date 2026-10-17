export type GradeContext = { id: string; grade_number: number; school_name: string; academic_year: number; semester: number; status: "draft" | "active" };
export type DashboardAccess = { school_role: "teacher" | "school_admin" | null; school_name: string | null; grades: GradeContext[] };
export type GradeSubject = { id: string; name: string; units: { id: string; title: string }[] };
export type ClassSubject = { subject_id: string; completed: number; total: number; percentage: number | null };
export type GradeClassroom = { id: string; name: string; class_number: number; teacher_name: string | null; student_count: number; subjects: ClassSubject[]; completed_unit_ids: string[] };
export type GradeSnapshot = {
  context: GradeContext & { own_classroom_id: string | null };
  subjects: GradeSubject[];
  classrooms: GradeClassroom[];
  students: { id: string; classroom_id: string; student_number: number; name: string }[];
  updated_at: string;
};
