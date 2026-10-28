// Kleine Hilfsfunktionen

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

export const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
export const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

const p2 = (n) => String(n).padStart(2, '0');
// Datumswerte sind immer lokale Kalendertage im Format YYYY-MM-DD
export const fmtDate = (d) => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
export const today = () => fmtDate(new Date());
export const parseDate = (s) => new Date(String(s).slice(0, 10) + 'T12:00:00');
export const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); };
export const diffDays = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 864e5);
export const deDate = (s) => (s ? parseDate(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
export const deShort = (s) => (s ? parseDate(s).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' }) : '');
export const mondayOf = (s) => { const d = parseDate(s); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return fmtDate(d); };
export const isoWeek = (s) => {
  const d = parseDate(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const w1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - w1) / 864e5 - 3 + ((w1.getDay() + 6) % 7)) / 7);
};
export const num = (n, digits = 0) => Number(n || 0).toLocaleString('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [138, 129, 112];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Lesbare Textfarbe auf einem Hintergrund
export const textOn = (hex) => (luminance(hex) > 0.38 ? '#1F1B16' : '#F4EFE6');

export function isbn13Valid(s) {
  if (!/^97[89]\d{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}
export function normalizeIsbn(raw) {
  const s = String(raw || '').replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(s)) {
    const core = '978' + s.slice(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
    return core + ((10 - (sum % 10)) % 10);
  }
  return s;
}
export function extractIsbns(text) {
  const out = [];
  for (const part of String(text || '').split(/[\n\r,;\t]+/)) {
    const m = /(?:97[89][\d -]{10,16}|\b\d{9}[\dXx]\b)/.exec(part);
    if (!m) continue;
    const n = normalizeIsbn(m[0]);
    if (isbn13Valid(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function download(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
