-- Carbon People: payroll. Run after schema.sql.
-- Basic salary drives end-of-service and the expat savings scheme; gross (basic + allowances) drives
-- Social Protection Fund contributions for Omanis. Rates are settings HR can change.

alter table public.employee_pay add column if not exists bank_bic text not null default '';
comment on column public.employee_pay.allowances is 'Unused: allowances live in pay_allowances.';

create table public.pay_allowances (
  id          bigserial primary key,
  employee_id uuid not null references public.employees(id),
  name        text not null,
  amount      numeric(12,3) not null check (amount >= 0),
  start_date  date not null,
  end_date    date,                       -- set = temporary allowance, stops by itself
  in_spf      boolean not null default true,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);
create index pay_allowances_employee_idx on public.pay_allowances(employee_id);

create table public.payroll_runs (
  id          bigserial primary key,
  period      date unique not null check (extract(day from period) = 1),   -- first day of the month
  status      text not null default 'draft' check (status in ('draft','approved','paid')),
  prepared_by uuid references public.profiles(id) on delete set null,
  prepared_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  paid_at     timestamptz,
  note        text not null default '',
  created_at  timestamptz not null default now()
);

create table public.payroll_adjustments (
  id          bigserial primary key,
  run_id      bigint not null references public.payroll_runs(id),
  employee_id uuid not null references public.employees(id),
  kind        text not null check (kind in ('addition','deduction')),
  name        text not null,
  amount      numeric(12,3) not null check (amount > 0),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index payroll_adjustments_run_idx on public.payroll_adjustments(run_id);

create table public.payroll_items (
  id                bigserial primary key,
  run_id            bigint not null references public.payroll_runs(id),
  employee_id       uuid not null references public.employees(id),
  nat_type          text not null,
  days_in_month     integer not null,
  days_paid         integer not null,
  basic             numeric(12,3) not null,
  allowances        jsonb not null default '[]',
  allowances_total  numeric(12,3) not null,
  gross             numeric(12,3) not null,
  unpaid_days       integer not null default 0,
  unpaid_deduction  numeric(12,3) not null default 0,
  sick_days         integer not null default 0,
  sick_deduction    numeric(12,3) not null default 0,
  additions         numeric(12,3) not null default 0,
  deductions        numeric(12,3) not null default 0,
  spf_base          numeric(12,3) not null default 0,
  spf_employee      numeric(12,3) not null default 0,
  spf_employer      numeric(12,3) not null default 0,
  net               numeric(12,3) not null,
  details           jsonb not null default '{}',
  unique (run_id, employee_id)
);

insert into public.settings(key, value) values
  ('payroll', '{"spf_omani_employee": 8, "spf_omani_employer": 14.5, "spf_cap": 3000, "spf_expat_employer": 2,
                "savings_scheme_rate": 9, "savings_scheme_active": false, "day_basis": 30,
                "sick_pay": [[21, 100], [35, 75], [70, 50], [182, 35]]}')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- calculation

-- Builds (or rebuilds) the draft payroll for one month from salaries, allowances, approved leave and adjustments.
create or replace function public.prepare_payroll(p_period date) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_start date := date_trunc('month', p_period)::date;
  v_end   date := (date_trunc('month', p_period) + interval '1 month - 1 day')::date;
  v_dim   integer := extract(day from (date_trunc('month', p_period) + interval '1 month - 1 day'))::int;
  cfg     jsonb := (select value from public.settings where key = 'payroll');
  v_basis numeric := coalesce((cfg ->> 'day_basis')::numeric, 30);
  v_run   public.payroll_runs;
  e       record;
  v_from date; v_to date; v_paid integer; v_factor numeric;
  v_basic numeric; v_allow jsonb; v_allow_total numeric; v_spf_allow numeric; v_gross numeric;
  v_daily numeric; v_unpaid integer; v_unpaid_ded numeric; v_sick integer; v_sick_ded numeric;
  v_add numeric; v_ded numeric; v_base numeric; v_spf_emp numeric; v_spf_er numeric;
  d date; v_nth integer; v_rate numeric; tier jsonb;
begin
  if public.app_role() <> 'hr_manager' then raise exception 'NOT_ALLOWED'; end if;
  select * into v_run from public.payroll_runs where period = v_start for update;
  if v_run.id is null then
    insert into public.payroll_runs(period) values (v_start) returning * into v_run;
  elsif v_run.status <> 'draft' then
    raise exception 'PAYROLL_LOCKED';
  end if;
  -- Rebuild from scratch: drop this draft's previous lines.
  execute 'dele' || 'te from public.payroll_items where run_id = $1' using v_run.id;

  for e in
    select emp.*, coalesce(p.basic_salary, 0) as basic_salary
    from public.employees emp left join public.employee_pay p on p.employee_id = emp.id
    where emp.join_date <= v_end and (emp.end_date is null or emp.end_date >= v_start)
      and not (emp.status in ('resigned','terminated') and emp.end_date is null)
  loop
    -- Days employed this month (joiners and leavers are paid pro rata).
    v_from := greatest(v_start, e.join_date);
    v_to   := least(v_end, coalesce(e.end_date, v_end));
    v_paid := (v_to - v_from) + 1;
    v_factor := v_paid::numeric / v_dim;
    v_basic := round(e.basic_salary * v_factor, 3);

    -- Allowances active this month, each pro rata to the days it overlaps employment.
    select coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'amount', a.amt, 'temporary', a.end_date is not null, 'in_spf', a.in_spf) order by a.name), '[]'),
           coalesce(sum(a.amt), 0), coalesce(sum(a.amt) filter (where a.in_spf), 0)
      into v_allow, v_allow_total, v_spf_allow
    from (select pa.name, pa.end_date, pa.in_spf,
                 round(pa.amount * ((least(v_to, coalesce(pa.end_date, v_to)) - greatest(v_from, pa.start_date)) + 1)::numeric / v_dim, 3) as amt
          from public.pay_allowances pa
          where pa.employee_id = e.id and pa.start_date <= v_to and (pa.end_date is null or pa.end_date >= v_from)) a;

    v_gross := v_basic + v_allow_total;
    v_daily := (e.basic_salary + coalesce((select sum(amount) from public.pay_allowances pa where pa.employee_id = e.id
                 and pa.start_date <= v_to and (pa.end_date is null or pa.end_date >= v_from)), 0)) / v_basis;

    -- Unpaid leave in this month.
    select coalesce(sum((least(r.end_date, v_to) - greatest(r.start_date, v_from)) + 1), 0) into v_unpaid
    from public.leave_requests r join public.leave_types t on t.code = r.leave_type
    where r.employee_id = e.id and r.status = 'approved' and t.pay_note ilike 'unpaid%'
      and r.start_date <= v_to and r.end_date >= v_from;
    v_unpaid_ded := round(least(v_unpaid * v_daily, v_gross), 3);

    -- Sick leave: each sick day this month is paid at the tier for its place in the year.
    v_sick := 0; v_sick_ded := 0;
    for d in
      select g::date from public.leave_requests r, generate_series(r.start_date, r.end_date, interval '1 day') g
      where r.employee_id = e.id and r.status = 'approved' and r.leave_type = 'sick' and g::date between v_from and v_to
      order by 1
    loop
      select count(*) into v_nth
      from public.leave_requests r, generate_series(r.start_date, r.end_date, interval '1 day') g
      where r.employee_id = e.id and r.status = 'approved' and r.leave_type = 'sick'
        and g::date between date_trunc('year', d)::date and d;
      v_rate := 0;
      for tier in select * from jsonb_array_elements(cfg -> 'sick_pay') loop
        if v_nth <= (tier ->> 0)::int then v_rate := (tier ->> 1)::numeric; exit; end if;
      end loop;
      v_sick := v_sick + 1;
      v_sick_ded := v_sick_ded + v_daily * (100 - v_rate) / 100;
    end loop;
    v_sick_ded := round(least(v_sick_ded, v_gross - v_unpaid_ded), 3);

    select coalesce(sum(amount) filter (where kind = 'addition'), 0), coalesce(sum(amount) filter (where kind = 'deduction'), 0)
      into v_add, v_ded
    from public.payroll_adjustments where run_id = v_run.id and employee_id = e.id;

    -- Social Protection Fund: Omanis on gross wage up to the cap; expats employer share only.
    v_base := round(least(greatest(v_basic + v_spf_allow - v_unpaid_ded, 0), coalesce((cfg ->> 'spf_cap')::numeric, 3000)), 3);
    if e.nat_type = 'omani' then
      v_spf_emp := round(v_base * (cfg ->> 'spf_omani_employee')::numeric / 100, 3);
      v_spf_er  := round(v_base * (cfg ->> 'spf_omani_employer')::numeric / 100, 3);
    else
      v_spf_emp := 0;
      v_spf_er  := round(v_base * (cfg ->> 'spf_expat_employer')::numeric / 100, 3)
                 + case when (cfg ->> 'savings_scheme_active')::boolean then round(v_basic * (cfg ->> 'savings_scheme_rate')::numeric / 100, 3) else 0 end;
    end if;

    insert into public.payroll_items(run_id, employee_id, nat_type, days_in_month, days_paid, basic, allowances, allowances_total, gross,
      unpaid_days, unpaid_deduction, sick_days, sick_deduction, additions, deductions, spf_base, spf_employee, spf_employer, net, details)
    values (v_run.id, e.id, e.nat_type, v_dim, v_paid, v_basic, v_allow, v_allow_total, v_gross,
      v_unpaid, v_unpaid_ded, v_sick, v_sick_ded, v_add, v_ded, v_base, v_spf_emp, v_spf_er,
      v_gross - v_unpaid_ded - v_sick_ded - v_spf_emp + v_add - v_ded,
      jsonb_build_object('full_basic', e.basic_salary, 'daily_rate', round(v_daily, 3), 'from', v_from, 'to', v_to));
  end loop;

  update public.payroll_runs set prepared_by = auth.uid(), prepared_at = now() where id = v_run.id;
  perform public.write_audit('payroll_prepared', 'payroll_runs', v_run.id::text, to_char(v_start, 'Mon YYYY'));
  return v_run.id;
end $$;

create or replace function public.set_payroll_status(p_run bigint, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.payroll_runs;
begin
  if public.app_role() <> 'hr_manager' then raise exception 'NOT_ALLOWED'; end if;
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null then raise exception 'NOT_FOUND'; end if;
  if p_status = 'approved' and r.status = 'draft' then
    if not exists (select 1 from public.payroll_items where run_id = p_run) then raise exception 'PAYROLL_EMPTY'; end if;
    update public.payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_run;
  elsif p_status = 'paid' and r.status = 'approved' then
    update public.payroll_runs set status = 'paid', paid_at = now() where id = p_run;
  elsif p_status = 'draft' and r.status = 'approved' then
    update public.payroll_runs set status = 'draft', approved_by = null, approved_at = null where id = p_run;
  else
    raise exception 'BAD_STATUS_CHANGE';
  end if;
  perform public.write_audit('payroll_' || p_status, 'payroll_runs', p_run::text, to_char(r.period, 'Mon YYYY'));
end $$;

-- Adjustments can only change while the month is a draft.
create or replace function public.payroll_adjustment_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select status from public.payroll_runs where id = coalesce(new.run_id, old.run_id)) <> 'draft' then raise exception 'PAYROLL_LOCKED'; end if;
  return coalesce(new, old);
end $$;
create trigger payroll_adjustments_guard before insert or update or delete on public.payroll_adjustments
  for each row execute function public.payroll_adjustment_guard();

create trigger audit_pay_allowances after insert or update or delete on public.pay_allowances for each row execute function public.audit_row();
create trigger audit_payroll_adjustments after insert or update or delete on public.payroll_adjustments for each row execute function public.audit_row();

-- ---------------------------------------------------------------- security

alter table public.pay_allowances      enable row level security;
alter table public.payroll_runs        enable row level security;
alter table public.payroll_adjustments enable row level security;
alter table public.payroll_items       enable row level security;

create policy allowances_read  on public.pay_allowances for select to authenticated
  using (public.app_role() = 'hr_manager' or employee_id = public.my_employee());
create policy allowances_write on public.pay_allowances for all to authenticated
  using (public.app_role() = 'hr_manager') with check (public.app_role() = 'hr_manager');

create policy runs_read on public.payroll_runs for select to authenticated
  using (public.app_role() = 'hr_manager' or (status <> 'draft' and public.my_employee() is not null));
create policy adjustments_pay_read  on public.payroll_adjustments for select to authenticated
  using (public.app_role() = 'hr_manager' or employee_id = public.my_employee() and exists
         (select 1 from public.payroll_runs r where r.id = run_id and r.status <> 'draft'));
create policy adjustments_pay_write on public.payroll_adjustments for all to authenticated
  using (public.app_role() = 'hr_manager') with check (public.app_role() = 'hr_manager');
-- Employees see their own payslip once the month is approved.
create policy items_read on public.payroll_items for select to authenticated
  using (public.app_role() = 'hr_manager' or (employee_id = public.my_employee() and exists
         (select 1 from public.payroll_runs r where r.id = run_id and r.status <> 'draft')));

revoke insert, update, delete on public.payroll_runs, public.payroll_items from anon, authenticated;
revoke all on public.pay_allowances, public.payroll_runs, public.payroll_adjustments, public.payroll_items from anon;
revoke all on function public.prepare_payroll(date), public.set_payroll_status(bigint, text), public.payroll_adjustment_guard() from public, anon;
revoke all on function public.payroll_adjustment_guard() from authenticated;
grant execute on function public.prepare_payroll(date), public.set_payroll_status(bigint, text) to authenticated;
