# Carbon People

Human resources platform for Carbon Engineering Design: employee records, documents with expiry tracking, leave requests with a two-step approval (line manager, then HR), employee self-service letters, reports and user accounts. Leave rules follow the Oman Labour Law (Royal Decree 53/2023) and are editable settings.

The website is plain HTML and JavaScript in `web/`. Data, sign-in and files live in Supabase (project **Carbon People**, region Mumbai).

## What each role can do

| Role | Can do |
|---|---|
| Employee | See own profile, leave balances and documents; request leave and letters; upload own documents. |
| Line manager | Anyone with direct reports. Approves their team's leave first and sees team leave. No special role needed. |
| HR Officer | All employee records and documents, final leave approval, letters, reports, holidays. Cannot see salaries. |
| HR Manager | Everything HR Officer does, plus salaries, leave rules, user accounts and the audit log. |
| System Admin | Company setup: employee records, departments, leave rules, user accounts, audit log. Cannot see salaries or documents. |

There is no self sign-up. HR Manager or System Admin creates each login on **User accounts** and links it to one employee. The employee must set a new password at first sign-in. When an employee's status is set to Resigned or Terminated, their login is disabled at once; the record is kept.

## Hosting (Vercel, free plan)

1. At https://vercel.com, **Add New > Project**, import the `carbon-people` GitHub repository.
2. Set **Root Directory** to `web`, framework preset **Other**, no build command.
3. Deploy. Any static host works (Netlify, Cloudflare Pages, GitHub Pages): serve the `web/` folder.

`web/config.js` holds the Supabase URL and publishable key. The key is meant to be public; all protection is in the database (row level security and the functions in `supabase/schema.sql`). Never put the `service_role` key in the website.

## Supabase settings

- **Authentication > Sign In / Providers > Email**: Email on, **Confirm email** off. Usernames are turned into `username@staff.carbon.local` behind the scenes.
- Optionally switch off **Allow new users to sign up**. Accounts made outside the app have no profile and can see nothing anyway.
- Storage bucket `files` (private) holds documents under `<employee id>/docs/` and leave attachments under `<employee id>/leave/`.

## Setting up a new database

Run `supabase/schema.sql` once in **SQL Editor** on an empty project. Then create the first account there:

```sql
select public.create_user_account('mohamed', 'a-temporary-password', 'admin', null, 'staff.carbon.local');
```

## Leave rules (defaults)

| Leave | Days | Notes |
|---|---|---|
| Annual | 30 a year | After 6 months of service |
| Sick | 182 a year | 100% days 1-21, 75% to 35, 50% to 70, 35% to 182; certificate required; goes straight to HR |
| Maternity | 98 each time | Women; goes straight to HR |
| Childcare | Up to 1 year, unpaid | Women |
| Paternity | 7 each time | Men |
| Marriage | 3 each time | |
| Bereavement | 10 (wife or child), 3 (other close relative) | |
| Iddah | 130 | Muslim women, death of husband |
| Death of husband | 14 | Non-Muslim women |
| Hajj | 15, once | After 1 year of service, Muslims |
| Accompanying a sick relative | 15 a year | Check whether it applies to expats |
| Unpaid | As approved | |

Weekly rest days default to Friday and Saturday. HR adds public holidays on **Leave rules**. All values should be checked against the decree text before go-live.

## Not in this version

- Email or SMS alerts. Expiring documents and waiting approvals show on the dashboard and Approvals screen.
- Payroll, attendance, performance reviews and the end-of-service calculator (the employee page shows an estimate for expats).

## Files

| Path | Purpose |
|---|---|
| `web/index.html` | Page and styles. |
| `web/app.js` | All screens. |
| `web/config.js` | Supabase URL, publishable key and login domain. |
| `web/vercel.json` | No caching for `config.js` and `app.js`. |
| `supabase/schema.sql` | Tables, Oman leave defaults, functions, security rules and storage. |
