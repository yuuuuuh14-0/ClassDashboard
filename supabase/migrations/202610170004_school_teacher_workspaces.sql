-- All domain writes are scoped, serialized against term transitions and audited.
create table auth_private.workspace_audit (
  id uuid primary key default gen_random_uuid(), school_id uuid not null references public.schools(id) on delete cascade,
  actor_id uuid references public.profiles(user_id) on delete set null,
  action text not null, target_id uuid, created_at timestamptz not null default now()
);
revoke all on auth_private.workspace_audit from public, anon, authenticated;

create function public.is_school_manager(target_school uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_access_app() and exists (
    select 1 from public.school_memberships m join public.schools s on s.id=m.school_id and s.is_active
    where m.school_id=target_school and m.user_id=auth.uid() and m.is_active and m.role='school_admin'
  );
$$;
create function public.can_read_classroom(target_classroom uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_access_app() and exists (
    select 1 from public.teacher_assignments ta
    join public.classrooms c on c.id=ta.classroom_id and c.is_active
    join public.school_memberships m on m.school_id=ta.school_id and m.user_id=ta.user_id and m.is_active
    join public.schools s on s.id=m.school_id and s.is_active
    where ta.classroom_id=target_classroom and ta.user_id=auth.uid() and ta.is_active
  );
$$;
revoke all on function public.is_school_manager(uuid), public.can_read_classroom(uuid) from public, anon;
grant execute on function public.is_school_manager(uuid), public.can_read_classroom(uuid) to authenticated;

-- Public tables retain SELECT-only grants. Teacher data is returned by a scoped RPC;
-- in particular no grade-wide student policy is granted to ordinary teachers.
create function public.school_workspace_snapshot(target_period uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare sid uuid; pid uuid;
begin
  select m.school_id into sid from public.school_memberships m where m.user_id=auth.uid() and m.is_active and public.is_school_manager(m.school_id);
  if sid is null then raise exception 'School manager required' using errcode='42501'; end if;
  if target_period is not null then
    select id into pid from public.academic_periods where id=target_period and school_id=sid;
    if pid is null then raise exception 'Period outside school' using errcode='42501'; end if;
  else
    select id into pid from public.academic_periods where school_id=sid order by (status='active') desc,academic_year desc,semester desc limit 1;
  end if;
  return jsonb_build_object(
    'school',(select jsonb_build_object('id',id,'name',name,'version',version) from public.schools where id=sid),
    'period_id',pid,
    'periods',coalesce((select jsonb_agg(to_jsonb(p) order by p.academic_year desc,p.semester desc) from public.academic_periods p where school_id=sid),'[]'::jsonb),
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',p.user_id,'username',p.username,'display_name',p.display_name,
      'is_active',p.is_active and m.is_active,'role',m.role,'password_change_required',p.password_change_required) order by p.display_name)
      from public.school_memberships m join public.profiles p on p.user_id=m.user_id where m.school_id=sid),'[]'::jsonb),
    'grades',coalesce((select jsonb_agg(to_jsonb(g) order by grade_number) from public.grades g where period_id=pid),'[]'::jsonb),
    'classrooms',coalesce((select jsonb_agg(to_jsonb(c) order by grade_id,class_number) from public.classrooms c where period_id=pid),'[]'::jsonb),
    'assignments',coalesce((select jsonb_agg(to_jsonb(a)) from public.teacher_assignments a where period_id=pid and is_active),'[]'::jsonb),
    'managers',coalesce((select jsonb_agg(to_jsonb(a)) from public.grade_manager_assignments a where period_id=pid and is_active),'[]'::jsonb),
    'subjects',coalesce((select jsonb_agg(to_jsonb(s) order by sort_order,id) from public.subjects s where period_id=pid),'[]'::jsonb),
    'units',coalesce((select jsonb_agg(to_jsonb(u) order by sort_order,id) from public.units u where period_id=pid),'[]'::jsonb),
    'students',coalesce((select jsonb_agg(to_jsonb(e) order by classroom_id,student_number) from public.student_enrollments e where period_id=pid),'[]'::jsonb),
    'updated_at',now()
  );
end;
$$;

create function public.school_workspace_mutate(payload jsonb, expected_version integer) returns uuid
language plpgsql security definer set search_path = '' as $$
declare sid uuid; pid uuid; gid uuid; cid uuid; uid uuid; tid uuid; aid uuid;
  operation text := payload->>'action'; label text := btrim(payload->>'name'); active boolean;
  school_version integer; period_status text; n integer;
begin
  select m.school_id into sid from public.school_memberships m where m.user_id=auth.uid() and m.is_active and public.is_school_manager(m.school_id);
  if sid is null then raise exception 'School manager required' using errcode='42501'; end if;
  select version into school_version from public.schools where id=sid for update;
  if not public.is_school_manager(sid) then raise exception 'School manager required' using errcode='42501'; end if;
  if expected_version is distinct from school_version then raise exception 'Refresh before saving' using errcode='PT409'; end if;
  tid := nullif(payload->>'id','')::uuid;
  if operation='period_create' then
    insert into public.academic_periods(school_id,academic_year,semester) values(sid,(payload->>'year')::integer,(payload->>'semester')::integer) returning id into tid;
  elsif operation in ('member_update','member_reset') then
    uid := (payload->>'user_id')::uuid;
    if not exists(select 1 from public.school_memberships m join public.profiles p on p.user_id=m.user_id where m.school_id=sid and m.user_id=uid and m.role='teacher' and not p.is_site_admin) then
      raise exception 'Only school teachers may be managed' using errcode='42501'; end if;
    perform 1 from public.profiles where user_id=uid for update;
    if operation='member_reset' then
      update public.profiles set password_change_required=true where user_id=uid;
    else
      active := (payload->>'active')::boolean;
      if label is null or char_length(label) not between 1 and 80 or active is null then raise exception 'Invalid member' using errcode='22023'; end if;
      update public.profiles set display_name=label,is_active=active where user_id=uid;
      -- Keep school affiliation and historical assignments. Disabled profiles fail all checks.
      if not active then
        update public.grade_manager_assignments gm set is_active=false from public.academic_periods p where gm.period_id=p.id and p.status<>'archived' and gm.user_id=uid and gm.school_id=sid;
        update public.teacher_assignments ta set is_active=false from public.academic_periods p where ta.period_id=p.id and p.status<>'archived' and ta.user_id=uid and ta.school_id=sid;
      end if;
    end if;
    if operation='member_reset' or not active then
      insert into auth_private.revoked_sessions(session_id,user_id) select id::text,user_id from auth.sessions where user_id=uid on conflict do nothing;
    end if;
    tid := uid;
  else
    pid := (payload->>'period_id')::uuid;
    select status into period_status from public.academic_periods where id=pid and school_id=sid for update;
    if period_status is null then raise exception 'Period outside school' using errcode='42501'; end if;
    if period_status='archived' then raise exception 'Archived term is read only' using errcode='PT409'; end if;
    if operation='period_activate' then
      if period_status<>'draft' then raise exception 'Draft term required' using errcode='22023'; end if;
      if not exists(select 1 from public.classrooms where period_id=pid and is_active)
        or exists(select 1 from public.classrooms c where c.period_id=pid and c.is_active and not exists(
          select 1 from public.teacher_assignments a join public.profiles p on p.user_id=a.user_id and p.is_active where a.classroom_id=c.id and a.is_active))
        or exists(select 1 from public.grades g where g.period_id=pid and exists(select 1 from public.classrooms c where c.grade_id=g.id and c.is_active)
          and not exists(select 1 from public.grade_manager_assignments gm join public.teacher_assignments a on a.id=gm.teacher_assignment_id and a.is_active where gm.grade_id=g.id and gm.is_active)) then
        raise exception 'Assign every classroom and grade manager first' using errcode='23514'; end if;
      update public.academic_periods set status='archived' where school_id=sid and status='active';
      update public.academic_periods set status='active' where id=pid;
      tid := pid;
    elsif operation='grade_create' then
      insert into public.grades(school_id,period_id,grade_number) values(sid,pid,(payload->>'number')::integer) returning id into tid;
    else
      gid := (payload->>'grade_id')::uuid;
      if not exists(select 1 from public.grades where id=gid and period_id=pid and school_id=sid) then raise exception 'Grade outside term' using errcode='42501'; end if;
      if operation in ('class_save','assignment','student_save') then
        cid := nullif(payload->>'classroom_id','')::uuid;
        if cid is not null and not exists(select 1 from public.classrooms where id=cid and grade_id=gid and period_id=pid and school_id=sid) then raise exception 'Class outside grade' using errcode='42501'; end if;
      end if;
      if operation='class_save' then
        active := (payload->>'active')::boolean; n := (payload->>'number')::integer;
        if label is null or char_length(label) not between 1 and 80 or active is null or n is null then raise exception 'Invalid class' using errcode='22023'; end if;
        if cid is null then
          insert into public.classrooms(school_id,period_id,grade_id,class_number,name,is_active) values(sid,pid,gid,n,label,active) returning id into tid;
        else
          if not active then
            update public.grade_manager_assignments gm set is_active=false from public.teacher_assignments a where gm.teacher_assignment_id=a.id and a.classroom_id=cid;
            update public.teacher_assignments set is_active=false where classroom_id=cid and is_active;
          end if;
          update public.classrooms set name=label,class_number=n,is_active=active where id=cid; tid:=cid;
        end if;
      elsif operation='assignment' then
        uid := nullif(payload->>'user_id','')::uuid;
        if cid is null or not exists(select 1 from public.classrooms where id=cid and is_active) then raise exception 'Active class required' using errcode='22023'; end if;
        if uid is not null and not exists(select 1 from public.school_memberships m join public.profiles p on p.user_id=m.user_id and p.is_active and not p.is_site_admin where m.school_id=sid and m.user_id=uid and m.is_active) then raise exception 'Teacher outside school' using errcode='42501'; end if;
        if uid is not null and exists(select 1 from public.teacher_assignments where user_id=uid and period_id=pid and classroom_id<>cid and is_active) then raise exception 'Teacher already assigned' using errcode='23505'; end if;
        update public.grade_manager_assignments gm set is_active=false from public.teacher_assignments a where gm.teacher_assignment_id=a.id and a.classroom_id=cid and gm.is_active;
        update public.teacher_assignments set is_active=false where classroom_id=cid and is_active;
        if uid is not null then
          insert into public.teacher_assignments(school_id,period_id,grade_id,classroom_id,user_id) values(sid,pid,gid,cid,uid) returning id into aid;
          if coalesce((payload->>'manager')::boolean,false) then
            update public.grade_manager_assignments set is_active=false where grade_id=gid and is_active;
            insert into public.grade_manager_assignments(school_id,period_id,grade_id,user_id,teacher_assignment_id) values(sid,pid,gid,uid,aid);
          end if;
        end if;
        tid:=cid;
      elsif operation='student_save' then
        active := (payload->>'active')::boolean; n := (payload->>'number')::integer;
        if cid is null or label is null or char_length(label) not between 1 and 80 or n is null or active is null or not exists(select 1 from public.classrooms where id=cid and is_active) then raise exception 'Invalid student' using errcode='22023'; end if;
        if tid is null then
          insert into public.student_enrollments(school_id,period_id,grade_id,classroom_id,student_number,name,is_active) values(sid,pid,gid,cid,n,label,active) returning id into tid;
        else
          if not exists(select 1 from public.student_enrollments where id=tid and grade_id=gid) then raise exception 'Student outside grade' using errcode='42501'; end if;
          update public.student_enrollments set classroom_id=cid,student_number=n,name=label,is_active=active where id=tid;
        end if;
      elsif operation='subject_save' then
        active := (payload->>'active')::boolean;
        if label is null or char_length(label) not between 1 and 80 or active is null then raise exception 'Invalid subject' using errcode='22023'; end if;
        if tid is null then
          insert into public.subjects(school_id,period_id,grade_id,name,sort_order,is_active) values(sid,pid,gid,label,(payload->>'order')::integer,active) returning id into tid;
        else
          if not exists(select 1 from public.subjects where id=tid and grade_id=gid) then raise exception 'Subject outside grade' using errcode='42501'; end if;
          update public.subjects set name=label,sort_order=(payload->>'order')::integer,is_active=active where id=tid;
        end if;
      elsif operation='unit_save' then
        uid := (payload->>'subject_id')::uuid; active := (payload->>'active')::boolean;
        if label is null or char_length(label) not between 1 and 160 or active is null or not exists(select 1 from public.subjects where id=uid and grade_id=gid) then raise exception 'Invalid unit scope' using errcode='22023'; end if;
        if tid is null then
          insert into public.units(school_id,period_id,grade_id,subject_id,title,sort_order,is_active) values(sid,pid,gid,uid,label,(payload->>'order')::integer,active) returning id into tid;
        else
          if not exists(select 1 from public.units where id=tid and subject_id=uid and grade_id=gid) then raise exception 'Unit outside subject' using errcode='42501'; end if;
          update public.units set title=label,sort_order=(payload->>'order')::integer,is_active=active where id=tid;
        end if;
      else raise exception 'Unknown operation' using errcode='22023';
      end if;
    end if;
  end if;
  update public.schools set version=version+1,updated_at=now() where id=sid;
  insert into auth_private.workspace_audit(school_id,actor_id,action,target_id) values(sid,auth.uid(),operation,tid);
  return tid;
end;
$$;

create function public.save_class_progress(target_classroom uuid, target_unit uuid, done boolean, expected_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.classrooms; sid uuid; v integer; term_status text;
begin
  select * into c from public.classrooms where id=target_classroom and is_active;
  if c.id is null or not (public.can_read_classroom(c.id) or public.is_school_manager(c.school_id)) then raise exception 'Assigned teacher required' using errcode='42501'; end if;
  perform 1 from public.schools where id=c.school_id for update;
  if not (public.can_read_classroom(c.id) or public.is_school_manager(c.school_id)) then raise exception 'Assignment revoked' using errcode='42501'; end if;
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

-- Registration and membership creation are one transaction after GoTrue creates the
-- Auth identity. Only the server can call this, and it rechecks the actor's role.
create function public.school_register_teacher(actor uuid, target_user uuid, login_name text, account_name text, internal_email text, target_school uuid, expected_version integer) returns void
language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  select version into v from public.schools where id=target_school and is_active for update;
  if not exists(select 1 from public.school_memberships m join public.profiles p on p.user_id=m.user_id and p.is_active and not p.password_change_required where m.user_id=actor and m.school_id=target_school and m.role='school_admin' and m.is_active) then raise exception 'School manager required' using errcode='42501'; end if;
  if v is null or v is distinct from expected_version then raise exception 'Refresh first' using errcode='PT409'; end if;
  perform public.register_login_account(target_user,login_name,account_name,internal_email,false);
  insert into public.school_memberships(school_id,user_id,role) values(target_school,target_user,'teacher');
  update public.schools set version=version+1,updated_at=now() where id=target_school;
  insert into auth_private.workspace_audit(school_id,actor_id,action,target_id) values(target_school,actor,'teacher_created',target_user);
end;
$$;
revoke all on function public.school_register_teacher(uuid,uuid,text,text,text,uuid,integer) from public, anon, authenticated;
grant execute on function public.school_register_teacher(uuid,uuid,text,text,text,uuid,integer) to service_role;
revoke all on function public.school_workspace_snapshot(uuid), public.school_workspace_mutate(jsonb,integer), public.save_class_progress(uuid,uuid,boolean,integer) from public, anon;
grant execute on function public.school_workspace_snapshot(uuid), public.school_workspace_mutate(jsonb,integer), public.save_class_progress(uuid,uuid,boolean,integer) to authenticated;

create function auth_private.workspace_grade_snapshot(target_grade uuid, own_class uuid, school_manager boolean) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'context',(select jsonb_build_object('id',g.id,'grade_number',g.grade_number,'school_name',s.name,
      'academic_year',p.academic_year,'semester',p.semester,'status',p.status,
      'own_classroom_id',own_class)
      from public.grades g join public.schools s on s.id = g.school_id join public.academic_periods p on p.id = g.period_id where g.id = target_grade),
    'subjects',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'units',coalesce((
      select jsonb_agg(jsonb_build_object('id',u.id,'title',u.title) order by u.sort_order,u.id) from public.units u where u.subject_id = s.id and u.is_active
    ),'[]'::jsonb)) order by s.sort_order,s.id) from public.subjects s where s.grade_id = target_grade and s.is_active),'[]'::jsonb),
    'classrooms',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'class_number',c.class_number,
      'teacher_name',(select p.display_name from public.teacher_assignments ta join public.profiles p on p.user_id = ta.user_id and p.is_active where ta.classroom_id = c.id and ta.is_active),
      'student_count',case when school_manager or c.id=own_class then (select count(*) from public.student_enrollments e where e.classroom_id=c.id and e.is_active) else null end,
      'subjects',coalesce((select jsonb_agg(jsonb_build_object('subject_id',s.id,'total',counts.total,'completed',counts.completed,
        'percentage',case when counts.total = 0 then null else round(counts.completed * 100.0 / counts.total,1) end) order by s.sort_order,s.id)
        from public.subjects s cross join lateral (
          select count(*) as total,count(*) filter(where cp.completed) as completed from public.units u
          left join public.class_progress cp on cp.unit_id = u.id and cp.classroom_id = c.id
          where u.subject_id = s.id and u.is_active
        ) counts where s.grade_id = target_grade and s.is_active),'[]'::jsonb),
      'progress_versions',coalesce((select jsonb_object_agg(cp.unit_id::text,cp.version) from public.class_progress cp where cp.classroom_id=c.id),'{}'::jsonb),
      'completed_unit_ids',coalesce((select jsonb_agg(cp.unit_id) from public.class_progress cp join public.units u on u.id = cp.unit_id and u.is_active
        join public.subjects s on s.id = u.subject_id and s.is_active where cp.classroom_id = c.id and cp.completed),'[]'::jsonb)
    ) order by c.class_number,c.id) from public.classrooms c where c.grade_id = target_grade and c.is_active),'[]'::jsonb),
    'students',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'classroom_id',e.classroom_id,'student_number',e.student_number,'name',e.name)
      order by c.class_number,e.student_number,e.id) from public.student_enrollments e join public.classrooms c on c.id = e.classroom_id and c.is_active
      where e.grade_id = target_grade and e.is_active and (school_manager or e.classroom_id=own_class)),'[]'::jsonb),
    'updated_at',now()
  );
end;
$$;

revoke all on function auth_private.workspace_grade_snapshot(uuid,uuid,boolean) from public,anon,authenticated;
create function public.teacher_workspace_snapshot(target_classroom uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cid uuid; c public.classrooms; choices jsonb; manager boolean;
begin
  if not public.can_access_app() then raise exception 'Account not ready' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'academic_year',p.academic_year,'semester',p.semester,'status',p.status,'school_name',s.name)
    order by (p.status='active') desc,p.academic_year desc,p.semester desc,c.class_number),'[]'::jsonb) into choices
    from public.classrooms c join public.academic_periods p on p.id=c.period_id join public.schools s on s.id=c.school_id
    where c.is_active and (public.can_read_classroom(c.id) or public.is_school_manager(c.school_id));
  cid := coalesce(target_classroom,(choices->0->>'id')::uuid);
  if cid is null then return jsonb_build_object('choices',choices,'snapshot',null); end if;
  if not (public.can_read_classroom(cid) or exists(select 1 from public.classrooms where id=cid and public.is_school_manager(school_id))) then raise exception 'Class outside assignment' using errcode='42501'; end if;
  select * into c from public.classrooms where id=cid and is_active;
  if c.id is null then raise exception 'Inactive class' using errcode='42501'; end if;
  manager := public.is_school_manager(c.school_id);
  return jsonb_build_object('choices',choices,'snapshot',auth_private.workspace_grade_snapshot(c.grade_id,c.id,manager));
end;
$$;
revoke all on function public.teacher_workspace_snapshot(uuid) from public,anon;
grant execute on function public.teacher_workspace_snapshot(uuid) to authenticated;

-- Future RPCs and accidental direct authenticated writes cannot edit an archive.
create function auth_private.guard_archived_period() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' and (
    (TG_OP<>'INSERT' and exists(select 1 from public.academic_periods where id=old.period_id and status='archived')) or
    (TG_OP<>'DELETE' and exists(select 1 from public.academic_periods where id=new.period_id and status='archived'))
  ) then raise exception 'Archived term is read only' using errcode='PT409'; end if;
  if TG_OP='DELETE' then return old; end if;
  return new;
end;
$$;
do $$
declare t text;
begin
  foreach t in array array['grades','classrooms','teacher_assignments','grade_manager_assignments','subjects','units','student_enrollments','class_progress'] loop
    execute format('create trigger protect_archive before insert or update or delete on public.%I for each row execute function auth_private.guard_archived_period()',t);
  end loop;
end;
$$;
