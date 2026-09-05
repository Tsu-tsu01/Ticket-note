import { DB, autoJudge, cvOn } from './db.js';
import { get, SCOPES, stageCounts, versionCounts } from './store.js';

/** Is this performance an "original member" performance? true / false / null(unknown) */
export function isOriginal(row){
  const st = get();
  const ov = st.origOverride[row.key];
  if(ov !== undefined) return ov;
  const rule = st.settings.originalRule;
  if(rule === 'csv' && row.is_original !== null) return row.is_original;
  const j = autoJudge(row);
  if(j === 'UNKNOWN') return rule === 'csv' ? row.is_original : null;
  if(rule === 'auto_full') return j === 'FULL';
  return j === 'FULL' || j === 'SUPERSET';   // auto_superset, and csv-fallback
}

/** 現地で観たなら形式に関わらず回収に数える。配信で観た分だけ形式フィルタが効く。 */
export function liveCounts(live){
  const st = get();
  const mode = st.attendance[live.live_id]?.mode;
  if(mode === 'onsite') return true;
  return stageCounts(live.performance_type, st.settings.stages || ['cast']);
}

export function attendedLives(scopeKey){
  const st = get();
  const modes = SCOPES[scopeKey].modes;
  return DB.lives.filter(l => modes.includes(st.attendance[l.live_id]?.mode) && liveCounts(l));
}

/** その1曲を、いま選んでいるライブ形式で数えるか。曲側の指定が公演より優先される。 */
export function rowCounts(row){
  const s = get().settings;
  const live = DB.live[row.live_id];
  const onsite = get().attendance[row.live_id]?.mode === 'onsite';
  const stageOk = onsite || stageCounts(row.stage_type || live?.performance_type, s.stages || ['cast']);
  return stageOk && versionCounts(row.version, s.versionMode || 'all');
}

const tally = () => new Map();
const bump = (m, k, by = 1) => m.set(k, (m.get(k) || 0) + by);
const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);

/** Total number of times each song appears anywhere in the DB — used for rarity + last-performed. */
const globalSongCount = new Map();
let globalReady = false;
function ensureGlobal(){
  if(globalReady) return;
  DB.rows.forEach(r => bump(globalSongCount, r.song_id));
  globalReady = true;
}

export function compute(scopeKey){
  ensureGlobal();
  const lives = attendedLives(scopeKey);
  const liveIds = new Set(lives.map(l => l.live_id));
  const rows = DB.rows.filter(r => liveIds.has(r.live_id) && rowCounts(r));

  const songN = tally(), lineupN = tally(), idolN = tally(), cvN = tally(),
        venueN = tally(), scaleN = tally(), prefN = tally(), yearN = tally(), brandN = tally();
  const lineupSample = new Map();
  const songFirst = new Map(), songLast = new Map();
  const origSeen = new Set();      // song_id heard with original members
  let premiere = 0;

  rows.forEach(r => {
    const live = DB.live[r.live_id];
    bump(songN, r.song_id);
    bump(lineupN, r.lineupKey);
    if(!lineupSample.has(r.lineupKey)) lineupSample.set(r.lineupKey, r);
    if(!songFirst.has(r.song_id) || live.date < songFirst.get(r.song_id)) songFirst.set(r.song_id, live.date);
    if(!songLast.has(r.song_id)  || live.date > songLast.get(r.song_id))  songLast.set(r.song_id, live.date);
    if(r.is_premiere) premiere++;
    if(isOriginal(r) === true) origSeen.add(r.song_id);
    const isXR = (r.stage_type || live?.performance_type) === 'xr';
    r.performers.forEach(id => {
      if(isXR){
        // xR公演: アイドル名で集計（キャストに会っていないのでcvNには載せない）
        bump(idolN, id);
      } else {
        // キャストライブ: CV名で集計（アイドルランキングには載せない）
        const cv = cvOn(id, live.date);
        if(cv) bump(cvN, cv);
      }
    });
  });

  lives.forEach(l => {
    bump(venueN, l.venue_id);
    bump(scaleN, l.scale);
    if(l.venue?.prefecture) bump(prefN, l.venue.prefecture);
    bump(yearN, l.year);
    bump(brandN, l.brand_id);          // 公演のブランド（越境公演は crossover）
  });

  // 曲のブランド別集計。越境公演で披露された学マス曲は「学マス」に数える。
  const songBrandN = new Map();
  rows.forEach(r => { const b = DB.song[r.song_id]?.brand_id; if(b) bump(songBrandN, b); });
  const uniqueByBrand = new Map();
  songN.forEach((_, sid) => {
    const b = DB.song[sid]?.brand_id;
    if(b) uniqueByBrand.set(b, (uniqueByBrand.get(b) || 0) + 1);
  });

  // キャストとxRは別物として数える。同じ曲を両方で聴いても、それぞれの側でだけ数える。
  const byStage = { cast: { songs: new Set(), rows: 0 }, xr: { songs: new Set(), rows: 0 } };
  rows.forEach(r => {
    const t = r.stage_type || DB.live[r.live_id]?.performance_type;
    const k = t === 'xr' ? 'xr' : 'cast';
    byStage[k].rows++; byStage[k].songs.add(r.song_id);
  });

  // original-member collection: denominator = songs the DB shows as having *ever* been
  // performed by original members (anything else is impossible to collect).
  const possible = new Set();
  DB.rows.forEach(r => { if(isOriginal(r) === true && rowCounts(r)) possible.add(r.song_id); });

  const origByBrand = DB.brands.map(b => {
    const all = [...possible].filter(s => DB.song[s]?.brand_id === b.brand_id);
    const done = all.filter(s => origSeen.has(s));
    return { brand: b, done: done.length, total: all.length };
  }).filter(x => x.total > 0);

  // rarity: rare songs (few performances in the whole DB) score higher
  let rarity = 0;
  songN.forEach((_, sid) => { rarity += 100 / (globalSongCount.get(sid) || 1); });

  const dates = lives.map(l => l.date).sort();

  return {
    scopeKey, lives, rows,
    liveCount: lives.length,
    songTotal: rows.length,
    uniqueSongs: songN.size,
    uniqueLineups: lineupN.size,
    premiere,
    firstDate: dates[0] || null,
    lastDate: dates[dates.length - 1] || null,
    onceOnly: [...songN.values()].filter(v => v === 1).length,
    rarity: Math.round(rarity),
    songN, lineupN, lineupSample, songFirst, songLast,
    idolN, cvN, venueN, scaleN, prefN, yearN, brandN, songBrandN, uniqueByBrand, byStage,
    origSeen, origPossible: possible, origByBrand,
    top: (m, n = 10) => top(m, n)
  };
}

/** Last time a song was performed, honouring the venue-scale / event-type filter. */
export function lastPerformed(songId, filt){
  const rows = DB.rowsBySong[songId] || [];
  let best = null;
  rows.forEach(r => {
    const l = DB.live[r.live_id];
    if(filt.scales && !filt.scales.includes(l.scale)) return;
    if(filt.eventTypes && !filt.eventTypes.includes(l.event_type)) return;
    if(filt.originalOnly && isOriginal(r) !== true) return;
    if(filt.stagesOnly && !rowCounts(r)) return;
    if(!best || l.date > DB.live[best.live_id].date) best = r;
  });
  return best;
}

export function daysSince(iso){
  const d = new Date(iso + 'T00:00:00');
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/** リミックス・カバーは既定で回収の対象外にする（原曲とは別物として数えない） */
export const isExtra = s => s?.tags?.includes('remix') || s?.tags?.includes('cover');

/** ブランド別のカバー率（聴いたユニーク曲 / DB上の全曲）。リミックス・カバーは除く。 */
export function coverage(st){
  const total = new Map(), heard = new Map();
  DB.songs.forEach(s => { if(!isExtra(s)) total.set(s.brand_id, (total.get(s.brand_id) || 0) + 1); });
  st.songN.forEach((_, sid) => {
    const s = DB.song[sid];
    if(s && !isExtra(s)) heard.set(s.brand_id, (heard.get(s.brand_id) || 0) + 1);
  });
  const rows = DB.brands.map(b => ({
      brand: b,
      heard: heard.get(b.brand_id) || 0,
      total: total.get(b.brand_id) || 0,
      plays: st.songBrandN.get(b.brand_id) || 0
    })).filter(r => r.total > 0).sort((a, b) => b.heard - a.heard);
  const heardMain = [...st.songN.keys()].filter(sid => !isExtra(DB.song[sid])).length;
  return { rows, heard: heardMain, total: DB.songs.filter(s => !isExtra(s)).length };
}

/** まだ会えていないキャスト。キャストライブでの遭遇だけを数える。 */
export function unmetCast(st){
  const met = new Set();
  st.rows.forEach(r => {
    const stage = r.stage_type || DB.live[r.live_id]?.performance_type;
    if(stage === 'xr') return;                    // xR公演はキャストに会っていない
    r.performers.forEach(id => { const cv = cvOn(id, DB.live[r.live_id].date); if(cv) met.add(cv); });
  });
  const byCv = new Map();
  DB.idols.forEach(i => {
    if(!i.cv_name) return;
    if(!byCv.has(i.cv_name)) byCv.set(i.cv_name, []);
    byCv.get(i.cv_name).push(i);
  });
  return [...byCv.entries()]
    .filter(([cv]) => !met.has(cv))
    .map(([cv, idols]) => ({ cv, idols }))
    .sort((a, b) => a.idols[0].brand_id.localeCompare(b.idols[0].brand_id) || a.cv.localeCompare(b.cv));
}

/** Songs never heard in this scope, with their most recent qualifying performance. */
export function unheard(st, filt){
  return DB.songs
    .filter(s => !st.songN.has(s.song_id))
    .filter(s => filt.includeExtra || !isExtra(s))
    .map(s => {
      const r = lastPerformed(s.song_id, filt);
      return { song: s, last: r ? DB.live[r.live_id] : null, row: r };
    })
    .sort((a, b) => {
      if(!a.last && !b.last) return a.song.title.localeCompare(b.song.title);
      if(!a.last) return 1;
      if(!b.last) return -1;
      return b.last.date.localeCompare(a.last.date);
    });
}

/** Songs heard, but never with the original members. */
export function origMissing(st, filt){
  return [...st.origPossible]
    .filter(sid => !st.origSeen.has(sid))
    .map(sid => {
      const r = lastPerformed(sid, { ...filt, originalOnly: true });
      return { song: DB.song[sid], last: r ? DB.live[r.live_id] : null, heard: st.songN.has(sid) };
    })
    .sort((a, b) => (b.last?.date || '').localeCompare(a.last?.date || ''));
}

/** ─── 追加エクスポート ─── */

/**
 * 自分が現地で聴いた曲のうち、最後に聴いてから最も日数が経っている曲Top-n。
 * 「久々ランキング」用。
 */
export function overdueHeard(st, n = 10) {
  const today = new Date().toISOString().slice(0, 10);
  const result = [];
  st.songN.forEach((_, sid) => {
    const lastDate = st.songLast.get(sid);
    if (!lastDate) return;
    const days = daysSince(lastDate);
    const s = DB.song[sid];
    result.push({ song: s, sid, lastDate, days });
  });
  return result
    .sort((a, b) => b.days - a.days || a.sid.localeCompare(b.sid))
    .slice(0, n);
}

/**
 * ブランド別公演統計（参戦公演数・聴いた曲数・ユニーク曲数）
 */
export function brandLiveStats(st) {
  const livesByBrand = new Map();
  const rowsByBrand = new Map();
  const uniqueByBrand = new Map();

  st.lives.forEach(l => {
    const b = l.brand_id;
    livesByBrand.set(b, (livesByBrand.get(b) || 0) + 1);
  });
  st.rows.forEach(r => {
    const b = DB.song[r.song_id]?.brand_id || r.live_id && DB.live[r.live_id]?.brand_id;
    if (!b) return;
    rowsByBrand.set(b, (rowsByBrand.get(b) || 0) + 1);
  });
  st.songN.forEach((_, sid) => {
    const b = DB.song[sid]?.brand_id;
    if (!b) return;
    uniqueByBrand.set(b, (uniqueByBrand.get(b) || 0) + 1);
  });

  return DB.brands.map(br => ({
    brand: br,
    lives: livesByBrand.get(br.brand_id) || 0,
    plays: rowsByBrand.get(br.brand_id) || 0,
    unique: uniqueByBrand.get(br.brand_id) || 0,
  })).filter(x => x.lives > 0 || x.plays > 0).sort((a, b) => b.plays - a.plays);
}

/**
 * 月別参戦分布（1〜12月ごと）
 */
export function monthDistribution(st) {
  const m = new Array(12).fill(0);
  st.lives.forEach(l => {
    const mo = parseInt(l.date.slice(5, 7), 10) - 1;
    if (mo >= 0 && mo < 12) m[mo]++;
  });
  return m;
}

/**
 * 都道府県別参戦
 */
export function prefStats(st) {
  return [...st.prefN.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([pref, n]) => ({ pref, n }));
}

/**
 * 連続参戦記録（月単位）：参戦した月が何ヶ月続いたか
 */
export function streakMonths(st) {
  if (!st.lives.length) return { current: 0, best: 0 };
  const months = new Set(st.lives.map(l => l.date.slice(0, 7)));
  const sorted = [...months].sort();
  let best = 1, cur = 1, bestStart = sorted[0], curStart = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const [py, pm] = sorted[i - 1].split('-').map(Number);
    const [cy, cm] = sorted[i].split('-').map(Number);
    const diff = (cy - py) * 12 + (cm - pm);
    if (diff === 1) {
      cur++;
      if (cur > best) { best = cur; bestStart = curStart; }
    } else {
      cur = 1; curStart = sorted[i];
    }
  }
  // current streak: check if last month is recent
  const lastMonth = sorted[sorted.length - 1];
  const nowMonth = new Date().toISOString().slice(0, 7);
  const [ly, lm] = lastMonth.split('-').map(Number);
  const [ny, nm] = nowMonth.split('-').map(Number);
  const gap = (ny - ly) * 12 + (nm - lm);
  const currentStreak = gap <= 1 ? cur : 0;
  return { best, bestStart, current: currentStreak, lastMonth };
}

/**
 * DB上の全曲で「最後に自分が聴いた公演から最も日数が経っている曲」Top-n
 * ただし自分が1回以上聴いた曲のみ。
 */
export function longestGap(st, n = 10) {
  return overdueHeard(st, n);
}

/**
 * ライブでまだ一度も披露されていない楽曲
 * DB の rowsBySong に存在しない曲 = ライブ未披露
 */
export function neverPerformed(opts = {}) {
  const { includeExtra = false, brandId = null } = opts;
  ensureGlobal();
  return DB.songs.filter(s => {
    if (!includeExtra && isExtra(s)) return false;
    if (brandId && s.brand_id !== brandId) return false;
    return !globalSongCount.has(s.song_id);
  });
}

/**
 * 「久しぶり度」計算のコア:
 * 自分が初めてその曲を聴いた日 (firstDate) の直前に、
 * DB上で最後にその曲が披露された日付を返す。
 * firstDate 当日または後の披露は除外し、直前の披露がなければ null。
 */
function prevPerformDate(songId, firstDate) {
  const rows = DB.rowsBySong[songId] || [];
  let best = null;
  rows.forEach(r => {
    const d = DB.live[r.live_id]?.date;
    if (!d || d >= firstDate) return;   // 自分が聴いた当日以降は除外
    if (!best || d > best) best = d;
  });
  return best;
}

/**
 * 久しぶり度スコア:
 * 自分が聴いた曲について、(自分が初めて聴いた日) - (DB上の直前の披露日) の日数。
 * 直前の披露が存在しない場合は -1（「DB開始以来初」扱い）。
 * n 件を久しぶり順（日数降順）で返す。ブランド横断。
 */
export function globalRareSongs(st, n = 20) {
  const result = [];
  st.songN.forEach((_, sid) => {
    const s = DB.song[sid];
    if (!s || isExtra(s)) return;
    const firstDate = st.songFirst.get(sid);
    if (!firstDate) return;
    const prev = prevPerformDate(sid, firstDate);
    const gapDays = prev
      ? Math.floor((new Date(firstDate) - new Date(prev)) / 86400000)
      : -1;  // 直前披露なし
    result.push({ sid, song: s, firstDate, prevDate: prev, gapDays });
  });
  return result
    .sort((a, b) => {
      // -1（直前なし）は最も久しぶりとして先頭に
      if (a.gapDays === -1 && b.gapDays !== -1) return -1;
      if (b.gapDays === -1 && a.gapDays !== -1) return  1;
      return b.gapDays - a.gapDays || a.sid.localeCompare(b.sid);
    })
    .slice(0, n);
}

/**
 * ブランド別の久しぶり度 Top-n
 */
export function brandRareSongs(st, n = 5) {
  return DB.brands
    .filter(b => !b.is_pseudo || b.brand_id === 'crossover')
    .map(b => {
      const heard = [...st.songN.keys()].filter(sid => DB.song[sid]?.brand_id === b.brand_id);
      if (!heard.length) return null;
      // gapDays を計算してから過去披露あり(>=0)のみに絞り、それから Top-n を取る
      const withGap = heard
        .map(sid => {
          const firstDate = st.songFirst.get(sid);
          const prev = firstDate ? prevPerformDate(sid, firstDate) : null;
          const gapDays = !firstDate ? 0
            : prev ? Math.floor((new Date(firstDate) - new Date(prev)) / 86400000)
            : -1;
          return { sid, song: DB.song[sid], firstDate, prevDate: prev, gapDays };
        })
        .filter(x => x.gapDays >= 0)           // ← 先にフィルタ
        .sort((a, b) => b.gapDays - a.gapDays || a.sid.localeCompare(b.sid))
        .slice(0, n);
      if (!withGap.length) return null;         // 過去披露あり曲がゼロなら除外
      return { brand: b, songs: withGap };
    })
    .filter(Boolean);
}
