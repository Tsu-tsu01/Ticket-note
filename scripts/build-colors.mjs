#!/usr/bin/env node
// data/_source/colors.tsv → brands.csv / idols.csv / units.csv のカラーとCVを更新する。
// idols.csv に無い名前は新規追加する（デレの未収録アイドルなどを一気に取り込める）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv, writeCsv, norm, DATA } from './lib.mjs';

const brands = parseCsv(join(DATA, 'brands.csv'));
const idols = parseCsv(join(DATA, 'idols.csv'));
const units = parseCsv(join(DATA, 'units.csv'));

const brandBy = new Map(brands.map(b => [b.brand_id, b]));
const idolBy = new Map();
for (const i of idols) {
  idolBy.set(norm(i.name), i);
  (i.alias || '').split(';').filter(Boolean).forEach(a => { if (!idolBy.has(norm(a))) idolBy.set(norm(a), i); });
}
const unitBy = new Map();
for (const u of units) {
  unitBy.set(norm(u.name), u);
  (u.alias || '').split(';').filter(Boolean).forEach(a => { if (!unitBy.has(norm(a))) unitBy.set(norm(a), u); });
}

const IDOL_HEAD = ['idol_id', 'name', 'name_kana', 'name_en', 'brand_id', 'color', 'cv_name',
  'unit_primary', 'alias', 'is_active', 'verified', 'notes'];

let setBrand = 0, setIdol = 0, setUnit = 0, added = 0, missUnit = [];
const seqByBrand = {};
function newId(brand) {
  const used = new Set(idols.map(i => i.idol_id));
  let n = (seqByBrand[brand] ||= 1);
  let id;
  do { id = `${brand}_x${String(n).padStart(3, '0')}`; n++; } while (used.has(id));
  seqByBrand[brand] = n;
  return id;
}

for (const raw of readFileSync(join(DATA, '_source/colors.tsv'), 'utf8').split('\n')) {
  const line = raw.replace(/\r$/, '');
  if (!line.trim() || line.startsWith('#')) continue;
  const [kind, brand, name, hex, cv] = line.split('\t').map(s => (s ?? '').trim());
  if (!kind || !name) continue;
  const color = hex ? hex.toUpperCase() : '';

  if (kind === 'brand') {
    const b = brandBy.get(brand);
    if (b && color) { b.color_primary = color; b.verified = 'true'; setBrand++; }
    continue;
  }
  if (kind === 'unit') {
    const u = unitBy.get(norm(name));
    if (u) { if (color) u.color = color; setUnit++; }
    else missUnit.push(name);
    continue;
  }
  // idol
  let i = idolBy.get(norm(name));
  if (!i) {
    i = { idol_id: newId(brand), name, name_kana: '', name_en: '', brand_id: brand, color: '',
          cv_name: '', unit_primary: '', alias: '', is_active: 'true', verified: 'false',
          notes: 'colors.tsv から自動追加' };
    idols.push(i); idolBy.set(norm(name), i); added++;
  }
  if (color) { i.color = color; setIdol++; }
  if (cv) i.cv_name = cv;            // 一覧側を正とする
  if (color && cv) i.verified = 'true';
}

writeCsv(join(DATA, 'brands.csv'), Object.keys(brands[0]), brands);
idols.sort((a, b) => a.brand_id.localeCompare(b.brand_id) || a.idol_id.localeCompare(b.idol_id));
writeCsv(join(DATA, 'idols.csv'), IDOL_HEAD, idols);
writeCsv(join(DATA, 'units.csv'), Object.keys(units[0]), units);

console.log(`ブランド ${setBrand} / アイドル ${setIdol}（新規 ${added}）/ ユニット ${setUnit} に色を設定`);
const noColor = idols.filter(i => !i.color);
if (noColor.length) console.log(`  色がまだ空のアイドル: ${noColor.length} 人 (${noColor.slice(0, 8).map(i => i.name).join(', ')}…)`);
if (missUnit.length) console.log(`  units.csv に無いユニット: ${missUnit.join(', ')}`);
