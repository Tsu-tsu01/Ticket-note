// ビルドスクリプト共通のユーティリティ。依存パッケージなし。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA = join(ROOT, 'data');

export function parseCsvText(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', i = 0, quoted = false;
  while (i < text.length) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { quoted = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; i++; continue; }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map(s => s.trim());
  return rows.filter(r => r.some(v => v !== ''))
    .map(r => Object.fromEntries(head.map((h, k) => [h, (r[k] ?? '').trim()])));
}
export const parseCsv = p => parseCsvText(readFileSync(p, 'utf8'));

const cell = v => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
export function writeCsv(path, head, rows) {
  const out = [head.join(',')];
  for (const r of rows) out.push(head.map(h => cell(r[h])).join(','));
  writeFileSync(path, out.join('\n') + '\n');
}

/** 全角/半角・かな・記号ゆれを吸収して照合キーにする */
export const norm = s => String(s || '')
  .normalize('NFKC').toLowerCase()
  .replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
  .replace(/[ー－―‐\-・･'’`"”\s]/g, '');

/**
 * 名前 → idol_id の索引。本名・かな・CV名・alias・ユニット名すべてを引ける。
 * ユニットは複数 idol_id に展開される。
 */
export function buildNameIndex(idols, units) {
  const map = new Map();
  const put = (name, ids) => {
    const k = norm(name);
    if (!k || map.has(k)) return;
    map.set(k, ids);
  };
  for (const i of idols) {
    const ids = [i.idol_id];
    put(i.name, ids); put(i.name_kana, ids); put(i.name_en, ids); put(i.cv_name, ids);
    (i.alias || '').split(';').filter(Boolean).forEach(a => put(a, ids));
  }
  for (const u of units) {
    const ids = (u.member_idol_ids || '').split(';').filter(Boolean);
    if (!ids.length) continue;
    put(u.name, ids); put(u.name_kana, ids);
    (u.alias || '').split(';').filter(Boolean).forEach(a => put(a, ids));
  }
  return map;
}

/** 「A、B,C」形式の名前列を idol_id 配列に変換。解決できなかった語も返す。 */
export function resolveNames(text, idx) {
  const ids = [], misses = [];
  const parts = String(text || '')
    .replace(/[［\[]/g, '(').replace(/[］\]]/g, ')')
    .split(/[、,，／\/＋+]|＆|&/)
    .map(s => s.replace(/\(.*?\)/g, '').replace(/[()（）]/g, '').trim())
    .filter(Boolean);
  for (const p of parts) {
    const hit = idx.get(norm(p));
    if (hit) hit.forEach(id => { if (!ids.includes(id)) ids.push(id); });
    else if (p.length > 1 && !/^(観客|ダンサー|アンサンブル|出演者全員|全員|他|ほか|など)$/.test(p)) misses.push(p);
  }
  return { ids, misses };
}
