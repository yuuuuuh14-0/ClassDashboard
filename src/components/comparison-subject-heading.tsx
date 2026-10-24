import type { GradeClassroom, GradeSubject } from "@/lib/grade-admin/types";

export function ComparisonSubjectHeading({ subject, classrooms }: {
  subject: Pick<GradeSubject, "id" | "name">;
  classrooms: Pick<GradeClassroom, "subjects">[];
}) {
  const rates = classrooms.flatMap(classroom => {
    const value = classroom.subjects.find(item => item.subject_id === subject.id);
    return value && value.total > 0 ? [value.completed / value.total * 100] : [];
  });
  const average = rates.length ? Math.round(rates.reduce((sum, rate) => sum + rate, 0) / rates.length) : null;

  return <span className="grade-subject-heading">{subject.name}<span className="grade-subject-average">(평균: {average === null ? "—" : `${average}%`})</span></span>;
}
