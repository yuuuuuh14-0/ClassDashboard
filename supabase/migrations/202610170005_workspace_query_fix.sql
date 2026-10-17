-- Disambiguate the classroom record from the choices query alias.
create or replace function public.teacher_workspace_snapshot(target_classroom uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cid uuid; classroom_record public.classrooms; choices jsonb; manager boolean;
begin
  if not public.can_access_app() then raise exception 'Account not ready' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'academic_year',p.academic_year,'semester',p.semester,'status',p.status,'school_name',s.name)
    order by (p.status='active') desc,p.academic_year desc,p.semester desc,c.class_number),'[]'::jsonb) into choices
    from public.classrooms c join public.academic_periods p on p.id=c.period_id join public.schools s on s.id=c.school_id
    where c.is_active and (public.can_read_classroom(c.id) or public.is_school_manager(c.school_id));
  cid := coalesce(target_classroom,(choices->0->>'id')::uuid);
  if cid is null then return jsonb_build_object('choices',choices,'snapshot',null); end if;
  if not (public.can_read_classroom(cid) or exists(select 1 from public.classrooms where id=cid and public.is_school_manager(school_id))) then raise exception 'Class outside assignment' using errcode='42501'; end if;
  select * into classroom_record from public.classrooms where id=cid and is_active;
  if classroom_record.id is null then raise exception 'Inactive class' using errcode='42501'; end if;
  manager := public.is_school_manager(classroom_record.school_id);
  return jsonb_build_object('choices',choices,'snapshot',auth_private.workspace_grade_snapshot(classroom_record.grade_id,classroom_record.id,manager));
end;
$$;

create or replace function public.save_class_progress(target_classroom uuid, target_unit uuid, done boolean, expected_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.classrooms; sid uuid; v integer; term_status text;
begin
  select * into c from public.classrooms where id=target_classroom and is_active;
  if c.id is null or not (public.can_read_classroom(c.id) or public.is_school_manager(c.school_id)) then raise exception 'Assigned teacher required' using errcode='42501'; end if;
  perform 1 from public.schools where id=c.school_id for update;
  if not (public.can_read_classroom(c.id) or public.is_school_manager(c.school_id)) then raise exception 'Assignment revoked' using errcode='42501'; end if;
  select * into c from public.classrooms where id=target_classroom and is_active;
  if c.id is null then raise exception 'Class disabled' using errcode='42501'; end if;
  select status into term_status from public.academic_periods where id=c.period_id;
  if term_status<>'active' then raise exception 'Only active term accepts progress' using errcode='PT409'; end if;
  if done is null or expected_version is null or expected_version<0 or not exists(select 1 from public.units u join public.subjects s on s.id=u.subject_id and s.is_active where u.id=target_unit and u.grade_id=c.grade_id and u.is_active) then raise exception 'Invalid unit' using errcode='22023'; end if;
  select version into v from public.class_progress where classroom_id=c.id and unit_id=target_unit;
  if coalesce(v,0)<>expected_version then raise exception 'Progress changed; reload' using errcode='PT409'; end if;
  insert into public.class_progress(school_id,period_id,grade_id,classroom_id,unit_id,completed,version)
    values(c.school_id,c.period_id,c.grade_id,c.id,target_unit,done,1)
    on conflict(classroom_id,unit_id) do update set completed=excluded.completed,version=class_progress.version+1,updated_at=now();
  insert into auth_private.workspace_audit(school_id,actor_id,action,target_id) values(c.school_id,auth.uid(),case when done then 'progress_completed' else 'progress_reopened' end,target_unit);
end;
$$;
