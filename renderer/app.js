'use strict';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
const fmtNum = (n) => Number(n || 0).toLocaleString();

// Unwraps { ok, data, error } replies from the main process.
async function call(promise) {
  const r = await promise;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', isError);
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 4500);
}

function confirmDialog(title, body, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    $('#modalTitle').textContent = title;
    $('#modalBody').textContent = body;
    const ok = $('#modalOk');
    ok.textContent = okLabel;
    ok.className = `btn ${danger ? 'danger' : 'primary'}`;
    $('#modal').classList.remove('hidden');
    const done = (v) => { $('#modal').classList.add('hidden'); ok.onclick = $('#modalCancel').onclick = null; resolve(v); };
    ok.onclick = () => done(true);
    $('#modalCancel').onclick = () => done(false);
  });
}

function setProgress(el, pct, text) {
  el.classList.remove('hidden');
  $('.bar', el).style.width = `${pct}%`;
  $('span', el).textContent = text;
}

// ---------------- navigation ----------------
const loaders = {};
function show(view) {
  $$('nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  loaders[view]?.();
}
$$('nav button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
$$('.card[data-goto]').forEach((c) => c.addEventListener('click', () => show(c.dataset.goto)));

// ---------------- junk / privacy ----------------
const state = { junk: null, privacy: null, registry: null, startup: null };
let activeProgress = null;
window.api.onProgress((d) => {
  if (activeProgress) setProgress(activeProgress, (d.current / d.total) * 100, `${d.current}/${d.total} · ${d.name}`);
});

function renderCategories(view, items) {
  const list = $('.list', view);
  const sections = {};
  for (const it of items) (sections[it.section] ||= []).push(it);
  list.innerHTML = Object.entries(sections).map(([sec, its]) => `
    <div class="section"><h4>${esc(sec)}</h4>
      ${its.map((it) => `
        <label class="item">
          <input type="checkbox" data-id="${esc(it.id)}" ${it.checked && it.count ? 'checked' : ''} ${it.count ? '' : 'disabled'}>
          <div class="info">
            <div class="name">${esc(it.name)}</div>
            <div class="desc">${esc(it.desc)}</div>
            ${it.warning ? `<div class="warn">⚠ ${esc(it.warning)}</div>` : ''}
          </div>
          <div class="size">${it.size ? fmtBytes(it.size) : (it.count ? '—' : 'Clean')}<small>${it.count ? `${fmtNum(it.count)} item${it.count === 1 ? '' : 's'}` : ''}</small></div>
        </label>`).join('')}
    </div>`).join('');
  $$('input[type=checkbox]', list).forEach((c) => c.addEventListener('change', () => updateSummary(view, items)));
  updateSummary(view, items);
}

function selectedIds(view) {
  return $$('.list input:checked', view).map((c) => c.dataset.id);
}

function updateSummary(view, items) {
  const ids = selectedIds(view);
  const sel = items.filter((i) => ids.includes(i.id));
  const size = sel.reduce((a, i) => a + i.size, 0);
  const count = sel.reduce((a, i) => a + i.count, 0);
  $('.summary', view).textContent = `Selected: ${fmtBytes(size)} · ${fmtNum(count)} items`;
  $('[data-act=clean]', view).disabled = !ids.length;
}

async function scanGroup(group) {
  const view = $(`#view-${group}`);
  const prog = $('.progress', view);
  activeProgress = prog;
  $('[data-act=scan]', view).disabled = true;
  try {
    const items = await call(window.api.junk.scan(group));
    state[group] = items;
    renderCategories(view, items);
    return items;
  } catch (e) { toast(e.message, true); }
  finally { prog.classList.add('hidden'); activeProgress = null; $('[data-act=scan]', view).disabled = false; }
}

async function cleanGroup(group, ids, ask = true) {
  const view = $(`#view-${group}`);
  if (!ids.length) return null;
  if (ask && !(await confirmDialog('Clean selected items?', 'The selected files will be permanently deleted. Files in use will be skipped.', 'Clean', true))) return null;
  const prog = $('.progress', view);
  activeProgress = prog;
  try {
    const r = await call(window.api.junk.clean(ids));
    toast(`Cleaned ${fmtBytes(r.freed)} (${fmtNum(r.deleted)} items).${r.failed ? ` ${fmtNum(r.failed)} in use or protected were skipped.` : ''}`);
    await scanGroup(group);
    return r;
  } catch (e) { toast(e.message, true); }
  finally { prog.classList.add('hidden'); activeProgress = null; }
}

for (const group of ['junk', 'privacy']) {
  const view = $(`#view-${group}`);
  $('[data-act=scan]', view).addEventListener('click', () => scanGroup(group));
  $('[data-act=clean]', view).addEventListener('click', () => cleanGroup(group, selectedIds(view)));
  loaders[group] = () => { if (!state[group]) scanGroup(group); };
}

// ---------------- registry ----------------
async function scanRegistry() {
  $('#regScan').disabled = true;
  $('#regProgress').classList.remove('hidden');
  $('#regBackupPanel').classList.add('hidden');
  try {
    const issues = await call(window.api.registry.scan());
    state.registry = issues;
    renderRegistry(issues);
    return issues;
  } catch (e) { toast(e.message, true); }
  finally { $('#regScan').disabled = false; $('#regProgress').classList.add('hidden'); }
}

function renderRegistry(issues) {
  $('#regTable').classList.toggle('hidden', !issues.length);
  $('#regEmpty').classList.toggle('hidden', !!issues.length);
  $('#regAll').checked = true;
  $('#regTable tbody').innerHTML = issues.map((i) => `
    <tr>
      <td class="chk"><input type="checkbox" data-id="${i.id}" checked></td>
      <td><span class="tag">${esc(i.category)}</span></td>
      <td class="mono" title="${esc([i.key, ...i.values].join('\n'))}">${esc(i.data)}</td>
      <td>${esc(i.reason)}</td>
    </tr>`).join('');
  $$('#regTable tbody input').forEach((c) => c.addEventListener('change', updateRegSummary));
  updateRegSummary();
}

function regSelected() { return $$('#regTable tbody input:checked').map((c) => Number(c.dataset.id)); }
function updateRegSummary() {
  const n = regSelected().length;
  $('#regFix').disabled = !n;
  $('#regSummary').textContent = state.registry ? `${n} of ${state.registry.length} selected` : '';
}

async function fixRegistry(ids, ask = true) {
  if (!ids.length) return null;
  if (ask && !(await confirmDialog('Fix registry issues?', `${ids.length} entries will be removed.\nA backup is created first and can be restored from "Backups…".`, 'Fix'))) return null;
  try {
    const r = await call(window.api.registry.fix(ids));
    toast(`Fixed ${r.fixed} issue(s).${r.failed ? ` ${r.failed} failed.` : ''} Backup saved.`);
    await scanRegistry();
    return r;
  } catch (e) { toast(e.message, true); }
}

$('#regScan').addEventListener('click', scanRegistry);
$('#regFix').addEventListener('click', () => fixRegistry(regSelected()));
$('#regAll').addEventListener('change', (e) => { $$('#regTable tbody input').forEach((c) => (c.checked = e.target.checked)); updateRegSummary(); });
$('#regBackups').addEventListener('click', async () => {
  const panel = $('#regBackupPanel');
  if (!panel.classList.contains('hidden')) return panel.classList.add('hidden');
  const backups = await call(window.api.registry.backups());
  panel.innerHTML = `
    <div class="row" style="margin-bottom:10px"><strong>Registry backups</strong><button class="btn ghost small" id="regOpenDir" style="margin-left:auto">Open folder</button></div>
    ${backups.length ? `<table><tbody>${backups.map((b, i) => `
      <tr><td>${esc(b.name)}</td><td class="muted">${b.files} file(s)</td><td style="text-align:right"><button class="btn ghost small" data-i="${i}">Restore</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="muted">No backups yet.</div>'}`;
  panel.classList.remove('hidden');
  $('#regOpenDir').onclick = () => window.api.registry.openBackups();
  $$('button[data-i]', panel).forEach((btn) => btn.addEventListener('click', async () => {
    const b = backups[Number(btn.dataset.i)];
    if (!(await confirmDialog('Restore backup?', `Re-import registry entries from ${b.name}.`, 'Restore'))) return;
    try {
      const r = await call(window.api.registry.restore(b.path));
      toast(r.failed ? `${r.failed} file(s) could not be imported.` : 'Backup restored.', !!r.failed);
    } catch (e) { toast(e.message, true); }
  }));
});
loaders.registry = () => { if (!state.registry) scanRegistry(); };

// ---------------- startup ----------------
async function loadStartup() {
  try {
    const items = await call(window.api.startup.list());
    state.startup = items;
    const enabled = items.filter((i) => i.enabled).length;
    $('#stSummary').textContent = `${enabled} enabled · ${items.length - enabled} disabled`;
    $('#stTable tbody').innerHTML = items.length ? items.map((i) => `
      <tr>
        <td><strong>${esc(i.name)}</strong><br><span class="tag">${esc(i.source)}</span></td>
        <td class="mono" title="${esc(i.command)}">${esc(i.command)}</td>
        <td>${esc(i.scope)}</td>
        <td><label class="switch"><input type="checkbox" data-id="${i.id}" ${i.enabled ? 'checked' : ''}><span></span></label></td>
      </tr>`).join('') : '<tr><td colspan="4" class="muted">No startup programs found.</td></tr>';
    $$('#stTable input').forEach((c) => c.addEventListener('change', async () => {
      try {
        await call(window.api.startup.set(Number(c.dataset.id), c.checked));
        const it = state.startup.find((x) => x.id === Number(c.dataset.id));
        it.enabled = c.checked;
        const en = state.startup.filter((x) => x.enabled).length;
        $('#stSummary').textContent = `${en} enabled · ${state.startup.length - en} disabled`;
        toast(`${it.name} ${c.checked ? 'enabled' : 'disabled'} at startup.`);
      } catch (e) { c.checked = !c.checked; toast(e.message, true); }
    }));
    return items;
  } catch (e) { toast(e.message, true); }
}
$('#stRefresh').addEventListener('click', loadStartup);
loaders.startup = () => { if (!state.startup) loadStartup(); };

// ---------------- programs ----------------
let programs = null;
async function loadPrograms() {
  $('#pgTable tbody').innerHTML = '<tr><td colspan="6" class="muted">Loading installed programs…</td></tr>';
  try { programs = await call(window.api.programs.list()); renderPrograms(); }
  catch (e) { toast(e.message, true); }
}
function renderPrograms() {
  if (!programs) return;
  const q = $('#pgSearch').value.trim().toLowerCase();
  const sort = $('#pgSort').value;
  let rows = programs.filter((p) => !q || p.name.toLowerCase().includes(q) || p.publisher.toLowerCase().includes(q));
  rows = [...rows].sort((a, b) =>
    sort === 'size' ? b.size - a.size : sort === 'date' ? String(b.installDate).localeCompare(String(a.installDate)) : a.name.localeCompare(b.name));
  $('#pgSummary').textContent = `${rows.length} programs · ${fmtBytes(rows.reduce((a, p) => a + p.size, 0))}`;
  $('#pgTable tbody').innerHTML = rows.map((p) => `
    <tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td class="muted">${esc(p.publisher)}</td>
      <td class="num muted">${esc(p.version)}</td>
      <td class="num">${p.size ? fmtBytes(p.size) : '—'}</td>
      <td class="num muted">${esc(p.installDate || '—')}</td>
      <td style="text-align:right"><button class="btn danger small" data-id="${p.id}">Uninstall</button></td>
    </tr>`).join('');
  $$('#pgTable button').forEach((b) => b.addEventListener('click', async () => {
    const p = programs.find((x) => x.id === Number(b.dataset.id));
    if (!(await confirmDialog(`Uninstall ${p.name}?`, "The program's own uninstaller will open. Follow its steps, then click Refresh.", 'Uninstall', true))) return;
    try { await call(window.api.programs.uninstall(p.id)); toast(`Launched uninstaller for ${p.name}.`); }
    catch (e) { toast(e.message, true); }
  }));
}
$('#pgSearch').addEventListener('input', renderPrograms);
$('#pgSort').addEventListener('change', renderPrograms);
$('#pgRefresh').addEventListener('click', loadPrograms);
loaders.programs = () => { if (!programs) loadPrograms(); };

// ---------------- large files ----------------
window.api.onDiskProgress((d) => {
  $('#dkProgress span').textContent = `${fmtNum(d.scanned)} files checked · ${d.current}`;
});
$('#dkPick').addEventListener('click', async () => {
  const p = await call(window.api.disk.pickFolder());
  if (p) $('#dkRoot').value = p;
});
$('#dkScan').addEventListener('click', async () => {
  $('#dkScan').disabled = true;
  $('#dkProgress').classList.remove('hidden');
  $('#dkProgress span').textContent = 'Scanning…';
  try {
    const r = await call(window.api.disk.largeFiles($('#dkRoot').value, Number($('#dkMin').value)));
    $('#dkSummary').textContent = `${r.files.length} large files · ${fmtBytes(r.files.reduce((a, f) => a + f.size, 0))} (${fmtNum(r.scanned)} scanned)`;
    $('#dkTable tbody').innerHTML = r.files.length ? r.files.map((f, i) => `
      <tr data-i="${i}">
        <td class="mono" title="${esc(f.path)}">${esc(f.path)}</td>
        <td class="num">${fmtBytes(f.size)}</td>
        <td class="num muted">${new Date(f.modified).toLocaleDateString()}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn ghost small" data-act="reveal">Show</button>
          <button class="btn danger small" data-act="trash">Recycle</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="4" class="muted">No files above that size.</td></tr>';
    $$('#dkTable button').forEach((b) => b.addEventListener('click', async () => {
      const tr = b.closest('tr');
      const f = r.files[Number(tr.dataset.i)];
      if (b.dataset.act === 'reveal') return call(window.api.disk.reveal(f.path)).catch((e) => toast(e.message, true));
      if (!(await confirmDialog('Move to Recycle Bin?', f.path, 'Recycle', true))) return;
      try { await call(window.api.disk.trash(f.path)); tr.remove(); toast('Moved to Recycle Bin.'); }
      catch (e) { toast(e.message, true); }
    }));
  } catch (e) { toast(e.message, true); }
  finally { $('#dkScan').disabled = false; $('#dkProgress').classList.add('hidden'); }
});
loaders.disk = async () => { if (!$('#dkRoot').value) $('#dkRoot').value = await call(window.api.disk.home()); };

// ---------------- system info ----------------
let sysLoaded = false;
loaders.system = async () => {
  if (sysLoaded) return;
  try {
    const s = await call(window.api.system.info());
    sysLoaded = true;
    const up = `${Math.floor(s.uptime / 86400)}d ${Math.floor((s.uptime % 86400) / 3600)}h ${Math.floor((s.uptime % 3600) / 60)}m`;
    const kv = (o) => `<dl class="kv">${Object.entries(o).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
    $('#sysGrid').innerHTML = `
      <div class="sys-card"><h3>Operating system</h3>${kv({ Windows: s.osName, Build: s.osBuild, Architecture: s.arch, Installed: s.installed, 'Last boot': s.lastBoot, Uptime: up })}</div>
      <div class="sys-card"><h3>Hardware</h3>${kv({ Computer: s.hostname, User: s.user, Manufacturer: s.manufacturer, Model: s.model, Processor: `${s.cpu} (${s.cores} threads)`, Graphics: s.gpu })}</div>
      <div class="sys-card"><h3>Memory</h3>
        <div class="disk"><div>${fmtBytes(s.totalMem - s.freeMem)} used of ${fmtBytes(s.totalMem)}</div>
        <div class="meter"><div style="width:${((1 - s.freeMem / s.totalMem) * 100).toFixed(1)}%"></div></div></div></div>
      <div class="sys-card"><h3>Drives</h3>${(s.disks || []).map((d) => {
        const used = 1 - d.free / d.size;
        return `<div class="disk"><div><strong>${esc(d.drive)}</strong> ${esc(d.label || '')} <span class="muted">· ${esc(d.fs)}</span></div>
          <div class="meter"><div class="${used > 0.9 ? 'full' : ''}" style="width:${(used * 100).toFixed(1)}%"></div></div>
          <div class="muted">${fmtBytes(d.free)} free of ${fmtBytes(d.size)}</div></div>`;
      }).join('')}</div>`;
  } catch (e) { $('#sysGrid').innerHTML = `<div class="muted">${esc(e.message)}</div>`; }
};

// ---------------- dashboard ----------------
function setScore(score) {
  const arc = $('#gaugeArc');
  arc.style.strokeDashoffset = `${326.7 * (1 - score / 100)}px`;
  arc.style.stroke = score >= 85 ? 'var(--success)' : score >= 60 ? 'var(--warn)' : 'var(--danger)';
  $('#score').textContent = score;
  $('#scoreText').textContent = score >= 85 ? 'Excellent' : score >= 60 ? 'Needs attention' : 'Poor';
}

function metric(el, text, bad) {
  el.textContent = text;
  el.classList.toggle('bad', bad);
  el.classList.toggle('good', !bad);
}

const checkedWithData = (items) => (items || []).filter((i) => i.checked && i.count);

function updateDashboard() {
  const junkSel = checkedWithData(state.junk);
  const privSel = checkedWithData(state.privacy);
  const junkSize = junkSel.reduce((a, i) => a + i.size, 0);
  const privCount = privSel.reduce((a, i) => a + i.count, 0);
  const regCount = state.registry?.length || 0;
  const startEnabled = (state.startup || []).filter((i) => i.enabled).length;

  metric($('#mJunk'), fmtBytes(junkSize), junkSize > 100 * 1024 * 1024);
  metric($('#mPrivacy'), `${fmtNum(privCount)} traces`, privCount > 0);
  metric($('#mRegistry'), `${regCount} issues`, regCount > 0);
  metric($('#mStartup'), `${startEnabled} enabled`, startEnabled > 6);

  const gb = junkSize / 1024 ** 3;
  let score = 100;
  score -= gb > 2 ? 25 : gb > 0.5 ? 15 : junkSize > 100 * 1024 * 1024 ? 8 : 0;
  score -= privCount > 0 ? 8 : 0;
  score -= Math.min(20, regCount * 2);
  score -= startEnabled > 10 ? 12 : startEnabled > 6 ? 6 : 0;
  score = Math.max(0, score);
  setScore(score);

  const fixable = junkSel.length + privSel.length + regCount;
  $('#heroTitle').textContent = fixable ? `Found ${fmtBytes(junkSize)} of junk and ${regCount + privCount} other issues` : 'Your PC is in great shape';
  $('#heroSub').textContent = fixable ? 'Review details by clicking a card below, or fix everything recommended in one go.' : 'Nothing to clean right now. Scan again any time.';
  $('#fixAll').classList.toggle('hidden', !fixable);
}

$('#scanAll').addEventListener('click', async () => {
  const btn = $('#scanAll');
  const prog = $('#dashProgress');
  btn.disabled = true;
  $('#fixAll').classList.add('hidden');
  try {
    const steps = [
      ['Scanning junk files…', () => scanGroup('junk')],
      ['Scanning privacy traces…', () => scanGroup('privacy')],
      ['Scanning registry…', () => scanRegistry()],
      ['Checking startup programs…', () => loadStartup()],
    ];
    for (let i = 0; i < steps.length; i++) {
      setProgress(prog, (i / steps.length) * 100, steps[i][0]);
      await steps[i][1]();
    }
    updateDashboard();
  } finally { btn.disabled = false; prog.classList.add('hidden'); btn.textContent = 'Scan Again'; }
});

$('#fixAll').addEventListener('click', async () => {
  const junkIds = checkedWithData(state.junk).map((i) => i.id);
  const privIds = checkedWithData(state.privacy).map((i) => i.id);
  const regIds = (state.registry || []).map((i) => i.id);
  if (!(await confirmDialog('Fix all recommended issues?',
    `• ${junkIds.length} junk categories\n• ${privIds.length} privacy categories\n• ${regIds.length} registry entries (backed up first)\n\nCookies and other optional items are left alone.`, 'Fix All'))) return;
  const prog = $('#dashProgress');
  $('#fixAll').disabled = true;
  try {
    setProgress(prog, 10, 'Cleaning junk files…');
    const j = await cleanGroup('junk', junkIds, false);
    setProgress(prog, 45, 'Cleaning privacy traces…');
    const p = await cleanGroup('privacy', privIds, false);
    setProgress(prog, 75, 'Fixing registry…');
    await fixRegistry(regIds, false);
    updateDashboard();
    toast(`All done — freed ${fmtBytes((j?.freed || 0) + (p?.freed || 0))}.`);
  } finally { $('#fixAll').disabled = false; prog.classList.add('hidden'); }
});

// ---------------- admin status ----------------
(async () => {
  const box = $('#adminBox');
  try {
    const admin = await call(window.api.system.isAdmin());
    if (admin) { box.textContent = '✓ Running as administrator'; return; }
    box.innerHTML = 'Limited mode — some system files can only be cleaned as administrator.<button class="btn ghost small" id="elevate">Restart as admin</button>';
    $('#elevate').onclick = () => window.api.system.relaunchAdmin();
  } catch { box.textContent = ''; }
})();
