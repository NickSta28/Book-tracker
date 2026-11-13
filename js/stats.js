// Statistik-Berechnung (reine Funktionen, ohne Oberfläche)
import { addDays, diffDays, mondayOf, parseDate, fmtDate } from './util.js';

export const CAT_PALETTE = ['#2F5D4E', '#8A3B33', '#8C6213', '#3F5B7A', '#5A3A55', '#6B7B3A'];
export const OTHER_COLOR = '#8A8170';
export const FORMAT_COLORS = { hardcover: '#8A3B33', softcover: '#3F5B7A', ebook: '#2F5D4E', audio: '#8C6213' };
export const FORMAT_LABELS = { hardcover: 'Hardcover', softcover: 'Softcover', ebook: 'E-Book', audio: 'Hörbuch' };
export const catOf = (u) => (u.category && u.category.trim()) || 'Ohne Kategorie';

// Tagesseiten je Tag.
// Grundsatz:
//  - Erfasste Lesetage (Logs) zählen tagesgenau.
//  - Erster Log mindestens 3 Tage nach dem Beginn = Nachtrag: seine Seiten werden auf Beginn bis Log-Tag verteilt.
//  - Sind Beginn und Ende bekannt, gilt dieser Zeitraum: Logs außerhalb werden ignoriert, fehlende Seiten
//    (Seitenzahl bzw. Abbruchseite minus geloggte Seiten) gleichmäßig auf die Tage ohne Log verteilt.
//  - Ein einzelner Log genau am letzten Tag zählt nicht als Tracking (wird ebenfalls verteilt).
//  Verteilte Seiten sind als geschätzt markiert.
const CATCHUP_DAYS = 3;
export function dailyMap(entries, logs) {
  const map = new Map();
  const add = (date, pages, u, est) => {
    if (!(pages > 0)) return;
    let d = map.get(date);
    if (!d) { d = { pages: 0, cats: {}, fmts: {}, est: 0, books: {} }; map.set(date, d); }
    d.pages += pages; d.est += est ? pages : 0;
    const bk = d.books[u.id] || (d.books[u.id] = { pages: 0, est: false }); bk.pages += pages; if (est) bk.est = true;
    const c = catOf(u), f = u.format;
    d.cats[c] = (d.cats[c] || 0) + pages;
    d.fmts[f] = (d.fmts[f] || 0) + pages;
  };
  const spreadOver = (from, to, pages, u, skip) => {
    const days = [];
    for (let i = 0, n = diffDays(from, to) + 1; i < n; i++) { const d = addDays(from, i); if (!skip || !skip.has(d)) days.push(d); }
    if (days.length) for (const d of days) add(d, pages / days.length, u, true);
    return days;
  };
  const logsBy = new Map();
  for (const l of logs) { if (!logsBy.has(l.user_book_id)) logsBy.set(l.user_book_id, []); logsBy.get(l.user_book_id).push(l); }

  for (const u of entries) {
    const ls = (logsBy.get(u.id) || []).slice().sort((a, b) => (a.log_date < b.log_date ? -1 : 1));
    const ranged = (u.status === 'finished' || u.status === 'abandoned') && u.started_at && u.finished_at && u.started_at <= u.finished_at;
    let inside = ranged ? ls.filter((l) => l.log_date >= u.started_at && l.log_date <= u.finished_at) : ls;
    if (ranged && ls.length === 1 && inside.length === 1 && inside[0].log_date === u.finished_at && u.started_at < u.finished_at) inside = [];
    const covered = new Set();
    let logged = 0;
    if (inside.length && u.started_at && diffDays(u.started_at, inside[0].log_date) >= CATCHUP_DAYS) {
      const first = inside[0];
      spreadOver(u.started_at, first.log_date, first.pages_read, u).forEach((d) => covered.add(d));
      logged += first.pages_read || 0;
      inside = inside.slice(1);
    }
    for (const l of inside) { add(l.log_date, l.pages_read, u, false); covered.add(l.log_date); logged += l.pages_read || 0; }
    if (!ranged) continue;
    const target = u.status === 'finished' ? (u.book && u.book.pages) || 0 : Math.max(0, ...ls.map((l) => l.page_to || 0));
    const rest = target - logged;
    if (rest > 0) spreadOver(u.started_at, u.finished_at, rest, u, covered);
  }
  return map;
}

// Lesetempo eines Buchs, passend zum Kalender: Seiten geteilt durch die Tage, an denen (erfasst oder geschätzt) gelesen wurde
export function bookPace(u, logs) {
  const m = dailyMap([u], logs.filter((l) => l.user_book_id === u.id));
  let pages = 0, est = false;
  for (const d of m.values()) { pages += d.pages; if (d.est) est = true; }
  const days = m.size;
  return { pages: Math.round(pages), days, perDay: days ? pages / days : 0, est };
}

export function periodRange(period, anchor) {
  const d = parseDate(anchor);
  if (period === 'week') { const from = mondayOf(anchor); return { from, to: addDays(from, 6) }; }
  if (period === 'year') return { from: d.getFullYear() + '-01-01', to: d.getFullYear() + '-12-31' };
  const from = fmtDate(new Date(d.getFullYear(), d.getMonth(), 1));
  const to = fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  return { from, to };
}
export function shiftAnchor(period, anchor, dir) {
  const d = parseDate(anchor);
  if (period === 'week') return addDays(anchor, 7 * dir);
  if (period === 'year') return fmtDate(new Date(d.getFullYear() + dir, 0, 1));
  return fmtDate(new Date(d.getFullYear(), d.getMonth() + dir, 1));
}

const inRange = (s, r) => !!s && s >= r.from && s <= r.to;

export function summarize(entries, daily, range, logs = []) {
  let pages = 0, readDays = 0;
  const cats = {}, fmts = {};
  for (const [date, d] of daily) {
    if (!inRange(date, range)) continue;
    pages += d.pages; readDays++;
    for (const k in d.cats) cats[k] = (cats[k] || 0) + d.cats[k];
    for (const k in d.fmts) fmts[k] = (fmts[k] || 0) + d.fmts[k];
  }
  const finished = entries.filter((u) => u.status === 'finished' && inRange(u.finished_at, range));
  const rated = finished.filter((u) => u.rating);
  const spend = entries.filter((u) => inRange(u.purchase_date, range) && u.purchase_price).reduce((s, u) => s + Number(u.purchase_price), 0);
  const paceList = finished
    .filter((u) => u.started_at && u.book && u.book.pages)
    .map((u) => { const p = bookPace(u, logs); return { u, perDay: p.perDay, days: p.days, est: p.est }; })
    .filter((p) => p.days > 0)
    .sort((a, b) => b.perDay - a.perDay);
  return {
    pages: Math.round(pages), readDays, finished,
    perReadDay: readDays ? pages / readDays : 0,
    avgRating: rated.length ? rated.reduce((s, u) => s + u.rating, 0) / rated.length : 0,
    spend, cats, fmts,
    fastest: paceList[0] || null, slowest: paceList.length > 1 ? paceList[paceList.length - 1] : null
  };
}

// Farben je Kategorie festlegen: nach Seiten sortiert, Rest als "Sonstige"
export function categoryColors(entries) {
  const total = {};
  for (const u of entries) total[catOf(u)] = (total[catOf(u)] || 0) + ((u.book && u.book.pages) || 1);
  const names = Object.keys(total).sort((a, b) => total[b] - total[a]);
  const map = {};
  names.forEach((n, i) => { map[n] = i < CAT_PALETTE.length ? CAT_PALETTE[i] : OTHER_COLOR; });
  return map;
}

export function lastPage(logs, userBookId) {
  let best = null;
  for (const l of logs) if (l.user_book_id === userBookId && (!best || l.log_date > best.log_date)) best = l;
  return best ? best.page_to : 0;
}
