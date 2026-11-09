// Regal-Deko: Katalog der Objekte und Platzierung im Regal.
// Höchstens ein Objekt pro Fach. Zwei Arten der Verankerung:
//  - anchor 'place': steht fest in Fach `shelf` (0 = oberstes) nach `slot` Büchern; die Bücher fließen drumherum
//  - anchor 'after' / 'before': hängt rechts bzw. links an einem Buch (book_id = user_books.id) und wandert mit ihm
// shelf/slot werden auch bei Buch-Verankerung mitgespeichert (Rückfall, falls das Buch gelöscht wird).

// w = Breite der SVG-viewBox (Höhe immer 200), gezeichnet mit SCALE
export const DECOR = [
  // Literaten
  { id: 'goethe', name: 'Goethe', w: 110, group: 'Literaten' },
  { id: 'schiller', name: 'Schiller', w: 100, group: 'Literaten' },
  { id: 'heine', name: 'Heine', w: 90, group: 'Literaten' },
  { id: 'rilke', name: 'Rilke', w: 70, group: 'Literaten' },
  { id: 'kafka', name: 'Kafka', w: 70, group: 'Literaten' },
  { id: 'thomas-mann', name: 'Thomas Mann', w: 90, group: 'Literaten' },
  // Antike
  { id: 'diana', name: 'Diana', w: 110, group: 'Antike' },
  { id: 'apollo', name: 'Apollo', w: 110, group: 'Antike' },
  { id: 'david', name: 'David', w: 120, group: 'Antike' },
  // Schreibtisch und Studierzimmer
  { id: 'globus', name: 'Globus', w: 140, group: 'Studierzimmer' },
  { id: 'teleskop', name: 'Teleskop', w: 150, group: 'Studierzimmer' },
  { id: 'sanduhr', name: 'Sanduhr', w: 70, group: 'Studierzimmer' },
  { id: 'tintenfass', name: 'Tintenfass', w: 80, group: 'Studierzimmer' },
  { id: 'schreibmaschine', name: 'Schreibmaschine', w: 150, group: 'Studierzimmer' },
  { id: 'leselampe', name: 'Leselampe', w: 110, group: 'Studierzimmer' },
  { id: 'grammophon', name: 'Grammophon', w: 140, group: 'Studierzimmer' },
  { id: 'kerze', name: 'Kerze', w: 60, group: 'Studierzimmer' },
  { id: 'fotorahmen', name: 'Fotorahmen', w: 110, group: 'Studierzimmer' },
  // Pflanzen und Wohnliches
  { id: 'topfpflanze', name: 'Topfpflanze', w: 140, group: 'Wohnliches' },
  { id: 'buchsbaum', name: 'Buchsbaum', w: 120, group: 'Wohnliches' },
  { id: 'trockenblumen', name: 'Trockenblumen', w: 120, group: 'Wohnliches' },
  { id: 'glasvasen', name: 'Glasvasen', w: 112, group: 'Wohnliches' },
  { id: 'rotwein', name: 'Rotwein', w: 90, group: 'Wohnliches' },
  { id: 'weihnachtsbaum', name: 'Weihnachtsbaum', w: 130, group: 'Wohnliches' }
];
export const SCALE = 0.9;
export const GAP = 2;
const BY_ID = new Map(DECOR.map((d) => [d.id, d]));
export const decorInfo = (id) => BY_ID.get(id) || null;
export const decorSrc = (id) => 'img/deko/' + id + '.svg';
export const decorW = (id) => Math.round((BY_ID.get(id)?.w || 100) * SCALE) + 6;
export const decorH = () => Math.round(200 * SCALE);
export const onBook = (d) => (d.anchor === 'after' || d.anchor === 'before') && !!d.book_id;

// items: Bücher in Regal-Reihenfolge [{e:{id}, w, ...}]; decor: Zeilen aus shelf_decor; width: Breite eines Fachs
// Ergebnis: rows [{cells, books, ids, decor}], pos[decorId] = {shelf, slot}
export function layoutShelf(items, decor, width) {
  const visible = new Set(items.map((it) => it.e.id));
  const fixed = new Map(), after = new Map(), before = new Map(), overflow = [];
  for (const d of decor) {
    if (!BY_ID.has(d.item)) continue;
    if (onBook(d)) {
      if (!visible.has(d.book_id)) continue; // Buch gerade ausgefiltert: das Objekt steht bei ihm, also auch weg
      (d.anchor === 'after' ? after : before).set(d.book_id, d);
    } else if (fixed.has(d.shelf)) overflow.push(d); // sollte nicht vorkommen (ein Objekt pro Fach)
    else fixed.set(d.shelf, d);
  }
  const maxFixed = Math.max(-1, ...fixed.keys());
  const rows = [], pos = {};
  let bi = 0;
  const pending = [...overflow]; // Objekte ohne Platz im vorigen Fach → an den Anfang des nächsten freien Fachs
  for (let r = 0; bi < items.length || r <= maxFixed || pending.length; r++) {
    const fx = fixed.get(r) || null;
    const cells = [], ids = []; let used = 0, k = 0, rowDecor = null;
    const put = (d) => { const w = decorW(d.item); cells.push({ kind: 'decor', d, w }); used += w + GAP; rowDecor = d; pos[d.id] = { shelf: r, slot: k }; };
    const reserve = () => (fx && rowDecor !== fx ? decorW(fx.item) + GAP : 0);
    if (!fx && pending.length) put(pending.shift());
    for (;;) {
      if (fx && rowDecor !== fx && fx.slot <= k) put(fx);
      if (bi >= items.length) break;
      const it = items[bi], id = it.e.id, bd = before.get(id), ad = after.get(id);
      const extra = bd && !fx && !rowDecor ? decorW(bd.item) + GAP : 0;
      if (used + it.w + GAP + extra + reserve() > width && cells.length) break; // Fach voll
      if (bd && (fx || rowDecor)) {
        if (cells.length && !fixed.has(r + 1)) break; // Fach belegt: Buch beginnt das nächste Fach, Objekt direkt davor
        pending.push(bd);
      } else if (bd) put(bd);
      cells.push({ kind: 'book', ...it }); ids.push(id); used += it.w + GAP; bi++; k++;
      if (ad) {
        if (!fx && !rowDecor && used + decorW(ad.item) + GAP <= width) put(ad);
        else {
          pending.push(ad); // an den Anfang des nächsten freien Fachs
          if (!fixed.has(r + 1)) break; // Fach hier beenden, damit das Objekt direkt hinter seinem Buch steht
        }
      }
    }
    if (fx && rowDecor !== fx) put(fx);
    rows.push({ cells, books: k, ids, decor: rowDecor });
  }
  return { rows, pos };
}
