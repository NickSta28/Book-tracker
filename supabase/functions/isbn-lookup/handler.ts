
// ===== Handler (Deno / Supabase Edge Function) =====
// deno-lint-ignore-file no-explicit-any

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function getText(url: string, ms = 8000): Promise<{ ok: boolean; status: number; text: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'buecher-tracker/1.0 (privat)' } });
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

  const [dnb, google, ol] = await Promise.all([viaDnb(isbn), viaGoogle(isbn), viaOpenLibrary(isbn)]);
  const merged: any = mergeInfos([dnb.info, google.info, ol.info]);
  const covers = [google.info && (google.info as any).coverUrl, ol.info && (ol.info as any).coverUrl].filter(Boolean) as string[];
  const coverPath = covers.length ? await cacheCover(isbn, covers) : null;
  delete merged.coverUrl;

  return json({
    isbn,
    found: !!merged.title,
    ...merged,
    coverPath,
    diag: { dnb: dnb.diag, google: google.diag, openlibrary: ol.diag }
  });
});
