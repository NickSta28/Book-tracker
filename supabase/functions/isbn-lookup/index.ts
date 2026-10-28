// Automatisch erzeugt aus parse.js + handler.ts (siehe build.sh). Nicht von Hand ändern.
// Reine Hilfsfunktionen (ohne Netzwerk), damit sie sich testen lassen.

function isbn13Valid(s) {
  if (!/^97[89]\d{10}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(s[i]) * (i % 2 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(s[12]);
}

function normalizeIsbn(raw) {
  const s = String(raw || '').replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{9}[\dX]$/.test(s)) {
    const core = '978' + s.slice(0, 9);
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 ? 3 : 1);
    return core + ((10 - (sum % 10)) % 10);
  }
  return s;
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
function decodeXml(t) {
  return String(t || '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENT[m])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function fields(xml, tag) {
  const out = [];
  const re = new RegExp('<(?:\\w+:)?datafield[^>]*tag="' + tag + '"[^>]*>([\\s\\S]*?)</(?:\\w+:)?datafield>', 'g');
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function sub(block, code) {
  const re = new RegExp('<(?:\\w+:)?subfield[^>]*code="' + code + '"[^>]*>([\\s\\S]*?)</(?:\\w+:)?subfield>', 'g');
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push(decodeXml(m[1]).trim());
  return out;
}
const clean = (s) => String(s || '').replace(/[¬\u0098\u009C]/g, '').replace(/\s+[/:;,]\s*$/, '').replace(/\s+/g, ' ').trim();
const flipName = (n) => {
  n = clean(n);
  const i = n.indexOf(',');
  return i > 0 ? (n.slice(i + 1).trim() + ' ' + n.slice(0, i).trim()).trim() : n;
};

// DNB liefert MARC21-XML. Wir lesen Titel (245), Autor (100/700), Verlag/Jahr (264/260),
// Umfang (300) und Sprache (041).
function parseMarc(xml) {
  if (!xml || !/datafield/.test(xml)) return null;
  const f245 = fields(xml, '245')[0];
  if (!f245) return null;
  const title = clean((sub(f245, 'a')[0] || ''));
  if (!title) return null;
  const subtitle = clean(sub(f245, 'b')[0] || '');
  const authors = [];
  const f100 = fields(xml, '100')[0];
  if (f100 && sub(f100, 'a')[0]) authors.push(flipName(sub(f100, 'a')[0]));
  fields(xml, '700').forEach((b) => {
    const role = sub(b, '4')[0] || '';
    if ((role === 'aut' || role === '') && sub(b, 'a')[0]) {
      const n = flipName(sub(b, 'a')[0]);
      if (!authors.includes(n) && role === 'aut') authors.push(n);
    }
  });
  const pub = fields(xml, '264')[0] || fields(xml, '260')[0] || '';
  const publisher = clean(sub(pub, 'b')[0] || '');
  const yr = (sub(pub, 'c')[0] || '').match(/\d{4}/);
  const ext = fields(xml, '300')[0] || '';
  const pg = (sub(ext, 'a')[0] || '').match(/(\d{1,5})\s*(?:Seiten|S\.|Pages|p\b)/i);
  const lang = (fields(xml, '041')[0] && sub(fields(xml, '041')[0], 'a')[0]) || '';
  return {
    title,
    subtitle: subtitle || undefined,
    authors: authors.join(', ') || undefined,
    publisher: publisher || undefined,
    year: yr ? Number(yr[0]) : undefined,
    pages: pg ? Number(pg[1]) : undefined,
    language: lang || undefined,
    source: 'dnb'
  };
}

// Mehrere Quellen zusammenführen: erste Quelle mit Wert gewinnt je Feld.
function mergeInfos(list) {
  const keys = ['title', 'subtitle', 'authors', 'publisher', 'year', 'pages', 'language', 'categories', 'coverUrl'];
  const out = {};
  const used = [];
  for (const info of list.filter(Boolean)) {
    used.push(info.source);
    for (const k of keys) if (out[k] == null && info[k] != null && info[k] !== '') out[k] = info[k];
  }
  out.sources = used;
  return out;
}

// ===== Handler (Deno / Supabase Edge Function) =====
// deno-lint-ignore-file no-explicit-any

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function getText(url: string, ms = 8000, retries = 1): Promise<{ ok: boolean; status: number; text: string }> {
  const r = await getOnce(url, ms);
  if (!r.ok && (r.status === 429 || r.status >= 500) && retries > 0) {
    await new Promise((res) => setTimeout(res, 1200));
    return getText(url, ms, retries - 1);
  }
  return r;
}

async function getOnce(url: string, ms: number): Promise<{ ok: boolean; status: number; text: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; buecher-tracker/1.0)', Accept: '*/*' } });
    return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : '' };
  } catch (e) {
    return { ok: false, status: 0, text: '' };
  } finally {
    clearTimeout(t);
  }
}

async function viaDnb(isbn: string) {
  const url = 'https://services.dnb.de/sru/dnb?version=1.1&operation=searchRetrieve&query=' +
    encodeURIComponent('num=' + isbn) + '&recordSchema=MARC21-xml&maximumRecords=1';
  const r = await getText(url);
  if (!r.ok) return { info: null, diag: r.status ? 'HTTP ' + r.status : 'nicht erreichbar' };
  const info = parseMarc(r.text);
  return { info, diag: info ? 'Treffer' : '0 Treffer' };
}

async function viaGoogle(isbn: string) {
  const key = Deno.env.get('GOOGLE_BOOKS_KEY');
  const url = 'https://www.googleapis.com/books/v1/volumes?q=isbn:' + isbn + '&maxResults=1' + (key ? '&key=' + key : '');
  const r = await getText(url);
  if (!r.ok) return { info: null, diag: r.status ? 'HTTP ' + r.status : 'nicht erreichbar' };
  let j: any = {};
  try { j = JSON.parse(r.text); } catch { /* leer */ }
  const g = j.items && j.items[0] && j.items[0].volumeInfo;
  if (!g) return { info: null, diag: '0 Treffer' };
  let th = g.imageLinks && (g.imageLinks.thumbnail || g.imageLinks.smallThumbnail);
  if (th) th = th.replace('http://', 'https://').replace('&edge=curl', '');
  return {
    info: {
      title: g.title, subtitle: g.subtitle, authors: (g.authors || []).join(', '), publisher: g.publisher,
      year: g.publishedDate ? Number(String(g.publishedDate).slice(0, 4)) || undefined : undefined,
      pages: g.pageCount || undefined, language: g.language, categories: (g.categories || []).join(', '),
      coverUrl: th, source: 'google'
    },
    diag: 'Treffer'
  };
}

async function viaOpenLibrary(isbn: string) {
  const r = await getText('https://openlibrary.org/api/books?bibkeys=ISBN:' + isbn + '&format=json&jscmd=data');
  if (!r.ok) return { info: null, diag: r.status ? 'HTTP ' + r.status : 'nicht erreichbar' };
  let j: any = {};
  try { j = JSON.parse(r.text); } catch { /* leer */ }
  const o = j['ISBN:' + isbn];
  if (!o) return { info: null, diag: '0 Treffer' };
  return {
    info: {
      title: o.title, subtitle: o.subtitle, authors: (o.authors || []).map((a: any) => a.name).join(', '),
      publisher: o.publishers && o.publishers[0] && o.publishers[0].name,
      year: o.publish_date ? Number(String(o.publish_date).slice(-4)) || undefined : undefined,
      pages: o.number_of_pages || undefined, coverUrl: 'https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg?default=false',
      source: 'openlibrary'
    },
    diag: 'Treffer'
  };
}

// lobid.org (hbz-Verbundkatalog, deutschsprachige Bücher, JSON)
async function viaLobid(isbn: string) {
  const r = await getText('https://lobid.org/resources/search?q=isbn:' + isbn + '&format=json&size=1');
  if (!r.ok) return { info: null, diag: r.status ? 'HTTP ' + r.status : 'nicht erreichbar' };
  let j: any = {};
  try { j = JSON.parse(r.text); } catch { /* leer */ }
  const m = j.member && j.member[0];
  if (!m || !m.title) return { info: null, diag: '0 Treffer' };
  const authors = (m.contribution || []).filter((c: any) => (c.role && c.role.id || '').includes('aut')).map((c: any) => c.agent && c.agent.label).filter(Boolean);
  const yr = Number(String(m.publication && m.publication[0] && m.publication[0].startDate || '').slice(0, 4)) || undefined;
  const ext = String(m.extent || '');
  const pg = /(\d{2,4})\s*(S\.|Seiten)/.exec(ext);
  return {
    info: {
      title: m.title, subtitle: m.otherTitleInformation && m.otherTitleInformation[0],
      authors: authors.join(', ') || undefined,
      publisher: m.publication && m.publication[0] && m.publication[0].publishedBy && m.publication[0].publishedBy[0],
      year: yr, pages: pg ? Number(pg[1]) : undefined, source: 'lobid'
    },
    diag: 'Treffer'
  };
}

// Open Library Suche (zweiter Weg neben der Books-API)
async function viaOpenLibrarySearch(isbn: string) {
  const r = await getText('https://openlibrary.org/search.json?q=isbn:' + isbn + '&fields=title,subtitle,author_name,publisher,first_publish_year,number_of_pages_median,cover_i&limit=1');
  if (!r.ok) return { info: null, diag: r.status ? 'HTTP ' + r.status : 'nicht erreichbar' };
  let j: any = {};
  try { j = JSON.parse(r.text); } catch { /* leer */ }
  const d = j.docs && j.docs[0];
  if (!d || !d.title) return { info: null, diag: '0 Treffer' };
  return {
    info: {
      title: d.title, subtitle: d.subtitle, authors: (d.author_name || []).join(', ') || undefined,
      publisher: d.publisher && d.publisher[0], year: d.first_publish_year,
      pages: d.number_of_pages_median, coverUrl: d.cover_i ? 'https://covers.openlibrary.org/b/id/' + d.cover_i + '-L.jpg' : undefined,
      source: 'openlibrary-search'
    },
    diag: 'Treffer'
  };
}

// Cover einmal laden und im eigenen Speicher ablegen (schont die Quellen, funktioniert dauerhaft).
async function cacheCover(isbn: string, candidates: string[]): Promise<string | null> {
  const base = Deno.env.get('SUPABASE_URL');
  const srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !srv) return null;
  for (const u of candidates) {
    try {
      const r = await fetch(u);
      if (!r.ok) continue;
      const type = r.headers.get('content-type') || '';
      if (!type.startsWith('image/')) continue;
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.length < 2500) continue; // Platzhalterbild
      const path = isbn + '.jpg';
      const up = await fetch(base + '/storage/v1/object/covers/' + path, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + srv, apikey: srv, 'Content-Type': type, 'x-upsert': 'true' },
        body: buf
      });
      if (up.ok) return path;
    } catch { /* nächster Kandidat */ }
  }
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  let body: any = {};
  try { body = await req.json(); } catch { /* leer */ }
  const isbn = normalizeIsbn(body.isbn);
  if (!isbn13Valid(isbn)) return json({ error: 'Ungültige ISBN' }, 400);

  const [dnb, google, ol, lobid, ols] = await Promise.all([
    viaDnb(isbn), viaGoogle(isbn), viaOpenLibrary(isbn), viaLobid(isbn), viaOpenLibrarySearch(isbn)
  ]);
  const merged: any = mergeInfos([dnb.info, lobid.info, google.info, ol.info, ols.info]);
  const covers = [google.info, ol.info, ols.info].map((i: any) => i && i.coverUrl).filter(Boolean) as string[];
  covers.push('https://covers.openlibrary.org/b/isbn/' + isbn + '-L.jpg?default=false');
  const coverPath = covers.length ? await cacheCover(isbn, covers) : null;
  delete merged.coverUrl;

  return json({
    isbn,
    found: !!merged.title,
    ...merged,
    coverPath,
    diag: { dnb: dnb.diag, lobid: lobid.diag, google: google.diag, openlibrary: ol.diag, 'openlibrary-suche': ols.diag }
  });
});
