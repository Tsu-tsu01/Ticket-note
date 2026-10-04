#!/usr/bin/env node
// セットリストwikiの HTML を data/_source/lives/*.txt の形式に変換する。
//
//   1. ブラウザで F12 → セトリの <table class="InfoboxLive2"> を右クリック
//      →「Copy」→「Copy outerHTML」（ページ全体の Copy element でも可）
//   2. 適当なファイルに保存して、このスクリプトに渡す
//
//   node scripts/parse-setlist-html.mjs setlist.html > /tmp/out.txt
//   node scripts/parse-setlist-html.mjs setlist.html --id 20140222_moiw2014_d1 --date 2014-02-22 \
//        --venue v_saitama_ssa --brand crossover --tour t_moiw2014 --perf cast
//
// 出力された @live 行の属性を整えて data/_source/lives/ に貼り、build-lives.mjs を回す。
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) {
  console.error('使い方: node scripts/parse-setlist-html.mjs <保存したHTML> [--id ...] [--date ...] [--venue ...] [--brand ...] [--tour ...] [--perf cast|xr|mixed]');
  process.exit(1);
}
const opt = k => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : ''; };

const html = readFileSync(file, 'utf8');

const strip = s => s
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

/** 「※〜」以降は注記なので落とす。ダンサー等の但し書きも同様。 */
const cleanPerformers = s => s
  .split(/※|　※/)[0]
  .replace(/（[^）]*?(?:より|から|のみ|参加|合唱|登場)[^）]*?）/g, '')
  .replace(/\([^)]*?(?:より|から|のみ|参加|合唱|登場)[^)]*?\)/g, '')
  .replace(/(?:間奏|ラスト|ラスサビ|大サビ|冒頭|途中)[^、]*?(?:から|より)[\s\S]*$/, '')
  .replace(/[、,]\s*$/, '')
  .trim();

// <tr> 単位に割って走査する。曲名セル（Pfont4）→ 次の <tr> が歌唱者。
const trs = html.split(/<tr[^>]*>/i).slice(1).map(t => t.split(/<\/tr>/i)[0]);
const rows = [];
let seq = 0;
for (let i = 0; i < trs.length; i++) {
  if (!/class="Pfont4"/.test(trs[i])) continue;
  const titleRaw = strip((trs[i].match(/<span class="Pfont4">([\s\S]*?)<\/span>/) || [, ''])[1]);
  if (!titleRaw) continue;
  const nextTds = (trs[i + 1] || '').match(/<td[^>]*>([\s\S]*?)<\/td>/i);
  const performers = cleanPerformers(strip(nextTds ? nextTds[1] : ''));
  seq++;
  // アンコールらしき位置は自動判定できないので、すべて main で出す（あとで手直しする）
  rows.push(`${seq}|main|${titleRaw}|${performers}`);
}

const caption = strip((html.match(/<caption[^>]*>([\s\S]*?)<\/caption>[\s\S]*?<caption[^>]*>([\s\S]*?)<\/caption>/) || [, '', ''])[2]);
const title = strip((html.match(/background-color: #[0-9a-f]{6};"><b>([\s\S]*?)<\/b>/i) || [, ''])[1]);

console.log(`@live id=${opt('id') || 'YYYYMMDD_xxx'} tour=${opt('tour')} title=${opt('title') || title} day=${opt('day') || 'DAY1'} ` +
  `date=${opt('date') || 'YYYY-MM-DD'} venue=${opt('venue') || 'v_xxx'} brand=${opt('brand') || 'crossover'} ` +
  `event=${opt('event') || 'solo'} perf=${opt('perf') || 'cast'} stream=false lv=false archive=false status=confirmed`);
rows.forEach(r => console.log(r));

console.error(`\n${rows.length} 曲を書き出しました（会場表記: ${caption || '不明'}）`);
console.error('確認してほしいところ:');
console.error('  - アンコールの行を main → encore に直す');
console.error('  - 「（GAME Ver・メドレー）」等は build-lives.mjs が自動で尺に変換します');
console.error('  - 歌唱者に残った注記（ダンサー・音源参加など）は手で消してください');
