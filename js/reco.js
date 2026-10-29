// Lesetipps (Prototyp, ohne KI): erkennt aktuelle Lesephasen und sortiert das ungelesene Regal danach.
import { today, diffDays } from './util.js';

const STOP = new Set(['roman', 'belletristik', 'literatur', 'allgemein', 'ohne kategorie', 'fiction', 'general', 'german', 'deutsch']);
const PHASE_DAYS = 120;   // so dicht beieinander müssen Bücher eines Themas gelesen sein
const ACTIVE_DAYS = 90;   // so jung muss das jüngste Buch sein, damit die Phase „aktuell“ ist

const split = (s) => String(s || '').split(/[;,/|]+/).map((x) => x.trim()).filter(Boolean);
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ');

// Themen-Merkmale eines Eintrags: Kategorie, Lesereihe, Fachgebiete (falls vorhanden) und Autor:in
export function tokensOf(e) {
  const out = new Map();
  const add = (label, kind) => { const k = kind + ':' + norm(label); if (label && !STOP.has(norm(label)) && !out.has(k)) out.set(k, { k, label, kind }); };
  split(e.category).forEach((t) => add(t, 'thema'));
  split(e.reading_series).forEach((t) => add(t, 'thema'));
  const subj = e.book.subjects;
  (Array.isArray(subj) ? subj : split(subj)).forEach((t) => add(t, 'thema'));
  split(e.book.categories).forEach((t) => add(t, 'thema'));
  split(e.book.authors).forEach((t) => add(t, 'autor'));
  return [...out.values()];
}

// Gewicht eines gelesenen Buchs: Sterne bestimmen, wie stark es zählt
const wOf = (e) => (e.status === 'abandoned' ? 0.1 : { 1: 0.1, 2: 0.4, 3: 0.8, 4: 1.2, 5: 1.6 }[e.rating] || 0.8);
const dateOf = (e) => e.finished_at || e.started_at || null;
const stars = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export function analyze(entries) {
  const now = today();
  const read = entries.filter((e) => ['finished', 'abandoned', 'reading'].includes(e.status) && dateOf(e));
  const byTok = new Map();
  for (const e of read) for (const t of tokensOf(e)) {
    if (!byTok.has(t.k)) byTok.set(t.k, { ...t, books: [] });
    byTok.get(t.k).books.push(e);
  }

  // Lesephasen: Themen mit mindestens 2 Büchern innerhalb von PHASE_DAYS
  const phases = [];
  for (const t of byTok.values()) {
    if (t.kind !== 'thema' || t.books.length < 2) continue;
    const bs = [...t.books].sort((a, b) => (dateOf(a) < dateOf(b) ? -1 : 1));
    let best = [];
    for (let i = 0; i < bs.length; i++) {
      const win = bs.filter((x) => { const d = diffDays(dateOf(bs[i]), dateOf(x)); return d >= 0 && d <= PHASE_DAYS; });
      if (win.length > best.length) best = win;
    }
    if (best.length < 2) continue;
    const last = dateOf(best[best.length - 1]), ageDays = diffDays(last, now);
    const rated = best.filter((x) => x.rating).map((x) => x.rating);
    const decay = Math.exp(-Math.max(0, ageDays) / 90);
    phases.push({
      key: t.k, label: t.label, books: best, from: dateOf(best[0]), to: last, ageDays, active: ageDays <= ACTIVE_DAYS,
      avg: stars(rated), strength: best.reduce((s, x) => s + wOf(x), 0) * decay
    });
  }
  phases.sort((a, b) => b.strength - a.strength);

  // Autor:innen, die du magst (nur gelesene Bücher mit Sternen, ≥ 4 im Schnitt)
  const authors = new Map();
  for (const t of byTok.values()) if (t.kind === 'autor') {
    const rated = t.books.filter((x) => x.rating && x.status !== 'abandoned').map((x) => x.rating);
    const dropped = t.books.some((x) => x.status === 'abandoned');
    if (rated.length) authors.set(t.k, { label: t.label, avg: stars(rated), n: rated.length, dropped });
    else if (dropped) authors.set(t.k, { label: t.label, avg: 0, n: 0, dropped });
  }

  // Kandidaten: ungelesene Bücher im Regal / auf der Wunschliste
  const phaseBy = new Map(phases.map((p) => [p.key, p]));
  const picks = [];
  for (const e of entries.filter((x) => x.status === 'shelf' || x.status === 'wishlist')) {
    let score = 0; const reasons = [];
    for (const t of tokensOf(e)) {
      const p = phaseBy.get(t.k);
      if (p) { score += p.strength * (p.active ? 1 : 0.4); reasons.push({ type: 'phase', text: `${p.label}: ${p.books.length} Bücher${p.avg ? ', Ø ' + p.avg.toFixed(1).replace('.', ',') + ' ★' : ''}${p.active ? '' : ' (länger her)'}` }); }
      const a = authors.get(t.k);
      if (a && a.n && a.avg >= 4) { score += (a.avg - 3) * a.n * 0.8; reasons.push({ type: 'autor', text: `${a.label}: ${a.n} ${a.n === 1 ? 'Buch' : 'Bücher'} von dir mit Ø ${a.avg.toFixed(1).replace('.', ',')} ★` }); }
      if (a && a.dropped && (!a.n || a.avg < 3)) { score -= 2; reasons.push({ type: 'warn', text: `${a.label}: ein Buch hast du abgebrochen` }); }
    }
    if (e.status === 'wishlist') score += 0.3;
    picks.push({ e, score, reasons });
  }
  picks.sort((a, b) => b.score - a.score);

  // Datenlage: wie viel Substanz hat die Auswertung?
  const done = entries.filter((e) => e.status === 'finished' || e.status === 'abandoned');
  const info = {
    total: entries.length, done: done.length,
    rated: done.filter((e) => e.rating).length,
    themed: entries.filter((e) => tokensOf(e).some((t) => t.kind === 'thema')).length
  };
  return { phases, picks, authors, info };
}
