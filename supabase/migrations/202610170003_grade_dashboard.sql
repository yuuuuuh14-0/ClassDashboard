-- Read-only grade-manager workspace. Domain writes will use audited RPCs in a later slice.
create table public.academic_periods (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  academic_year integer not null check (academic_year between 2000 and 2200),
  semester integer not null check (semester in (1,2)),
  status text not null default 'draft' check (status in ('draft','active','archived')),
  created_at timestamptz not null default now(),
  unique(school_id,id), unique(school_id,academic_year,semester)
);
create unique index school_one_active_period on public.academic_periods(school_id) where status = 'active';
create table public.grades (
  id uuid primary key default gen_random_uuid(), school_id uuid not null, period_id uuid not null,
  grade_number integer not null check (grade_number between 1 and 6),
  unique(school_id,period_id,id), unique(period_id,grade_number),
  foreign key(school_id,period_id) references public.academic_periods(school_id,id) on delete cascade
);
create table public.classrooms (
  id uuid primary key default gen_random_uuid(), school_id uuid not null, period_id uuid not null, grade_id uuid not null,
  class_number integer not null check (class_number between 1 and 99),
  name text not null check (char_length(btrim(name)) between 1 and 80), is_active boolean not null default true,
  unique(school_id,period_id,grade_id,id), unique(grade_id,class_number),
  foreign key(school_id,period_id,grade_id) references public.grades(school_id,period_id,id) on delete cascade
);
create table public.teacher_assignments (
  id uuid primary key default gen_random_uuid(), school_id uuid not null, period_id uuid not null, grade_id uuid not null,
  classroom_id uuid not null, user_id uuid not null, is_active boolean not null default true,
  unique(id,school_id,period_id,grade_id,user_id),
  foreign key(school_id,period_id,grade_id,classroom_id) references public.classrooms(school_id,period_id,grade_id,id) on delete cascade,
  foreign key(school_id,user_id) references public.school_memberships(school_id,user_id) on delete cascade
);
create unique index one_teacher_per_classroom on public.teacher_assignments(classroom_id) where is_active;
create unique index one_classroom_per_teacher_period on public.teacher_assignments(period_id,user_id) where is_active;
create table public.grade_manager_assignments (
  id uuid primary key default gen_random_uuid(), school_id uuid not null, period_id uuid not null, grade_id uuid not null,
  user_id uuid not null, teacher_assignment_id uuid not null, is_active boolean not null default true,
  foreign key(teacher_assignment_id,school_id,period_id,grade_id,user_id)
    references public.teacher_assignments(id,school_id,period_id,grade_id,user_id) on delete cascade
);
create unique index one_manager_per_grade on public.grade_manager_assignments(grade_id) where is_active;
create unique index one_grade_manager_per_period on public.grade_manager_assignments(period_id,user_id) where is_active;
create table public.subjects (
  id uuid primary key default gen_random_uuid(), school_id uuid not null, period_id uuid not null, grade_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 80), sort_order integer not null default 0,
  is_active boolean not null default true, unique(school_id,period_id,grade_id,id),
  foreign key(school_id,period_id,grade_id) references public.grades(school_id,period_id,id) on delete cascade
);
create table public.units (
  id uuid primary key default gen_random_uuid(), school_id uuid not null, period_id uuid not null, grade_id uuid not null,
  subject_id uuid not null, title text not null check (char_length(btrim(title)) between 1 and 160),
  sort_order integer not null default 0, is_active boolean not null default true,
  unique(school_id,period_id,grade_id,id),
  foreign key(school_id,period_id,grade_id,subject_id) references public.subjects(school_id,period_id,grade_id,id) on delete cascade
);
create table public.class_progress (
  school_id uuid not null, period_id uuid not null, grade_id uuid not null, classroom_id uuid not null, unit_id uuid not null,
  completed boolean not null default false, version integer not null default 1 check(version > 0),
  updated_at timestamptz not null default now(), primary key(classroom_id,unit_id),
  foreign key(school_id,period_id,grade_id,classroom_id) references public.classrooms(school_id,period_id,grade_id,id) on delete cascade,
  foreign key(school_id,period_id,grade_id,unit_id) references public.units(school_id,period_id,grade_id,id) on delete cascade
);
create table public.student_enrollments (
  id uuid primary key default gen_random_uuid(), school_id uuid not null, period_id uuid not null, grade_id uuid not null,
  classroom_id uuid not null, student_number integer not null check (student_number between 1 and 999),
  name text not null check (char_length(btrim(name)) between 1 and 80), is_active boolean not null default true,
  foreign key(school_id,period_id,grade_id,classroom_id) references public.classrooms(school_id,period_id,grade_id,id) on delete cascade
);
create unique index active_student_number on public.student_enrollments(classroom_id,student_number) where is_active;
create index grade_manager_user on public.grade_manager_assignments(user_id);
create index grade_students on public.student_enrollments(grade_id);
create index grade_units on public.units(grade_id);

create function public.is_grade_manager(target_grade uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_access_app() and exists (
    select 1 from public.grade_manager_assignments gm
    join public.teacher_assignments ta on ta.id = gm.teacher_assignment_id and ta.is_active
    join public.classrooms c on c.id = ta.classroom_id and c.is_active
    join public.school_memberships m on m.school_id = gm.school_id and m.user_id = gm.user_id and m.is_active
    join public.schools s on s.id = gm.school_id and s.is_active
    join public.academic_periods p on p.id = gm.period_id and p.status in ('draft','active')
    where gm.user_id = auth.uid() and gm.grade_id = target_grade and gm.is_active
  );
$$;
revoke all on function public.is_grade_manager(uuid) from public, anon;
grant execute on function public.is_grade_manager(uuid) to authenticated;

-- Metadata and all grade data remain inaccessible without a live assignment.
do $$
declare table_name text;
begin
  foreach table_name in array array['academic_periods','grades','classrooms','teacher_assignments','grade_manager_assignments','subjects','units','class_progress','student_enrollments'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public, anon, authenticated',table_name);
    execute format('grant select on public.%I to authenticated',table_name);
    execute format('grant all on public.%I to service_role',table_name);
  end loop;
end;
$$;
create policy manager_period_read on public.academic_periods for select to authenticated using (
  exists(select 1 from public.grades g where g.period_id = academic_periods.id and public.is_grade_manager(g.id))
);
create policy manager_grade_read on public.grades for select to authenticated using (public.is_grade_manager(id));
create policy manager_class_read on public.classrooms for select to authenticated using (public.is_grade_manager(grade_id));
create policy manager_assignment_read on public.teacher_assignments for select to authenticated using (public.is_grade_manager(grade_id));
create policy manager_role_read on public.grade_manager_assignments for select to authenticated using (public.is_grade_manager(grade_id));
create policy manager_subject_read on public.subjects for select to authenticated using (public.is_grade_manager(grade_id));
create policy manager_unit_read on public.units for select to authenticated using (public.is_grade_manager(grade_id));
create policy manager_progress_read on public.class_progress for select to authenticated using (public.is_grade_manager(grade_id));
create policy manager_student_read on public.student_enrollments for select to authenticated using (public.is_grade_manager(grade_id));

create function public.dashboard_access() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare school_info jsonb;
begin
  if not public.can_access_app() then raise exception 'Account not ready' using errcode = '42501'; end if;
  select jsonb_build_object('school_role',m.role,'school_name',s.name) into school_info
    from public.school_memberships m join public.schools s on s.id = m.school_id and s.is_active
    where m.user_id = auth.uid() and m.is_active;
  return coalesce(school_info,jsonb_build_object('school_role',null,'school_name',null)) || jsonb_build_object(
    'grades',coalesce((select jsonb_agg(jsonb_build_object(
      'id',g.id,'grade_number',g.grade_number,'school_name',s.name,'academic_year',p.academic_year,'semester',p.semester,'status',p.status
    ) order by (p.status = 'active') desc,p.academic_year desc,p.semester desc)
    from public.grade_manager_assignments gm join public.grades g on g.id = gm.grade_id
    join public.schools s on s.id = gm.school_id join public.academic_periods p on p.id = gm.period_id
    where gm.user_id = auth.uid() and gm.is_active and public.is_grade_manager(g.id)), '[]'::jsonb)
  );
end;
$$;

create function public.grade_admin_snapshot(target_grade uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_grade_manager(target_grade) then raise exception 'Assigned grade manager required' using errcode = '42501'; end if;
  return jsonb_build_object(
    'context',(select jsonb_build_object('id',g.id,'grade_number',g.grade_number,'school_name',s.name,
      'academic_year',p.academic_year,'semester',p.semester,'status',p.status,
      'own_classroom_id',(select ta.classroom_id from public.teacher_assignments ta where ta.user_id = auth.uid() and ta.period_id = p.id and ta.is_active))
      from public.grades g join public.schools s on s.id = g.school_id join public.academic_periods p on p.id = g.period_id where g.id = target_grade),
    'subjects',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'units',coalesce((
      select jsonb_agg(jsonb_build_object('id',u.id,'title',u.title) order by u.sort_order,u.id) from public.units u where u.subject_id = s.id and u.is_active
    ),'[]'::jsonb)) order by s.sort_order,s.id) from public.subjects s where s.grade_id = target_grade and s.is_active),'[]'::jsonb),
    'classrooms',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'class_number',c.class_number,
      'teacher_name',(select p.display_name from public.teacher_assignments ta join public.profiles p on p.user_id = ta.user_id and p.is_active where ta.classroom_id = c.id and ta.is_active),
      'student_count',(select count(*) from public.student_enrollments e where e.classroom_id = c.id and e.is_active),
      'subjects',coalesce((select jsonb_agg(jsonb_build_object('subject_id',s.id,'total',counts.total,'completed',counts.completed,
        'percentage',case when counts.total = 0 then null else round(counts.completed * 100.0 / counts.total,1) end) order by s.sort_order,s.id)
        from public.subjects s cross join lateral (
          select count(*) as total,count(*) filter(where cp.completed) as completed from public.units u
          left join public.class_progress cp on cp.unit_id = u.id and cp.classroom_id = c.id
          where u.subject_id = s.id and u.is_active
        ) counts where s.grade_id = target_grade and s.is_active),'[]'::jsonb),
      'completed_unit_ids',coalesce((select jsonb_agg(cp.unit_id) from public.class_progress cp join public.units u on u.id = cp.unit_id and u.is_active
        join public.subjects s on s.id = u.subject_id and s.is_active where cp.classroom_id = c.id and cp.completed),'[]'::jsonb)
    ) order by c.class_number,c.id) from public.classrooms c where c.grade_id = target_grade and c.is_active),'[]'::jsonb),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'classroom_id',e.classroom_id,'student_number',e.student_number,'name',e.name)
      order by c.class_number,e.student_number,e.id) from public.student_enrollments e join public.classrooms c on c.id = e.classroom_id and c.is_active
      where e.grade_id = target_grade and e.is_active),'[]'::jsonb),
    'updated_at',now()
  );
end;
$$;
revoke all on function public.dashboard_access() from public, anon;
revoke all on function public.grade_admin_snapshot(uuid) from public, anon;
grant execute on function public.dashboard_access() to authenticated;
grant execute on function public.grade_admin_snapshot(uuid) to authenticated;
