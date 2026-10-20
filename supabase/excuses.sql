-- Carbon People: absence excuses, and documents kept by HR and the System Admin. Run after payroll.sql.
-- An excuse is a request for days already missed. It uses the leave workflow (line manager, then HR)
-- but has no balance and no pay deduction.

alter table public.leave_types add column if not exists category text not null default 'leave' check (category in ('leave','excuse'));

insert into public.leave_types(code, name, days, per, pay_note, counts, min_service_months, needs_attachment, route, gender, religion, note, sort, category) values
  ('exc_medical',   'Medical appointment',            null, 'event', '100%', 'working', 0, true,  'manager_hr', 'any', 'any', 'Attach the appointment slip or clinic note.', 101, 'excuse'),
  ('exc_official',  'Government or official errand',  null, 'event', '100%', 'working', 0, true,  'manager_hr', 'any', 'any', 'Attach proof, such as a ministry or police receipt.', 102, 'excuse'),
  ('exc_emergency', 'Family emergency',               null, 'event', '100%', 'working', 0, false, 'manager_hr', 'any', 'any', '', 103, 'excuse'),
  ('exc_transport', 'Transport or road problem',      null, 'event', '100%', 'working', 0, false, 'manager_hr', 'any', 'any', '', 104, 'excuse'),
  ('exc_other',     'Other excuse',                   null, 'event', '100%', 'working', 0, false, 'manager_hr', 'any', 'any', 'Explain the reason.', 105, 'excuse')
on conflict (code) do nothing;

-- Documents: HR and the System Admin add, change and remove them. Employees can only view their own.
alter policy documents_read   on public.documents using (public.is_hr() or public.app_role() = 'admin' or employee_id = public.my_employee());
alter policy documents_insert on public.documents with check (public.is_hr() or public.app_role() = 'admin');
alter policy documents_update on public.documents using (public.is_hr() or public.app_role() = 'admin') with check (public.is_hr() or public.app_role() = 'admin');
alter policy documents_delete on public.documents using (public.is_hr() or public.app_role() = 'admin');

-- Files: employees may upload only leave and excuse attachments.
alter policy files_read on storage.objects
  using (bucket_id = 'files' and (public.is_hr() or public.app_role() = 'admin'
         or (storage.foldername(name))[1] = public.my_employee()::text
         or ((storage.foldername(name))[2] = 'leave' and public.manages(((storage.foldername(name))[1])::uuid))));
alter policy files_insert on storage.objects
  with check (bucket_id = 'files' and (public.is_hr() or public.app_role() = 'admin'
              or ((storage.foldername(name))[1] = public.my_employee()::text and (storage.foldername(name))[2] = 'leave')));
alter policy files_delete on storage.objects using (bucket_id = 'files' and (public.is_hr() or public.app_role() = 'admin'));
