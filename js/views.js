// Darstellung: baut HTML aus dem Zustand. Alle Texte werden maskiert.
import { esc, hashStr, textOn, luminance, MONTHS, MONTHS_SHORT, deDate, deShort, num, isoWeek, parseDate, addDays, diffDays, today } from './util.js';
import { coverUrl } from './api.js';
import { analyze } from './reco.js';
import { dailyMap, periodRange, summarize, categoryColors, catOf, FORMAT_COLORS, FORMAT_LABELS, OTHER_COLOR, lastPage } from './stats.js';

// Feste Kategorien (je Buch genau eine); eigene, ältere Werte bleiben auswählbar
export const CATEGORY_GROUPS = {
  Literatur: ['Gegenwartsliteratur', 'Klassiker und Moderne', 'Lyrik', 'Essay', 'Erzählungen', 'Literatur in Übersetzung'],
  Genre: ['Krimi und Thriller', 'Historischer Roman', 'SciFi, Dystopie und Fantasy', 'Humor und Satire'],
  Sachbuch: ['Geschichte', 'Biografie und Memoir', 'Politik und Gesellschaft', 'Philosophie', 'Wirtschaft und Finanzen', 'Naturwissenschaft', 'Reise und Natur', 'Sport', 'Kunst und Kultur'],
  Sonstiges: ['Kinderbuch', 'Ratgeber', 'Kochen und Wein', 'Comic und Graphic Novel']
};
function catOptions(cur) {
  const all = Object.values(CATEGORY_GROUPS).flat();
  const own = cur && !all.includes(cur) ? `<optgroup label="Bisher"><option value="${esc(cur)}" selected>${esc(cur)}</option></optgroup>` : '';
  return own + Object.entries(CATEGORY_GROUPS).map(([g, l]) => `<optgroup label="${g}">${l.map((c) => `<option value="${esc(c)}" ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('')}</optgroup>`).join('');
}
export const STATUS = { wishlist: 'Wunschliste', shelf: 'Regal', reading: 'Lese ich', finished: 'Gelesen', abandoned: 'Abgebrochen' };
const FALLBACK = ['#2F5D4E', '#8A3B33', '#3F5B7A', '#5A3A55', '#4B5D3A', '#6B4A2E', '#2B2B2B', '#8C6213'];
export const colorOf = (b) => b.cover_color || FALLBACK[hashStr(b.title || '') % FALLBACK.length];

const ICON = {
  books: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4v16M10 4v16M15.5 5.5l3.5 14"/></svg>',
  chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M12 20V5M19 20v-6"/></svg>',
  pen: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1-4L16 5l3 3L8 19z"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  scan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9v6M11.5 9v6M15 9v6"/></svg>'
};

export function coverHtml(b, small) {
  const bg = colorOf(b), fg = textOn(bg);
  const img = b.cover_path ? `<img src="${esc(coverUrl(b.cover_path))}" alt="" loading="lazy" onerror="this.remove()">` : '';
  return `<div class="cover" style="background:${bg};color:${fg}">${img}<span class="ct">${esc(b.title)}</span>${small ? '' : `<span class="ca">${esc(b.authors || '')}</span>`}</div>`;
}

export function loginView(error, busy, email) {
  return `<form class="login" data-form="login" autocomplete="on">
    <h1>Bücher</h1>
    <p class="sub">Bitte anmelden.</p>
    <div class="form">
      <label>E-Mail<input name="email" type="email" autocomplete="username" required inputmode="email" value="${esc(email || '')}"></label>
      <label>Passwort<input name="password" type="password" autocomplete="current-password" required></label>
    </div>
    <p class="msg bad" role="alert">${esc(error || '')}</p>
    <div class="btns"><button class="btn grow" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Anmelden …' : 'Anmelden'}</button></div>
  </form>`;
}

export function header(S, title, subtitle) {
  const initial = esc((S.me && S.me.name ? S.me.name : '?').trim().charAt(0).toUpperCase() || '?');
  return `<div class="top"><div><h1>${esc(title)}</h1><p class="sub">${esc(subtitle || '')}</p></div>
    <button class="icon-btn" data-act="settings" aria-label="Einstellungen und Konto"><span class="sans" style="font-weight:700">${initial}</span></button></div>
    ${S.viewUser !== S.me.id ? `<p class="sub" style="color:var(--red)">Du siehst die Bibliothek von ${esc(S.viewName)} (nur Ansicht).</p>` : ''}`;
}

export function navView(tab) {
  const item = (id, label, icon) => `<button data-act="tab" data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>${ICON[icon]}${label}</button>`;
  return `<nav class="nav"><div class="nav-in">${item('shelf', 'Bibliothek', 'books')}${item('stats', 'Statistik', 'chart')}${item('reading', 'Lesen', 'pen')}${item('reco', 'Tipps', 'star')}</div></nav>`;
}
export const fabView = () => `<button class="fab" data-act="add" aria-label="Buch hinzufügen">${ICON.plus}</button>`;

/* ---------- Bibliothek ---------- */
export function shelfShell(S, counts) {
  const chip = (id, l) => `<button class="chip" data-act="status" data-v="${id}" aria-pressed="${S.filter.status === id}">${l}${counts[id] != null ? ' · ' + counts[id] : ''}</button>`;
  const tg = (k, l) => `<button class="tg" data-act="fmt" data-v="${k}" aria-pressed="${!!S.filter.formats[k]}"><i></i>${l}</button>`;
  return `${header(S, 'Bibliothek', counts.all + ' Bücher')}
  <div class="row" style="justify-content:space-between;align-items:center;margin-top:12px;gap:8px">
    <div class="seg" role="group" aria-label="Ansicht"><button data-act="layout" data-v="shelf" aria-pressed="${S.layout === 'shelf'}">Regal</button><button data-act="layout" data-v="grid" aria-pressed="${S.layout === 'grid'}">Raster</button></div>
    <div class="toggles">${tg('paper', 'Papier')}${tg('ebook', 'E-Book')}${tg('audio', 'Hörbuch')}</div>
  </div>
  <label class="search">${ICON.search}<span class="sr">Suche</span><input id="q" type="search" placeholder="Titel, Autor:in, ISBN" value="${esc(S.filter.q)}" autocomplete="off"></label>
  <div class="chips" role="group" aria-label="Status">${chip('all', 'Alle')}${chip('reading', 'Lese ich')}${chip('finished', 'Gelesen')}${chip('shelf', 'Regal')}${chip('wishlist', 'Wunschliste')}${chip('abandoned', 'Abgebrochen')}</div>
  <div id="list"></div>`;
}

export function shelfList(S, entries, width) {
  if (!entries.length) {
    return `<div class="empty"><b>Noch nichts hier</b>${S.ub.length ? 'Kein Buch passt zu den Filtern.' : 'Tippe auf +, um das erste Buch zu erfassen oder deine Bookology-CSV zu importieren.'}</div>`;
  }
  if (S.layout === 'grid') {
    return `<div class="grid">${entries.map((e) => `<button class="card" data-act="open" data-id="${e.id}" aria-label="${esc(e.book.title)}">${coverHtml(e.book)}<div class="nm">${esc(e.book.title)}</div><div class="mt">${esc(metaLine(e))}</div></button>`).join('')}</div>`;
  }
  const rows = []; let cur = [], used = 0;
  const items = entries.map((e) => {
    const pages = Math.max(60, Math.min(900, e.book.pages || 250));
    const w = Math.round(20 + pages / 528 * 22);
    const h = Math.round(150 + Math.min(pages, 600) / 600 * 50 + (hashStr(e.book.title) % 16));
    return { e, w, h };
  });
  for (const it of items) {
    if (used + it.w + 2 > width && cur.length) { rows.push(cur); cur = []; used = 0; }
    cur.push(it); used += it.w + 2;
  }
  if (cur.length) rows.push(cur);
  return rows.map((r) => `<div class="shelf-row"><div class="books">${r.map(({ e, w, h }) => {
    const bg = colorOf(e.book), fg = textOn(bg), light = luminance(bg) > 0.7;
    return `<button class="spine${light ? ' light' : ''}" data-act="open" data-id="${e.id}" aria-label="${esc(e.book.title)}, ${esc(e.book.authors || '')}" style="width:${w}px;height:${h}px;background:${bg};color:${fg}">${e.status === 'reading' ? '<span class="mark"></span>' : ''}<span class="t" style="max-height:${h - 44}px;font-family:${hashStr(e.book.title) % 2 ? 'var(--serif)' : 'var(--sans)'}">${esc(e.book.title)}</span><span class="dot"></span></button>`;
  }).join('')}</div><div class="board"></div></div>`).join('') +
    `<p class="note">Rückenfarbe aus dem Cover, Dicke nach Seitenzahl, rotes Lesezeichen = lese ich gerade.</p>`;
}
function metaLine(e) {
  if (e.status === 'finished') return (e.rating ? '★'.repeat(e.rating) + ' · ' : '') + (e.book.pages || '?') + ' S.';
  if (e.status === 'reading') { return STATUS.reading + (e.book.pages ? ' · ' + e.progress + ' %' : ''); }
  return STATUS[e.status] + (e.book.pages ? ' · ' + e.book.pages + ' S.' : '');
}

/* ---------- Statistik ---------- */
export function statsView(S, entries) {
  const st = S.stats, range = periodRange(st.period, st.anchor);
  const daily = dailyMap(entries, S.logs);
  const sum = summarize(entries, daily, range);
  const ccolors = categoryColors(entries);
  const label = st.period === 'week' ? `KW ${isoWeek(range.from)} · ${deShort(range.from)} – ${deDate(range.to)}`
    : st.period === 'year' ? String(parseDate(st.anchor).getFullYear())
    : MONTHS[parseDate(st.anchor).getMonth()] + ' ' + parseDate(st.anchor).getFullYear();
  const seg = (v, l) => `<button data-act="period" data-v="${v}" aria-pressed="${st.period === v}">${l}</button>`;
  const colorBy = st.color;
  const keyColor = (d) => {
    const src = colorBy === 'format' ? d.fmts : d.cats;
    let best = null, bv = -1;
    for (const k in src) if (src[k] > bv) { bv = src[k]; best = k; }
    return colorBy === 'format' ? (FORMAT_COLORS[best] || OTHER_COLOR) : (ccolors[best] || OTHER_COLOR);
  };
  const share = colorBy === 'format' ? sum.fmts : sum.cats;
  const total = Object.values(share).reduce((a, b) => a + b, 0);
  const names = Object.keys(share).sort((a, b) => share[b] - share[a]);
  const colOf = (k) => (colorBy === 'format' ? FORMAT_COLORS[k] : ccolors[k]) || OTHER_COLOR;
  const nameOf = (k) => (colorBy === 'format' ? FORMAT_LABELS[k] || k : k);

  let chart = '';
  if (st.period === 'month') {
    const first = parseDate(range.from), n = parseDate(range.to).getDate(), off = (first.getDay() + 6) % 7;
    let cells = '';
    for (let i = 0; i < off; i++) cells += '<div class="d off"></div>';
    for (let d = 1; d <= n; d++) {
      const date = addDays(range.from, d - 1), dd = daily.get(date);
      if (!dd) { cells += `<div class="d">${d}</div>`; continue; }
      const a = dd.pages < 20 ? 0.45 : dd.pages < 45 ? 0.72 : 1;
      const bg = keyColor(dd);
      cells += `<button class="d on" data-act="day" data-date="${date}" aria-label="${d}. – ${Math.round(dd.pages)} Seiten" style="background:${bg};color:${textOn(bg)};--a:${a}">${d}</button>`;
    }
    chart = `<h3 class="sec">Lesekalender</h3><div class="cal">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((w) => `<div class="wd">${w}</div>`).join('')}${cells}</div>`;
  } else {
    const bars = [];
    if (st.period === 'week') {
      for (let i = 0; i < 7; i++) { const date = addDays(range.from, i), dd = daily.get(date); bars.push({ l: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'][i], v: dd ? dd.pages : 0, date }); }
    } else {
      const y = parseDate(st.anchor).getFullYear();
      for (let m = 0; m < 12; m++) {
        let v = 0; const pre = y + '-' + String(m + 1).padStart(2, '0');
        for (const [date, d] of daily) if (date.startsWith(pre)) v += d.pages;
        bars.push({ l: MONTHS_SHORT[m], v });
      }
    }
    const mx = Math.max(1, ...bars.map((b) => b.v));
    chart = `<h3 class="sec">${st.period === 'week' ? 'Seiten pro Tag' : 'Seiten pro Monat'}</h3><div class="bars">${bars.map((b) => `<${b.date && b.v ? 'button data-act="day" data-date="' + b.date + '"' : 'div'} class="c"><span>${b.v ? num(b.v) : ''}</span><i style="height:${Math.round(b.v / mx * 90)}px"></i><em>${b.l}</em></${b.date && b.v ? 'button' : 'div'}>`).join('')}</div>`;
  }

  const fastest = sum.fastest, slowest = sum.slowest;
  const pace = (p) => p ? `<b>${esc(p.u.book.title)}</b><span>${num(p.perDay)} Seiten pro Tag · ${p.days} ${p.days === 1 ? 'Tag' : 'Tage'}</span>` : '<b>–</b><span>noch keine Daten</span>';
  const est = [...daily.entries()].filter(([d]) => d >= range.from && d <= range.to).reduce((s, [, d]) => s + d.est, 0);
  return `${header(S, 'Statistik', S.ub.length + ' Einträge')}
  <div class="row" style="justify-content:space-between;align-items:center;margin-top:12px">
    <div class="seg" role="group" aria-label="Zeitraum">${seg('week', 'Woche')}${seg('month', 'Monat')}${seg('year', 'Jahr')}</div>
    <div class="seg" role="group" aria-label="Farbe nach"><button data-act="colorby" data-v="category" aria-pressed="${colorBy === 'category'}">Kategorie</button><button data-act="colorby" data-v="format" aria-pressed="${colorBy === 'format'}">Format</button></div>
  </div>
  <div class="pernav"><button class="icon-btn" data-act="prev" aria-label="Zurück">‹</button><span>${esc(label)}</span><button class="icon-btn" data-act="next" aria-label="Weiter">›</button></div>
  <div class="kpis">
    <div class="kpi"><b>${sum.finished.length}</b><span>Bücher beendet</span></div>
    <div class="kpi"><b>${num(sum.pages)}</b><span>Seiten gelesen</span></div>
    <div class="kpi"><b>${num(sum.perReadDay)}</b><span>Seiten pro Lesetag (${sum.readDays} Tage)</span></div>
  </div>
  ${sum.spend || sum.avgRating ? `<div class="kpis"><div class="kpi"><b>${sum.spend ? num(sum.spend, 2) + ' €' : '–'}</b><span>Ausgaben für Bücher</span></div><div class="kpi"><b>${sum.avgRating ? num(sum.avgRating, 1) : '–'}</b><span>Ø Bewertung</span></div><div class="kpi"><b>${S.ub.filter((u) => u.status === 'shelf').length}</b><span>ungelesen im Regal</span></div></div>` : ''}
  ${chart}
  ${total ? `<div class="legend">${names.map((k) => `<span><i style="background:${colOf(k)}"></i>${esc(nameOf(k))} ${Math.round(share[k] / total * 100)} %</span>`).join('')}</div><div class="stack">${names.map((k) => `<div style="width:${share[k] / total * 100}%;background:${colOf(k)}"></div>`).join('')}</div>` : '<p class="note">In diesem Zeitraum wurden keine Seiten erfasst.</p>'}
  ${st.period === 'month' || st.period === 'week' ? '<p class="note">Tipp: Tage antippen, um die gelesenen Bücher zu sehen.</p>' : ''}
  ${est > 0 ? `<p class="note">Enthält geschätzte Seiten (${num(est)}) aus Büchern ohne Tages-Log, gleichmäßig über Start- bis Enddatum verteilt.</p>` : ''}
  <h3 class="sec">Tempo</h3>
  <div class="two-cards"><div class="tcard"><small>Am schnellsten</small>${pace(fastest)}</div><div class="tcard"><small>Am langsamsten</small>${pace(slowest)}</div></div>`;
}

/* ---------- Lesen ---------- */
export function readingView(S, entries) {
  const list = entries.filter((e) => e.status === 'reading');
  const ro = S.viewUser !== S.me.id;
  const body = list.length ? list.map((e) => {
    const lp = lastPage(S.logs, e.id), pages = e.book.pages || 0;
    const pct = pages ? Math.min(100, Math.round(lp / pages * 100)) : 0;
    return `<div class="rd">${coverHtml(e.book, true)}<div class="body"><h3>${esc(e.book.title)}</h3><p class="sub">${esc(e.book.authors || '')}</p>
      <div class="bar" style="margin-top:8px"><div style="width:${pct}%"></div></div>
      <p class="sub">Seite ${lp}${pages ? ' von ' + pages + ' · ' + pct + ' %' : ''}</p>
      ${ro ? '' : `<div class="inline"><input type="number" inputmode="numeric" min="0" ${pages ? `max="${pages}"` : ''} value="${lp || ''}" placeholder="Seite" aria-label="Aktuelle Seite" data-pg="${e.id}"><button class="btn" data-act="logpage" data-id="${e.id}">Eintragen</button><button class="btn ghost" data-act="open" data-id="${e.id}">Details</button><button class="btn ghost" data-act="abandonopen" data-id="${e.id}">Abbrechen</button></div>`}
    </div></div>`;
  }).join('') : `<div class="empty"><b>Gerade liest du nichts</b>Öffne ein Buch im Regal und setze den Status auf „Lese ich“.</div>`;
  return `${header(S, 'Lesen', list.length + ' ' + (list.length === 1 ? 'Buch' : 'Bücher') + ' in Arbeit')}${body}`;
}

/* ---------- Buch-Detail ---------- */
export function bookSheet(S, e) {
  const b = e.book, ro = S.viewUser !== S.me.id;
  const logs = S.logs.filter((l) => l.user_book_id === e.id).sort((a, c) => (a.log_date < c.log_date ? 1 : -1));
  const lp = logs.length ? logs[0].page_to : 0, pages = b.pages || 0;
  const days = e.started_at && e.finished_at ? Math.max(1, diffDays(e.started_at, e.finished_at) + 1) : null;
  const pace = days && pages ? Math.round(pages / days) : null;
  const stBg = { finished: 'var(--green)', reading: 'var(--red)', shelf: 'var(--muted)', wishlist: 'var(--ochre)', abandoned: 'var(--muted)' }[e.status];
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  const cats = [...new Set(S.ub.map((u) => u.category).filter(Boolean))];
  const dis = ro ? 'disabled' : '';
  return `<div class="scrim" data-act="closeSheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Buchdetails" data-stop>
    <div class="sheet-head"><span style="width:44px"></span><span class="grab"></span><button class="icon-btn" style="border:0" data-act="closeSheet" aria-label="Schließen">${ICON.close}</button></div>
    <div class="row hero">${coverHtml(b)}<div style="min-width:0;display:flex;flex-direction:column;justify-content:center;gap:6px">
      <span class="pill" style="align-self:flex-start;background:${stBg}">${STATUS[e.status]}</span>
      <h2>${esc(b.title)}</h2>${b.subtitle ? `<p class="sub" style="margin:0">${esc(b.subtitle)}</p>` : ''}
      <p class="sub" style="margin:0">${esc(b.authors || '')}</p></div></div>
    <div class="facts"><div class="fact"><b>${pages || '–'}</b><span>Seiten</span></div><div class="fact"><b>${pace || '–'}</b><span>Seiten pro Tag</span></div><div class="fact"><b>${days || '–'}</b><span>Tage</span></div></div>
    ${ro ? '' : `<label class="btn ghost covbtn">${b.cover_path ? 'Cover ersetzen' : 'Cover fotografieren oder wählen'}<input type="file" accept="image/*" data-cover="${b.id}" hidden></label>`}

    ${!ro && (e.status === 'reading' || e.status === 'shelf') ? `<h3 class="sec">Lesen loggen</h3>
      ${pages ? `<div class="bar"><div style="width:${Math.min(100, Math.round(lp / pages * 100))}%"></div></div>` : ''}
      <p class="sub">Aktuell auf Seite ${lp}${pages ? ' von ' + pages : ''}</p>
      <div class="inline"><input id="logpg" type="number" inputmode="numeric" min="0" ${pages ? `max="${pages}"` : ''} value="${lp || ''}" aria-label="Aktuelle Seite" placeholder="Seite"><button class="btn" data-act="sheetlog" data-id="${e.id}">Eintragen</button></div>
      <div class="quick">${[10, 25, 50].map((n) => `<button data-act="quicklog" data-n="${n}">+${n}</button>`).join('')}<button data-act="quicklog" data-n="done">Fertig</button>${e.status === 'reading' ? `<button data-act="abandonopen" data-id="${e.id}">Abbrechen</button>` : ''}</div>` : ''}
    ${logs.length ? `<h3 class="sec">Verlauf</h3>${logs.slice(0, 6).map((l) => `<div class="logrow"><span>${deDate(l.log_date)}</span><span>+${l.pages_read} S.</span><span>bis Seite ${l.page_to}</span></div>`).join('')}` : ''}

    <h3 class="sec">Mein Eintrag</h3>
    <form class="form" data-form="entry" data-id="${e.id}">
      <div class="two"><label>Status<select name="status" ${dis}>${opt(STATUS, e.status)}</select></label>
      <label>Format<select name="format" ${dis}>${opt(FORMAT_LABELS, e.format)}</select></label></div>
      <div><span class="sans" style="font:600 12px var(--sans);color:var(--muted)">Bewertung</span>
        <div class="stars" role="group" aria-label="Bewertung">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="${e.rating >= n ? 'on' : ''}" data-act="rate" data-n="${n}" aria-label="${n} Sterne" ${dis}>★</button>`).join('')}</div>
        <input type="hidden" name="rating" value="${e.rating || ''}"></div>
      <div class="two"><label>Begonnen<input type="date" name="started_at" value="${e.started_at || ''}" ${dis}></label><label>Beendet<input type="date" name="finished_at" value="${e.finished_at || ''}" ${dis}></label></div>
      <div class="two"><label>Kaufpreis (€)<input type="number" step="0.01" min="0" name="purchase_price" value="${e.purchase_price ?? ''}" ${dis}></label><label>Gekauft am<input type="date" name="purchase_date" value="${e.purchase_date || ''}" ${dis}></label></div>
      <div class="two"><label>Kategorie<select name="category" ${dis}><option value="">– keine –</option>${catOptions(e.category)}</select></label><label>Lesereihe / Thema<input name="reading_series" list="serlist" value="${esc(e.reading_series || '')}" placeholder="z. B. Dystopie" ${dis}></label></div>
      <datalist id="serlist">${[...new Set(S.ub.flatMap((u) => String(u.reading_series || '').split(',')).map((x) => x.trim()).filter(Boolean))].map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <label>Notizen<textarea name="notes" ${dis}>${esc(e.notes || '')}</textarea></label>
      <details><summary class="sans" style="font:600 13px var(--sans);min-height:44px;display:flex;align-items:center">Buchdaten bearbeiten</summary>
        <div class="form" style="margin-top:0">
          <label>Titel<input name="b_title" value="${esc(b.title)}" ${dis}></label>
          <label>Untertitel<input name="b_subtitle" value="${esc(b.subtitle || '')}" ${dis}></label>
          <label>Autor:in<input name="b_authors" value="${esc(b.authors || '')}" ${dis}></label>
          <div class="two"><label>Seiten<input type="number" min="1" name="b_pages" value="${b.pages || ''}" ${dis}></label><label>Jahr<input type="number" name="b_year" value="${b.pub_year || ''}" ${dis}></label></div>
          <label>Verlag<input name="b_publisher" value="${esc(b.publisher || '')}" ${dis}></label>
        </div></details>
      ${ro ? '' : `<div class="btns"><button class="btn grow" type="submit">Speichern</button><button class="btn danger" type="button" data-act="delentry" data-id="${e.id}">Entfernen</button></div>`}
    </form>
    <dl class="meta"><dt>ISBN</dt><dd>${esc(b.isbn13)}</dd><dt>Verlag</dt><dd>${esc(b.publisher || '–')}${b.pub_year ? ' · ' + b.pub_year : ''}</dd>
      ${e.started_at ? `<dt>Begonnen</dt><dd>${deDate(e.started_at)}</dd>` : ''}${e.finished_at ? `<dt>Beendet</dt><dd>${deDate(e.finished_at)}</dd>` : ''}</dl>
  </div></div>`;
}

/* ---------- Hinzufügen ---------- */
export function addSheet(S) {
  const a = S.add, tab = a.tab;
  const t = (id, l) => `<button data-act="addtab" data-v="${id}" aria-pressed="${tab === id}">${l}</button>`;
  const defaults = `<div class="two" style="margin-top:12px"><label class="sans" style="display:grid;gap:4px;font:600 12px var(--sans);color:var(--muted)">Status<select id="defStatus" class="sans" style="min-height:44px;border:1px solid var(--line2);border-radius:8px;background:transparent;padding:0 10px;font:500 15px var(--sans)">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === a.defStatus ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="sans" style="display:grid;gap:4px;font:600 12px var(--sans);color:var(--muted)">Format<select id="defFormat" class="sans" style="min-height:44px;border:1px solid var(--line2);border-radius:8px;background:transparent;padding:0 10px;font:500 15px var(--sans)">${Object.entries(FORMAT_LABELS).map(([k, v]) => `<option value="${k}" ${k === a.defFormat ? 'selected' : ''}>${v}</option>`).join('')}</select></label></div>`;
  let body = '';
  if (tab === 'scan') {
    body = `${defaults}<div class="vid"><video id="vid" playsinline muted autoplay></video><div class="fr"></div></div>
      <div class="btns"><button class="btn" data-act="camstart">Kamera starten</button><label class="btn ghost" for="photoIn">Foto aufnehmen</label><input id="photoIn" type="file" accept="image/*" capture="environment" class="hidden"></div>
      <p class="msg" id="scanMsg" role="status">Tippe auf „Kamera starten“.</p>
      <div id="scanResult"></div>
      <form class="form" data-form="manual-isbn" style="margin-top:8px"><div class="two" style="grid-template-columns:1fr auto"><label>ISBN von Hand<input name="isbn" inputmode="numeric" placeholder="978…" autocomplete="off"></label><button class="btn ghost" style="align-self:end" type="submit">Suchen</button></div></form>`;
  } else if (tab === 'list') {
    body = `${defaults}<form class="form" data-form="bulk"><label>ISBNs einfügen (eine pro Zeile oder mit Komma getrennt)<textarea name="isbns" rows="8" placeholder="978-3-596-90701-4&#10;9783641341060"></textarea></label>
      <div class="btns" style="margin-top:0"><button class="btn grow" type="submit">Hinzufügen</button></div></form><div id="bulkOut" class="prog" role="status"></div>`;
  } else {
    body = `<p class="sub">Bookology-Export (CSV) wählen. Titel, Autor:innen, Seiten, Daten und Bewertungen werden übernommen. Cover und fehlende Angaben lade ich danach nach.</p>
      <div class="btns"><label class="btn grow" for="csvIn">CSV-Datei wählen</label><input id="csvIn" type="file" accept=".csv,text/csv,text/plain" class="hidden"></div><div id="csvOut" class="prog" role="status"></div>`;
  }
  return `<div class="scrim" data-act="closeSheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Buch hinzufügen" data-stop>
    <div class="sheet-head"><span style="width:44px"></span><span class="grab"></span><button class="icon-btn" style="border:0" data-act="closeSheet" aria-label="Schließen">${ICON.close}</button></div>
    <h2>Buch hinzufügen</h2>
    <div class="seg" style="margin-top:12px;width:max-content" role="group" aria-label="Weg">${t('scan', 'Scannen')}${t('list', 'ISBN-Liste')}${t('csv', 'CSV-Import')}</div>
    ${body}</div></div>`;
}

export function foundCard(info, isbn, existing) {
  const b = { title: info.title || '', authors: info.authors || '', cover_path: info.coverPath || '', cover_color: null };
  const sources = info.diag ? Object.entries(info.diag).map(([k, v]) => `${k}: ${v}`).join(' · ') : '';
  return `<form class="found" data-form="found" data-isbn="${esc(isbn)}">
    <div class="row">${coverHtml({ ...b, title: b.title || 'ISBN ' + isbn }, true)}<div style="min-width:0;flex:1">
      ${existing ? `<p class="msg ok" style="margin:0 0 6px">Schon im Bestand – wird nur deiner Bibliothek hinzugefügt.</p>` : (info.found ? '' : `<p class="msg bad" style="margin:0 0 6px">Keine Daten gefunden. Bitte ergänzen.</p>`)}
      <div class="form" style="margin-top:0">
        <label>Titel<input name="title" value="${esc(info.title || '')}" required></label>
        <label>Autor:in<input name="authors" value="${esc(info.authors || '')}"></label>
        <div class="two"><label>Seiten<input type="number" min="1" name="pages" value="${info.pages || ''}" inputmode="numeric"></label><label>Jahr<input type="number" name="year" value="${info.year || ''}"></label></div>
      </div></div></div>
    <p class="note">ISBN ${esc(isbn)}${info.publisher ? ' · ' + esc(info.publisher) : ''}${sources ? '<br>Quellen: ' + esc(sources) : ''}</p>
    <div class="btns"><button class="btn grow" type="submit">Hinzufügen</button><button class="btn ghost" type="button" data-act="discard">Verwerfen</button></div>
  </form>`;
}

/* ---------- Einstellungen ---------- */
export function settingsSheet(S) {
  const others = S.profiles.filter((p) => p.id !== S.me.id);
  return `<div class="scrim" data-act="closeSheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Konto" data-stop>
    <div class="sheet-head"><span style="width:44px"></span><span class="grab"></span><button class="icon-btn" style="border:0" data-act="closeSheet" aria-label="Schließen">${ICON.close}</button></div>
    <h2>Konto</h2><p class="sub">${esc(S.me.email)}</p>
    <form class="form" data-form="profile"><label>Anzeigename<input name="name" value="${esc(S.me.name)}" required></label><div class="btns" style="margin-top:0"><button class="btn" type="submit">Speichern</button></div></form>
    <h3 class="sec">Bibliothek ansehen</h3>
    <div class="btns" style="margin-top:6px"><button class="btn ${S.viewUser === S.me.id ? '' : 'ghost'}" data-act="viewuser" data-id="${S.me.id}">Meine</button>
      ${others.map((p) => `<button class="btn ${S.viewUser === p.id ? '' : 'ghost'}" data-act="viewuser" data-id="${p.id}">${esc(p.display_name || 'Unbenannt')}</button>`).join('')}</div>
    <h3 class="sec">Daten</h3>
    <div class="btns" style="margin-top:6px"><button class="btn ghost" data-act="enrich">Fehlende Cover und Daten nachladen</button><button class="btn ghost" data-act="export">Als CSV exportieren</button></div>
    <div id="setOut" class="prog" role="status"></div>
    <div class="btns"><button class="btn danger grow" data-act="logout">Abmelden</button></div>
  </div></div>`;
}

/* ---------- Tagesansicht (Statistik) ---------- */
export function daySheet(S, date, dd, byId) {
  const rows = Object.entries(dd ? dd.books : {}).sort((a, b) => b[1].pages - a[1].pages).map(([id, v]) => {
    const e = byId.get(id); if (!e) return '';
    const p = Math.round(v.pages);
    return `<button class="dayrow" data-act="open" data-id="${id}">${coverHtml(e.book, true)}<span class="body"><b>${esc(e.book.title)}</b><span>${esc(e.book.authors || '')}</span><span>${p} ${p === 1 ? 'Seite' : 'Seiten'}${v.est ? ' (geschätzt)' : ''}${e.category ? ' · ' + esc(e.category) : ''}</span></span></button>`;
  }).join('');
  const total = dd ? Math.round(dd.pages) : 0;
  return `<div class="scrim" data-act="closeSheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Gelesen am ${deDate(date)}" data-stop>
    <div class="sheet-head"><span style="width:44px"></span><span class="grab"></span><button class="icon-btn" style="border:0" data-act="closeSheet" aria-label="Schließen">${ICON.close}</button></div>
    <h2>${parseDate(date).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
    <p class="sub">${total} Seiten gelesen</p>
    ${rows || '<p class="note">An diesem Tag wurde nichts erfasst.</p>'}
  </div></div>`;
}

/* ---------- Buch abbrechen ---------- */
export function abandonSheet(S, e, lp) {
  const pages = e.book.pages || 0;
  return `<div class="scrim" data-act="closeSheet"><div class="sheet" role="dialog" aria-modal="true" aria-label="Buch abbrechen" data-stop>
    <div class="sheet-head"><span style="width:44px"></span><span class="grab"></span><button class="icon-btn" style="border:0" data-act="closeSheet" aria-label="Schließen">${ICON.close}</button></div>
    <h2>Abbrechen: ${esc(e.book.title)}</h2>
    <p class="sub">Die bis hier gelesenen Seiten zählen in der Statistik weiter mit.</p>
    <form class="form" data-form="abandon" data-id="${e.id}">
      <label>Bis zu welcher Seite gelesen?<input name="page" type="number" inputmode="numeric" min="0" ${pages ? `max="${pages}"` : ''} value="${lp || ''}" placeholder="Seite"></label>
      <label>Abgebrochen am<input name="date" type="date" value="${today()}"></label>
      <label>Bewertung (optional)<select name="rating"><option value="">keine</option>${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${e.rating === n ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select></label>
      <label>Warum abgebrochen? (optional)<textarea name="reason" rows="3" placeholder="z. B. sprachlich zu schwach, Thema trägt nicht …">${esc(e.notes || '')}</textarea></label>
      <button class="btn" type="submit">Als abgebrochen speichern</button>
    </form></div></div>`;
}

/* ---------- Lesetipps (Prototyp) ---------- */
export function recoView(S, entries) {
  const r = analyze(entries), i = r.info;
  const ro = S.viewUser !== S.me.id;
  const fmtDay = (d) => deDate(d);
  const phases = r.phases.slice(0, 5).map((p) => `<div class="phase${p.active ? ' act' : ''}">
      <div class="ph-h"><b>${esc(p.label)}</b><span class="pill" style="background:${p.active ? 'var(--green)' : 'var(--muted)'}">${p.active ? 'aktuell' : 'früher'}</span></div>
      <p class="sub">${p.books.length} Bücher · ${fmtDay(p.from)} – ${fmtDay(p.to)}${p.avg ? ' · Ø ' + num(p.avg, 1) + ' ★' : ''}</p>
      <div class="mini">${p.books.map((x) => `<button data-act="open" data-id="${x.id}" aria-label="${esc(x.book.title)}">${coverHtml(x.book, true)}</button>`).join('')}</div>
    </div>`).join('');
  const picks = r.picks.filter((p) => p.score > 0).slice(0, 8).map((p) => `<button class="pick" data-act="open" data-id="${p.e.id}">${coverHtml(p.e.book, true)}
      <span class="body"><b>${esc(p.e.book.title)}</b><span>${esc(p.e.book.authors || '')}${p.e.book.pages ? ' · ' + p.e.book.pages + ' S.' : ''}</span>
      ${p.reasons.slice(0, 2).map((x) => `<span class="why">${esc(x.text)}</span>`).join('')}</span></button>`).join('');
  const thin = i.rated < 10 || i.themed < 10;
  return `${header(S, 'Lesetipps', 'Aus deinem Regal, nach Lesephasen')}
  ${thin ? `<div class="note box"><b>Datenlage noch dünn.</b> ${i.rated} von ${i.done} gelesenen Büchern haben Sterne, ${i.themed} von ${i.total} Büchern ein Thema (Kategorie, Lesereihe). Je mehr davon gepflegt ist, desto treffender werden die Tipps.</div>` : ''}
  <h3 class="sec">Deine Lesephasen</h3>
  ${phases || '<p class="note">Noch keine Phase erkennbar. Eine Phase entsteht, wenn du mindestens zwei Bücher zum selben Thema (Kategorie oder Lesereihe) innerhalb von vier Monaten liest.</p>'}
  <h3 class="sec">Als Nächstes aus deinem Regal</h3>
  ${picks || '<p class="note">Noch keine passenden Bücher im Regal gefunden.</p>'}
  ${ro ? '' : '<p class="note">Prototyp: Die Reihenfolge beruht nur auf deinen Themen, Autor:innen und Sternen, nicht auf Rezensionen oder Preislisten.</p>'}`;
}
