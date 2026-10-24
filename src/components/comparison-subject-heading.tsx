import type { GradeClassroom, GradeSubject } from "@/lib/grade-admin/types";

export function ComparisonSubjectHeading({ subject, classrooms }: {
  subject: Pick<GradeSubject, "id" | "name">;
  classrooms: Pick<GradeClassroom, "subjects">[];
}) {
  const rates = classrooms.flatMap(classroom => {
    const value = classroom.subjects.find(item => item.subject_id === subject.id);
    return value && value.total > 0 ? [value.completed / value.total * 100] : [];
  });
  const average = rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : null;

  return <span className="grade-subject-heading" title={average === null ? `${subject.name} · 단원 미등록` : `${subject.name} 평균 진도율 ${Math.round(average)}%`}>
    {average !== null && <span className="grade-subject-background" role="meter" aria-label={`${subject.name} 평균 진도율`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={average} aria-valuetext={`${Math.round(average)}%`}>
      <span className="grade-subject-fill" style={{ width: `${average}%` }} />
    </span>}
    <span className="grade-subject-title">{subject.name}{average !== null && ` (${Math.round(average)}%)`}</span>
    {average === null && <span className="sr-only">단원 미등록</span>}
  </span>;
}
