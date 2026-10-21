-- Carbon People: the System Admin can see and manage pay, like the HR Manager (decided 2026-10-21). Run after attendance.sql.

create or replace function public.can_pay() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_role() in ('hr_manager','admin');
$$;
grant execute on function public.can_pay() to authenticated;

alter policy pay_read         on public.employee_pay        using (public.can_pay() or employee_id = public.my_employee());
alter policy pay_write        on public.employee_pay        using (public.can_pay()) with check (public.can_pay());
alter policy allowances_read  on public.pay_allowances      using (public.can_pay() or employee_id = public.my_employee());
alter policy allowances_write on public.pay_allowances      using (public.can_pay()) with check (public.can_pay());
alter policy runs_read        on public.payroll_runs        using (public.can_pay() or (status <> 'draft' and public.my_employee() is not null));
alter policy adjustments_pay_read  on public.payroll_adjustments using (public.can_pay() or (employee_id = public.my_employee() and exists
  (select 1 from public.payroll_runs r where r.id = run_id and r.status <> 'draft')));
alter policy adjustments_pay_write on public.payroll_adjustments using (public.can_pay()) with check (public.can_pay());
alter policy items_read       on public.payroll_items       using (public.can_pay() or (employee_id = public.my_employee() and exists
  (select 1 from public.payroll_runs r where r.id = run_id and r.status <> 'draft')));

-- prepare_payroll and set_payroll_status: the role check becomes "if not public.can_pay() then raise exception 'NOT_ALLOWED'".
do $$
declare f text;
begin
  foreach f in array array['public.prepare_payroll(date)', 'public.set_payroll_status(bigint, text)'] loop
    execute replace(pg_get_functiondef(f::regprocedure), 'if public.app_role() <> ''hr_manager'' then', 'if not public.can_pay() then');
  end loop;
end $$;
