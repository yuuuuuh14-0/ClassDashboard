import type { ClassSubject } from "@/lib/grade-admin/types";

export function ProgressMeter({ percentage, label, valueText }: { percentage: number; label: string; valueText?: string }) {
  const value = Math.min(100, Math.max(0, percentage));
  const rounded = Math.round(value);

  return <span className="grade-progress" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-valuetext={valueText ?? `${rounded}%`}>
    <span className="grade-rate-label" style={{ left: `${value}%` }} aria-hidden="true">{rounded}%</span>
    <span className="grade-track" aria-hidden="true"><span className="grade-track-fill" style={{ width: `${value}%` }} /></span>
  </span>;
}

export function ComparisonProgress({ value }: { value: ClassSubject | undefined }) {
  if (!value?.total) return <span className="grade-no-units">—<small>단원 미등록</small></span>;

  const percentage = Math.min(100, Math.max(0, value.percentage ?? value.completed / value.total * 100));
  const rounded = Math.round(percentage);

  return <span className="grade-rate">
    <ProgressMeter percentage={percentage} label="단원 진도율" valueText={`${rounded}% · ${value.completed}/${value.total} 단원`} />
    <small>{value.completed}/{value.total} 단원</small>
  </span>;
}
