// CSV lesen (Bookology-Export) und schreiben
import { fmtDate, normalizeIsbn, isbn13Valid } from './util.js';

export function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
}

const localDay = (iso) => (iso ? fmtDate(new Date(iso)) : null);

// Aus einer Bookology-Zeile Buch- und Eintragsdaten machen
export function fromBookology(r) {
  const isbn = normalizeIsbn(r.isbn);
  if (!isbn13Valid(isbn)) return { error: 'Ungültige ISBN: ' + (r.isbn || '(leer)'), title: r.title };
  const tidy = (s) => String(s || '').replace(/[\u0080-\u009F\u00AD\u200B]/g, '').replace(/\s*\((German|English|Deutsche|Englische) (Edition|Ausgabe)\)/i, '').trim();
  let title = tidy((r.title || '').split(' | ')[0]);
  let subtitle = tidy(r.subtitle);
  if (title.length > 70 && title.includes(': ')) {
    const i = title.indexOf(': ');
    if (!subtitle) subtitle = title.slice(i + 2).trim();
    title = title.slice(0, i).trim();
  }
  const ebook = /e-?book/i.test(r.publisher || '') || /\(German Edition\)|Kindle/i.test(r.title || '');
  const started = localDay(r.start_date), finished = localDay(r.finish_date);
  const rating = Math.round(parseFloat(r.rating));
  const price = parseFloat(String(r.purchase_price_amount || '').replace(',', '.'));
  return {
    book: {
      isbn13: isbn, title: title || 'ISBN ' + isbn, subtitle: subtitle || null,
      authors: (r.authors || '').split(';').map((s) => s.trim()).filter(Boolean).join(', ') || null,
      publisher: r.publisher || null,
      pub_year: parseInt(r.publish_year, 10) || null,
      pages: parseInt(r.printed_pages, 10) || null
    },
    entry: {
      status: finished ? 'finished' : started ? 'reading' : 'shelf',
      format: ebook ? 'ebook' : 'softcover',
      rating: rating >= 1 && rating <= 5 ? rating : null,
      review: r.review || null,
      notes: r.notes || null,
      purchase_price: Number.isFinite(price) ? price : null,
      purchase_date: localDay(r.purchase_date),
      started_at: started, finished_at: finished
    }
  };
}

const q = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export function toCsv(rows, columns) {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => q(r[c])).join(','))].join('\n');
}
