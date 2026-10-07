-- Authentication foundation. Apply once through Supabase SQL Editor or migrations.
create schema if not exists auth_private;
revoke all on schema auth_private from public, anon, authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9._-]{4,30}$'),
  display_name text not null check (char_length(display_name) between 1 and 80),
  is_active boolean not null default true,
  is_site_admin boolean not null default false,
  password_change_required boolean not null default true,
  created_at timestamptz not null default now()
);

create table auth_private.login_identifiers (
  username text primary key references public.profiles(username) on delete cascade,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  auth_email text not null unique
);

create table auth_private.login_attempts (
  username text primary key,
  attempts integer not null,
  window_start timestamptz not null
);

create table auth_private.revoked_sessions (
  session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  revoked_at timestamptz not null default now()
);

-- No private table is exposed through the Data API.
revoke all on all tables in schema auth_private from public, anon, authenticated;
alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated;
grant select on public.profiles to authenticated;
grant all on public.profiles to service_role;

create function public.is_active_account() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.is_active
      and coalesce(auth.jwt()->>'session_id', '') <> ''
      and not exists (
        select 1 from auth_private.revoked_sessions r
        where r.session_id = auth.jwt()->>'session_id'
      )
  );
$$;

create function public.can_access_app() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_active_account() and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and not p.password_change_required
  );
$$;

revoke all on function public.is_active_account() from public, anon;
revoke all on function public.can_access_app() from public, anon;
grant execute on function public.is_active_account() to authenticated;
grant execute on function public.can_access_app() to authenticated;

create policy own_active_profile on public.profiles for select to authenticated
using (user_id = auth.uid() and public.is_active_account());

-- Service-only resolution also counts unknown usernames, without exposing existence.
create function public.resolve_login(login_name text)
returns table (allowed boolean, auth_email text)
language plpgsql security definer set search_path = '' as $$
declare
  count_now integer;
begin
  if login_name is null or login_name !~ '^[a-z0-9._-]{4,30}$' then
    return query select false, null::text;
    return;
  end if;
  insert into auth_private.login_attempts as a (username, attempts, window_start)
  values (login_name, 1, now())
  on conflict (username) do update set
    attempts = case when a.window_start <= now() - interval '15 minutes' then 1 else least(a.attempts + 1, 11) end,
    window_start = case when a.window_start <= now() - interval '15 minutes' then now() else a.window_start end
  returning attempts into count_now;
  return query select count_now <= 10, (
    select i.auth_email from auth_private.login_identifiers i
    where i.username = login_name
  );
end;
$$;

create function public.reset_login_attempts(login_name text) returns void
language sql security definer set search_path = '' as $$
  delete from auth_private.login_attempts where username = login_name;
$$;

create function public.register_login_account(
  target_user uuid, login_name text, account_name text, internal_email text, site_admin boolean default false
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from auth.users where id = target_user and email = internal_email) then
    raise exception 'Authentication account does not match';
  end if;
  insert into public.profiles(user_id, username, display_name, is_site_admin)
  values (target_user, login_name, account_name, site_admin);
  insert into auth_private.login_identifiers(username, user_id, auth_email)
  values (login_name, target_user, internal_email);
end;
$$;

create function public.mark_password_changed(target_user uuid) returns void
language sql security definer set search_path = '' as $$
  update public.profiles set password_change_required = false where user_id = target_user and is_active;
$$;

create function public.revoke_current_session() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'session_id', '') = '' then
    raise exception 'Authenticated session required';
  end if;
  insert into auth_private.revoked_sessions(session_id, user_id)
  values (auth.jwt()->>'session_id', auth.uid()) on conflict do nothing;
end;
$$;

revoke all on function public.resolve_login(text) from public, anon, authenticated;
revoke all on function public.reset_login_attempts(text) from public, anon, authenticated;
revoke all on function public.register_login_account(uuid,text,text,text,boolean) from public, anon, authenticated;
revoke all on function public.mark_password_changed(uuid) from public, anon, authenticated;
revoke all on function public.revoke_current_session() from public, anon;
grant execute on function public.resolve_login(text) to service_role;
grant execute on function public.reset_login_attempts(text) to service_role;
grant execute on function public.register_login_account(uuid,text,text,text,boolean) to service_role;
grant execute on function public.mark_password_changed(uuid) to service_role;
grant execute on function public.revoke_current_session() to authenticated;

-- Future school/grade/class policies must additionally require can_access_app().
-- Archive and school membership policies will be added with those domain tables.
