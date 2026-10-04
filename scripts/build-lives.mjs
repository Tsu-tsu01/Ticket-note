#!/usr/bin/env node
// data/_source/lives/*.txt → data/lives.csv + data/setlists/<年>.csv
//
// 書き方:
//   @live id=... tour=... title=... day=... date=YYYY-MM-DD venue=... brand=...
//         event=solo perf=cast stream=true lv=false archive=true status=confirmed
//   1|main|曲名|歌唱者、歌唱者|フラグ
//
// 歌唱者はキャスト名でもキャラ名でもユニット名でも書ける。
// 「ユニット名［A、B］」と書いた場合は括弧内の実際の出演者だけを採る。
// フラグ: premiere / xr / cast / medley:キー
import { readdirSync, readFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv, writeCsv, buildNameIndex, resolveNames, norm, DATA } from './lib.mjs';

const idols = parseCsv(join(DATA, 'idols.csv'));
const units = parseCsv(join(DATA, 'units.csv'));
const songs = parseCsv(join(DATA, 'songs.csv'));
const nameIdx = buildNameIndex(idols, units);

const songIdx = new Map();
for (const s of songs) if (!songIdx.has(norm(s.title))) songIdx.set(norm(s.title), s);
const songById = Object.fromEntries(songs.map(s => [s.song_id, s]));

const SRC = join(DATA, '_source/lives');
const lives = [];
const rowsByYear = {};
const missingSongs = new Map();
const missingNames = new Map();

/** 「ユニット名［A、B］」→「A、B」 */
const unwrapBrackets = t => t.replace(/[^、,／\/＋+]*[［\[]([^］\]]*)[］\]]/g, '$1');

/** 曲名から注記を落とし、フル尺でない場合はその種別を返す */
function splitTitle(raw){
  let t = raw.replace(/【.*?】/g, '').replace(/\s*〈.*?〉/g, '');
  let version = '';
  const pick = (re, v) => { if(re.test(t)){ version ||= v; t = t.replace(re, ''); } };
  pick(/\s*[(（][^)）]*(?:medley\s*(?:ver\.?|size)|メドレー)[^)）]*[)）]/gi, 'medley');
  pick(/\s*[(（][^)）]*half\s*ver\.?[^)）]*[)）]/gi, 'half');
  pick(/\s*[(（][^)）]*short\s*ver\.?[^)）]*[)）]/gi, 'short');
  pick(/\s*[(（][^)）]*game\s*ver(?:sion|\.)?[^)）]*[)）]/gi, 'game');
  pick(/\s*[(（][^)）]*(?:acoustic|アカペラ)[^)）]*[)）]/gi, 'acoustic');
  pick(/\s*[(（][^)）]*(?:1番のみ|ワンコーラス)[^)）]*[)）]/gi, 'short');
  // 残った「〜ver.」系の注記はフル尺として扱い、曲名から落とす
  t = t.replace(/\s*[(（][^)）]*(?:ver\.?|version|mix|arrange)[^)）]*[)）]/gi, '');
  t = t.replace(/\s*〜[^〜]*ver\.?\s*〜\s*$/gi, '');
  // 「曲名/本来の歌唱者」表記。曲名そのものの "1/3" を壊さないよう日本語名のときだけ落とす
  t = t.replace(/\s*\/\s*[一-龥ぁ-んァ-ヶ][一-龥ぁ-んァ-ヶー・\s]+$/, '');
  t = t.replace(/\s*-[^-]*cover-\s*$/i, '');
  return { title: t.trim(), version };
}

function judge(songId, performers) {
  const orig = (songById[songId]?.original_members || '').split(';').filter(Boolean);
  if (!orig.length) return '';
  const set = new Set(performers);
  const hit = orig.filter(id => set.has(id)).length;
  if (hit === 0) return 'false';
  if (hit < orig.length) return 'false';
  return 'true';   // 完全一致 / オリメン全員＋ゲスト → true
}

for (const file of readdirSync(SRC).filter(f => f.endsWith('.txt')).sort()) {
  let cur = null;
  const lines = readFileSync(join(SRC, file), 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('@live')) {
      const attrs = {};
      // key=value（値に空白を含めてよい。次の key= まで）
      const body = line.slice(5).trim();
      const re = /(\w+)=(.*?)(?=\s+\w+=|$)/g;
      let m;
      while ((m = re.exec(body))) attrs[m[1]] = m[2].trim();
      cur = attrs;
      lives.push({
        live_id: attrs.id,
        tour_id: attrs.tour || '',
        title: attrs.title || '',
        day_label: attrs.day || '',
        date: attrs.date,
        start_time: '',
        venue_id: attrs.venue,
        brand_id: attrs.brand,
        event_type: attrs.event || 'solo',
        performance_type: attrs.perf || 'cast',
        has_stream: attrs.stream || 'false',
        has_lv: attrs.lv || 'false',
        has_archive: attrs.archive || 'false',
        setlist_status: attrs.status || 'confirmed',
        official_url: '',
        verified: 'false',
        notes: ''
      });
      continue;
    }
    if (!cur) continue;

    const [seqRaw, block, titleRaw, perfRaw, flagRaw] = line.split('|').map(s => (s ?? '').trim());
    if (!titleRaw) continue;
    const parsed = splitTitle(titleRaw);
    const title = parsed.title;
    const song = songIdx.get(norm(title));
    if (!song) {
      missingSongs.set(title, (missingSongs.get(title) || 0) + 1);
      continue;
    }
    const { ids, misses } = resolveNames(unwrapBrackets(perfRaw || ''), nameIdx);
    misses.forEach(x => missingNames.set(x, (missingNames.get(x) || 0) + 1));

    const flags = (flagRaw || '').split(/[;,]/).map(s => s.trim()).filter(Boolean);
    const medley = flags.find(f => f.startsWith('medley:'));
    const stage = flags.find(f => f === 'xr' || f === 'cast' || f === 'mixed');
    const verFlag = flags.find(f => f.startsWith('ver:'));
    const version = verFlag ? verFlag.slice(4) : parsed.version;

    const year = cur.date.slice(0, 4);
    (rowsByYear[year] ||= []).push({
      live_id: cur.id,
      seq: String(rowsByYear[year] ? (rowsByYear[year].filter(r => r.live_id === cur.id).length + 1) : 1),
      block: block || 'main',
      song_id: song.song_id,
      performers: ids.join(';'),
      is_original: judge(song.song_id, ids),
      is_premiere: flags.includes('premiere') ? 'true' : 'false',
      stage_type: stage || '',
      version,
      medley_group: medley ? medley.slice(7) : '',
      notes: ''
    });
  }
}

const LIVE_HEAD = ['live_id', 'tour_id', 'title', 'day_label', 'date', 'start_time', 'venue_id',
  'brand_id', 'event_type', 'performance_type', 'has_stream', 'has_lv', 'has_archive',
  'setlist_status', 'official_url', 'verified', 'notes'];
lives.sort((a, b) => b.date.localeCompare(a.date) || a.live_id.localeCompare(b.live_id));
writeCsv(join(DATA, 'lives.csv'), LIVE_HEAD, lives);

const SET_HEAD = ['live_id', 'seq', 'block', 'song_id', 'performers', 'is_original',
  'is_premiere', 'stage_type', 'version', 'medley_group', 'notes'];
const dir = join(DATA, 'setlists');
if (existsSync(dir)) rmSync(dir, { recursive: true });
mkdirSync(dir, { recursive: true });
let total = 0;
for (const [year, rows] of Object.entries(rowsByYear)) {
  writeCsv(join(dir, `${year}.csv`), SET_HEAD, rows);
  total += rows.length;
}

console.log(`lives.csv: ${lives.length} 公演 / setlists: ${total} 行`);
if (missingSongs.size) {
  console.log('  songs.csv に無い曲 (data/_source/songs.tsv に足してください):');
  [...missingSongs.entries()].forEach(([t, c]) => console.log(`    ${t} (${c}件)`));
}
if (missingNames.size) {
  console.log('  解決できなかった出演者名 (idols.csv の alias に足してください):');
  [...missingNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
    .forEach(([n, c]) => console.log(`    ${n} (${c}件)`));
}
