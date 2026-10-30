// Reine Hilfsfunktionen (ohne Netzwerk), damit sie sich testen lassen.

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

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
export function decodeXml(t) {
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
export function parseMarc(xml) {
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
  // Inhaltstext: direkt (520) oder als Link vom Verlag/VLB (856 mit $3 „Inhaltstext“)
  const abstract = fields(xml, '520').map((b) => sub(b, 'a').join(' ')).join(' ').trim();
  let descUrl;
  for (const b of fields(xml, '856')) {
    const label = sub(b, '3').join(' ');
    const u = sub(b, 'u')[0];
    if (u && /inhaltstext|klappentext|beschreibung/i.test(label)) { descUrl = u; break; }
  }
  return {
    title,
    subtitle: subtitle || undefined,
    authors: authors.join(', ') || undefined,
    publisher: publisher || undefined,
    year: yr ? Number(yr[0]) : undefined,
    pages: pg ? Number(pg[1]) : undefined,
    language: lang || undefined,
    description: abstract ? clean(abstract) : undefined,
    descUrl,
    source: 'dnb'
  };
}

// Mehrere Quellen zusammenführen: erste Quelle mit Wert gewinnt je Feld.
export function mergeInfos(list) {
  const keys = ['title', 'subtitle', 'authors', 'publisher', 'year', 'pages', 'language', 'categories', 'description', 'coverUrl'];
  const out = {};
  const used = [];
  for (const info of list.filter(Boolean)) {
    used.push(info.source);
    for (const k of keys) if (out[k] == null && info[k] != null && info[k] !== '') out[k] = info[k];
  }
  out.sources = used;
  return out;
}

// HTML (z. B. Inhaltstext-Seite der DNB oder Google-Beschreibung) in lesbaren Text umwandeln
export function htmlToText(html) {
  let t = String(html || '');
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(t); if (body) t = body[1];
  t = t.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ');
  t = decodeXml(t).replace(/&nbsp;/g, ' ').replace(/&#?\w+;/g, ' ');
  return t.split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
