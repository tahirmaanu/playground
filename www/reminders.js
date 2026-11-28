/* Follow-up reminders.
 *
 * Each visit can carry "followUpDays" (e.g. medicine for 7 days) and a computed "nextVisitDate".
 * For every patient only the LATEST visit counts - a newer visit replaces the old reminder.
 *
 *   category of a reminder
 *     due       next-visit date (or snooze date) is today or already past, not marked done
 *     upcoming  still in the future
 *     snoozed   user pushed it to a later date
 *     done      user marked it complete
 *
 * State per reminder (read / done / snooze) lives in the `reminders` table keyed by record number.
 * Android notifications are scheduled for every open reminder at the chosen time of day.
 */
(function () {
  'use strict';

  const CHANNEL = 'followups';
  let state = new Map();          // recordNumber -> {status, snoozeUntil, isRead}
  let reminderTime = '09:00';
  let tab = 'due';
  let openSnooze = '';
  let refreshTimer = null, syncRunning = false, syncAgain = false, listenerAdded = false;

  // ---- dates ----------------------------------------------------------------------------
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  function parse(str) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(str || '')); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : null; }
  const today = () => ymd(new Date());
  function addDays(str, n) { const d = parse(str); if (!d) return ''; d.setDate(d.getDate() + Number(n)); return ymd(d); }
  function diffDays(from, to) { const a = parse(from), b = parse(to); return a && b ? Math.round((b - a) / 86400000) : 0; }
  function formatDate(str) {
    const d = parse(str); if (!d) return '—';
    let wd = '';
    try { wd = new Intl.DateTimeFormat('ur-PK', { weekday: 'long' }).format(d) + '، '; } catch (_) {}
    return `${wd}${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
  }
  const fmtNum = n => { try { return new Intl.NumberFormat('ur-PK', { maximumFractionDigits: 0 }).format(n); } catch (_) { return String(n); } };

  // ---- model ----------------------------------------------------------------------------
  function entryNum(r) { const n = Number(r.entryId); return Number.isFinite(n) ? n : 0; }
  function latestByPatient(records) {
    const map = new Map();
    for (const r of records) {
      const k = patientToken(r), cur = map.get(k);
      const a = String(r.date || ''), b = cur ? String(cur.date || '') : '';
      if (!cur || a > b || (a === b && entryNum(r) > entryNum(cur))) map.set(k, r);
    }
    return map;
  }
  function stateOf(rn) { return state.get(String(rn)) || { status: 'pending', snoozeUntil: '', isRead: 0 }; }

  function infoFor(rec) {
    if (!rec || !(Number(rec.followUpDays) > 0) || !rec.nextVisitDate) return null;
    const st = stateOf(rec.recordNumber), t = today();
    const snoozed = st.status !== 'done' && st.snoozeUntil && st.snoozeUntil > t;
    const eff = snoozed ? st.snoozeUntil : (st.snoozeUntil && st.snoozeUntil > rec.nextVisitDate ? st.snoozeUntil : rec.nextVisitDate);
    const days = diffDays(t, eff);
    let cat = 'upcoming';
    if (st.status === 'done') cat = 'done';
    else if (snoozed) cat = 'snoozed';
    else if (days <= 0) cat = 'due';
    return { rec, st, eff, days, cat, unread: cat === 'due' && !st.isRead, patient: rec.patientName };
  }
  function allItems() {
    const out = [];
    for (const rec of latestByPatient(records).values()) { const i = infoFor(rec); if (i) out.push(i); }
    return out;
  }
  function badgeHtml(info, big) {
    if (!info) return big ? '<span class="cd cd-none"><b>—</b><small>فالو اپ نہیں</small></span>' : '';
    let num, label, cls;
    if (info.cat === 'done') { num = '✓'; label = 'مکمل'; cls = 'done'; }
    else if (info.days > 7) { num = fmtNum(info.days); label = 'دن باقی'; cls = 'ok'; }
    else if (info.days > 0) { num = fmtNum(info.days); label = 'دن باقی'; cls = 'soon'; }
    else if (info.days === 0) { num = 'آج'; label = 'فالو اپ'; cls = 'late'; }
    else { num = fmtNum(-info.days); label = 'دن تاخیر'; cls = 'late'; }
    return `<span class="cd cd-${cls}${info.cat === 'snoozed' ? ' cd-snz' : ''}"><b>${num}</b><small>${label}</small></span>`;
  }

  // ---- storage --------------------------------------------------------------------------
  async function loadState() {
    try {
      const data = await api('list_reminders');
      state = new Map((data.reminders || []).map(r => [String(r.recordNumber), { status: r.status, snoozeUntil: r.snoozeUntil || '', isRead: Number(r.isRead) ? 1 : 0 }]));
    } catch (err) { console.error('Reminder state load failed:', err); }
    try { const s = await api('get_settings'); if (s.reminderTime) reminderTime = s.reminderTime; } catch (_) {}
  }
  async function setState(rn, patch) {
    await api('set_reminder', Object.assign({ recordNumber: rn }, patch));
    await loadState();
  }

  // ---- Android notifications --------------------------------------------------------------
  const LN = () => (typeof isNativeApp !== 'undefined' && isNativeApp ? window.Capacitor?.Plugins?.LocalNotifications : null);
  function notifId(rn) { const n = Number(rn); if (Number.isSafeInteger(n) && n > 0 && n < 2000000000) return n; let h = 7; for (const c of String(rn)) h = (h * 31 + c.charCodeAt(0)) % 2000000000; return h + 1; }

  async function ensurePermission(ask) {
    const ln = LN(); if (!ln) return 'unsupported';
    try {
      let p = await ln.checkPermissions();
      if (p.display !== 'granted' && ask) p = await ln.requestPermissions();
      return p.display;
    } catch (err) { console.error(err); return 'error'; }
  }
  async function ensureChannel(ln) {
    try { await ln.createChannel({ id: CHANNEL, name: 'فالو اپ یاد دہانی', description: 'مریضوں کی اگلی وزٹ کی یاد دہانی', importance: 4, visibility: 1, vibration: true }); } catch (_) {}
  }
  async function syncNative() {
    const ln = LN(); if (!ln) return;
    if (syncRunning) { syncAgain = true; return; }
    syncRunning = true;
    try {
      if (await ensurePermission(false) !== 'granted') return;
      await ensureChannel(ln);
      if (!listenerAdded) {
        listenerAdded = true;
        ln.addListener('localNotificationActionPerformed', () => { try { window.openNotifications(); } catch (_) {} });
      }
      const pending = await ln.getPending();
      if (pending.notifications && pending.notifications.length) await ln.cancel({ notifications: pending.notifications.map(n => ({ id: n.id })) });
      const now = Date.now(), horizon = now + 400 * 86400000, list = [];
      for (const it of allItems()) {
        if (it.cat === 'done') continue;
        const at = new Date(`${it.eff}T${reminderTime}:00`);
        if (!(at.getTime() > now) || at.getTime() > horizon) continue;
        list.push({
          id: notifId(it.rec.recordNumber), channelId: CHANNEL, smallIcon: 'ic_stat_notify',
          title: 'فالو اپ کا وقت',
          body: `${it.rec.patientName} — ${Number(it.rec.followUpDays)} دن مکمل۔ رابطہ کریں۔`,
          schedule: { at, allowWhileIdle: true }, extra: { recordNumber: it.rec.recordNumber }
        });
      }
      for (let i = 0; i < list.length; i += 50) await ln.schedule({ notifications: list.slice(i, i + 50) });
    } catch (err) { console.error('Notification scheduling failed:', err); }
    finally { syncRunning = false; if (syncAgain) { syncAgain = false; syncNative(); } }
  }
  async function sendTest() {
    const ln = LN();
    if (!ln) { toast('یہ سہولت صرف اینڈرائیڈ ایپ میں ہے۔'); return; }
    const perm = await ensurePermission(true);
    if (perm !== 'granted') { toast('نوٹیفکیشن کی اجازت نہیں ملی۔ فون کی Settings → Apps → Notifications میں اجازت دیں۔'); return; }
    await ensureChannel(ln);
    await ln.schedule({ notifications: [{ id: 2147000000, channelId: CHANNEL, smallIcon: 'ic_stat_notify', title: 'ٹیسٹ نوٹیفکیشن', body: 'فالو اپ یاد دہانیاں اسی طرح نظر آئیں گی۔', schedule: { at: new Date(Date.now() + 4000), allowWhileIdle: true } }] });
    toast('4 سیکنڈ میں ٹیسٹ نوٹیفکیشن آئے گا۔');
  }

  // ---- UI -------------------------------------------------------------------------------
  function updateHome() {
    const items = allItems(), due = items.filter(i => i.cat === 'due'), unread = due.filter(i => i.unread).length;
    const badge = document.getElementById('notifBadge');
    if (badge) { badge.textContent = due.length ? fmtNum(due.length) : ''; badge.classList.toggle('hidden', !due.length); badge.classList.toggle('read', !unread); }
    const cnt = document.getElementById('followupDueCount'); if (cnt) cnt.textContent = fmtNum(due.length);
  }

  function whatsAppText(rec) {
    return ['السلام علیکم', `محترم/محترمہ ${rec.patientName}`, `آپ کی اگلی وزٹ کی تاریخ: ${formatDate(rec.nextVisitDate)}`, `ریکارڈ نمبر: ${rec.recordNumber}`, 'براہِ کرم چیک اپ کے لیے تشریف لائیں۔', 'دواخانہ حکیم امیر معاویہ اینڈ حجامہ کلینک'].join('\n\n');
  }

  function cardHtml(it) {
    const r = it.rec, rn = escapeHtml(r.recordNumber), open = openSnooze === String(r.recordNumber);
    const when = it.cat === 'snoozed' ? `مؤخر: ${formatDate(it.st.snoozeUntil)}` : `اگلی وزٹ: ${formatDate(r.nextVisitDate)}`;
    const readBtn = it.cat === 'due' ? `<button type="button" data-act="read" data-rn="${rn}" class="nt-b">${it.st.isRead ? '● ان پڑھ کریں' : '○ پڑھا ہوا'}</button>` : '';
    const doneBtn = it.cat === 'done' ? `<button type="button" data-act="reopen" data-rn="${rn}" class="nt-b">↺ دوبارہ کھولیں</button>` : `<button type="button" data-act="done" data-rn="${rn}" class="nt-b nt-go">✓ مکمل</button><button type="button" data-act="snoozeMenu" data-rn="${rn}" class="nt-b">⏰ مؤخر کریں</button>`;
    return `<article class="nt-card ${it.unread ? 'unread' : ''}"><div class="nt-top"><span class="nt-dot" aria-hidden="true"></span><div class="nt-who"><strong>${escapeHtml(r.patientName)}</strong><small>ریکارڈ ${rn} · ${escapeHtml(r.phone)}</small></div>${badgeHtml(it)}</div><div class="nt-meta">${escapeHtml(when)} · ${fmtNum(Number(r.followUpDays))} دن کی دوا${r.disease ? ' · ' + escapeHtml(r.disease) : ''}</div><div class="nt-actions">${doneBtn}${readBtn}<button type="button" data-act="wa" data-rn="${rn}" class="nt-b">واٹس ایپ پیغام</button><button type="button" data-act="hist" data-rn="${rn}" class="nt-b">ہسٹری</button></div>${open ? `<div class="nt-snooze"><span>دوبارہ یاد دلائیں:</span><button type="button" data-act="snooze" data-n="1" data-rn="${rn}">کل</button><button type="button" data-act="snooze" data-n="2" data-rn="${rn}">2 دن</button><button type="button" data-act="snooze" data-n="3" data-rn="${rn}">3 دن</button><button type="button" data-act="snooze" data-n="7" data-rn="${rn}">ایک ہفتہ</button><input type="date" min="${addDays(today(), 1)}" data-act="snoozeDate" data-rn="${rn}" aria-label="تاریخ منتخب کریں"></div>` : ''}</article>`;
  }

  function render() {
    updateHome();
    const body = document.getElementById('notifBody'); if (!body) return;
    const items = allItems(), by = c => items.filter(i => i.cat === c);
    const groups = { due: by('due'), upcoming: by('upcoming'), snoozed: by('snoozed'), done: by('done') };
    groups.due.sort((a, b) => a.days - b.days);
    groups.upcoming.sort((a, b) => a.days - b.days);
    groups.snoozed.sort((a, b) => a.days - b.days);
    groups.done.sort((a, b) => String(b.rec.nextVisitDate).localeCompare(String(a.rec.nextVisitDate)));
    const names = { due: 'نئے', upcoming: 'آنے والے', snoozed: 'مؤخر', done: 'مکمل' };
    const unread = groups.due.filter(i => i.unread).length;
    document.getElementById('notifTabs').innerHTML = Object.keys(names).map(k => `<button type="button" role="tab" class="ov-tab ${tab === k ? 'active' : ''}" data-act="tab" data-tab="${k}">${names[k]} <span class="nt-n">${fmtNum(groups[k].length)}</span></button>`).join('');
    const empty = { due: 'کوئی فالو اپ باقی نہیں۔ 🎉', upcoming: 'آنے والے کوئی فالو اپ نہیں۔', snoozed: 'کوئی مؤخر کیا ہوا فالو اپ نہیں۔', done: 'ابھی کوئی فالو اپ مکمل نہیں ہوا۔' };
    const list = groups[tab];
    const tools = tab === 'due' && unread ? `<div class="nt-bar"><button type="button" class="secondary" data-act="readAll">سب کو پڑھا ہوا کریں (${fmtNum(unread)})</button></div>` : '';
    body.innerHTML = tools + (list.length ? list.map(cardHtml).join('') : `<div class="ov-empty">${empty[tab]}</div>`);
  }

  async function handle(e) {
    const el = e.target.closest('[data-act]'); if (!el) return;
    if (e.type === 'change' && el.dataset.act !== 'snoozeDate') return;
    if (e.type === 'click' && el.dataset.act === 'snoozeDate') return;
    const act = el.dataset.act, rn = el.dataset.rn;
    const rec = rn ? records.find(r => String(r.recordNumber) === String(rn)) : null;
    try {
      if (act === 'tab') { tab = el.dataset.tab; openSnooze = ''; render(); return; }
      if (act === 'snoozeMenu') { openSnooze = openSnooze === rn ? '' : rn; render(); return; }
      if (act === 'readAll') { for (const i of allItems().filter(i => i.cat === 'due' && i.unread)) await api('set_reminder', { recordNumber: i.rec.recordNumber, isRead: true }); await loadState(); }
      else if (act === 'read') { await setState(rn, { isRead: !stateOf(rn).isRead }); }
      else if (act === 'done') { await setState(rn, { status: 'done', isRead: true, snoozeUntil: '' }); toast('فالو اپ مکمل نشان زد کر دیا گیا۔'); }
      else if (act === 'reopen') { await setState(rn, { status: 'pending', isRead: false }); toast('فالو اپ دوبارہ کھول دیا گیا۔'); }
      else if (act === 'snooze' || act === 'snoozeDate') {
        const date = act === 'snooze' ? addDays(today(), Number(el.dataset.n)) : el.value;
        if (!date || date <= today()) { toast('آنے والی تاریخ منتخب کریں۔'); return; }
        openSnooze = ''; await setState(rn, { status: 'pending', snoozeUntil: date, isRead: false });
        toast(`یاد دہانی ${formatDate(date)} کو دوبارہ آئے گی۔`);
      }
      else if (act === 'wa' && rec) { await setState(rn, { isRead: true }); sendWhatsApp(rec.phone, whatsAppText(rec)); }
      else if (act === 'hist' && rec) { await setState(rn, { isRead: true }); window.openPatientHistoryFromOverview(rec.phone, rec.patientName); return; }
      render(); syncNative();
    } catch (err) { toast('عمل مکمل نہیں ہو سکا: ' + err.message); }
  }

  async function open() { await refresh(); tab = allItems().some(i => i.cat === 'due') ? 'due' : (tab === 'due' ? 'upcoming' : tab); render(); }
  async function refresh() { await loadState(); render(); syncNative(); }
  function refreshSoon() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250); }

  async function init() {
    const body = document.getElementById('notifBody');
    if (body) { body.addEventListener('click', handle); body.addEventListener('change', handle); }
    const tabs = document.getElementById('notifTabs'); if (tabs) tabs.addEventListener('click', handle);
    await loadState();
    const t = document.getElementById('reminderTime'); if (t) { t.value = reminderTime; t.addEventListener('change', async () => { try { await api('set_setting', { key: 'reminder_time', value: t.value }); reminderTime = t.value; syncNative(); toast('یاد دہانی کا وقت محفوظ ہو گیا۔'); } catch (err) { toast('وقت محفوظ نہیں ہو سکا: ' + err.message); } }); }
    // Ask for the Android notification permission the first time follow-ups exist.
    if (allItems().length) { await ensurePermission(true); }
    render(); syncNative();
  }

  window.Reminders = { infoFor, badgeHtml, formatDate, addDays, today, latestByPatient, open, refresh: refreshSoon, init, sendTest, ensurePermission, whatsAppText, syncNative };
})();
