// Statistik-Berechnung (reine Funktionen, ohne Oberfläche)
import { addDays, diffDays, mondayOf, parseDate, fmtDate } from './util.js';

export const CAT_PALETTE = ['#2F5D4E', '#8A3B33', '#8C6213', '#3F5B7A', '#5A3A55', '#6B7B3A'];
export const OTHER_COLOR = '#8A8170';
export const FORMAT_COLORS = { hardcover: '#8A3B33', softcover: '#3F5B7A', ebook: '#2F5D4E', audio: '#8C6213' };
export const FORMAT_LABELS = { hardcover: 'Hardcover', softcover: 'Softcover', ebook: 'E-Book', audio: 'Hörbuch' };
export const catOf = (u) => (u.category && u.category.trim()) || 'Ohne Kategorie';

// Tagesseiten je Tag: aus den Logs; bei beendeten Büchern ohne Logs gleichmäßig über Lesezeitraum geschätzt.
export function dailyMap(entries, logs) {
  const byId = new Map(entries.map((u) => [u.id, u]));
  const withLog = new Set(logs.map((l) => l.user_book_id));
  const map = new Map();
  const add = (date, pages, u, est) => {
    if (!(pages > 0)) return;
    let d = map.get(date);
    if (!d) { d = { pages: 0, cats: {}, fmts: {}, est: 0 }; map.set(date, d); }
    d.pages += pages; d.est += est ? pages : 0;
    const c = catOf(u), f = u.format;
    d.cats[c] = (d.cats[c] || 0) + pages;
    d.fmts[f] = (d.fmts[f] || 0) + pages;
  };
  for (const l of logs) { const u = byId.get(l.user_book_id); if (u) add(l.log_date, l.pages_read, u, false); }
  for (const u of entries) {
    if (withLog.has(u.id) || u.status !== 'finished' || !u.started_at || !u.finished_at || !(u.book && u.book.pages)) continue;
    const n = Math.max(1, diffDays(u.started_at, u.finished_at) + 1);
    for (let i = 0; i < n; i++) add(addDays(u.started_at, i), u.book.pages / n, u, true);
  }
  return map;
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

export function summarize(entries, daily, range) {
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
    .map((u) => ({ u, perDay: u.book.pages / Math.max(1, diffDays(u.started_at, u.finished_at) + 1), days: Math.max(1, diffDays(u.started_at, u.finished_at) + 1) }))
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
