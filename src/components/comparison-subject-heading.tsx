import type { GradeClassroom, GradeSubject } from "@/lib/grade-admin/types";
import { ProgressMeter } from "./comparison-progress";

export function ComparisonSubjectHeading({ subject, classrooms }: {
  subject: Pick<GradeSubject, "id" | "name">;
  classrooms: Pick<GradeClassroom, "subjects">[];
}) {
  const rates = classrooms.flatMap(classroom => {
    const value = classroom.subjects.find(item => item.subject_id === subject.id);
    return value && value.total > 0 ? [value.completed / value.total * 100] : [];
  });
  const average = rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : null;

  return <span className="grade-subject-heading">
    <span className="grade-subject-title">{subject.name}</span>
    {average === null
      ? <span className="grade-subject-no-average">—<small>단원 미등록</small></span>
      : <ProgressMeter percentage={average} label={`${subject.name} 평균 진도율`} />}
  </span>;
}
