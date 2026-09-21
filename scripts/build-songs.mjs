#!/usr/bin/env node
// data/_source/songs.tsv → data/songs.csv
// 一覧サイトからコピーしたタブ区切りをそのまま貼れる。歌唱欄からオリメンを自動解決する。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, writeCsv, buildNameIndex, resolveNames, DATA } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const BRAND = {
  GKM: 'gk', SYC: 'sc', SdM: 'sm', CIN: 'cg',
  MIL: 'ml', MILR: 'ml', MILC: 'ml', 'MIL別': 'ml',
  CINR: 'cg', CINC: 'cg', 'CIN別': 'cg',
  765: '765as', '765R': '765as', '765C': '765as',
  876: '876', VLV: 'valiv', VLVR: 'valiv', 961: '961', 合同: 'crossover', ETC: 'crossover'
};
// リミックス / カバーは本編と分けてタグを付ける（未回収や網羅率の分母から外せるように）
const EXTRA_TAG = { MILR: 'remix', CINR: 'remix', '765R': 'remix', VLVR: 'remix',
  'MIL別': 'remix', 'CIN別': 'remix', MILC: 'cover', CINC: 'cover', '765C': 'cover' };

const idols = parseCsv(join(DATA, 'idols.csv'));
const units = parseCsv(join(DATA, 'units.csv'));
const idx = buildNameIndex(idols, units);

const lines = readFileSync(join(DATA, '_source/songs.tsv'), 'utf8').split('\n');
const rows = [];
const unresolved = new Map();
const seen = new Map();

// song_id は曲名から作る。日本語はそのまま使えないのでローマ字化はせず、
// 連番ではなく「s_連番+短縮」でなく、曲名のハッシュではなく、可読性優先で
// ASCII が取れるならそれを、無理なら通し番号を使う。
// FNV-1a。日本語タイトルでも毎回同じ ID になるようにする（setlists が参照するため）
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, '0');
}
function slug(title, brand) {
  const ascii = title.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (ascii.length >= 3) return 's_' + ascii.slice(0, 28);
  return `s_${brand}_${hash(title)}`;
}

let seq = 0;
for (const raw of lines) {
  const line = raw.replace(/\r$/, '');
  if (!line.trim() || line.startsWith('#')) continue;
  const cells = line.split('\t').map(s => s.trim());
  if (cells.length < 2) continue;
  // 「[765][876]」のように複数付いている場合は先頭を採る
  const tag = (cells[0].match(/^\[([^\]]+)\]/) || [, cells[0]])[1].trim();
  const brand = BRAND[tag] ?? BRAND[tag.replace(/[\[\]]/g, '')] ?? 'crossover';
  const title = cells[1].replace(/〈.*?〉/g, '').trim();
  const performer = cells[2] || '';
  const date = (cells[3] || '').replace(/\//g, '-').replace(/-(\d)(?=-|$)/g, '-0$1');
  const source = cells[4] || '';
  if (!title) continue;

  // 歌唱欄の (…) の中身が種別、外が名前リスト
  const m = performer.match(/^\((.*?)\)(.*)$/);
  const kind = m ? m[1] : '';
  const rest = (m ? m[2] : performer).trim();

  let type = 'unit';
  if (/ソロ/.test(kind)) type = 'solo';
  else if (/全体曲|全員曲|校歌|共通曲|記念楽曲|テーマソング|イメージソング/.test(kind + performer)) type = 'all';

  const tags = [];
  if (EXTRA_TAG[tag]) tags.push(EXTRA_TAG[tag]);
  if (/アレンジ|Remix|remix/.test(kind + title) && !tags.includes('remix')) tags.push('remix');
  if (/コラボ/.test(kind)) tags.push('collab');
  if (/アニメ|OP|ED/.test(kind + source)) tags.push('anime');
  if (/シーズン曲|クラス曲|ツアー曲|音楽祭|グラビア曲/.test(kind)) tags.push('event');

  // 名前の候補: 括弧の外 + 括弧内のユニット名らしき部分
  const namesText = [rest, /ソロ|全体曲|全員曲|UNIT|クラス曲|コラボ|シーズン|ツアー|-/.test(kind) ? '' : kind]
    .filter(Boolean).join(',');
  const { ids, misses } = resolveNames(namesText, idx);
  misses.forEach(x => unresolved.set(x, (unresolved.get(x) || 0) + 1));

  let id = slug(title, brand);
  if (seen.has(id)) {
    let n = 2;
    while (seen.has(`${id}_${n}`)) n++;
    id = `${id}_${n}`;
  }
  seen.set(id, title);

  rows.push({
    song_id: id, title, title_kana: '', brand_id: brand, unit_id: '',
    original_members: ids.join(';'), song_type: type, tags: tags.join(';'),
    release_date: date, source, verified: 'false', notes: performer
  });
  seq++;
}

const HEAD = ['song_id', 'title', 'title_kana', 'brand_id', 'unit_id', 'original_members',
  'song_type', 'tags', 'release_date', 'source', 'verified', 'notes'];
writeCsv(join(DATA, 'songs.csv'), HEAD, rows);

console.log(`songs.csv: ${rows.length} 曲`);
const withMembers = rows.filter(r => r.original_members).length;
console.log(`  歌唱メンバーを解決できた曲: ${withMembers} / ${rows.length}`);
if (unresolved.size) {
  console.log('  未解決の名前 (idols.csv の alias に足すと解決できます):');
  [...unresolved.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)
    .forEach(([n, c]) => console.log(`    ${n} (${c}件)`));
}
