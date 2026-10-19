-- Carbon People: database schema for Supabase.
-- Run once on an empty project (SQL Editor > New query > paste > Run).
-- Rules follow the Oman Labour Law (Royal Decree 53/2023); every number is a setting HR can change.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- tables

create table public.departments (
  id         bigserial primary key,
  name       text unique not null,
  created_at timestamptz not null default now()
);

create sequence public.employee_no_seq start 1001;

create table public.employees (
  id                uuid primary key default gen_random_uuid(),
  employee_no       text unique not null default ('CE-' || nextval('public.employee_no_seq')),
  full_name         text not null,
  email             text not null default '',
  phone             text not null default '',
  nationality       text not null default '',
  nat_type          text not null check (nat_type in ('omani','expat')),
  gender            text not null check (gender in ('male','female')),
  religion          text not null default 'muslim' check (religion in ('muslim','non_muslim')),
  date_of_birth     date,
  marital_status    text not null default '' check (marital_status in ('','single','married','divorced','widowed')),
  department_id     bigint references public.departments(id),
  job_title         text not null default '',
  manager_id        uuid references public.employees(id),
  join_date         date not null,
  probation_end     date,
  contract_type     text not null default 'unlimited' check (contract_type in ('unlimited','fixed')),
  contract_end      date,
  work_location     text not null default '',
  emergency_contact text not null default '',
  status            text not null default 'active' check (status in ('active','probation','resigned','terminated')),
  end_date          date,
  created_at        timestamptz not null default now(),
  check (manager_id is distinct from id)
);
create index employees_manager_idx on public.employees(manager_id);

-- Pay is kept apart so only the HR Manager (and the employee) can read it.
create table public.employee_pay (
  employee_id   uuid primary key references public.employees(id),
  basic_salary  numeric(12,3) not null default 0,
  allowances    numeric(12,3) not null default 0,
  bank_iban     text not null default '',
  updated_at    timestamptz not null default now()
);

create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  username             text unique not null,
  employee_id          uuid unique references public.employees(id),
  role                 text not null check (role in ('employee','hr_officer','hr_manager','admin')),
  status               text not null default 'active' check (status in ('active','disabled')),
  must_change_password boolean not null default true,
  created_at           timestamptz not null default now()
);

create table public.documents (
  id          bigserial primary key,
  employee_id uuid not null references public.employees(id),
  doc_type    text not null check (doc_type in ('passport','resident_card','work_permit','visa','civil_id','contract',
                                                 'certificate','medical_insurance','driving_licence','other')),
  doc_number  text not null default '',
  issue_date  date,
  expiry_date date,
  file_path   text,
  notes       text not null default '',
  uploaded_by uuid references public.profiles(id) on delete set null,
  verified_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index documents_expiry_idx on public.documents(expiry_date);
create index documents_employee_idx on public.documents(employee_id);

create table public.leave_types (
  code               text primary key,
  name               text not null,
  days               integer,                  -- null = as approved (unpaid leave)
  per                text not null check (per in ('year','event','employment')),
  pay_note           text not null default '',
  counts             text not null default 'calendar' check (counts in ('calendar','working')),
  min_service_months integer not null default 0,
  needs_attachment   boolean not null default false,
  route              text not null default 'manager_hr' check (route in ('manager_hr','hr')),
  gender             text not null default 'any' check (gender in ('any','male','female')),
  religion           text not null default 'any' check (religion in ('any','muslim','non_muslim')),
  note               text not null default '',
  active             boolean not null default true,
  sort               integer not null default 0
);

create table public.holidays (
  day  date primary key,
  name text not null
);

create table public.settings (
  key   text primary key,
  value jsonb not null
);

create table public.leave_requests (
  id              bigserial primary key,
  employee_id     uuid not null references public.employees(id),
  leave_type      text not null references public.leave_types(code),
  start_date      date not null,
  end_date        date not null,
  days            integer not null check (days > 0),
  reason          text not null default '',
  attachment_path text,
  status          text not null check (status in ('pending_manager','pending_hr','approved','rejected','returned','cancelled')),
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (end_date >= start_date)
);
create index leave_requests_employee_idx on public.leave_requests(employee_id);
create index leave_requests_status_idx on public.leave_requests(status);

create table public.leave_actions (
  id         bigserial primary key,
  request_id bigint not null references public.leave_requests(id),
  actor      uuid references public.profiles(id) on delete set null,
  actor_name text not null default '',
  action     text not null,
  comment    text not null default '',
  at         timestamptz not null default now()
);
create index leave_actions_request_idx on public.leave_actions(request_id);

-- Opening balances and carry-over: days added (or removed) for one employee, type and year.
create table public.leave_adjustments (
  id          bigserial primary key,
  employee_id uuid not null references public.employees(id),
  leave_type  text not null references public.leave_types(code),
  year        integer not null,
  days        integer not null,
  note        text not null default '',
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table public.letter_requests (
  id           bigserial primary key,
  employee_id  uuid not null references public.employees(id),
  letter_type  text not null check (letter_type in ('salary_certificate','noc','experience')),
  addressed_to text not null default '',
  purpose      text not null default '',
  status       text not null default 'pending' check (status in ('pending','issued','rejected')),
  hr_note      text not null default '',
  created_at   timestamptz not null default now(),
  decided_by   uuid references public.profiles(id) on delete set null,
  decided_at   timestamptz
);

create table public.audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      uuid,
  actor_name text not null default '',
  action     text not null,
  entity     text not null default '',
  entity_id  text not null default '',
  summary    text not null default '',
  old_data   jsonb,
  new_data   jsonb
);
create index audit_log_at_idx on public.audit_log(at desc);

-- ---------------------------------------------------------------- default rules (Oman Labour Law, RD 53/2023)

insert into public.settings(key, value) values
  ('rest_days', '[5,6]'),              -- 0 = Sunday ... 5 = Friday, 6 = Saturday
  ('annual_carry_over_cap', '30'),
  ('company', '"Carbon Engineering Design"'),
  ('login_domain', '"staff.carbon.local"');

insert into public.leave_types(code, name, days, per, pay_note, counts, min_service_months, needs_attachment, route, gender, religion, note, sort) values
  ('annual',    'Annual leave',                           30,  'year',       '100%',                                   'calendar', 6,  false, 'manager_hr', 'any',    'any',        'After 6 months of continuous service. Carry-over capped at 30 days.', 10),
  ('sick',      'Sick leave',                             182, 'year',       '100% days 1-21, 75% to 35, 50% to 70, 35% to 182', 'calendar', 0,  true,  'hr',         'any',    'any',        'Medical certificate required. Employer pays the first 7 days, Social Protection Fund after.', 20),
  ('maternity', 'Maternity leave',                        98,  'event',      '100%',                                   'calendar', 0,  true,  'hr',         'female', 'any',        'Up to 14 days may be taken before delivery. One nursing hour a day afterwards.', 30),
  ('childcare', 'Childcare leave',                        365, 'event',      'Unpaid',                                 'calendar', 0,  false, 'hr',         'female', 'any',        'After maternity leave.', 40),
  ('paternity', 'Paternity leave',                        7,   'event',      '100%',                                   'calendar', 0,  true,  'manager_hr', 'male',   'any',        'Within 98 days of the birth.', 50),
  ('marriage',  'Marriage leave',                         3,   'event',      '100%',                                   'calendar', 0,  true,  'manager_hr', 'any',    'any',        'Per marriage.', 60),
  ('bereave_family', 'Bereavement: wife or child',        10,  'event',      '100%',                                   'calendar', 0,  false, 'hr',         'any',    'any',        '', 70),
  ('bereave_other',  'Bereavement: other close relative', 3,   'event',      '100%',                                   'calendar', 0,  false, 'hr',         'any',    'any',        'Parent, sibling, grandparent.', 80),
  ('iddah',     'Iddah leave (death of husband)',         130, 'event',      '100%',                                   'calendar', 0,  true,  'hr',         'female', 'muslim',     '', 90),
  ('widow',     'Death of husband',                       14,  'event',      '100%',                                   'calendar', 0,  true,  'hr',         'female', 'non_muslim', '', 100),
  ('hajj',      'Hajj leave',                             15,  'employment', '100%',                                   'calendar', 12, false, 'manager_hr', 'any',    'muslim',     'Once per employment, after 1 year of service.', 110),
  ('relative',  'Accompanying a sick relative',           15,  'year',       '100%',                                   'calendar', 0,  true,  'manager_hr', 'any',    'any',        'Confirm whether this applies to expats.', 120),
  ('unpaid',    'Unpaid leave',                           null,'event',      'Unpaid',                                 'calendar', 0,  false, 'manager_hr', 'any',    'any',        'Not counted in end-of-service years.', 130);

-- ---------------------------------------------------------------- helpers

create or replace function public.oman_today() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Asia/Muscat')::date $$;

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid() and status = 'active'), 'none');
$$;

create or replace function public.my_employee() returns uuid
language sql stable security definer set search_path = public as $$
  select employee_id from public.profiles where id = auth.uid() and status = 'active';
$$;

create or replace function public.is_hr() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() in ('hr_officer','hr_manager');
$$;

create or replace function public.can_manage_users() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() in ('hr_manager','admin');
$$;

create or replace function public.manages(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees e where e.id = p_employee and e.manager_id = public.my_employee()
                 and public.my_employee() is not null);
$$;

create or replace function public.actor_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select e.full_name from public.profiles p join public.employees e on e.id = p.employee_id where p.id = p_user),
                  (select username from public.profiles where id = p_user), '');
$$;

-- Days a leave takes: every calendar day, or only working days (no weekly rest days, no public holidays).
create or replace function public.leave_days(p_counts text, p_start date, p_end date) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from generate_series(p_start, p_end, interval '1 day') g(day)
  where p_counts = 'calendar'
     or (not (extract(dow from g.day)::int in (select jsonb_array_elements_text(value)::int from public.settings where key = 'rest_days'))
         and not exists (select 1 from public.holidays h where h.day = g.day::date));
$$;

-- Whole months of service on a date.
create or replace function public.service_months(p_join date, p_on date) returns integer
language sql immutable as $$
  select (extract(year from age(p_on, p_join)) * 12 + extract(month from age(p_on, p_join)))::int;
$$;

-- Balance for one employee, leave type and year. Null entitlement = no limit.
create or replace function public.leave_balance(p_employee uuid, p_type text, p_year integer)
returns table(entitled integer, taken integer, pending integer, remaining integer)
language plpgsql stable security definer set search_path = public as $$
declare t public.leave_types; v_ent integer; v_taken integer; v_pend integer;
begin
  if not (public.is_hr() or p_employee = public.my_employee() or public.manages(p_employee)) then raise exception 'NOT_ALLOWED'; end if;
  select * into t from public.leave_types where code = p_type;
  if t.code is null then raise exception 'BAD_LEAVE_TYPE'; end if;
  select coalesce(sum(case when status = 'approved' then days end), 0), coalesce(sum(case when status in ('pending_manager','pending_hr') then days end), 0)
    into v_taken, v_pend
  from public.leave_requests
  where employee_id = p_employee and leave_type = p_type
    and (t.per <> 'year' or extract(year from start_date)::int = p_year);
  if t.days is null or t.per = 'event' then
    v_ent := t.days;
  else
    v_ent := t.days + coalesce((select sum(days) from public.leave_adjustments
                                 where employee_id = p_employee and leave_type = p_type
                                   and (t.per <> 'year' or year = p_year)), 0)::int;
  end if;
  return query select v_ent, v_taken, v_pend, case when v_ent is null or t.per = 'event' then null else v_ent - v_taken - v_pend end;
end $$;

-- ---------------------------------------------------------------- audit

create or replace function public.write_audit(p_action text, p_entity text, p_entity_id text, p_summary text,
                                              p_old jsonb default null, p_new jsonb default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log(actor, actor_name, action, entity, entity_id, summary, old_data, new_data)
  values (auth.uid(), public.actor_name(auth.uid()), p_action, coalesce(p_entity, ''), coalesce(p_entity_id, ''),
          coalesce(p_summary, ''), p_old, p_new);
end $$;

create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  r jsonb := coalesce(n, o);
  v_old jsonb := o; v_new jsonb := n;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(k, o -> k), '{}'), coalesce(jsonb_object_agg(k, n -> k), '{}') into v_old, v_new
    from jsonb_object_keys(n) k where (o -> k) is distinct from (n -> k);
    if v_new = '{}'::jsonb then return null; end if;
  end if;
  perform public.write_audit(lower(tg_op), tg_table_name,
    coalesce(r ->> 'id', r ->> 'employee_id', r ->> 'code', r ->> 'key', r ->> 'day', ''),
    coalesce(r ->> 'full_name', r ->> 'username', r ->> 'name', r ->> 'doc_type', r ->> 'status', ''), v_old, v_new);
  return null;
end $$;

create trigger audit_employees    after insert or update or delete on public.employees    for each row execute function public.audit_row();
create trigger audit_employee_pay after insert or update or delete on public.employee_pay for each row execute function public.audit_row();
create trigger audit_profiles     after insert or update or delete on public.profiles     for each row execute function public.audit_row();
create trigger audit_documents    after insert or update or delete on public.documents    for each row execute function public.audit_row();
create trigger audit_leave_types  after insert or update or delete on public.leave_types  for each row execute function public.audit_row();
create trigger audit_holidays     after insert or update or delete on public.holidays     for each row execute function public.audit_row();
create trigger audit_settings     after insert or update or delete on public.settings     for each row execute function public.audit_row();
create trigger audit_adjustments  after insert or update or delete on public.leave_adjustments for each row execute function public.audit_row();

create or replace function public.audit_guard() returns trigger
language plpgsql as $$ begin raise exception 'AUDIT_LOG_READ_ONLY'; end $$;
create trigger audit_log_guard before update or delete on public.audit_log for each row execute function public.audit_guard();

create or replace function public.log_event(p_action text, p_detail text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'NOT_ALLOWED'; end if;
  if p_action not in ('sign_in','sign_out','password_changed','export','letter_printed') then raise exception 'BAD_EVENT'; end if;
  perform public.write_audit(p_action, 'session', '', left(coalesce(p_detail, ''), 300));
end $$;

-- ---------------------------------------------------------------- user accounts (no self sign-up)

create or replace function public.create_user_account(p_username text, p_password text, p_role text, p_employee uuid, p_domain text)
returns uuid
language plpgsql security definer set search_path = public, extensions, auth as $$
declare
  v_id    uuid := gen_random_uuid();
  v_user  text := lower(trim(p_username));
  v_email text := lower(trim(p_username)) || '@' || p_domain;
begin
  if v_user !~ '^[a-z0-9._-]{3,30}$' then raise exception 'BAD_USERNAME'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'PASSWORD_TOO_SHORT'; end if;
  if p_role not in ('employee','hr_officer','hr_manager','admin') then raise exception 'BAD_ROLE'; end if;
  if p_role <> 'admin' and p_employee is null then raise exception 'EMPLOYEE_REQUIRED'; end if;
  if p_employee is not null and exists (select 1 from public.profiles where employee_id = p_employee) then raise exception 'EMPLOYEE_HAS_LOGIN'; end if;
  if p_employee is not null and exists (select 1 from public.employees where id = p_employee and status in ('resigned','terminated')) then
    raise exception 'EMPLOYEE_LEFT';
  end if;
  if exists (select 1 from public.profiles where username = v_user) or exists (select 1 from auth.users where email = v_email) then
    raise exception 'USERNAME_TAKEN';
  end if;
  insert into auth.users(instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                         raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                         confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
          crypt(p_password, gen_salt('bf')), now(),
          '{"provider":"email","providers":["email"]}', jsonb_build_object('username', v_user),
          now(), now(), '', '', '', '');
  insert into auth.identities(id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
          jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  insert into public.profiles(id, username, employee_id, role, must_change_password) values (v_id, v_user, p_employee, p_role, true);
  return v_id;
end $$;

create or replace function public.admin_create_user(p_username text, p_password text, p_role text, p_employee uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_users() then raise exception 'NOT_ALLOWED'; end if;
  if p_role = 'admin' and public.app_role() <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  return public.create_user_account(p_username, p_password, p_role, p_employee,
                                    (select value #>> '{}' from public.settings where key = 'login_domain'));
end $$;

create or replace function public.admin_set_password(p_user uuid, p_password text) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if not public.can_manage_users() then raise exception 'NOT_ALLOWED'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'PASSWORD_TOO_SHORT'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = p_user;
  update public.profiles set must_change_password = true where id = p_user;
  perform public.write_audit('password_reset', 'profiles', p_user::text, (select username from public.profiles where id = p_user));
end $$;

create or replace function public.admin_update_user(p_user uuid, p_role text, p_status text) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.can_manage_users() then raise exception 'NOT_ALLOWED'; end if;
  if p_user = auth.uid() then raise exception 'NOT_YOURSELF'; end if;
  if p_role not in ('employee','hr_officer','hr_manager','admin') or p_status not in ('active','disabled') then raise exception 'BAD_VALUE'; end if;
  if p_role = 'admin' and public.app_role() <> 'admin' then raise exception 'NOT_ALLOWED'; end if;
  update public.profiles set role = p_role, status = p_status where id = p_user;
  update auth.users set banned_until = case when p_status = 'disabled' then 'infinity'::timestamptz end where id = p_user;
end $$;

create or replace function public.password_changed() returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set must_change_password = false where id = auth.uid();
  perform public.write_audit('password_changed', 'profiles', auth.uid()::text, '');
end $$;

-- An employee who leaves loses their login the same moment; the record stays.
create or replace function public.employee_left() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  if new.status in ('resigned','terminated') and old.status not in ('resigned','terminated') then
    update public.profiles set status = 'disabled' where employee_id = new.id;
    update auth.users set banned_until = 'infinity'::timestamptz where id in (select id from public.profiles where employee_id = new.id);
  end if;
  return new;
end $$;
create trigger employees_left after update of status on public.employees for each row execute function public.employee_left();

-- ---------------------------------------------------------------- leave workflow

create or replace function public.add_leave_action(p_request bigint, p_action text, p_comment text) returns void
language sql security definer set search_path = public as $$
  insert into public.leave_actions(request_id, actor, actor_name, action, comment)
  values (p_request, auth.uid(), public.actor_name(auth.uid()), p_action, coalesce(p_comment, ''));
$$;

create or replace function public.submit_leave(p_type text, p_start date, p_end date, p_reason text,
                                               p_attachment text default null, p_employee uuid default null)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_emp   uuid := coalesce(p_employee, public.my_employee());
  e       public.employees;
  t       public.leave_types;
  v_days  integer;
  b       record;
  v_mgr_has_login boolean;
  v_status text;
  v_id    bigint;
begin
  if v_emp is null then raise exception 'NO_EMPLOYEE_RECORD'; end if;
  if v_emp <> coalesce(public.my_employee(), '00000000-0000-0000-0000-000000000000'::uuid) and not public.is_hr() then raise exception 'NOT_ALLOWED'; end if;
  select * into e from public.employees where id = v_emp;
  select * into t from public.leave_types where code = p_type and active;
  if t.code is null then raise exception 'BAD_LEAVE_TYPE'; end if;
  if e.status in ('resigned','terminated') then raise exception 'EMPLOYEE_LEFT'; end if;
  if p_end < p_start then raise exception 'BAD_DATES'; end if;
  if t.gender <> 'any' and t.gender <> e.gender then raise exception 'NOT_ELIGIBLE_GENDER'; end if;
  if t.religion <> 'any' and t.religion <> e.religion then raise exception 'NOT_ELIGIBLE_RELIGION'; end if;
  if public.service_months(e.join_date, p_start) < t.min_service_months then
    raise exception 'NEEDS_SERVICE:%', t.min_service_months;
  end if;
  if t.needs_attachment and coalesce(p_attachment, '') = '' then raise exception 'ATTACHMENT_REQUIRED'; end if;
  v_days := public.leave_days(t.counts, p_start, p_end);
  if v_days = 0 then raise exception 'NO_WORKING_DAYS'; end if;
  if exists (select 1 from public.leave_requests where employee_id = v_emp
             and status in ('pending_manager','pending_hr','approved') and daterange(start_date, end_date, '[]') && daterange(p_start, p_end, '[]')) then
    raise exception 'OVERLAP';
  end if;
  if t.days is not null then
    if t.per = 'event' and v_days > t.days then raise exception 'TOO_MANY_DAYS:%', t.days; end if;
    if t.per = 'employment' and exists (select 1 from public.leave_requests where employee_id = v_emp and leave_type = p_type
                                         and status in ('pending_manager','pending_hr','approved')) then
      raise exception 'ONCE_PER_EMPLOYMENT';
    end if;
    if t.per = 'employment' and v_days > t.days then raise exception 'TOO_MANY_DAYS:%', t.days; end if;
    if t.per = 'year' then
      select * into b from public.leave_balance(v_emp, p_type, extract(year from p_start)::int);
      if v_days > b.remaining then raise exception 'NOT_ENOUGH_BALANCE:%', b.remaining; end if;
    end if;
  end if;
  select exists (select 1 from public.profiles where employee_id = e.manager_id and status = 'active') into v_mgr_has_login;
  v_status := case when t.route = 'hr' or e.manager_id is null or not v_mgr_has_login then 'pending_hr' else 'pending_manager' end;
  insert into public.leave_requests(employee_id, leave_type, start_date, end_date, days, reason, attachment_path, status, created_by)
  values (v_emp, p_type, p_start, p_end, v_days, coalesce(p_reason, ''), p_attachment, v_status, auth.uid())
  returning id into v_id;
  perform public.add_leave_action(v_id, 'submitted', p_reason);
  return v_id;
end $$;

create or replace function public.decide_leave(p_request bigint, p_action text, p_comment text default '') returns text
language plpgsql security definer set search_path = public as $$
declare r public.leave_requests; v_new text;
begin
  select * into r from public.leave_requests where id = p_request for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if p_action not in ('approve','reject','return') then raise exception 'BAD_ACTION'; end if;
  if p_action in ('reject','return') and coalesce(trim(p_comment), '') = '' then raise exception 'COMMENT_REQUIRED'; end if;
  if r.employee_id = public.my_employee() then raise exception 'NOT_YOUR_OWN'; end if;
  if r.status = 'pending_manager' and public.manages(r.employee_id) then
    v_new := case p_action when 'approve' then 'pending_hr' when 'reject' then 'rejected' else 'returned' end;
  elsif r.status in ('pending_manager','pending_hr') and public.is_hr() then
    v_new := case p_action when 'approve' then 'approved' when 'reject' then 'rejected' else 'returned' end;
  else
    raise exception 'NOT_ALLOWED';
  end if;
  update public.leave_requests set status = v_new, updated_at = now() where id = p_request;
  perform public.add_leave_action(p_request,
    case when p_action = 'approve' and v_new = 'pending_hr' then 'approved_by_manager'
         when p_action = 'approve' then 'approved_by_hr'
         when p_action = 'reject' then 'rejected' else 'returned' end, p_comment);
  return v_new;
end $$;

create or replace function public.cancel_leave(p_request bigint, p_comment text default '') returns void
language plpgsql security definer set search_path = public as $$
declare r public.leave_requests;
begin
  select * into r from public.leave_requests where id = p_request for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if r.employee_id = public.my_employee() and r.status in ('pending_manager','pending_hr','returned') then null;
  elsif public.is_hr() and r.status in ('pending_manager','pending_hr','returned','approved') then null;
  else raise exception 'NOT_ALLOWED'; end if;
  update public.leave_requests set status = 'cancelled', updated_at = now() where id = p_request;
  perform public.add_leave_action(p_request, 'cancelled', p_comment);
end $$;

create or replace function public.request_letter(p_type text, p_addressed_to text, p_purpose text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if public.my_employee() is null then raise exception 'NO_EMPLOYEE_RECORD'; end if;
  insert into public.letter_requests(employee_id, letter_type, addressed_to, purpose)
  values (public.my_employee(), p_type, coalesce(p_addressed_to, ''), coalesce(p_purpose, '')) returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- row level security

alter table public.departments       enable row level security;
alter table public.employees         enable row level security;
alter table public.employee_pay      enable row level security;
alter table public.profiles          enable row level security;
alter table public.documents         enable row level security;
alter table public.leave_types       enable row level security;
alter table public.holidays          enable row level security;
alter table public.settings          enable row level security;
alter table public.leave_requests    enable row level security;
alter table public.leave_actions     enable row level security;
alter table public.leave_adjustments enable row level security;
alter table public.letter_requests   enable row level security;
alter table public.audit_log         enable row level security;

create policy departments_read  on public.departments for select to authenticated using (public.app_role() <> 'none');
create policy departments_write on public.departments for all to authenticated
  using (public.is_hr() or public.app_role() = 'admin') with check (public.is_hr() or public.app_role() = 'admin');

create policy employees_read on public.employees for select to authenticated
  using (public.is_hr() or public.app_role() = 'admin' or id = public.my_employee() or manager_id = public.my_employee());
-- The System Admin can set up employee records but cannot see pay or documents.
create policy employees_insert on public.employees for insert to authenticated with check (public.is_hr() or public.app_role() = 'admin');
create policy employees_update on public.employees for update to authenticated
  using (public.is_hr() or public.app_role() = 'admin') with check (public.is_hr() or public.app_role() = 'admin');

create policy pay_read  on public.employee_pay for select to authenticated
  using (public.app_role() = 'hr_manager' or employee_id = public.my_employee());
create policy pay_write on public.employee_pay for all to authenticated
  using (public.app_role() = 'hr_manager') with check (public.app_role() = 'hr_manager');

create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_hr() or public.can_manage_users());

create policy documents_read on public.documents for select to authenticated
  using (public.is_hr() or employee_id = public.my_employee());
create policy documents_insert on public.documents for insert to authenticated
  with check (public.is_hr() or employee_id = public.my_employee());
create policy documents_update on public.documents for update to authenticated using (public.is_hr()) with check (public.is_hr());
create policy documents_delete on public.documents for delete to authenticated using (public.is_hr());

create policy leave_types_read  on public.leave_types for select to authenticated using (public.app_role() <> 'none');
create policy leave_types_write on public.leave_types for all to authenticated
  using (public.app_role() in ('hr_manager','admin')) with check (public.app_role() in ('hr_manager','admin'));
create policy holidays_read  on public.holidays for select to authenticated using (public.app_role() <> 'none');
create policy holidays_write on public.holidays for all to authenticated using (public.is_hr()) with check (public.is_hr());
create policy settings_read  on public.settings for select to authenticated using (public.app_role() <> 'none');
create policy settings_write on public.settings for all to authenticated
  using (public.app_role() in ('hr_manager','admin')) with check (public.app_role() in ('hr_manager','admin'));

create policy leave_requests_read on public.leave_requests for select to authenticated
  using (public.is_hr() or employee_id = public.my_employee() or public.manages(employee_id));
create policy leave_actions_read on public.leave_actions for select to authenticated
  using (exists (select 1 from public.leave_requests r where r.id = request_id
                 and (public.is_hr() or r.employee_id = public.my_employee() or public.manages(r.employee_id))));
create policy adjustments_read  on public.leave_adjustments for select to authenticated
  using (public.is_hr() or employee_id = public.my_employee());
create policy adjustments_write on public.leave_adjustments for all to authenticated using (public.is_hr()) with check (public.is_hr());

create policy letters_read   on public.letter_requests for select to authenticated using (public.is_hr() or employee_id = public.my_employee());
create policy letters_update on public.letter_requests for update to authenticated using (public.is_hr()) with check (public.is_hr());

create policy audit_read on public.audit_log for select to authenticated using (public.app_role() in ('hr_manager','admin'));

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;
revoke insert, update, delete on public.leave_requests, public.leave_actions, public.profiles from anon, authenticated;
revoke insert on public.letter_requests from anon, authenticated;
revoke all on all tables in schema public from anon;

-- ---------------------------------------------------------------- function access

revoke all on all functions in schema public from public, anon;
revoke all on function public.create_user_account(text, text, text, uuid, text) from authenticated;
revoke all on function public.write_audit(text, text, text, text, jsonb, jsonb) from authenticated;
revoke all on function public.add_leave_action(bigint, text, text) from authenticated;
revoke all on function public.audit_row() from authenticated;
revoke all on function public.employee_left() from authenticated;
grant execute on function
  public.app_role(), public.my_employee(), public.is_hr(), public.can_manage_users(), public.manages(uuid), public.oman_today(),
  public.leave_days(text, date, date), public.service_months(date, date), public.leave_balance(uuid, text, integer),
  public.submit_leave(text, date, date, text, text, uuid), public.decide_leave(bigint, text, text), public.cancel_leave(bigint, text),
  public.request_letter(text, text, text), public.log_event(text, text), public.password_changed(),
  public.admin_create_user(text, text, text, uuid), public.admin_set_password(uuid, text), public.admin_update_user(uuid, text, text)
to authenticated;

-- ---------------------------------------------------------------- file storage
-- Files live under "<employee id>/docs/..." or "<employee id>/leave/...".

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('files', 'files', false, 10485760, array['application/pdf','image/jpeg','image/png'])
on conflict (id) do nothing;

create policy files_read on storage.objects for select to authenticated
  using (bucket_id = 'files' and (public.is_hr()
         or (storage.foldername(name))[1] = public.my_employee()::text
         or ((storage.foldername(name))[2] = 'leave' and public.manages(((storage.foldername(name))[1])::uuid))));
create policy files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and (public.is_hr() or (storage.foldername(name))[1] = public.my_employee()::text));
create policy files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and public.is_hr());

-- ---------------------------------------------------------------- hardening (advisor fixes)

alter function public.audit_guard() set search_path = public;
alter function public.service_months(date, date) set search_path = public;
revoke all on function public.actor_name(uuid) from authenticated;
revoke all on function public.audit_guard() from authenticated;
