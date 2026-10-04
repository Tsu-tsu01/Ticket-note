#!/usr/bin/env node
// Validates data/*.csv. Run: node scripts/validate.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DATA = 'data';
const errors = [], warns = [];
const err = (f, l, m) => errors.push(`${f}:${l} ${m}`);
const warn = (f, l, m) => warns.push(`${f}:${l} ${m}`);

function parse(file){
  const text = readFileSync(join(DATA, file), 'utf8').replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', i = 0, q = false;
  while(i < text.length){
    const c = text[i];
    if(q){
      if(c === '"'){ if(text[i+1] === '"'){ field += '"'; i += 2; continue; } q = false; i++; continue; }
      field += c; i++; continue;
    }
    if(c === '"'){ q = true; i++; continue; }
    if(c === ','){ row.push(field); field = ''; i++; continue; }
    if(c === '\r'){ i++; continue; }
    if(c === '\n'){ row.push(field); field = ''; rows.push(row); row = []; i++; continue; }
    field += c; i++;
  }
  if(field !== '' || row.length){ row.push(field); rows.push(row); }
  const head = rows.shift().map(s => s.trim());
  return rows.map((r, k) => {
    const o = { __line: k + 2, __file: file };
    head.forEach((hh, x) => o[hh] = (r[x] ?? '').trim());
    return o;
  }).filter(o => Object.entries(o).some(([k, v]) => !k.startsWith('__') && v !== ''));
}

const multi = v => (v ? v.split(';').map(s => s.trim()).filter(Boolean) : []);
const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const HEX  = /^#[0-9A-F]{6}$/;
const BOOL = new Set(['true', 'false']);
const ID   = /^[a-z0-9_]+$/;

const manifest = JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8'));
const SCALES = new Set(manifest.scales.map(s => s.id));
const EVENTS = new Set(manifest.event_types.map(e => e.id));
const PERFS = new Set(['cast', 'xr', 'mixed']);

const brands = parse('brands.csv');
const idols  = parse('idols.csv');
const units  = parse('units.csv');
const songs  = parse('songs.csv');
const venues = parse('venues.csv');
const tours  = parse('tours.csv');
const lives  = parse('lives.csv');
const cvs    = parse('cv_assignments.csv');
const setFiles = readdirSync(join(DATA, 'setlists')).filter(f => f.endsWith('.csv'));
const sets = setFiles.flatMap(f => parse(join('setlists', f)));

function uniq(rows, key){
  const seen = new Map();
  rows.forEach(r => {
    if(!r[key]) return err(r.__file, r.__line, `${key} が空です`);
    if(!ID.test(r[key]) && key !== 'live_id') warn(r.__file, r.__line, `${key} "${r[key]}" は英小文字・数字・_ 推奨`);
    if(seen.has(r[key])) err(r.__file, r.__line, `${key} "${r[key]}" が重複 (${seen.get(r[key])}行目と)`);
    seen.set(r[key], r.__line);
  });
  return new Set(seen.keys());
}

const B = uniq(brands, 'brand_id');
const I = uniq(idols, 'idol_id');
const U = uniq(units, 'unit_id');
const G = uniq(songs, 'song_id');
const V = uniq(venues, 'venue_id');
const T = uniq(tours, 'tour_id');
const L = uniq(lives, 'live_id');

const fk = (r, field, set, label) => {
  const v = r[field];
  if(v && !set.has(v)) err(r.__file, r.__line, `${field} "${v}" が ${label} に存在しません`);
};
const fkMulti = (r, field, set, label) =>
  multi(r[field]).forEach(v => { if(!set.has(v)) err(r.__file, r.__line, `${field} の "${v}" が ${label} に存在しません`); });

brands.forEach(r => {
  if(!HEX.test(r.color_primary)) err(r.__file, r.__line, `color_primary "${r.color_primary}" は #RRGGBB(大文字) で書いてください`);
});
idols.forEach(r => {
  fk(r, 'brand_id', B, 'brands.csv');
  fk(r, 'unit_primary', U, 'units.csv');
  if(!r.name_kana) warn(r.__file, r.__line, 'name_kana が空です（かな検索・五十音順が効きません）');
  if(r.color && !HEX.test(r.color)) err(r.__file, r.__line, `color "${r.color}" は #RRGGBB(大文字) で書いてください`);
  if(!r.color) warn(r.__file, r.__line, `${r.name} のキャラカラーが未設定（ブランドカラーで代用されます）`);
});
cvs.forEach(r => fk(r, 'idol_id', I, 'idols.csv'));
units.forEach(r => { fk(r, 'brand_id', B, 'brands.csv'); fkMulti(r, 'member_idol_ids', I, 'idols.csv'); });
songs.forEach(r => {
  fk(r, 'brand_id', B, 'brands.csv');
  fk(r, 'unit_id', U, 'units.csv');
  fkMulti(r, 'original_members', I, 'idols.csv');
  if(r.release_date && !DATE.test(r.release_date)) err(r.__file, r.__line, `release_date "${r.release_date}" は YYYY-MM-DD 形式で`);
});
venues.forEach(r => {
  if(!SCALES.has(r.scale)) err(r.__file, r.__line, `scale "${r.scale}" は manifest.json の定義にありません`);
});
tours.forEach(r => fk(r, 'brand_id', B, 'brands.csv'));
lives.forEach(r => {
  fk(r, 'venue_id', V, 'venues.csv');
  fk(r, 'tour_id', T, 'tours.csv');
  fk(r, 'brand_id', B, 'brands.csv');
  if(!DATE.test(r.date)) err(r.__file, r.__line, `date "${r.date}" は YYYY-MM-DD 形式で`);
  if(!EVENTS.has(r.event_type)) err(r.__file, r.__line, `event_type "${r.event_type}" は manifest.json の定義にありません`);
  if(!PERFS.has(r.performance_type))
    err(r.__file, r.__line, `performance_type "${r.performance_type}" は cast / xr / mixed のいずれかで`);
  ['has_stream', 'has_lv', 'has_archive'].forEach(k => {
    if(!BOOL.has(String(r[k]).toLowerCase())) err(r.__file, r.__line, `${k} は true / false で`);
  });
});

const seq = new Set();
sets.forEach(r => {
  fk(r, 'live_id', L, 'lives.csv');
  fk(r, 'song_id', G, 'songs.csv');
  fkMulti(r, 'performers', I, 'idols.csv');
  if(!/^\d+$/.test(r.seq)) err(r.__file, r.__line, `seq "${r.seq}" は 1 以上の整数で`);
  const k = `${r.live_id}#${r.seq}`;
  if(seq.has(k)) err(r.__file, r.__line, `live_id + seq "${k}" が重複しています`);
  seq.add(k);
  if(r.is_original && !BOOL.has(r.is_original.toLowerCase()))
    err(r.__file, r.__line, `is_original は true / false / 空欄 のいずれかで`);
  if(r.stage_type && !PERFS.has(r.stage_type))
    err(r.__file, r.__line, `stage_type "${r.stage_type}" は cast / xr / mixed / 空欄 のいずれかで`);
  if(!multi(r.performers).length) warn(r.__file, r.__line, 'performers が空です（統計に反映されません）');
});

// lives declared as having a setlist but none present
const withRows = new Set(sets.map(r => r.live_id));
lives.forEach(r => {
  if(r.setlist_status === 'confirmed' && !withRows.has(r.live_id))
    warn(r.__file, r.__line, `setlist_status=confirmed ですがセットリスト行がありません`);
});

// regenerate manifest file lists so the app always sees every setlist file
manifest.masters = ['brands.csv','idols.csv','cv_assignments.csv','units.csv','songs.csv','venues.csv','tours.csv','lives.csv'];
manifest.setlists = setFiles.sort().map(f => `setlists/${f}`);
manifest.generated_at = new Date().toISOString();
manifest.counts = { brands: brands.length, idols: idols.length, songs: songs.length,
                    venues: venues.length, lives: lives.length, setlist_rows: sets.length };
writeFileSync(join(DATA, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

console.log(`brands ${brands.length} / idols ${idols.length} / songs ${songs.length} / venues ${venues.length} / lives ${lives.length} / setlist rows ${sets.length}`);
warns.forEach(w => console.log('WARN  ' + w));
errors.forEach(e => console.error('ERROR ' + e));
console.log(`\n${errors.length} error(s), ${warns.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
