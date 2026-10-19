/* Carbon People: HR platform for Carbon Engineering Design.
   Plain browser script on top of Supabase. Every permission is enforced in the database
   (row level security and the functions in supabase/schema.sql); the screens only hide what a role cannot use. */
(() => {
const CFG = window.CP_CONFIG || {};
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {auth: {persistSession: true, autoRefreshToken: true}});
const S = {user: null, profile: null, emp: null, types: [], settings: {}, depts: [], isManager: false, view: 'dashboard', pendingCount: 0};
const $ = id => document.getElementById(id);
const root = $('root');

// ---------------------------------------------------------------- helpers
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const today = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Muscat'}).format(new Date());
const dt = s => new Date(s + 'T00:00:00Z');
const fmt = s => s ? dt(String(s).slice(0, 10)).toLocaleDateString('en-GB', {day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'}) : '';
const fmtTime = s => s ? new Date(s).toLocaleString('en-GB', {day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Muscat'}) : '';
const daysUntil = s => Math.round((dt(s) - dt(today())) / 864e5);
const year = () => Number(today().slice(0, 4));
const omr = n => n == null ? '' : Number(n).toLocaleString('en-GB', {minimumFractionDigits: 3, maximumFractionDigits: 3});
const role = () => S.profile?.role;
const isHR = () => ['hr_officer', 'hr_manager'].includes(role());
const isHRM = () => role() === 'hr_manager';
const canUsers = () => ['hr_manager', 'admin'].includes(role());
const canRules = () => ['hr_manager', 'admin'].includes(role());
const ROLE_NAMES = {employee: 'Employee', hr_officer: 'HR Officer', hr_manager: 'HR Manager', admin: 'System Admin'};
const STATUS_NAMES = {pending_manager: 'Waiting for manager', pending_hr: 'Waiting for HR', approved: 'Approved', rejected: 'Rejected', returned: 'Returned for changes', cancelled: 'Cancelled'};
const DOC_TYPES = {passport: 'Passport', resident_card: 'Resident card', work_permit: 'Work permit', visa: 'Visa', civil_id: 'Civil ID', contract: 'Contract',
  certificate: 'Certificate', medical_insurance: 'Medical insurance', driving_licence: 'Driving licence', other: 'Other'};
const LETTERS = {salary_certificate: 'Salary certificate', noc: 'No objection certificate (NOC)', experience: 'Experience letter'};
const EMP_STATUS = {active: 'Active', probation: 'On probation', resigned: 'Resigned', terminated: 'Terminated'};
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ERRORS = {
  NEEDS_SERVICE: n => `This leave needs ${n} months of service on the start date.`,
  NOT_ENOUGH_BALANCE: n => `Not enough balance. You have ${n} days left.`,
  TOO_MANY_DAYS: n => `This leave allows up to ${n} days at a time.`,
  ATTACHMENT_REQUIRED: () => 'This leave needs an attachment, such as a certificate.',
  OVERLAP: () => 'These dates overlap another leave request.',
  NO_WORKING_DAYS: () => 'These dates fall only on rest days or public holidays.',
  BAD_DATES: () => 'The end date must be on or after the start date.',
  ONCE_PER_EMPLOYMENT: () => 'This leave can be taken once during employment, and it has already been used.',
  NOT_ELIGIBLE_GENDER: () => 'This leave type does not apply to this employee.',
  NOT_ELIGIBLE_RELIGION: () => 'This leave type does not apply to this employee.',
  COMMENT_REQUIRED: () => 'Add a comment so the employee knows why.',
  NOT_YOUR_OWN: () => 'You cannot approve your own request.',
  NOT_ALLOWED: () => 'You do not have permission to do that.',
  USERNAME_TAKEN: () => 'That username is already used.',
  BAD_USERNAME: () => 'Usernames use 3 to 30 lowercase letters, numbers, dots, dashes or underscores.',
  PASSWORD_TOO_SHORT: () => 'Passwords need at least 10 characters.',
  EMPLOYEE_HAS_LOGIN: () => 'This employee already has a login.',
  EMPLOYEE_REQUIRED: () => 'Choose the employee this login belongs to.',
  EMPLOYEE_LEFT: () => 'This employee has left the company.',
  NOT_YOURSELF: () => 'You cannot change your own account here.',
  NO_EMPLOYEE_RECORD: () => 'Your login is not linked to an employee record. Ask HR to link it.'
};
function errText(e){
  const m = String(e?.message || e || 'Something went wrong');
  const [code, arg] = m.split(':');
  if (ERRORS[code]) return ERRORS[code](arg);
  if (/Invalid login credentials/i.test(m)) return 'Wrong username or password.';
  if (/banned/i.test(m)) return 'This account is disabled. Contact HR.';
  if (/duplicate key/i.test(m)) return 'That value is already used by another record.';
  return m;
}
let toastTimer;
function toast(t){ const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 3200); }
function drawer(html){ $('drawer').innerHTML = `<div class="drawer" role="dialog" aria-modal="true">${html}</div>`; }
function closeDrawer(){ $('drawer').innerHTML = ''; }
const drawerHead = title => `<div class="row between" style="margin-bottom:8px"><h2 style="margin:0">${title}</h2><button class="btn sm" data-a="close">Close</button></div>`;
async function q(p){ const {data, error} = await p; if (error) throw error; return data; }
const pill = (text, cls) => `<span class="pill ${cls}">${esc(text)}</span>`;
function statusPill(s){
  const cls = s === 'approved' ? 'p-good' : ['rejected', 'cancelled'].includes(s) ? 'p-bad' : s === 'returned' ? 'p-mute' : 'p-warn';
  return pill(STATUS_NAMES[s] || s, cls);
}
function docState(expiry){
  if (!expiry) return {days: null, label: 'No expiry', cls: 'p-mute'};
  const d = daysUntil(expiry);
  if (d < 0) return {days: d, label: `Expired ${-d}d ago`, cls: 'p-bad'};
  if (d <= 30) return {days: d, label: `${d} days left`, cls: 'p-bad'};
  if (d <= 90) return {days: d, label: `${d} days left`, cls: 'p-warn'};
  return {days: d, label: 'Valid', cls: 'p-good'};
}
const typeName = c => S.types.find(t => t.code === c)?.name || c;
const deptName = id => S.depts.find(d => d.id === id)?.name || '';
const header = (title, sub, actions = '') => `<div class="top"><div><h1>${title}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div class="row noprint">${actions}</div></div>`;
function table(heads, rows, empty = 'Nothing to show.'){
  if (!rows.length) return `<p class="empty">${empty}</p>`;
  return `<div class="tablewrap"><table><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
async function signedUrl(path){
  const {data, error} = await sb.storage.from('files').createSignedUrl(path, 300);
  if (error) throw error;
  return data.signedUrl;
}
async function upload(file, folder){
  if (file.size > 10 * 1024 * 1024) throw new Error('Files can be up to 10 MB.');
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const path = `${folder}/${Date.now()}-${safe}`;
  const {error} = await sb.storage.from('files').upload(path, file, {contentType: file.type});
  if (error) throw error;
  return path;
}
function downloadText(name, text, type = 'text/csv'){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], {type}));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
const csvCell = v => /[",\n]/.test(String(v ?? '')) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? '');
function parseCsv(text){
  const rows = []; let row = [], cell = '', inQ = false;
  for (let i = 0; i < text.length; i++){
    const c = text[i];
    if (inQ){ if (c === '"' && text[i + 1] === '"'){ cell += '"'; i++; } else if (c === '"') inQ = false; else cell += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r'){ if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length){ row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()));
}
function tempPassword(){
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const b = new Uint32Array(12); crypto.getRandomValues(b);
  return Array.from(b, x => a[x % a.length]).join('');
}

// ---------------------------------------------------------------- sign in
function renderLogin(msg = ''){
  closeDrawer();
  root.innerHTML = `<div class="login"><form class="panel" id="loginForm">
    <div class="brand">Carbon People<small>Carbon Engineering Design · Your People. One Platform.</small></div>
    <p class="muted small" style="margin:14px 0 18px">Sign in with the username and password HR gave you.</p>
    ${msg ? `<div class="msg bad">${esc(msg)}</div>` : ''}
    <div class="f" style="margin-bottom:12px"><label for="lUser">Username</label><input id="lUser" autocomplete="username" autocapitalize="none" required></div>
    <div class="f" style="margin-bottom:16px"><label for="lPass">Password</label><input id="lPass" type="password" autocomplete="current-password" required></div>
    <button class="btn primary" id="lBtn" style="width:100%">Sign in</button>
    <p class="muted small" style="margin:14px 0 0">Forgot your password? Ask HR to reset it.</p></form></div>`;
  $('lUser').focus();
}
async function doLogin(){
  const u = $('lUser').value.trim().toLowerCase(), p = $('lPass').value;
  $('lBtn').disabled = true;
  const {error} = await sb.auth.signInWithPassword({email: `${u}@${CFG.LOGIN_DOMAIN}`, password: p});
  if (error){ renderLogin(errText(error)); $('lUser').value = u; return; }
  sb.rpc('log_event', {p_action: 'sign_in', p_detail: navigator.userAgent.slice(0, 200)});
  await boot();
}
function renderChangePassword(msg = ''){
  root.innerHTML = `<div class="login"><form class="panel" id="pwForm">
    <div class="brand">Set your password</div>
    <p class="muted small" style="margin:10px 0 18px">Choose a new password before you continue. Use at least 10 characters.</p>
    ${msg ? `<div class="msg bad">${esc(msg)}</div>` : ''}
    <div class="f" style="margin-bottom:12px"><label for="pw1">New password</label><input id="pw1" type="password" autocomplete="new-password" minlength="10" required></div>
    <div class="f" style="margin-bottom:16px"><label for="pw2">Repeat new password</label><input id="pw2" type="password" autocomplete="new-password" minlength="10" required></div>
    <button class="btn primary" id="pwBtn" style="width:100%">Save password</button>
    <button class="btn" type="button" data-a="signout" style="width:100%;margin-top:8px">Sign out</button></form></div>`;
}
async function doChangePassword(){
  const a = $('pw1').value, b = $('pw2').value;
  if (a.length < 10) return renderChangePassword('Use at least 10 characters.');
  if (a !== b) return renderChangePassword('The two passwords do not match.');
  $('pwBtn').disabled = true;
  const {error} = await sb.auth.updateUser({password: a});
  if (error) return renderChangePassword(errText(error));
  await sb.rpc('password_changed');
  toast('Password saved');
  await boot();
}

// ---------------------------------------------------------------- boot
async function loadLookups(){
  const [types, settings, depts] = await Promise.all([
    q(sb.from('leave_types').select('*').order('sort')),
    q(sb.from('settings').select('*')),
    q(sb.from('departments').select('*').order('name'))
  ]);
  S.types = types; S.depts = depts;
  S.settings = Object.fromEntries(settings.map(r => [r.key, r.value]));
}
async function boot(){
  const {data: {session}} = await sb.auth.getSession();
  if (!session) return renderLogin();
  S.user = session.user;
  const prof = await q(sb.from('profiles').select('*').eq('id', S.user.id).maybeSingle());
  if (!prof || prof.status !== 'active'){ await sb.auth.signOut(); return renderLogin('This account is not active. Contact HR.'); }
  S.profile = prof;
  if (prof.must_change_password) return renderChangePassword();
  S.emp = prof.employee_id ? await q(sb.from('employees').select('*').eq('id', prof.employee_id).maybeSingle()) : null;
  await loadLookups();
  S.isManager = S.emp ? (await q(sb.from('employees').select('id', {count: 'exact', head: false}).eq('manager_id', S.emp.id).limit(1))).length > 0 : false;
  root.innerHTML = `<div class="app"><aside class="rail noprint"><div class="brand">Carbon People<small>Your People. One Platform.</small></div>
    <nav class="nav" id="nav"></nav><div class="who"><div><b>${esc(S.emp?.full_name || S.profile.username)}</b><br>${ROLE_NAMES[role()]}${S.isManager ? ' · Line manager' : ''}</div>
    <div class="row"><button class="btn sm" data-a="mypw">Change password</button><button class="btn sm" data-a="signout">Sign out</button></div></div></aside><main id="main"></main></div>`;
  if (!navItems().some(i => i[0] === S.view)) S.view = navItems()[0][0];
  await render();
}
function navItems(){
  const n = [];
  if (S.emp) n.push(['dashboard', 'Dashboard'], ['leave', 'My leave'], ['letters', 'My letters']);
  if (S.emp && !isHR()) n.push(['mydocs', 'My documents']);
  if (S.isManager || isHR()) n.push(['approvals', 'Approvals']);
  if (isHR() || role() === 'admin') n.push(['employees', 'Employees']);
  else if (S.isManager) n.push(['employees', 'My team']);
  if (isHR()) n.push(['documents', 'Documents'], ['letterq', 'Letter requests'], ['reports', 'Reports']);
  if (canRules()) n.push(['rules', 'Leave rules']);
  if (canUsers()) n.push(['users', 'User accounts'], ['audit', 'Audit log']);
  return n;
}
async function refreshPending(){
  if (!(S.isManager || isHR())) { S.pendingCount = 0; return; }
  const rows = await q(sb.from('leave_requests').select('id, status, employee_id, employees!inner(manager_id)').in('status', ['pending_manager', 'pending_hr']));
  S.pendingCount = rows.filter(r => mineToDecide(r)).length;
}
function mineToDecide(r){
  if (r.employee_id === S.emp?.id) return false;
  if (r.status === 'pending_manager' && r.employees?.manager_id === S.emp?.id) return true;
  if (r.status === 'pending_hr' && isHR()) return true;
  return false;
}
function renderNav(){
  $('nav').innerHTML = navItems().map(([k, label]) => `<button data-a="nav" data-v="${k}" ${k === S.view ? 'aria-current="page"' : ''}>${label}${k === 'approvals' && S.pendingCount ? `<span class="count">${S.pendingCount}</span>` : ''}</button>`).join('');
}
async function render(){
  const main = $('main');
  try {
    await refreshPending();
    renderNav();
    main.innerHTML = await V[S.view]();
  } catch (e){
    main.innerHTML = `<div class="msg bad">${esc(errText(e))}</div>`;
  }
}
const go = v => { S.view = v; closeDrawer(); render(); };

// ---------------------------------------------------------------- views
const V = {};

V.dashboard = async () => {
  const t = today(), in90 = new Date(dt(t).getTime() + 90 * 864e5).toISOString().slice(0, 10);
  let tiles = '', extra = '';
  if (isHR()){
    const [emps, docs, pend, off] = await Promise.all([
      q(sb.from('employees').select('id, nat_type, status').not('status', 'in', '(resigned,terminated)')),
      q(sb.from('documents').select('id, doc_type, expiry_date, employee_id, employees(full_name)').not('expiry_date', 'is', null).lte('expiry_date', in90).order('expiry_date')),
      q(sb.from('leave_requests').select('id').eq('status', 'pending_hr')),
      q(sb.from('leave_requests').select('id, leave_type, start_date, end_date, status, employees(full_name)').in('status', ['approved', 'pending_manager', 'pending_hr']).gte('end_date', t).order('start_date').limit(12))
    ]);
    const om = emps.filter(e => e.nat_type === 'omani').length;
    const expired = docs.filter(d => d.expiry_date < t).length, d30 = docs.filter(d => d.expiry_date >= t && daysUntil(d.expiry_date) <= 30).length;
    tiles = `<div class="panel tile"><div class="k">Headcount</div><div class="v">${emps.length}</div><div class="n">${om} Omani · ${emps.length - om} expat</div></div>
      <div class="panel tile"><div class="k">Omanisation</div><div class="v">${emps.length ? (om / emps.length * 100).toFixed(1) : '0.0'}%</div><div class="n">Omani share of headcount</div></div>
      <div class="panel tile"><div class="k">Documents expired</div><div class="v" style="color:${expired ? 'var(--bad)' : 'inherit'}">${expired}</div><div class="n">${d30} more within 30 days</div></div>
      <div class="panel tile"><div class="k">Waiting on HR</div><div class="v">${pend.length}</div><div class="n">leave requests at the final step</div></div>`;
    extra = `<div class="grid two" style="margin-top:16px"><div class="panel"><h2>Documents expiring within 90 days</h2>
      ${table(['Employee', 'Document', 'Expiry', 'Status'], docs.map(d => { const s = docState(d.expiry_date); return `<tr class="click" data-a="emp" data-id="${d.employee_id}"><td>${esc(d.employees?.full_name)}</td><td>${DOC_TYPES[d.doc_type]}</td><td class="mono">${fmt(d.expiry_date)}</td><td>${pill(s.label, s.cls)}</td></tr>`; }), 'No documents expire in the next 90 days.')}</div>
      <div class="panel"><h2>Who is off</h2>${offTable(off)}</div></div>`;
  } else if (S.emp){
    const [bal, mine, docs] = await Promise.all([
      q(sb.rpc('leave_balance', {p_employee: S.emp.id, p_type: 'annual', p_year: year()})),
      q(sb.from('leave_requests').select('*').eq('employee_id', S.emp.id).order('created_at', {ascending: false}).limit(8)),
      q(sb.from('documents').select('id, expiry_date').eq('employee_id', S.emp.id).not('expiry_date', 'is', null).lte('expiry_date', in90))
    ]);
    const b = bal[0] || {};
    tiles = `<div class="panel tile"><div class="k">Annual leave left</div><div class="v">${b.remaining ?? 0}</div><div class="n">of ${b.entitled ?? 0} days in ${year()}</div></div>
      <div class="panel tile"><div class="k">My pending requests</div><div class="v">${mine.filter(r => r.status.startsWith('pending')).length}</div><div class="n">waiting for approval</div></div>
      <div class="panel tile"><div class="k">My documents due</div><div class="v">${docs.length}</div><div class="n">expiring within 90 days</div></div>`;
    if (S.isManager) tiles += `<div class="panel tile"><div class="k">Waiting on you</div><div class="v">${S.pendingCount}</div><div class="n">leave requests to approve</div></div>`;
    let offHtml = '';
    if (S.isManager){
      const off = await q(sb.from('leave_requests').select('id, leave_type, start_date, end_date, status, employees!inner(full_name, manager_id)').eq('employees.manager_id', S.emp.id).in('status', ['approved', 'pending_manager', 'pending_hr']).gte('end_date', t).order('start_date').limit(12));
      offHtml = `<div class="panel"><h2>Team leave</h2>${offTable(off)}</div>`;
    }
    extra = `<div class="grid ${S.isManager ? 'two' : ''}" style="margin-top:16px"><div class="panel"><h2>My recent requests</h2>${requestTable(mine, false)}</div>${offHtml}</div>`;
  }
  const name = (S.emp?.full_name || S.profile.username).split(' ')[0];
  const sub = S.emp ? `${esc(S.emp.job_title)}${S.emp.department_id ? ' · ' + esc(deptName(S.emp.department_id)) : ''}` : ROLE_NAMES[role()];
  return header(`Welcome, ${esc(name)}`, sub) + `<div class="grid tiles">${tiles}</div>` + extra;
};
function offTable(rows){
  return table(['Employee', 'Leave', 'Dates', 'Status'], rows.map(r => `<tr><td>${esc(r.employees?.full_name)}</td><td>${esc(typeName(r.leave_type))}</td><td class="mono">${fmt(r.start_date)} to ${fmt(r.end_date)}</td><td>${statusPill(r.status)}</td></tr>`), 'Nobody has leave booked.');
}
function requestTable(rows, withEmp){
  return table(['Ref', ...(withEmp ? ['Employee'] : []), 'Leave', 'Dates', 'Days', 'Status'], rows.map(r => `<tr class="click" data-a="req" data-id="${r.id}">
    <td class="mono">LR-${r.id}</td>${withEmp ? `<td>${esc(r.employees?.full_name)}</td>` : ''}<td>${esc(typeName(r.leave_type))}</td>
    <td class="mono">${fmt(r.start_date)} to ${fmt(r.end_date)}</td><td class="mono">${r.days}</td><td>${statusPill(r.status)}</td></tr>`), 'No requests yet.');
}

// ---- My leave
let draft = {type: 'annual', start: '', end: '', reason: ''};
let leaveMsg = null;
function eligibleTypes(e){
  return S.types.filter(t => t.active && (t.gender === 'any' || t.gender === e.gender) && (t.religion === 'any' || t.religion === e.religion));
}
V.leave = async () => {
  const types = eligibleTypes(S.emp);
  if (!types.some(t => t.code === draft.type)) draft.type = types[0]?.code;
  const yearly = types.filter(t => t.per === 'year' && t.days != null);
  const [bals, mine] = await Promise.all([
    Promise.all(yearly.map(t => q(sb.rpc('leave_balance', {p_employee: S.emp.id, p_type: t.code, p_year: year()})).then(r => ({t, b: r[0]})))),
    q(sb.from('leave_requests').select('*').eq('employee_id', S.emp.id).order('created_at', {ascending: false}))
  ]);
  return header('My leave', `Balances for ${year()} under the Oman Labour Law`) + `
    <div class="panel" style="margin-bottom:16px"><h2>Balances</h2><div class="bal">${bals.map(({t, b}) => `<div><b>${b.remaining}</b><span>${esc(t.name)}: days left of ${b.entitled}${b.pending ? `, ${b.pending} pending` : ''}</span></div>`).join('')}</div></div>
    <div class="grid two"><div class="panel"><h2>New leave request</h2>
      ${leaveMsg ? `<div class="msg ${leaveMsg.cls}">${esc(leaveMsg.text)}</div>` : ''}
      <form id="leaveForm">
        <div class="fgrid">
          <div class="f full"><label for="lfType">Leave type</label><select id="lfType">${types.map(t => `<option value="${t.code}" ${t.code === draft.type ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>
          <div class="f"><label for="lfStart">From</label><input id="lfStart" type="date" value="${draft.start}" required></div>
          <div class="f"><label for="lfEnd">To</label><input id="lfEnd" type="date" value="${draft.end}" required></div>
        </div>
        <div class="calc" id="lfCalc">${typeInfo(S.types.find(t => t.code === draft.type))}</div>
        <div class="fgrid">
          <div class="f full"><label for="lfReason">Reason</label><textarea id="lfReason" rows="2">${esc(draft.reason)}</textarea></div>
          <div class="f full" id="lfAttachWrap"><label for="lfAttach">Attachment (PDF, JPG or PNG, up to 10 MB)</label><input id="lfAttach" type="file" accept=".pdf,.jpg,.jpeg,.png"></div>
        </div>
        <button class="btn primary" id="lfBtn">Submit request</button>
      </form></div>
      <div class="panel"><h2>My requests</h2>${requestTable(mine, false)}</div></div>`;
};
function typeInfo(t, days){
  if (!t) return '';
  return `${days != null ? `<b class="mono">${days}</b> ${t.counts} day${days === 1 ? '' : 's'} · ` : ''}Pay ${esc(t.pay_note)} · ${t.route === 'hr' ? 'Goes straight to HR' : 'Line manager, then HR'}${t.needs_attachment ? ' · <b>attachment required</b>' : ''}${t.days != null ? ` · up to ${t.days} days ${t.per === 'year' ? 'a year' : t.per === 'employment' ? 'once' : 'each time'}` : ''}${t.note ? `<br><span class="muted">${esc(t.note)}</span>` : ''}`;
}
async function updateLeaveCalc(){
  draft.type = $('lfType').value; draft.start = $('lfStart').value; draft.end = $('lfEnd').value;
  const t = S.types.find(x => x.code === draft.type);
  let days = null;
  if (draft.start && draft.end && draft.end >= draft.start) days = await q(sb.rpc('leave_days', {p_counts: t.counts, p_start: draft.start, p_end: draft.end}));
  $('lfCalc').innerHTML = typeInfo(t, days);
}
async function submitLeave(){
  const btn = $('lfBtn'); btn.disabled = true;
  draft.reason = $('lfReason').value;
  try {
    const file = $('lfAttach').files[0];
    const path = file ? await upload(file, `${S.emp.id}/leave`) : null;
    const id = await q(sb.rpc('submit_leave', {p_type: $('lfType').value, p_start: $('lfStart').value, p_end: $('lfEnd').value, p_reason: draft.reason, p_attachment: path}));
    leaveMsg = {cls: 'good', text: `LR-${id} was sent for approval.`};
    draft = {type: 'annual', start: '', end: '', reason: ''};
  } catch (e){ leaveMsg = {cls: 'bad', text: errText(e)}; }
  await render();
}

async function openRequest(id){
  const r = await q(sb.from('leave_requests').select('*, employees(full_name, job_title, manager_id)').eq('id', id).single());
  const [acts, bal] = await Promise.all([
    q(sb.from('leave_actions').select('*').eq('request_id', id).order('at')),
    q(sb.rpc('leave_balance', {p_employee: r.employee_id, p_type: r.leave_type, p_year: Number(r.start_date.slice(0, 4))})).catch(() => [])
  ]);
  const t = S.types.find(x => x.code === r.leave_type) || {};
  const canDecide = mineToDecide(r);
  const own = r.employee_id === S.emp?.id;
  const canCancel = (own && ['pending_manager', 'pending_hr', 'returned'].includes(r.status)) || (isHR() && !own && ['pending_manager', 'pending_hr', 'returned', 'approved'].includes(r.status));
  const b = bal[0];
  const ACT = {submitted: 'Submitted', approved_by_manager: 'Approved by manager', approved_by_hr: 'Approved by HR', rejected: 'Rejected', returned: 'Returned for changes', cancelled: 'Cancelled'};
  drawer(drawerHead(`LR-${r.id}`) + `<p>${statusPill(r.status)}</p>
    <dl class="dl"><dt>Employee</dt><dd>${esc(r.employees?.full_name)} · ${esc(r.employees?.job_title)}</dd>
    <dt>Leave</dt><dd>${esc(t.name)} (pay ${esc(t.pay_note)})</dd><dt>Dates</dt><dd class="mono">${fmt(r.start_date)} to ${fmt(r.end_date)}</dd>
    <dt>Days</dt><dd class="mono">${r.days} ${t.counts || ''}</dd>${b && b.remaining != null ? `<dt>Balance</dt><dd class="mono">${b.remaining} left of ${b.entitled} (this request included)</dd>` : ''}
    <dt>Reason</dt><dd>${esc(r.reason) || '<span class="muted">None given</span>'}</dd>
    ${r.attachment_path ? `<dt>Attachment</dt><dd><button class="btn sm" data-a="file" data-path="${esc(r.attachment_path)}">Open file</button></dd>` : ''}</dl>
    <h2>History</h2>${table(['When', 'What', 'Who'], acts.map(a => `<tr><td class="mono">${fmtTime(a.at)}</td><td>${ACT[a.action] || esc(a.action)}${a.comment && a.action !== 'submitted' ? `<div class="muted small">${esc(a.comment)}</div>` : ''}</td><td>${esc(a.actor_name)}</td></tr>`))}
    ${canDecide || canCancel ? `<div class="f" style="margin-top:16px"><label for="rqNote">Comment${canDecide ? ' (required to reject or return)' : ''}</label><textarea id="rqNote" rows="2"></textarea></div><div id="rqErr" class="msg bad" hidden style="margin-top:10px"></div>` : ''}
    <div class="row" style="margin-top:10px">
      ${canDecide ? `<button class="btn primary" data-a="decide" data-act="approve" data-id="${r.id}">${r.status === 'pending_manager' && r.employees?.manager_id === S.emp?.id ? 'Approve and send to HR' : 'Approve'}</button>
        <button class="btn" data-a="decide" data-act="return" data-id="${r.id}">Return for changes</button><button class="btn danger" data-a="decide" data-act="reject" data-id="${r.id}">Reject</button>` : ''}
      ${canCancel ? `<button class="btn danger" data-a="cancelReq" data-id="${r.id}">Cancel request</button>` : ''}</div>`);
}
async function decide(id, act){
  try {
    const st = await q(sb.rpc('decide_leave', {p_request: Number(id), p_action: act, p_comment: $('rqNote').value}));
    toast(st === 'pending_hr' ? 'Approved and sent to HR' : st === 'approved' ? 'Leave approved' : st === 'rejected' ? 'Request rejected' : 'Returned to the employee');
    closeDrawer(); await render();
  } catch (e){ const el = $('rqErr'); el.textContent = errText(e); el.hidden = false; }
}
async function cancelReq(id){
  try { await q(sb.rpc('cancel_leave', {p_request: Number(id), p_comment: $('rqNote').value})); toast('Request cancelled'); closeDrawer(); await render(); }
  catch (e){ const el = $('rqErr'); el.textContent = errText(e); el.hidden = false; }
}

// ---- Approvals
V.approvals = async () => {
  const rows = await q(sb.from('leave_requests').select('*, employees!inner(full_name, manager_id)').in('status', ['pending_manager', 'pending_hr']).order('created_at'));
  const mine = rows.filter(mineToDecide);
  const others = isHR() ? rows.filter(r => r.status === 'pending_manager' && !mineToDecide(r) && r.employee_id !== S.emp?.id) : [];
  const waited = r => Math.max(0, -daysUntil(r.updated_at.slice(0, 10)));
  const tbl = list => table(['Ref', 'Employee', 'Leave', 'Dates', 'Days', 'Waiting', 'Status'], list.map(r => `<tr class="click" data-a="req" data-id="${r.id}">
    <td class="mono">LR-${r.id}</td><td>${esc(r.employees.full_name)}</td><td>${esc(typeName(r.leave_type))}</td><td class="mono">${fmt(r.start_date)} to ${fmt(r.end_date)}</td>
    <td class="mono">${r.days}</td><td>${waited(r) >= 3 ? pill(waited(r) + ' days', 'p-bad') : `<span class="mono">${waited(r)}d</span>`}</td><td>${statusPill(r.status)}</td></tr>`), 'Nothing is waiting on you.');
  const recent = await q(sb.from('leave_actions').select('request_id, action, at, actor').eq('actor', S.user.id).neq('action', 'submitted').order('at', {ascending: false}).limit(15));
  return header('Approvals', isHR() ? 'HR gives the final approval after the line manager. HR can also act on requests a manager has not handled.' : 'You approve your direct reports first, then HR gives the final approval.') + `
    <div class="panel" style="margin-bottom:16px"><h2>Waiting on you</h2>${tbl(mine)}</div>
    ${isHR() ? `<div class="panel" style="margin-bottom:16px"><h2>Waiting on line managers</h2>${tbl(others)}<p class="muted small" style="margin:10px 0 0">Requests waiting 3 days or more are marked red. HR can approve them directly.</p></div>` : ''}
    <div class="panel"><h2>Your recent decisions</h2>${table(['Ref', 'Decision', 'When'], recent.map(a => `<tr class="click" data-a="req" data-id="${a.request_id}"><td class="mono">LR-${a.request_id}</td><td>${esc(a.action.replace(/_/g, ' '))}</td><td class="mono">${fmtTime(a.at)}</td></tr>`), 'No decisions yet.')}</div>`;
};

// ---- Employees
let empFilter = {q: '', show: 'current'};
V.employees = async () => {
  let rows = await q(sb.from('employees').select('*').order('full_name'));
  if (!isHR() && role() !== 'admin') rows = rows.filter(e => e.manager_id === S.emp?.id);
  const names = Object.fromEntries(rows.map(e => [e.id, e.full_name]));
  const ql = empFilter.q.toLowerCase();
  const shown = rows.filter(e => (empFilter.show === 'all' || (empFilter.show === 'current') === !['resigned', 'terminated'].includes(e.status))
    && (!ql || [e.full_name, e.employee_no, e.job_title, deptName(e.department_id), e.nationality].join(' ').toLowerCase().includes(ql)));
  const actions = isHR() ? `<button class="btn" data-a="importEmp">Import from Excel (CSV)</button><button class="btn primary" data-a="newEmp">Add employee</button>` : '';
  return header(isHR() || role() === 'admin' ? 'Employees' : 'My team', `${shown.length} shown`, actions) + `<div class="panel">
    <div class="row" style="margin-bottom:12px"><input id="empQ" placeholder="Search name, number, title, department" value="${esc(empFilter.q)}" style="max-width:340px">
    <select id="empShow" style="width:auto"><option value="current" ${empFilter.show === 'current' ? 'selected' : ''}>Current staff</option><option value="left" ${empFilter.show === 'left' ? 'selected' : ''}>Left the company</option><option value="all" ${empFilter.show === 'all' ? 'selected' : ''}>Everyone</option></select></div>
    ${table(['No.', 'Name', 'Department', 'Job title', 'Line manager', 'Nationality', 'Joined', 'Status'], shown.map(e => `<tr class="click" data-a="emp" data-id="${e.id}">
      <td class="mono">${esc(e.employee_no)}</td><td>${esc(e.full_name)}</td><td>${esc(deptName(e.department_id))}</td><td>${esc(e.job_title)}</td><td>${esc(names[e.manager_id] || '')}</td>
      <td>${pill(e.nat_type === 'omani' ? 'Omani' : 'Expat' + (e.nationality ? ' · ' + e.nationality : ''), e.nat_type === 'omani' ? 'p-info' : 'p-mute')}</td><td class="mono">${fmt(e.join_date)}</td><td>${EMP_STATUS[e.status]}</td></tr>`), 'No employees match.')}</div>`;
};
async function openEmployee(id){
  const e = await q(sb.from('employees').select('*').eq('id', id).single());
  const [docs, mgr, pay, prof, bal] = await Promise.all([
    isHR() || id === S.emp?.id ? q(sb.from('documents').select('*').eq('employee_id', id).order('expiry_date')) : Promise.resolve([]),
    e.manager_id ? q(sb.from('employees').select('full_name').eq('id', e.manager_id).maybeSingle()) : Promise.resolve(null),
    isHRM() ? q(sb.from('employee_pay').select('*').eq('employee_id', id).maybeSingle()) : Promise.resolve(null),
    isHR() || canUsers() ? q(sb.from('profiles').select('username, role, status').eq('employee_id', id).maybeSingle()) : Promise.resolve(null),
    q(sb.rpc('leave_balance', {p_employee: id, p_type: 'annual', p_year: year()})).catch(() => [])
  ]);
  const months = (() => { const a = dt(e.join_date), b = dt(e.end_date || today()); return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth() - (b.getUTCDate() < a.getUTCDate() ? 1 : 0); })();
  const b = bal[0];
  let eos = '';
  if (e.nat_type === 'expat'){
    eos = pay ? `About OMR ${omr(pay.basic_salary * months / 12)} (1 month basic per year, ${Math.floor(months / 12)}y ${months % 12}m, before unpaid leave)` : '1 month of basic wage per year of service';
  } else eos = 'Covered by the Social Protection Fund';
  drawer(drawerHead(esc(e.full_name)) + `<p class="muted">${esc(e.job_title)}${e.department_id ? ' · ' + esc(deptName(e.department_id)) : ''}</p>
    <dl class="dl"><dt>Employee no.</dt><dd class="mono">${esc(e.employee_no)}</dd><dt>Status</dt><dd>${EMP_STATUS[e.status]}${e.end_date ? ' on ' + fmt(e.end_date) : ''}</dd>
    <dt>Nationality</dt><dd>${e.nat_type === 'omani' ? 'Omani' : 'Expat'}${e.nationality ? ' · ' + esc(e.nationality) : ''}</dd>
    <dt>Line manager</dt><dd>${mgr ? esc(mgr.full_name) : '<span class="muted">None</span>'}</dd>
    <dt>Joined</dt><dd class="mono">${fmt(e.join_date)} (${Math.floor(months / 12)}y ${months % 12}m)</dd>
    ${e.probation_end ? `<dt>Probation ends</dt><dd class="mono">${fmt(e.probation_end)}</dd>` : ''}
    <dt>Contract</dt><dd>${e.contract_type === 'fixed' ? 'Fixed term' + (e.contract_end ? ' to ' + fmt(e.contract_end) : '') : 'Unlimited'}</dd>
    ${e.email ? `<dt>Email</dt><dd>${esc(e.email)}</dd>` : ''}${e.phone ? `<dt>Phone</dt><dd>${esc(e.phone)}</dd>` : ''}
    ${e.emergency_contact ? `<dt>Emergency</dt><dd>${esc(e.emergency_contact)}</dd>` : ''}
    ${b && b.remaining != null ? `<dt>Annual leave</dt><dd class="mono">${b.remaining} of ${b.entitled} days left</dd>` : ''}
    ${pay ? `<dt>Basic salary</dt><dd class="mono">OMR ${omr(pay.basic_salary)}</dd><dt>Allowances</dt><dd class="mono">OMR ${omr(pay.allowances)}</dd>${pay.bank_iban ? `<dt>IBAN</dt><dd class="mono">${esc(pay.bank_iban)}</dd>` : ''}` : ''}
    ${isHR() || isHRM() ? `<dt>End of service</dt><dd class="small">${eos}</dd>` : ''}
    ${isHR() || canUsers() ? `<dt>Login</dt><dd>${prof ? `${esc(prof.username)} · ${ROLE_NAMES[prof.role]}${prof.status === 'disabled' ? ' · disabled' : ''}` : '<span class="muted">No login yet</span>'}</dd>` : ''}</dl>
    ${isHR() ? `<div class="row" style="margin-bottom:18px"><button class="btn primary" data-a="editEmp" data-id="${e.id}">Edit details</button><button class="btn" data-a="newDoc" data-id="${e.id}">Upload document</button></div>` : ''}
    ${isHR() || id === S.emp?.id ? `<h2>Documents</h2>${docsTable(docs, false)}` : ''}`);
}
function docsTable(docs, withEmp){
  return table([...(withEmp ? ['Employee'] : []), 'Document', 'Number', 'Expiry', 'Status', ''], docs.map(d => { const s = docState(d.expiry_date); return `<tr>
    ${withEmp ? `<td><a href="#" data-a="emp" data-id="${d.employee_id}">${esc(d.employees?.full_name)}</a></td>` : ''}<td>${DOC_TYPES[d.doc_type]}${d.notes ? `<div class="muted small">${esc(d.notes)}</div>` : ''}</td>
    <td class="mono">${esc(d.doc_number)}</td><td class="mono">${fmt(d.expiry_date)}</td><td>${pill(s.label, s.cls)}</td>
    <td style="white-space:nowrap">${d.file_path ? `<button class="btn sm" data-a="file" data-path="${esc(d.file_path)}">Open</button>` : ''}${isHR() ? ` <button class="btn sm danger" data-a="delDoc" data-id="${d.id}">Remove</button>` : ''}</td></tr>`; }), 'No documents uploaded.');
}
async function employeeForm(id){
  const e = id ? await q(sb.from('employees').select('*').eq('id', id).single()) : {nat_type: 'omani', gender: 'male', religion: 'muslim', status: 'active', contract_type: 'unlimited', join_date: today()};
  const pay = id && isHRM() ? await q(sb.from('employee_pay').select('*').eq('employee_id', id).maybeSingle()) : null;
  const all = await q(sb.from('employees').select('id, full_name').not('status', 'in', '(resigned,terminated)').order('full_name'));
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${String(v) === String(cur ?? '') ? 'selected' : ''}>${esc(label)}</option>`;
  const inp = (k, label, type = 'text', extra = '') => `<div class="f"><label for="ef_${k}">${label}</label><input id="ef_${k}" type="${type}" value="${esc(e[k] ?? '')}" ${extra}></div>`;
  drawer(drawerHead(id ? 'Edit employee' : 'New employee') + `<form id="empForm" data-id="${id || ''}">
    <div class="fgrid">
      <div class="f full"><label for="ef_full_name">Full name</label><input id="ef_full_name" value="${esc(e.full_name || '')}" required></div>
      ${id ? inp('employee_no', 'Employee no.') : ''}
      <div class="f"><label for="ef_nat_type">Nationality type</label><select id="ef_nat_type">${opt('omani', e.nat_type, 'Omani')}${opt('expat', e.nat_type, 'Expat')}</select></div>
      ${inp('nationality', 'Nationality (country)')}
      <div class="f"><label for="ef_gender">Gender</label><select id="ef_gender">${opt('male', e.gender, 'Male')}${opt('female', e.gender, 'Female')}</select></div>
      <div class="f"><label for="ef_religion">Religion (for leave rules)</label><select id="ef_religion">${opt('muslim', e.religion, 'Muslim')}${opt('non_muslim', e.religion, 'Non-Muslim')}</select></div>
      ${inp('date_of_birth', 'Date of birth', 'date')}
      <div class="f"><label for="ef_marital_status">Marital status</label><select id="ef_marital_status">${['', 'single', 'married', 'divorced', 'widowed'].map(v => opt(v, e.marital_status, v ? v[0].toUpperCase() + v.slice(1) : 'Not set')).join('')}</select></div>
      <div class="f"><label for="ef_department_id">Department</label><select id="ef_department_id">${opt('', e.department_id, 'None')}${S.depts.map(d => opt(d.id, e.department_id, d.name)).join('')}${opt('__new', '', '+ Add a department…')}</select></div>
      ${inp('job_title', 'Job title')}
      <div class="f"><label for="ef_manager_id">Line manager</label><select id="ef_manager_id">${opt('', e.manager_id, 'None')}${all.filter(x => x.id !== id).map(x => opt(x.id, e.manager_id, x.full_name)).join('')}</select></div>
      ${inp('join_date', 'Join date', 'date', 'required')}${inp('probation_end', 'Probation ends', 'date')}
      <div class="f"><label for="ef_contract_type">Contract</label><select id="ef_contract_type">${opt('unlimited', e.contract_type, 'Unlimited')}${opt('fixed', e.contract_type, 'Fixed term')}</select></div>
      ${inp('contract_end', 'Contract ends', 'date')}${inp('work_location', 'Work location')}
      ${inp('email', 'Email', 'email')}${inp('phone', 'Phone', 'tel')}
      <div class="f full"><label for="ef_emergency_contact">Emergency contact</label><input id="ef_emergency_contact" value="${esc(e.emergency_contact || '')}"></div>
      <div class="f"><label for="ef_status">Status</label><select id="ef_status">${Object.entries(EMP_STATUS).map(([k, v]) => opt(k, e.status, v)).join('')}</select></div>
      ${inp('end_date', 'Last working day', 'date')}
      ${isHRM() ? `<div class="f"><label for="pf_basic">Basic salary (OMR)</label><input id="pf_basic" type="number" step="0.001" min="0" value="${pay?.basic_salary ?? ''}"></div>
        <div class="f"><label for="pf_allow">Allowances (OMR)</label><input id="pf_allow" type="number" step="0.001" min="0" value="${pay?.allowances ?? ''}"></div>
        <div class="f full"><label for="pf_iban">Bank IBAN</label><input id="pf_iban" value="${esc(pay?.bank_iban || '')}"></div>` : ''}
    </div>
    <p class="muted small">Setting the status to Resigned or Terminated disables the employee's login at once. The record is kept.</p>
    <div id="efErr" class="msg bad" hidden></div>
    <button class="btn primary" id="efBtn">${id ? 'Save changes' : 'Add employee'}</button></form>`);
}
async function saveEmployee(form){
  const id = form.dataset.id || null;
  const g = k => $('ef_' + k)?.value ?? '';
  const nul = v => v === '' ? null : v;
  try {
    $('efBtn').disabled = true;
    let dept = g('department_id');
    if (dept === '__new'){
      const name = (window.prompt ? window.prompt('Department name') : '') || '';
      if (!name.trim()) throw new Error('Type a department name.');
      const d = await q(sb.from('departments').insert({name: name.trim()}).select().single());
      S.depts.push(d); dept = d.id;
    }
    const row = {full_name: g('full_name').trim(), nat_type: g('nat_type'), nationality: g('nationality').trim(), gender: g('gender'), religion: g('religion'),
      date_of_birth: nul(g('date_of_birth')), marital_status: g('marital_status'), department_id: nul(dept), job_title: g('job_title').trim(), manager_id: nul(g('manager_id')),
      join_date: g('join_date'), probation_end: nul(g('probation_end')), contract_type: g('contract_type'), contract_end: nul(g('contract_end')),
      work_location: g('work_location').trim(), email: g('email').trim(), phone: g('phone').trim(), emergency_contact: g('emergency_contact').trim(),
      status: g('status'), end_date: nul(g('end_date'))};
    if (id && g('employee_no').trim()) row.employee_no = g('employee_no').trim();
    if (['resigned', 'terminated'].includes(row.status) && !row.end_date) row.end_date = today();
    const saved = id ? await q(sb.from('employees').update(row).eq('id', id).select().single()) : await q(sb.from('employees').insert(row).select().single());
    if (isHRM() && ($('pf_basic').value !== '' || $('pf_allow').value !== '' || $('pf_iban').value !== '')){
      await q(sb.from('employee_pay').upsert({employee_id: saved.id, basic_salary: Number($('pf_basic').value || 0), allowances: Number($('pf_allow').value || 0), bank_iban: $('pf_iban').value.trim(), updated_at: new Date().toISOString()}));
    }
    toast(id ? 'Employee saved' : 'Employee added');
    await render(); openEmployee(saved.id);
  } catch (e){ const el = $('efErr'); el.textContent = errText(e); el.hidden = false; $('efBtn').disabled = false; }
}

const IMPORT_COLS = ['employee_no', 'full_name', 'nat_type', 'nationality', 'gender', 'religion', 'date_of_birth', 'department', 'job_title', 'manager_employee_no', 'join_date', 'probation_end', 'contract_type', 'contract_end', 'email', 'phone'];
function importForm(){
  drawer(drawerHead('Import employees') + `<p>Save your Excel sheet as <b>CSV</b> with these column headings in the first row, then choose the file. Leave <span class="mono">employee_no</span> empty to number employees automatically.</p>
    <p class="mono small" style="background:var(--sunk);padding:8px;border-radius:6px;overflow-wrap:anywhere">${IMPORT_COLS.join(', ')}</p>
    <p class="small muted">nat_type: omani or expat · gender: male or female · religion: muslim or non_muslim · contract_type: unlimited or fixed · dates as YYYY-MM-DD. New departments are created automatically.</p>
    <div class="row" style="margin:12px 0"><button class="btn" data-a="importTemplate">Download template</button></div>
    <div class="f" style="margin-bottom:12px"><label for="impFile">CSV file</label><input id="impFile" type="file" accept=".csv,text/csv"></div>
    <div id="impOut"></div><button class="btn primary" data-a="runImport">Import</button>`);
}
async function runImport(){
  const out = $('impOut');
  const file = $('impFile').files[0];
  if (!file){ out.innerHTML = '<div class="msg bad">Choose a CSV file first.</div>'; return; }
  const rows = parseCsv(await file.text());
  const head = rows.shift().map(h => h.trim().toLowerCase());
  const miss = ['full_name', 'nat_type', 'gender', 'join_date'].filter(c => !head.includes(c));
  if (miss.length){ out.innerHTML = `<div class="msg bad">Missing columns: ${miss.join(', ')}</div>`; return; }
  const recs = rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  const errors = [];
  for (const d of new Set(recs.map(r => r.department).filter(Boolean))){
    if (!S.depts.some(x => x.name.toLowerCase() === d.toLowerCase())) S.depts.push(await q(sb.from('departments').insert({name: d}).select().single()));
  }
  const byNo = {}, done = [];
  for (const [i, r] of recs.entries()){
    try {
      const row = {full_name: r.full_name, nat_type: r.nat_type.toLowerCase(), nationality: r.nationality || '', gender: r.gender.toLowerCase(), religion: (r.religion || 'muslim').toLowerCase().replace('-', '_'),
        date_of_birth: r.date_of_birth || null, department_id: r.department ? S.depts.find(x => x.name.toLowerCase() === r.department.toLowerCase()).id : null,
        job_title: r.job_title || '', join_date: r.join_date, probation_end: r.probation_end || null, contract_type: (r.contract_type || 'unlimited').toLowerCase(),
        contract_end: r.contract_end || null, email: r.email || '', phone: r.phone || ''};
      if (r.employee_no) row.employee_no = r.employee_no;
      const saved = await q(sb.from('employees').insert(row).select('id, employee_no').single());
      byNo[saved.employee_no] = saved.id; done.push({r, id: saved.id});
    } catch (e){ errors.push(`Row ${i + 2} (${r.full_name || 'no name'}): ${errText(e)}`); }
  }
  for (const {r, id} of done){
    if (!r.manager_employee_no) continue;
    let mid = byNo[r.manager_employee_no];
    if (!mid){ const m = await q(sb.from('employees').select('id').eq('employee_no', r.manager_employee_no).maybeSingle()); mid = m?.id; }
    if (mid) await sb.from('employees').update({manager_id: mid}).eq('id', id); else errors.push(`${r.full_name}: manager ${r.manager_employee_no} not found`);
  }
  out.innerHTML = `<div class="msg ${errors.length ? 'bad' : 'good'}">Imported ${done.length} of ${recs.length} employees.${errors.length ? '<br>' + errors.map(esc).join('<br>') : ''}</div>`;
  S.view === 'employees' && render();
}

// ---- Documents
let docFilter = 'all';
async function docsView(own){
  let query = sb.from('documents').select('*, employees(full_name)').order('expiry_date', {nullsFirst: false});
  if (own) query = query.eq('employee_id', S.emp.id);
  let docs = await q(query);
  const t = today();
  const counts = {expired: docs.filter(d => d.expiry_date && d.expiry_date < t).length, d30: docs.filter(d => d.expiry_date >= t && daysUntil(d.expiry_date) <= 30).length, d90: docs.filter(d => d.expiry_date && daysUntil(d.expiry_date) > 30 && daysUntil(d.expiry_date) <= 90).length};
  if (docFilter === 'expired') docs = docs.filter(d => d.expiry_date && d.expiry_date < t);
  if (docFilter === 'd30') docs = docs.filter(d => d.expiry_date >= t && daysUntil(d.expiry_date) <= 30);
  if (docFilter === 'd90') docs = docs.filter(d => d.expiry_date && daysUntil(d.expiry_date) > 30 && daysUntil(d.expiry_date) <= 90);
  const chip = (k, label) => `<button class="btn sm ${docFilter === k ? 'primary' : ''}" data-a="docFilter" data-v="${k}">${label}</button>`;
  return header(own ? 'My documents' : 'Documents', 'Passports, resident cards, work permits, civil IDs and contracts, soonest expiry first', `<button class="btn primary" data-a="newDoc" data-id="${own ? S.emp.id : ''}">Upload document</button>`) + `<div class="panel">
    <div class="row" style="margin-bottom:12px">${chip('all', 'All')}${chip('expired', `Expired (${counts.expired})`)}${chip('d30', `Within 30 days (${counts.d30})`)}${chip('d90', `31 to 90 days (${counts.d90})`)}</div>
    ${docsTable(docs, !own)}</div>`;
}
V.documents = () => docsView(false);
V.mydocs = () => docsView(true);
async function docForm(empId){
  const emps = !empId ? await q(sb.from('employees').select('id, full_name').not('status', 'in', '(resigned,terminated)').order('full_name')) : [];
  drawer(drawerHead('Upload document') + `<form id="docForm" data-emp="${empId || ''}"><div class="fgrid">
    ${!empId ? `<div class="f full"><label for="dfEmp">Employee</label><select id="dfEmp" required>${emps.map(e => `<option value="${e.id}">${esc(e.full_name)}</option>`).join('')}</select></div>` : ''}
    <div class="f"><label for="dfType">Document</label><select id="dfType">${Object.entries(DOC_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="f"><label for="dfNo">Number</label><input id="dfNo"></div>
    <div class="f"><label for="dfIssue">Issue date</label><input id="dfIssue" type="date"></div>
    <div class="f"><label for="dfExp">Expiry date</label><input id="dfExp" type="date"></div>
    <div class="f full"><label for="dfNotes">Notes</label><input id="dfNotes"></div>
    <div class="f full"><label for="dfFile">File (PDF, JPG or PNG, up to 10 MB)</label><input id="dfFile" type="file" accept=".pdf,.jpg,.jpeg,.png"></div></div>
    <div id="dfErr" class="msg bad" hidden></div><button class="btn primary" id="dfBtn">Save document</button></form>`);
}
async function saveDoc(form){
  const emp = form.dataset.emp || $('dfEmp').value;
  try {
    $('dfBtn').disabled = true;
    const file = $('dfFile').files[0];
    const path = file ? await upload(file, `${emp}/docs`) : null;
    await q(sb.from('documents').insert({employee_id: emp, doc_type: $('dfType').value, doc_number: $('dfNo').value.trim(), issue_date: $('dfIssue').value || null,
      expiry_date: $('dfExp').value || null, notes: $('dfNotes').value.trim(), file_path: path, uploaded_by: S.user.id}));
    toast('Document saved'); closeDrawer(); await render();
  } catch (e){ const el = $('dfErr'); el.textContent = errText(e); el.hidden = false; $('dfBtn').disabled = false; }
}

// ---- Letters
V.letters = async () => {
  const rows = await q(sb.from('letter_requests').select('*').eq('employee_id', S.emp.id).order('created_at', {ascending: false}));
  return header('My letters', 'Ask HR for a salary certificate, NOC or experience letter') + `<div class="grid two">
    <div class="panel"><h2>Request a letter</h2><form id="letterForm"><div class="fgrid">
      <div class="f full"><label for="ltType">Letter</label><select id="ltType">${Object.entries(LETTERS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      <div class="f full"><label for="ltTo">Addressed to</label><input id="ltTo" placeholder="For example: Bank Muscat, or To whom it may concern"></div>
      <div class="f full"><label for="ltPurpose">Purpose</label><input id="ltPurpose" placeholder="For example: opening a bank account"></div></div>
      <button class="btn primary">Send request</button></form></div>
    <div class="panel"><h2>My requests</h2>${lettersTable(rows, false)}</div></div>`;
};
function lettersTable(rows, withEmp){
  return table([...(withEmp ? ['Employee'] : []), 'Letter', 'Addressed to', 'Requested', 'Status', ''], rows.map(r => `<tr>${withEmp ? `<td>${esc(r.employees?.full_name)}</td>` : ''}
    <td>${LETTERS[r.letter_type]}${r.purpose ? `<div class="muted small">${esc(r.purpose)}</div>` : ''}</td><td>${esc(r.addressed_to)}</td><td class="mono">${fmt(r.created_at)}</td>
    <td>${pill(r.status[0].toUpperCase() + r.status.slice(1), r.status === 'issued' ? 'p-good' : r.status === 'rejected' ? 'p-bad' : 'p-warn')}${r.hr_note ? `<div class="muted small">${esc(r.hr_note)}</div>` : ''}</td>
    <td style="white-space:nowrap">${r.status === 'issued' ? `<button class="btn sm" data-a="printLetter" data-id="${r.id}">Print</button>` : ''}
      ${withEmp && r.status === 'pending' ? `<button class="btn sm primary" data-a="issueLetter" data-id="${r.id}">Issue</button> <button class="btn sm danger" data-a="rejectLetter" data-id="${r.id}">Reject</button>` : ''}</td></tr>`), 'No letter requests.');
}
V.letterq = async () => {
  const rows = await q(sb.from('letter_requests').select('*, employees(full_name)').order('created_at', {ascending: false}).limit(100));
  return header('Letter requests', 'Issue a letter to let the employee print it, or print it here') + `<div class="panel">${lettersTable(rows, true)}</div>`;
};
async function printLetter(id){
  const r = await q(sb.from('letter_requests').select('*').eq('id', id).single());
  const e = await q(sb.from('employees').select('*').eq('id', r.employee_id).single());
  const pay = r.letter_type === 'salary_certificate' ? await q(sb.from('employee_pay').select('*').eq('employee_id', e.id).maybeSingle()) : null;
  const docs = await q(sb.from('documents').select('doc_type, doc_number').eq('employee_id', e.id).in('doc_type', ['passport', 'civil_id']));
  const idDoc = docs.find(d => d.doc_type === (e.nat_type === 'omani' ? 'civil_id' : 'passport'));
  const he = e.gender === 'female' ? 'she' : 'he', his = e.gender === 'female' ? 'her' : 'his', title = e.gender === 'female' ? 'Ms.' : 'Mr.';
  const nat = e.nat_type === 'omani' ? 'Omani' : (e.nationality || 'expatriate');
  const idTxt = idDoc ? `, holding ${DOC_TYPES[idDoc.doc_type].toLowerCase()} number ${idDoc.doc_number}` : '';
  const company = S.settings.company || 'Carbon Engineering Design';
  const body = {
    salary_certificate: `This is to certify that ${title} ${e.full_name}, ${nat} national${idTxt}, is employed with ${company} as ${e.job_title || 'a member of staff'} since ${fmt(e.join_date)}.</p><p>${his[0].toUpperCase() + his.slice(1)} monthly basic salary is OMR ${pay ? omr(pay.basic_salary) : '________'} and ${his} monthly allowances are OMR ${pay ? omr(pay.allowances) : '________'}, a total of OMR ${pay ? omr(Number(pay.basic_salary) + Number(pay.allowances)) : '________'}.`,
    noc: `This is to certify that ${title} ${e.full_name}, ${nat} national${idTxt}, is employed with ${company} as ${e.job_title || 'a member of staff'} since ${fmt(e.join_date)}.</p><p>The company has no objection to ${his} request${r.purpose ? ' for ' + r.purpose : ''}.`,
    experience: `This is to certify that ${title} ${e.full_name}, ${nat} national${idTxt}, ${e.end_date ? 'worked' : 'has been working'} with ${company} as ${e.job_title || 'a member of staff'} from ${fmt(e.join_date)}${e.end_date ? ' to ' + fmt(e.end_date) : ' to date'}.</p><p>During this period ${he} carried out ${his} duties to our satisfaction. We wish ${his === 'her' ? 'her' : 'him'} every success.`
  }[r.letter_type];
  const w = window.open('', '_blank');
  if (!w){ toast('Allow pop-ups for this site to print letters.'); return; }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${LETTERS[r.letter_type]} - ${esc(e.full_name)}</title>
    <style>body{font-family:Georgia,serif;font-size:15px;line-height:1.7;color:#111;max-width:680px;margin:48px auto;padding:0 24px}h1{font-size:20px;letter-spacing:.04em;text-transform:uppercase;text-align:center;margin:40px 0 28px}.co{font-family:Arial,sans-serif;font-weight:700;font-size:18px;border-bottom:2px solid #1d6a83;padding-bottom:8px}.meta{display:flex;justify-content:space-between;margin-top:24px;font-size:14px}.sig{margin-top:64px}</style></head><body>
    <div class="co">${esc(company)}</div><div class="meta"><span>Ref: CP-LTR-${r.id}</span><span>Date: ${fmt(today())}</span></div>
    <p style="margin-top:24px">To: ${esc(r.addressed_to || 'To whom it may concern')}</p><h1>${LETTERS[r.letter_type].replace(' (NOC)', '')}</h1>
    <p>${esc(body).replace(/&lt;\/p&gt;&lt;p&gt;/g, '</p><p>')}</p>
    <p>This letter is issued at the employee's request without any liability on the part of the company.</p>
    <div class="sig">______________________<br>Human Resources Department<br>${esc(company)}</div>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
  sb.rpc('log_event', {p_action: 'letter_printed', p_detail: `CP-LTR-${r.id}`});
}

// ---- Reports
V.reports = async () => {
  const [emps, leaves, docs] = await Promise.all([
    q(sb.from('employees').select('*').order('full_name')),
    q(sb.from('leave_requests').select('leave_type, days, start_date, employee_id').eq('status', 'approved').gte('start_date', `${year()}-01-01`).lte('start_date', `${year()}-12-31`)),
    q(sb.from('documents').select('expiry_date'))
  ]);
  const cur = emps.filter(e => !['resigned', 'terminated'].includes(e.status));
  const groups = {};
  for (const e of cur){ const k = deptName(e.department_id) || 'No department'; (groups[k] ||= {n: 0, om: 0}).n++; if (e.nat_type === 'omani') groups[k].om++; }
  const byType = {};
  for (const l of leaves) byType[l.leave_type] = (byType[l.leave_type] || 0) + l.days;
  const om = cur.filter(e => e.nat_type === 'omani').length;
  const t = today();
  return header('Reports', `${cur.length} current employees · ${year()}`, `<button class="btn" data-a="exportEmp">Export employees (CSV)</button><button class="btn" data-a="print">Print</button>`) + `
    <div class="grid two"><div class="panel"><h2>Headcount and Omanisation by department</h2>${table(['Department', 'Headcount', 'Omani', 'Expat', 'Omanisation'],
      [...Object.entries(groups).sort().map(([k, g]) => `<tr><td>${esc(k)}</td><td class="mono">${g.n}</td><td class="mono">${g.om}</td><td class="mono">${g.n - g.om}</td><td class="mono">${(g.om / g.n * 100).toFixed(1)}%</td></tr>`),
       `<tr><td><b>Total</b></td><td class="mono"><b>${cur.length}</b></td><td class="mono"><b>${om}</b></td><td class="mono"><b>${cur.length - om}</b></td><td class="mono"><b>${cur.length ? (om / cur.length * 100).toFixed(1) : '0.0'}%</b></td></tr>`])}</div>
    <div class="panel"><h2>Approved leave in ${year()}</h2>${table(['Leave type', 'Days taken', 'Requests'], Object.entries(byType).map(([k, d]) => `<tr><td>${esc(typeName(k))}</td><td class="mono">${d}</td><td class="mono">${leaves.filter(l => l.leave_type === k).length}</td></tr>`), 'No approved leave this year.')}
      <h2 style="margin-top:20px">Documents</h2>${table(['Expired', 'Within 30 days', '31 to 90 days'], [`<tr><td class="mono">${docs.filter(d => d.expiry_date && d.expiry_date < t).length}</td><td class="mono">${docs.filter(d => d.expiry_date >= t && daysUntil(d.expiry_date) <= 30).length}</td><td class="mono">${docs.filter(d => d.expiry_date && daysUntil(d.expiry_date) > 30 && daysUntil(d.expiry_date) <= 90).length}</td></tr>`])}</div></div>`;
};
async function exportEmployees(){
  const emps = await q(sb.from('employees').select('*').order('employee_no'));
  const names = Object.fromEntries(emps.map(e => [e.id, e.employee_no]));
  const cols = ['employee_no', 'full_name', 'nat_type', 'nationality', 'gender', 'religion', 'date_of_birth', 'department', 'job_title', 'manager_employee_no', 'join_date', 'probation_end', 'contract_type', 'contract_end', 'email', 'phone', 'status', 'end_date'];
  const lines = [cols.join(','), ...emps.map(e => cols.map(c => csvCell(c === 'department' ? deptName(e.department_id) : c === 'manager_employee_no' ? names[e.manager_id] : e[c])).join(','))];
  downloadText(`carbon-people-employees-${today()}.csv`, lines.join('\n'));
  sb.rpc('log_event', {p_action: 'export', p_detail: 'employees csv'});
}

// ---- Leave rules
V.rules = async () => {
  const hol = await q(sb.from('holidays').select('*').order('day'));
  const rest = S.settings.rest_days || [5, 6];
  const types = await q(sb.from('leave_types').select('*').order('sort'));
  return header('Leave rules', 'Defaults from the Oman Labour Law (Royal Decree 53/2023). Change a number here when the regulations change; new requests use it at once.') + `
    <div class="panel" style="margin-bottom:16px"><h2>Leave types</h2>${table(['Leave type', 'Days', 'Per', 'Counts', 'Min. service (months)', 'Attachment', 'Approval', 'Active', ''], types.map(t => `<tr data-code="${t.code}">
      <td>${esc(t.name)}<div class="muted small">${esc(t.pay_note)}</div></td>
      <td><input class="mono" style="width:76px" data-k="days" type="number" min="0" value="${t.days ?? ''}" placeholder="Any" aria-label="Days"></td>
      <td><select data-k="per" style="width:auto" aria-label="Per">${['year', 'event', 'employment'].map(o => `<option value="${o}" ${o === t.per ? 'selected' : ''}>${o === 'event' ? 'each time' : o === 'employment' ? 'once' : 'year'}</option>`).join('')}</select></td>
      <td><select data-k="counts" style="width:auto" aria-label="Counts">${['calendar', 'working'].map(o => `<option ${o === t.counts ? 'selected' : ''}>${o}</option>`).join('')}</select></td>
      <td><input class="mono" style="width:70px" data-k="min_service_months" type="number" min="0" value="${t.min_service_months}" aria-label="Minimum service"></td>
      <td><input type="checkbox" data-k="needs_attachment" ${t.needs_attachment ? 'checked' : ''} aria-label="Attachment required"></td>
      <td><select data-k="route" style="width:auto" aria-label="Approval">${[['manager_hr', 'Manager, then HR'], ['hr', 'HR only']].map(([v, l]) => `<option value="${v}" ${v === t.route ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input type="checkbox" data-k="active" ${t.active ? 'checked' : ''} aria-label="Active"></td>
      <td><button class="btn sm" data-a="saveType" data-code="${t.code}">Save</button></td></tr>`))}</div>
    <div class="grid two"><div class="panel"><h2>Weekly rest days</h2><div class="row" style="margin-bottom:12px">${DAY_NAMES.map((d, i) => `<label class="row" style="gap:4px"><input type="checkbox" class="restDay" value="${i}" ${rest.includes(i) ? 'checked' : ''}>${d}</label>`).join('')}</div>
      <button class="btn" data-a="saveRest">Save rest days</button><p class="muted small">Working-day leave types skip these days and public holidays.</p>
      <p class="muted small">End of service for expats: 1 month of basic wage per year of service, pro-rated. The planned 9% Social Protection Fund savings scheme (around July 2027) will replace it.</p></div>
    <div class="panel"><h2>Public holidays</h2>${table(['Date', 'Holiday', ''], hol.map(h => `<tr><td class="mono">${fmt(h.day)}</td><td>${esc(h.name)}</td><td><button class="btn sm danger" data-a="delHoliday" data-day="${h.day}">Remove</button></td></tr>`), 'No holidays added yet.')}
      <div class="row" style="margin-top:12px"><input id="holDay" type="date" style="width:auto" aria-label="Holiday date"><input id="holName" placeholder="Holiday name" style="flex:1;min-width:140px"><button class="btn primary" data-a="addHoliday">Add</button></div></div></div>`;
};
async function saveType(code){
  const tr = document.querySelector(`tr[data-code="${code}"]`);
  const v = k => tr.querySelector(`[data-k="${k}"]`);
  try {
    await q(sb.from('leave_types').update({days: v('days').value === '' ? null : Number(v('days').value), per: v('per').value, counts: v('counts').value, min_service_months: Number(v('min_service_months').value || 0),
      needs_attachment: v('needs_attachment').checked, route: v('route').value, active: v('active').checked}).eq('code', code));
    await loadLookups(); toast(`${typeName(code)} saved`);
  } catch (e){ toast(errText(e)); }
}

// ---- Users
V.users = async () => {
  const [profs, emps] = await Promise.all([
    q(sb.from('profiles').select('*, employees(full_name, employee_no, status)').order('username')),
    q(sb.from('employees').select('id, full_name, employee_no').not('status', 'in', '(resigned,terminated)').order('full_name'))
  ]);
  const linked = new Set(profs.map(p => p.employee_id));
  const without = emps.filter(e => !linked.has(e.id));
  return header('User accounts', 'Only HR Managers and System Admins create logins. Each login belongs to one employee.', `<button class="btn primary" data-a="newUser">Create login</button>`) + `
    <div class="panel" style="margin-bottom:16px"><h2>Logins</h2>${table(['Employee', 'Username', 'Role', 'Status', ''], profs.map(p => `<tr>
      <td>${p.employees ? esc(p.employees.full_name) + ` <span class="muted mono">${esc(p.employees.employee_no)}</span>` : '<span class="muted">No employee (admin)</span>'}</td>
      <td class="mono">${esc(p.username)}</td>
      <td>${p.id === S.user.id ? ROLE_NAMES[p.role] : `<select data-a2="role" data-id="${p.id}" style="width:auto" aria-label="Role">${Object.entries(ROLE_NAMES).filter(([k]) => k !== 'admin' || role() === 'admin' || p.role === 'admin').map(([k, v]) => `<option value="${k}" ${k === p.role ? 'selected' : ''}>${v}</option>`).join('')}</select>`}</td>
      <td>${p.status === 'active' ? (p.must_change_password ? pill('New, password not set', 'p-warn') : pill('Active', 'p-good')) : pill('Disabled', 'p-bad')}</td>
      <td style="white-space:nowrap">${p.id === S.user.id ? '<span class="muted small">You</span>' : `<button class="btn sm" data-a="resetPw" data-id="${p.id}" data-u="${esc(p.username)}">Reset password</button>
        ${p.status === 'active' ? `<button class="btn sm danger" data-a="setStatus" data-id="${p.id}" data-role="${p.role}" data-s="disabled">Disable</button>` : `<button class="btn sm" data-a="setStatus" data-id="${p.id}" data-role="${p.role}" data-s="active">Enable</button>`}`}</td></tr>`))}</div>
    <div class="panel"><h2>Employees without a login (${without.length})</h2>${table(['No.', 'Employee', ''], without.map(e => `<tr><td class="mono">${esc(e.employee_no)}</td><td>${esc(e.full_name)}</td><td><button class="btn sm" data-a="newUser" data-id="${e.id}">Create login</button></td></tr>`), 'Every current employee has a login.')}</div>`;
};
async function userForm(empId){
  const [profs, emps] = await Promise.all([q(sb.from('profiles').select('employee_id')), q(sb.from('employees').select('id, full_name, employee_no').not('status', 'in', '(resigned,terminated)').order('full_name'))]);
  const linked = new Set(profs.map(p => p.employee_id));
  const free = emps.filter(e => !linked.has(e.id));
  const suggest = e => e ? e.full_name.toLowerCase().normalize('NFKD').replace(/[^a-z ]/g, '').trim().split(/\s+/).filter(w => !['al', 'bin', 'bint'].includes(w)).slice(0, 2).join('.') : '';
  const first = free.find(e => e.id === empId) || free[0];
  drawer(drawerHead('Create login') + `<form id="userForm"><div class="fgrid">
    <div class="f full"><label for="ufEmp">Employee</label><select id="ufEmp">${free.map(e => `<option value="${e.id}" data-s="${esc(suggest(e))}" ${e.id === first?.id ? 'selected' : ''}>${esc(e.full_name)} (${esc(e.employee_no)})</option>`).join('')}${role() === 'admin' ? '<option value="">No employee: system admin only</option>' : ''}</select></div>
    <div class="f"><label for="ufUser">Username</label><input id="ufUser" value="${esc(suggest(first))}" autocapitalize="none" required></div>
    <div class="f"><label for="ufRole">Role</label><select id="ufRole">${Object.entries(ROLE_NAMES).filter(([k]) => k !== 'admin' || role() === 'admin').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
    <div class="f full"><label for="ufPw">Temporary password</label><input id="ufPw" class="mono" value="${tempPassword()}" required minlength="10"></div></div>
    <p class="muted small">Give the employee the username and temporary password. They must set their own password the first time they sign in. Line managers need no special role: anyone with direct reports sees the Approvals screen.</p>
    <div id="ufErr" class="msg bad" hidden></div><button class="btn primary" id="ufBtn">Create login</button></form>`);
}
async function saveUser(){
  const u = $('ufUser').value.trim().toLowerCase(), pw = $('ufPw').value;
  try {
    $('ufBtn').disabled = true;
    await q(sb.rpc('admin_create_user', {p_username: u, p_password: pw, p_role: $('ufRole').value, p_employee: $('ufEmp').value || null}));
    drawer(drawerHead('Login created') + `<p>Give these details to the employee. The password is shown only now.</p>
      <dl class="dl"><dt>Website</dt><dd class="mono">${esc(location.origin + location.pathname)}</dd><dt>Username</dt><dd class="mono">${esc(u)}</dd><dt>Temporary password</dt><dd class="mono">${esc(pw)}</dd></dl>
      <button class="btn primary" data-a="copy" data-text="${esc(`Carbon People\n${location.origin + location.pathname}\nUsername: ${u}\nTemporary password: ${pw}`)}">Copy details</button>`);
    render();
  } catch (e){ const el = $('ufErr'); el.textContent = errText(e); el.hidden = false; $('ufBtn').disabled = false; }
}
async function resetPw(id, username){
  const pw = tempPassword();
  try {
    await q(sb.rpc('admin_set_password', {p_user: id, p_password: pw}));
    drawer(drawerHead('Password reset') + `<p>The employee must set a new password at the next sign-in.</p><dl class="dl"><dt>Username</dt><dd class="mono">${esc(username)}</dd><dt>Temporary password</dt><dd class="mono">${esc(pw)}</dd></dl>
      <button class="btn primary" data-a="copy" data-text="${esc(`Username: ${username}\nTemporary password: ${pw}`)}">Copy details</button>`);
    render();
  } catch (e){ toast(errText(e)); }
}

// ---- Audit
V.audit = async () => {
  const rows = await q(sb.from('audit_log').select('*').order('at', {ascending: false}).limit(300));
  const short = o => o ? esc(Object.entries(o).filter(([k]) => !['created_at', 'updated_at'].includes(k)).slice(0, 6).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ')).slice(0, 220) : '';
  return header('Audit log', 'The latest 300 changes. Entries cannot be edited or deleted.') + `<div class="panel">${table(['When', 'Who', 'Action', 'Record', 'Change'], rows.map(r => `<tr>
    <td class="mono" style="white-space:nowrap">${fmtTime(r.at)}</td><td>${esc(r.actor_name || 'System')}</td><td>${esc(r.action.replace(/_/g, ' '))}</td>
    <td>${esc(r.entity.replace(/_/g, ' '))}${r.summary ? `<div class="muted small">${esc(r.summary)}</div>` : ''}</td><td class="small">${short(r.new_data)}</td></tr>`))}</div>`;
};

// ---------------------------------------------------------------- events
const A = {
  nav: el => go(el.dataset.v),
  close: () => closeDrawer(),
  signout: async () => { try { await sb.rpc('log_event', {p_action: 'sign_out', p_detail: ''}); } catch {} await sb.auth.signOut(); S.view = 'dashboard'; renderLogin(); },
  mypw: () => renderChangePassword(),
  req: el => openRequest(el.dataset.id),
  emp: el => openEmployee(el.dataset.id),
  decide: el => decide(el.dataset.id, el.dataset.act),
  cancelReq: el => cancelReq(el.dataset.id),
  file: async el => { try { window.open(await signedUrl(el.dataset.path), '_blank'); } catch (e){ toast(errText(e)); } },
  newEmp: () => employeeForm(null),
  editEmp: el => employeeForm(el.dataset.id),
  importEmp: () => importForm(),
  importTemplate: () => downloadText('carbon-people-import-template.csv', IMPORT_COLS.join(',') + '\nCE-0001,Example Name,omani,Oman,male,muslim,1990-05-14,Engineering,Civil Engineer,,2021-03-14,,unlimited,,name@example.com,+968 9000 0000\n'),
  runImport: () => runImport(),
  newDoc: el => docForm(el.dataset.id || null),
  delDoc: async el => { if (!el.dataset.confirm){ el.dataset.confirm = 1; el.textContent = 'Confirm remove'; return; } try { await q(sb.from('documents').delete().eq('id', el.dataset.id)); toast('Document removed'); closeDrawer(); render(); } catch (e){ toast(errText(e)); } },
  docFilter: el => { docFilter = el.dataset.v; render(); },
  printLetter: el => printLetter(el.dataset.id),
  issueLetter: async el => { await q(sb.from('letter_requests').update({status: 'issued', decided_by: S.user.id, decided_at: new Date().toISOString()}).eq('id', el.dataset.id)); toast('Letter issued'); render(); },
  rejectLetter: async el => { const note = (window.prompt && window.prompt('Reason for rejecting')) || ''; await q(sb.from('letter_requests').update({status: 'rejected', hr_note: note, decided_by: S.user.id, decided_at: new Date().toISOString()}).eq('id', el.dataset.id)); toast('Letter request rejected'); render(); },
  exportEmp: () => exportEmployees(),
  print: () => window.print(),
  saveType: el => saveType(el.dataset.code),
  saveRest: async () => { const days = [...document.querySelectorAll('.restDay:checked')].map(x => Number(x.value)); try { await q(sb.from('settings').upsert({key: 'rest_days', value: days})); await loadLookups(); toast('Rest days saved'); } catch (e){ toast(errText(e)); } },
  addHoliday: async () => { const day = $('holDay').value, name = $('holName').value.trim(); if (!day || !name) return toast('Choose a date and type a name.'); try { await q(sb.from('holidays').insert({day, name})); render(); } catch (e){ toast(errText(e)); } },
  delHoliday: async el => { try { await q(sb.from('holidays').delete().eq('day', el.dataset.day)); render(); } catch (e){ toast(errText(e)); } },
  newUser: el => userForm(el.dataset.id || null),
  resetPw: el => resetPw(el.dataset.id, el.dataset.u),
  setStatus: async el => { try { await q(sb.rpc('admin_update_user', {p_user: el.dataset.id, p_role: el.dataset.role, p_status: el.dataset.s})); toast(el.dataset.s === 'active' ? 'Login enabled' : 'Login disabled'); render(); } catch (e){ toast(errText(e)); } },
  copy: async el => { try { await navigator.clipboard.writeText(el.dataset.text); toast('Copied'); } catch { toast('Select the text and copy it'); } }
};
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-a]');
  if (!el || !A[el.dataset.a]) return;
  if (el.tagName === 'A' || el.tagName === 'BUTTON') ev.preventDefault();
  Promise.resolve().then(() => A[el.dataset.a](el)).catch(e => toast(errText(e)));
});
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeDrawer(); });
document.addEventListener('submit', ev => {
  ev.preventDefault();
  const f = ev.target;
  ({loginForm: doLogin, pwForm: doChangePassword, leaveForm: submitLeave, empForm: () => saveEmployee(f), docForm: () => saveDoc(f), userForm: saveUser,
    letterForm: async () => { try { await q(sb.rpc('request_letter', {p_type: $('ltType').value, p_addressed_to: $('ltTo').value, p_purpose: $('ltPurpose').value})); toast('Request sent to HR'); render(); } catch (e){ toast(errText(e)); } }
  })[f.id]?.();
});
let searchTimer;
document.addEventListener('input', ev => {
  if (ev.target.id === 'empQ'){ clearTimeout(searchTimer); searchTimer = setTimeout(async () => { empFilter.q = ev.target.value; await render(); const s = $('empQ'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 250); }
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (['lfType', 'lfStart', 'lfEnd'].includes(t.id)) updateLeaveCalc().catch(e => toast(errText(e)));
  if (t.id === 'empShow'){ empFilter.show = t.value; render(); }
  if (t.id === 'ufEmp') $('ufUser').value = t.selectedOptions[0]?.dataset.s || '';
  if (t.dataset.a2 === 'role') q(sb.rpc('admin_update_user', {p_user: t.dataset.id, p_role: t.value, p_status: 'active'})).then(() => { toast('Role saved'); render(); }).catch(e => toast(errText(e)));
});
sb.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') renderLogin(); });
boot().catch(e => { root.innerHTML = `<div class="loading">${esc(errText(e))}</div>`; });
})();
