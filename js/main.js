// Hauptprogramm: Zustand, Daten laden, Aktionen
import * as api from './api.js';
import { $, $$, esc, today, addDays, sleep, debounce, extractIsbns, normalizeIsbn, isbn13Valid, download, rgbToHex, num } from './util.js';
import { parseCsv, fromBookology, toCsv } from './csv.js';
import { shiftAnchor, lastPage, dailyMap } from './stats.js';
import { startScanner, stopScanner, decodePhoto, beep } from './scan.js';
import * as V from './views.js';

const PREFS = 'bt_prefs_v1';
const S = {
  me: null, profiles: [], viewUser: null, viewName: '',
  books: new Map(), ub: [], logs: [], loaded: false,
  tab: 'shelf', layout: 'shelf',
  filter: { status: 'all', formats: { paper: true, ebook: true, audio: false }, q: '' },
  stats: { period: 'month', anchor: today(), color: 'category' },
  add: { tab: 'scan', defStatus: 'shelf', defFormat: 'softcover', busy: false, last: null },
  loginError: '', loginBusy: false, openId: null, enriching: false
};
try { Object.assign(S, JSON.parse(localStorage.getItem(PREFS) || '{}').ui || {}); } catch { /* egal */ }
const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify({ ui: { layout: S.layout, filter: { ...S.filter, q: '' }, tab: S.tab, stats: { ...S.stats, anchor: today() } } })); } catch { /* egal */ } };

/* ---------- Hilfen ---------- */
let toastTimer;
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), bad ? 5000 : 2600);
}
const errMsg = (e) => (e && e.message ? e.message : String(e));
async function guard(fn) { try { return await fn(); } catch (e) { console.error(e); toast(errMsg(e), true); return undefined; } }
const ro = () => S.viewUser !== S.me.id;
const fmtGroup = (f) => (f === 'ebook' ? 'ebook' : f === 'audio' ? 'audio' : 'paper');

function entries() {
  return S.ub.map((u) => {
    const book = S.books.get(u.book_id);
    return book ? { ...u, book, progress: book.pages ? Math.min(100, Math.round(lastPage(S.logs, u.id) / book.pages * 100)) : 0 } : null;
  }).filter(Boolean);
}
function visibleEntries() {
  return entries().filter((e) => S.filter.formats[fmtGroup(e.format)]);
}
function filtered() {
  const q = S.filter.q.trim().toLowerCase();
  const key = (e) => (e.status === 'reading' ? '9' : '0') + (e.finished_at || e.started_at || e.created_at || '').slice(0, 10);
  return visibleEntries()
    .filter((e) => S.filter.status === 'all' || e.status === S.filter.status)
    .filter((e) => !q || [e.book.title, e.book.subtitle, e.book.authors, e.book.isbn13, e.category, e.reading_series].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (key(a) < key(b) ? 1 : -1));
}

/* ---------- Rendern ---------- */
function render() {
  const app = $('#app');
  if (!api.isLoggedIn()) { app.innerHTML = V.loginView(S.loginError, S.loginBusy, S.loginEmail); return; }
  if (!S.loaded) { app.innerHTML = '<p class="empty">Lädt …</p>'; return; }
  const y = window.scrollY, ents = visibleEntries();
  let html;
  if (S.tab === 'stats') html = V.statsView(S, ents);
  else if (S.tab === 'reading') html = V.readingView(S, ents);
  else if (S.tab === 'reco') html = V.recoView(S, entries());
  else {
    const counts = { all: ents.length };
    for (const e of ents) counts[e.status] = (counts[e.status] || 0) + 1;
    ['reading', 'finished', 'shelf', 'wishlist', 'abandoned'].forEach((k) => { counts[k] = counts[k] || 0; });
    html = V.shelfShell(S, counts);
  }
  app.innerHTML = html + V.navView(S.tab) + (ro() ? '' : V.fabView());
  if (S.tab === 'shelf') renderList();
  window.scrollTo(0, y);
  scheduleColors();
}
function renderList() {
  const box = $('#list'); if (!box) return;
  const width = Math.min($('#app').clientWidth, 560) - 36 - 12;
  box.innerHTML = V.shelfList(S, filtered(), width);
}
let openSheetEl = null;
function openSheet(html) {
  const layer = $('#layer'); layer.innerHTML = html;
  const sheet = $('#layer .sheet'); openSheetEl = null;
  if (sheet) {
    // Kopfleiste (X) fest, nur der Rest scrollt
    const body = document.createElement('div'); body.className = 'sheet-body';
    [...sheet.children].filter((c) => !c.classList.contains('sheet-head')).forEach((c) => body.appendChild(c));
    sheet.appendChild(body); openSheetEl = body;
  }
  document.body.style.overflow = 'hidden';
}
function closeSheet() { stopScanner(); $('#layer').innerHTML = ''; openSheetEl = null; S.add.busy = false; S.openId = null; document.body.style.overflow = ''; }
function openAbandon(e) {
  const tracked = S.logs.some((l) => l.user_book_id === e.id && l.page_to > 0);
  openSheet(V.abandonSheet(S, e, lastPage(S.logs, e.id), tracked));
}
function openBook(id) {
  const e = entries().find((x) => x.id === id); if (!e) return;
  const top = openSheetEl ? openSheetEl.scrollTop : 0;
  S.openId = id; openSheet(V.bookSheet(S, e));
  if (openSheetEl) openSheetEl.scrollTop = top;
}

/* ---------- Daten laden ---------- */
async function loadShared() {
  const [profiles, books] = await Promise.all([api.selectAll('profiles'), api.selectAll('books')]);
  S.profiles = profiles; S.books = new Map(books.map((b) => [b.id, b]));
}
async function loadUser(uid) {
  const [ub, logs] = await Promise.all([api.selectAll('user_books', { user_id: 'eq.' + uid }), api.selectAll('reading_logs', { user_id: 'eq.' + uid })]);
  S.ub = ub; S.logs = logs;
}
async function boot() {
  if (!api.isLoggedIn()) { render(); return; }
  const s = api.getSession();
  S.me = { id: s.user.id, email: s.user.email, name: s.user.name || '' };
  S.viewUser = S.viewUser && S.viewUser !== S.me.id ? S.viewUser : S.me.id;
  render();
  try {
    await loadShared();
    const mine = S.profiles.find((p) => p.id === S.me.id);
    if (mine) S.me.name = mine.display_name || S.me.email.split('@')[0];
    const vp = S.profiles.find((p) => p.id === S.viewUser); S.viewName = vp ? vp.display_name : '';
    await loadUser(S.viewUser);
    S.loaded = true; render();
    if (!S.ub.length && !ro()) toast('Noch leer. Über + kannst du Bücher scannen oder die CSV importieren.');
  } catch (e) {
    console.error(e);
    if (!api.isLoggedIn()) { S.loginError = 'Bitte neu anmelden.'; render(); return; }
    $('#app').innerHTML = `<p class="empty"><b>Laden fehlgeschlagen</b>${esc(errMsg(e))}<br><br><button class="btn" data-act="reload">Nochmal versuchen</button></p>`;
  }
}

/* ---------- Cover-Farben ---------- */
const colorQueue = new Set(); let colorBusy = false; const colorTried = new Set();
function scheduleColors() {
  for (const e of entries()) if (e.book.cover_path && !e.book.cover_color && !colorTried.has(e.book.id)) colorQueue.add(e.book.id);
  if (!colorBusy && colorQueue.size) runColors();
}
async function runColors() {
  colorBusy = true; let changed = 0;
  while (colorQueue.size) {
    const id = colorQueue.values().next().value; colorQueue.delete(id); colorTried.add(id);
    const b = S.books.get(id); if (!b) continue;
    try {
      const hex = await dominantColor(api.coverUrl(b.cover_path));
      if (hex) { const [row] = await api.patch('books', { id: 'eq.' + id }, { cover_color: hex }); S.books.set(id, row || { ...b, cover_color: hex }); changed++; }
    } catch { /* Cover nicht lesbar: Standardfarbe */ }
    if (changed && changed % 12 === 0 && S.tab === 'shelf') renderList();
  }
  colorBusy = false;
  if (changed && S.tab === 'shelf') renderList();
}
function dominantColor(url) {
  return new Promise((resolve, reject) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = 24; c.height = 36;
      const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, 24, 36);
      const d = ctx.getImageData(0, 0, 24, 36).data;
      let r = 0, g = 0, b = 0, w = 0, r2 = 0, g2 = 0, b2 = 0, n2 = 0;
      for (let i = 0; i < d.length; i += 4) {
        const R = d[i], G = d[i + 1], B = d[i + 2], mx = Math.max(R, G, B), mn = Math.min(R, G, B), sat = mx - mn;
        r2 += R; g2 += G; b2 += B; n2++;
        if (mx > 245 && sat < 20) continue; // weißer Rand
        const wt = 1 + sat / 32; r += R * wt; g += G * wt; b += B * wt; w += wt;
      }
      resolve(w > 20 ? rgbToHex(r / w, g / w, b / w) : rgbToHex(r2 / n2, g2 / n2, b2 / n2));
    };
    img.onerror = () => reject(new Error('Bild'));
    img.src = url;
  });
}

/* ---------- Aktionen auf Büchern ---------- */
function setUb(row) {
  const i = S.ub.findIndex((u) => u.id === row.id);
  if (i >= 0) S.ub[i] = row; else S.ub.push(row);
}
async function patchEntry(id, values) {
  const [row] = await api.patch('user_books', { id: 'eq.' + id }, values); setUb(row); return row;
}
async function saveLog(id, pageTo, date = today()) {
  const e = entries().find((x) => x.id === id); if (!e) return;
  const pages = e.book.pages || 0;
  pageTo = Math.max(0, Math.round(Number(pageTo) || 0)); if (pages) pageTo = Math.min(pageTo, pages);
  const prev = S.logs.filter((l) => l.user_book_id === id && l.log_date < date).sort((a, b) => (a.log_date < b.log_date ? 1 : -1))[0];
  const pagesRead = Math.max(0, pageTo - (prev ? prev.page_to : 0));
  const [row] = await api.upsert('reading_logs', [{ user_id: S.me.id, user_book_id: id, log_date: date, page_to: pageTo, pages_read: pagesRead }], 'user_book_id,log_date');
  const i = S.logs.findIndex((l) => l.user_book_id === id && l.log_date === date);
  if (i >= 0) S.logs[i] = row; else S.logs.push(row);
  const upd = {};
  if (e.status === 'shelf' || e.status === 'wishlist') upd.status = 'reading';
  if (!e.started_at) upd.started_at = date;
  if (pages && pageTo >= pages) { upd.status = 'finished'; upd.finished_at = date; }
  if (Object.keys(upd).length) await patchEntry(id, upd);
  toast(pages && pageTo >= pages ? 'Fertig gelesen!' : 'Seite ' + pageTo + ' gespeichert (+' + pagesRead + ')');
}

async function addBook(info, status, format) {
  let book = [...S.books.values()].find((b) => b.isbn13 === info.isbn13);
  if (!book) {
    const [row] = await api.upsert('books', [{
      isbn13: info.isbn13, title: info.title, subtitle: info.subtitle || null, authors: info.authors || null,
      publisher: info.publisher || null, pub_year: info.pub_year || null, pages: info.pages || null,
      language: info.language || null, categories: info.categories || null, cover_path: info.cover_path || null,
      description: info.description || null
    }], 'isbn13');
    book = row; S.books.set(book.id, book);
  }
  const have = S.ub.find((u) => u.book_id === book.id);
  if (have) return { entry: have, dup: true };
  const [ub] = await api.insert('user_books', [{ user_id: S.me.id, book_id: book.id, status, format }]);
  S.ub.push(ub);
  if (needsData(book)) enrichSoon(book);
  return { entry: ub, dup: false };
}

/* ---------- Scannen ---------- */
// Verständliche Hinweise, warum die Kamera nicht startet
function cameraHelp(e) {
  const n = (e && e.name) || '';
  const standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (n === 'NotAllowedError' || n === 'SecurityError') {
    return 'Kamera-Zugriff wurde verweigert. iPhone: Einstellungen → Apps → Safari → Kamera → „Fragen“ oder „Erlauben“. '
      + (standalone ? 'Danach die App ganz schließen und neu öffnen.' : 'Oder in Safari links im Adressfeld auf „aA“ → Website-Einstellungen → Kamera → Erlauben.')
      + ' Prüfe auch Bildschirmzeit → Beschränkungen → Kamera.';
  }
  if (n === 'NoMediaDevices') return 'Dieser Browser bietet keinen Kamera-Zugriff. Bitte die Seite direkt in Safari öffnen (nicht aus WhatsApp/Mail heraus) und dort zum Home-Bildschirm hinzufügen.';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Keine passende Kamera gefunden. Alternativ: „Foto aufnehmen“ daneben nutzen.';
  if (n === 'NotReadableError' || n === 'AbortError') return 'Die Kamera wird gerade von einer anderen App benutzt. Andere Apps schließen und erneut versuchen.';
  if (n === 'LibLoadError') return 'Das Scan-Modul konnte nicht geladen werden (Internet? Inhaltsblocker oder Blockierungsmodus aktiv?). Alternativ: ISBN eintippen.';
  return 'Kamera nicht verfügbar: ' + errMsg(e);
}
const scanMsg = (t, cls) => { const m = $('#scanMsg'); if (m) { m.textContent = t; m.className = 'msg ' + (cls || ''); } };
async function onScanCode(isbn) {
  if (S.add.busy || S.add.tab !== 'scan') return;
  S.add.busy = true; beep();
  scanMsg('ISBN ' + isbn + ' erkannt. Suche Daten …');
  try {
    const known = [...S.books.values()].find((b) => b.isbn13 === isbn);
    if (known && S.ub.some((u) => u.book_id === known.id)) { scanMsg('Schon in deiner Bibliothek: ' + known.title, 'bad'); S.add.busy = false; setTimeout(() => { S.add.busy = false; }, 1500); return; }
    let info;
    if (known) info = { found: true, title: known.title, authors: known.authors, pages: known.pages, year: known.pub_year, publisher: known.publisher, coverPath: known.cover_path };
    else info = await api.lookupIsbn(isbn);
    S.add.last = { isbn, info, known };
    $('#scanResult').innerHTML = V.foundCard(info, isbn, !!known);
    scanMsg(info.found ? 'Gefunden. Bitte prüfen und hinzufügen.' : 'Keine Daten gefunden. Bitte ergänzen.', info.found ? 'ok' : 'bad');
  } catch (e) {
    S.add.busy = false; scanMsg('Abfrage fehlgeschlagen: ' + errMsg(e), 'bad');
  }
}

/* ---------- Anreichern (Cover & fehlende Angaben) ---------- */
// Holt Cover/Daten für ein Buch, mit bis zu 3 Versuchen und wachsender Wartezeit (Quellen drosseln gern).
async function enrichBook(b) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await api.lookupIsbn(b.isbn13, b.cover_path ? { cover: false } : {});
      const upd = {};
      if (r.coverPath && !b.cover_path) upd.cover_path = r.coverPath;
      if (r.pages && !b.pages) upd.pages = r.pages;
      if (r.publisher && !b.publisher) upd.publisher = r.publisher;
      if (r.categories && !b.categories) upd.categories = r.categories;
      if (r.year && !b.pub_year) upd.pub_year = r.year;
      const limited = r.diag && Object.values(r.diag).some((v) => /HTTP 429|HTTP 5|nicht erreichbar|Zeitüberschreitung/.test(String(v)));
      if (b.description == null && (r.description || !limited)) upd.description = r.description || ''; // '' = gesucht, keiner gefunden
      if (Object.keys(upd).length) { const [row] = await api.patch('books', { id: 'eq.' + b.id }, upd); S.books.set(b.id, row); b = row; }
      const real = Object.keys(upd).some((k) => upd[k] !== '');
      if (b.cover_path && b.pages && b.description != null) return { ok: true, changed: real };
      if (!limited) return { ok: false, changed: real }; // wirklich nichts da: kein Wiederholen
    } catch (e) { if (e.status === 401) throw e; }
    await sleep(1500 * (attempt + 1));
  }
  return { ok: false, changed: false };
}
const needsData = (b) => (!b.cover_path || !b.pages || b.description == null) && S.ub.some((u) => u.book_id === b.id);
async function enrich(out, only) {
  if (S.enriching) return; S.enriching = true;
  const say = (t) => { const o = out && out.isConnected ? out : $('#setOut') || $('#csvOut'); if (o) o.textContent = t; };
  try {
    const ids = only ? new Set(only) : null;
    const todo = [...S.books.values()].filter(needsData).filter((b) => !ids || ids.has(b.id));
    let done = 0, changed = 0, still = 0;
    for (const b of todo) {
      say('Lade Cover und Daten: ' + done + ' von ' + todo.length + ' …');
      try {
        const r = await enrichBook(b);
        if (r.changed) { changed++; if (S.loaded && done % 5 === 4) render(); }
        if (!r.ok) still++;
      } catch (e) { if (e.status === 401) break; }
      done++; await sleep(900);
    }
    say('Fertig: ' + changed + ' von ' + todo.length + ' Büchern ergänzt' + (still ? ', ' + still + ' ohne vollständige Daten (keine Quelle kennt sie oder sie drosseln gerade; später erneut versuchen).' : '.'));
    if (S.loaded) render();
  } finally { S.enriching = false; }
}
// Direkt nach dem Erfassen im Hintergrund nachladen
async function enrichSoon(book) {
  if (!book) return;
  while (S.enriching) await sleep(1500);
  await enrich(null, [book.id]);
}

/* ---------- CSV-Import ---------- */
async function importCsv(file, out) {
  const say = (t) => { out.textContent = t; };
  const rows = parseCsv(await file.text()).map(fromBookology);
  const ok = rows.filter((r) => !r.error), bad = rows.filter((r) => r.error);
  if (!ok.length) { say('Keine gültigen Zeilen gefunden. Ist es der Bookology-Export?'); return; }
  say(ok.length + ' Bücher gefunden. Importiere …');
  const books = new Map();
  ok.forEach((r) => books.set(r.book.isbn13, r.book));
  const list = [...books.values()];
  for (let i = 0; i < list.length; i += 100) { await api.upsertIgnore('books', list.slice(i, i + 100), 'isbn13'); say('Bücher: ' + Math.min(i + 100, list.length) + ' / ' + list.length); }
  await loadShared();
  const byIsbn = new Map([...S.books.values()].map((b) => [b.isbn13, b]));
  const entriesRows = ok.map((r) => ({ user_id: S.me.id, book_id: byIsbn.get(r.book.isbn13).id, ...r.entry }));
  for (let i = 0; i < entriesRows.length; i += 100) { await api.upsertIgnore('user_books', entriesRows.slice(i, i + 100), 'user_id,book_id'); say('Einträge: ' + Math.min(i + 100, entriesRows.length) + ' / ' + entriesRows.length); }
  await loadUser(S.me.id); S.viewUser = S.me.id;
  say('Fertig: ' + ok.length + ' Bücher importiert' + (bad.length ? ', ' + bad.length + ' übersprungen (' + bad.map((b) => b.title || b.error).join('; ') + ')' : '') + '. Cover werden jetzt nachgeladen …');
  render();
  await enrich(out);
}

/* ---------- Ereignisse ---------- */
document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  if (el.classList.contains('scrim') && ev.target.closest('[data-stop]')) return;
  const act = el.dataset.act, v = el.dataset.v, id = el.dataset.id;
  guard(async () => {
    switch (act) {
      case 'tab': S.tab = el.dataset.tab; savePrefs(); render(); window.scrollTo(0, 0); break;
      case 'status': S.filter.status = v; savePrefs(); render(); break;
      case 'fmt': S.filter.formats[v] = !S.filter.formats[v]; savePrefs(); render(); break;
      case 'layout': S.layout = v; savePrefs(); render(); break;
      case 'period': S.stats.period = v; S.stats.anchor = today(); savePrefs(); render(); break;
      case 'colorby': S.stats.color = v; savePrefs(); render(); break;
      case 'prev': S.stats.anchor = shiftAnchor(S.stats.period, S.stats.anchor, -1); render(); break;
      case 'next': S.stats.anchor = shiftAnchor(S.stats.period, S.stats.anchor, 1); render(); break;
      case 'reload': boot(); break;
      case 'open': openBook(id); break;
      case 'closeSheet': closeSheet(); break;
      case 'blurb': { const d = $('#blurb'); const open = d.classList.toggle('open'); el.textContent = open ? 'Weniger anzeigen' : 'Mehr anzeigen'; break; }
      case 'day': {
        const date = el.dataset.date, byId = new Map(entries().map((u) => [u.id, u]));
        openSheet(V.daySheet(S, date, dailyMap(entries(), S.logs).get(date), byId)); break;
      }
      case 'abandonopen': {
        const e = entries().find((x) => x.id === id); if (!e) break;
        openAbandon(e); break;
      }
      case 'settings': openSheet(V.settingsSheet(S)); break;
      case 'add': S.add.tab = 'scan'; S.add.busy = false; openSheet(V.addSheet(S)); break;
      case 'addtab': stopScanner(); S.add.tab = v; S.add.busy = false; openSheet(V.addSheet(S)); break;
      case 'camstart': {
        const video = $('#vid');
        try { await startScanner(video, (isbn) => guard(() => onScanCode(isbn)), (t) => scanMsg(t)); }
        catch (e) { scanMsg(cameraHelp(e), 'bad'); }
        break;
      }
      case 'discard': $('#scanResult').innerHTML = ''; S.add.busy = false; scanMsg('Bereit. Nächstes Buch scannen.'); break;
      case 'rate': {
        const n = Number(el.dataset.n), form = el.closest('form'), inp = form.elements.rating;
        inp.value = Number(inp.value) === n ? '' : n;
        $$('.stars button', form).forEach((b, i) => b.classList.toggle('on', i < Number(inp.value || 0)));
        break;
      }
      case 'logpage': {
        const inp = $(`[data-pg="${id}"]`); await saveLog(id, inp.value); render(); break;
      }
      case 'sheetlog': { await saveLog(id, $('#logpg').value); render(); openBook(id); break; }
      case 'quicklog': {
        const e = entries().find((x) => x.id === S.openId); if (!e) break;
        const cur = lastPage(S.logs, e.id);
        const target = el.dataset.n === 'done' ? (e.book.pages || cur) : cur + Number(el.dataset.n);
        await saveLog(e.id, target); render(); openBook(e.id); break;
      }
      case 'delentry': {
        if (!window.confirm('Dieses Buch aus deiner Bibliothek entfernen? Leselogs dazu werden ebenfalls gelöscht.')) break;
        await api.remove('user_books', { id: 'eq.' + id });
        S.ub = S.ub.filter((u) => u.id !== id); S.logs = S.logs.filter((l) => l.user_book_id !== id);
        closeSheet(); render(); toast('Entfernt.'); break;
      }
      case 'viewuser': {
        S.viewUser = id; const p = S.profiles.find((x) => x.id === id); S.viewName = p ? p.display_name : '';
        closeSheet(); S.loaded = false; render(); await loadUser(id); S.loaded = true; render(); break;
      }
      case 'logout': api.signOut(); closeSheet(); S.loaded = false; S.ub = []; S.logs = []; S.loginError = ''; render(); break;
      case 'export': {
        const cols = ['isbn13', 'title', 'authors', 'publisher', 'pub_year', 'pages', 'status', 'format', 'rating', 'started_at', 'finished_at', 'purchase_price', 'purchase_date', 'category', 'reading_series', 'notes'];
        download('buecher-' + today() + '.csv', toCsv(entries().map((e) => ({ ...e, ...e.book, isbn13: e.book.isbn13 })), cols)); break;
      }
      case 'enrich': await enrich($('#setOut')); break;
    }
  });
});

document.addEventListener('submit', (ev) => {
  const form = ev.target.closest('form[data-form]'); if (!form) return;
  ev.preventDefault();
  const kind = form.dataset.form, fd = new FormData(form);
  guard(async () => {
    if (kind === 'login') {
      S.loginEmail = String(fd.get('email')).trim(); S.loginBusy = true; S.loginError = ''; render();
      try { await api.signIn(String(fd.get('email')).trim(), String(fd.get('password'))); S.loginBusy = false; await boot(); }
      catch (e) { S.loginBusy = false; S.loginError = e.status === 400 ? 'E-Mail oder Passwort stimmt nicht.' : errMsg(e); render(); }
    } else if (kind === 'entry') {
      const id = form.dataset.id, e = entries().find((x) => x.id === id), val = (k) => { const s = String(fd.get(k) ?? '').trim(); return s === '' ? null : s; };
      const upd = {
        status: fd.get('status'), format: fd.get('format'), rating: val('rating') ? Number(val('rating')) : null,
        started_at: val('started_at'), finished_at: val('finished_at'), purchase_price: val('purchase_price') ? Number(val('purchase_price')) : null,
        purchase_date: val('purchase_date'), category: val('category'), reading_series: val('reading_series'), notes: val('notes')
      };
      if (upd.status === 'finished' && !upd.finished_at) upd.finished_at = today();
      if ((upd.status === 'reading' || upd.status === 'finished') && !upd.started_at) upd.started_at = upd.finished_at || today();
      await patchEntry(id, upd);
      const bk = { title: val('b_title') || e.book.title, subtitle: val('b_subtitle'), authors: val('b_authors'), pages: val('b_pages') ? Number(val('b_pages')) : null, pub_year: val('b_year') ? Number(val('b_year')) : null, publisher: val('b_publisher'), description: val('b_description') };
      if (['title', 'subtitle', 'authors', 'pages', 'pub_year', 'publisher', 'description'].some((k) => (e.book[k] ?? null) !== bk[k])) { const [row] = await api.patch('books', { id: 'eq.' + e.book.id }, bk); S.books.set(row.id, row); }
      toast('Gespeichert.'); closeSheet(); render();
    } else if (kind === 'abandon') {
      const id = form.dataset.id, e = entries().find((x) => x.id === id); if (!e) return;
      const date = String(fd.get('date') || today());
      const upd = { status: 'abandoned', finished_at: date, abandon_reason: String(fd.get('reason') || '') || null, notes: String(fd.get('note') || '').trim() || null };
      const st = String(fd.get('started') || ''); if (st && st <= date) upd.started_at = st;
      if (!e.started_at && !upd.started_at) upd.started_at = date;
      const rt = String(fd.get('rating') || ''); if (rt) upd.rating = Number(rt);
      if (form.dataset.tracked !== '1') {
        // Ohne Lese-Log: Seiten als einen Log-Eintrag am Abbruchtag erfassen
        const pg = Math.round(Number(fd.get('page')) || 0);
        if (pg > 0) {
          const [row] = await api.upsert('reading_logs', [{ user_id: S.me.id, user_book_id: id, log_date: date, page_to: pg, pages_read: pg }], 'user_book_id,log_date');
          const i = S.logs.findIndex((l) => l.user_book_id === id && l.log_date === date);
          if (i >= 0) S.logs[i] = row; else S.logs.push(row);
        }
      }
      await patchEntry(id, upd);
      closeSheet(); render(); toast('Als abgebrochen gespeichert.');
    } else if (kind === 'manual-isbn') {
      const isbn = normalizeIsbn(fd.get('isbn')); if (!isbn13Valid(isbn)) { scanMsg('Ungültige ISBN.', 'bad'); return; }
      await onScanCode(isbn);
    } else if (kind === 'found') {
      const { isbn, info, known } = S.add.last;
      const book = { isbn13: isbn, title: String(fd.get('title')).trim(), authors: String(fd.get('authors')).trim() || null, pages: Number(fd.get('pages')) || null, pub_year: Number(fd.get('year')) || null,
        subtitle: info.subtitle, publisher: info.publisher, language: info.language, categories: info.categories, description: info.description, cover_path: info.coverPath || (known && known.cover_path) || null };
      const r = await addBook(book, S.add.defStatus, S.add.defFormat);
      $('#scanResult').innerHTML = ''; S.add.busy = false;
      scanMsg(r.dup ? 'Schon in deiner Bibliothek.' : 'Hinzugefügt: ' + book.title + '. Nächstes Buch scannen.', 'ok');
      render();
    } else if (kind === 'bulk') {
      const list = extractIsbns(fd.get('isbns')), out = $('#bulkOut');
      if (!list.length) { out.textContent = 'Keine gültigen ISBNs gefunden.'; return; }
      let added = 0, dup = 0, unknown = [];
      for (let i = 0; i < list.length; i++) {
        out.textContent = 'Verarbeite ' + (i + 1) + ' von ' + list.length + ' …';
        const isbn = list[i], known = [...S.books.values()].find((b) => b.isbn13 === isbn);
        let info = null;
        if (!known) { try { info = await api.lookupIsbn(isbn); } catch { info = null; } await sleep(300); }
        const book = known ? known : { isbn13: isbn, title: info && info.found ? info.title : '[ergänzen] ISBN ' + isbn, subtitle: info && info.subtitle, authors: info && info.authors, publisher: info && info.publisher,
          pub_year: info && info.year, pages: info && info.pages, language: info && info.language, categories: info && info.categories, description: info && info.description, cover_path: info && info.coverPath };
        if (!known && !(info && info.found)) unknown.push(isbn);
        const r = await addBook(known ? { isbn13: isbn } : book, S.add.defStatus, S.add.defFormat);
        if (r.dup) dup++; else added++;
      }
      out.textContent = added + ' hinzugefügt' + (dup ? ', ' + dup + ' schon vorhanden' : '') + (unknown.length ? '. Ohne Daten (bitte ergänzen): ' + unknown.join(', ') : '.');
      render();
    } else if (kind === 'profile') {
      const name = String(fd.get('name')).trim(); await api.patch('profiles', { id: 'eq.' + S.me.id }, { display_name: name });
      S.me.name = name; const p = S.profiles.find((x) => x.id === S.me.id); if (p) p.display_name = name; toast('Name gespeichert.'); render();
    }
  });
});

// Foto verkleinern (längste Seite max. px) und als JPEG liefern
async function shrinkImage(file, max) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Bild nicht lesbar')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
  } finally { URL.revokeObjectURL(url); }
}
document.addEventListener('change', (ev) => {
  const t = ev.target;
  if (t.name === 'status' && t.value === 'abandoned' && t.closest('form[data-form=entry]')) {
    const e = entries().find((x) => x.id === t.closest('form').dataset.id);
    if (e && e.status !== 'abandoned') { openAbandon(e); return; }
  }
  if (t.id === 'defStatus') S.add.defStatus = t.value;
  else if (t.id === 'defFormat') S.add.defFormat = t.value;
  else if (t.id === 'photoIn' && t.files[0]) {
    guard(async () => { scanMsg('Foto wird ausgewertet …'); const isbn = await decodePhoto(t.files[0]); t.value = ''; if (isbn) await onScanCode(isbn); else scanMsg('Im Foto wurde kein Barcode erkannt. Näher ran, scharf stellen.', 'bad'); });
  } else if (t.dataset && t.dataset.cover && t.files[0]) {
    const file = t.files[0], bid = t.dataset.cover;
    guard(async () => {
      toast('Cover wird hochgeladen …');
      const blob = await shrinkImage(file, 700);
      const b = S.books.get(bid); const path = b.isbn13 + '-' + Date.now().toString(36) + '.jpg';
      await api.uploadCover(path, blob);
      const [row] = await api.patch('books', { id: 'eq.' + bid }, { cover_path: path, cover_color: null });
      S.books.set(bid, row); colorTried.delete(bid);
      toast('Cover gespeichert.'); render(); if (S.openId) openBook(S.openId);
    });
  } else if (t.id === 'csvIn' && t.files[0]) {
    guard(async () => { await importCsv(t.files[0], $('#csvOut')); t.value = ''; });
  }
});
document.addEventListener('input', debounce((ev) => {
  if (ev.target.id === 'q') { S.filter.q = ev.target.value; renderList(); }
}, 150));

window.addEventListener('resize', debounce(() => { if (S.loaded && S.tab === 'shelf' && S.layout === 'shelf') renderList(); }, 200));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
boot();
