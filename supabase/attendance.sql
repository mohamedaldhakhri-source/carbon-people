-- Carbon People: attendance from the fingerprint device. Run after excuses.sql.
-- HR imports the device's punch log (exported file). Each punch is matched to an employee by the
-- number the employee has on the device. Daily status (present, late, absent) is worked out on screen
-- from punches, working hours, rest days, holidays and approved leave or excuses.

alter table public.employees add column if not exists device_user_id text;
create unique index if not exists employees_device_user_idx on public.employees(device_user_id) where device_user_id is not null and device_user_id <> '';

create table if not exists public.attendance_punches (
  id          bigserial primary key,
  employee_id uuid not null references public.employees(id),
  punched_at  timestamptz not null,
  source      text not null default 'device',
  imported_by uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (employee_id, punched_at)
);
create index if not exists attendance_punches_time_idx on public.attendance_punches(punched_at);

insert into public.settings(key, value) values
  ('attendance', '{"start": "07:30", "end": "16:30", "grace_minutes": 15}')
on conflict (key) do nothing;

alter table public.attendance_punches enable row level security;
create policy punches_read on public.attendance_punches for select to authenticated
  using (public.is_hr() or public.app_role() = 'admin' or employee_id = public.my_employee() or public.manages(employee_id));
create policy punches_write on public.attendance_punches for all to authenticated
  using (public.is_hr() or public.app_role() = 'admin') with check (public.is_hr() or public.app_role() = 'admin');
revoke all on public.attendance_punches from anon;
