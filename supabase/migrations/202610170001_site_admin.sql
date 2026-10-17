-- Site administration uses the caller's session, never a service key.
create function public.is_site_administrator() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_access_app() and exists (
    select 1 from public.profiles where user_id = auth.uid() and is_site_admin
  );
$$;
revoke all on function public.is_site_administrator() from public, anon;
grant execute on function public.is_site_administrator() to authenticated;

create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and char_length(name) between 1 and 80),
  is_active boolean not null default true,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.school_memberships (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role text not null check (role in ('teacher', 'school_admin')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(school_id, user_id)
);
create unique index one_active_school_per_user on public.school_memberships(user_id) where is_active;
create index school_memberships_school on public.school_memberships(school_id);

create table auth_private.school_audit_logs (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  actor_id uuid references public.profiles(user_id) on delete set null,
  action text not null check (action in ('created', 'renamed', 'paused', 'restored', 'admin_assigned', 'admin_removed')),
  created_at timestamptz not null default now()
);
create index school_audit_recent on auth_private.school_audit_logs(created_at desc);
revoke all on auth_private.school_audit_logs from public, anon, authenticated;

alter table public.schools enable row level security;
alter table public.school_memberships enable row level security;
revoke all on public.schools, public.school_memberships from public, anon, authenticated;
grant select on public.schools, public.school_memberships to authenticated;
grant all on public.schools, public.school_memberships to service_role;
create policy site_admin_school_read on public.schools for select to authenticated
using (public.is_site_administrator());
create policy site_admin_membership_read on public.school_memberships for select to authenticated
using (public.is_site_administrator());

create function public.site_admin_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_site_administrator() then
    raise exception 'Site administrator required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'schools', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object(
      'administrators', coalesce((select jsonb_agg(jsonb_build_object(
        'user_id', p.user_id, 'display_name', p.display_name, 'username', p.username
      ) order by p.display_name) from public.school_memberships m join public.profiles p on p.user_id = m.user_id
        where m.school_id = s.id and m.is_active and m.role = 'school_admin' and p.is_active), '[]'::jsonb)
    ) order by s.created_at desc, s.id) from public.schools s), '[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object(
      'user_id', p.user_id, 'display_name', p.display_name, 'username', p.username,
      'school_id', (select school_id from public.school_memberships m where m.user_id = p.user_id and m.is_active)
    ) order by p.display_name) from public.profiles p where p.is_active and not p.is_site_admin), '[]'::jsonb),
    'active_accounts', (select count(*) from public.profiles where is_active),
    'recent_changes', coalesce((select jsonb_agg(to_jsonb(entry)) from (
      select a.id, a.action, a.created_at, s.name as school_name, coalesce(p.display_name, '운영자') as actor_name
      from auth_private.school_audit_logs a join public.schools s on s.id = a.school_id
      left join public.profiles p on p.user_id = a.actor_id
      order by a.created_at desc, a.id desc limit 6
    ) entry), '[]'::jsonb),
    'updated_at', now()
  );
end;
$$;

-- Updating school metadata and permissions serializes on the school row.
-- A version conflict leaves both the record and its audit history unchanged.
create function public.site_admin_save_school(
  school_name text, target_school uuid default null, expected_version integer default null, active boolean default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  existing public.schools;
  saved_id uuid;
  event text;
begin
  if not public.is_site_administrator() then
    raise exception 'Site administrator required' using errcode = '42501';
  end if;
  if school_name is null or char_length(btrim(school_name)) not between 1 and 80 then
    raise exception 'Invalid school name' using errcode = '22023';
  end if;
  if target_school is null then
    if active is not null or expected_version is not null then
      raise exception 'Invalid creation fields' using errcode = '22023';
    end if;
    insert into public.schools(name) values (btrim(school_name)) returning id into saved_id;
    event := 'created';
  else
    select * into existing from public.schools where id = target_school for update;
    if not found then raise exception 'School not found' using errcode = 'P0002'; end if;
    if expected_version is null or existing.version <> expected_version then
      raise exception 'School changed' using errcode = '40001';
    end if;
    if existing.name = btrim(school_name) and (active is null or existing.is_active = active) then return existing.id; end if;
    event := case when active is false and existing.is_active then 'paused'
      when active is true and not existing.is_active then 'restored' else 'renamed' end;
    update public.schools set name = btrim(school_name), is_active = coalesce(active, is_active),
      version = version + 1, updated_at = now() where id = target_school;
    saved_id := target_school;
  end if;
  insert into auth_private.school_audit_logs(school_id, actor_id, action) values (saved_id, auth.uid(), event);
  return saved_id;
end;
$$;

create function public.site_admin_set_manager(
  target_school uuid, target_user uuid, expected_version integer, assign boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  existing public.schools;
begin
  if not public.is_site_administrator() then
    raise exception 'Site administrator required' using errcode = '42501';
  end if;
  if assign is null then raise exception 'Assignment required' using errcode = '22023'; end if;
  select * into existing from public.schools where id = target_school for update;
  if not found then raise exception 'School not found' using errcode = 'P0002'; end if;
  if expected_version is null or existing.version <> expected_version then
    raise exception 'School changed' using errcode = '40001';
  end if;
  if not existing.is_active then raise exception 'School inactive' using errcode = '22023'; end if;
  -- Lock the account as well: concurrent cross-school assignments must not race.
  perform 1 from public.profiles where user_id = target_user and is_active and not is_site_admin for update;
  if not found then raise exception 'Active teacher required' using errcode = '22023'; end if;
  if assign then
    if exists(select 1 from public.school_memberships where user_id = target_user and is_active and school_id <> target_school) then
      raise exception 'Account belongs to another school' using errcode = '23505';
    end if;
    if exists(select 1 from public.school_memberships where user_id = target_user and school_id = target_school
      and is_active and role = 'school_admin') then return; end if;
    insert into public.school_memberships(school_id, user_id, role) values (target_school, target_user, 'school_admin')
    on conflict(school_id,user_id) do update set role = 'school_admin', is_active = true;
  else
    if not exists(select 1 from public.school_memberships where school_id = target_school and user_id = target_user and is_active and role = 'school_admin') then
      raise exception 'Administrator not found' using errcode = 'P0002';
    end if;
    if not exists(select 1 from public.school_memberships m join public.profiles p on p.user_id = m.user_id
      where m.school_id = target_school and m.user_id <> target_user and m.role = 'school_admin' and m.is_active and p.is_active) then
      raise exception 'Assign a replacement administrator first' using errcode = '23514';
    end if;
    update public.school_memberships set role = 'teacher' where school_id = target_school and user_id = target_user;
  end if;
  update public.schools set version = version + 1, updated_at = now() where id = target_school;
  insert into auth_private.school_audit_logs(school_id, actor_id, action)
    values (target_school, auth.uid(), case when assign then 'admin_assigned' else 'admin_removed' end);
end;
$$;

revoke all on function public.site_admin_snapshot() from public, anon;
revoke all on function public.site_admin_save_school(text,uuid,integer,boolean) from public, anon;
revoke all on function public.site_admin_set_manager(uuid,uuid,integer,boolean) from public, anon;
grant execute on function public.site_admin_snapshot() to authenticated;
grant execute on function public.site_admin_save_school(text,uuid,integer,boolean) to authenticated;
grant execute on function public.site_admin_set_manager(uuid,uuid,integer,boolean) to authenticated;
