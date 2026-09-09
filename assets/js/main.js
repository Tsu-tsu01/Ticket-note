import { DB, loadDB, autoJudge, cvOn } from './db.js';
import * as S from './store.js';
import { compute, isOriginal, unheard, origMissing, lastPerformed, daysSince, coverage, unmetCast, isExtra, overdueHeard, brandLiveStats, monthDistribution, prefStats, streakMonths, neverPerformed, brandRareSongs, globalRareSongs } from './stats.js';
import { CARDS, renderCard, renderTierCard, download } from './card.js';
import { norm, fmtDate, fmtDateJP, pct, esc } from './text.js';

const view = document.getElementById('view');
const sheetEl = document.getElementById('sheet');
const toastEl = document.getElementById('toast');

const ui = {
  lives: { q: '', brands: new Set(), years: new Set(), scales: new Set(), perfs: new Set(), onlyUnset: false },
  songs: { tab: 'unheard', q: '', brands: new Set(), scales: null, events: null, sort: 'recent', includeExtra: false, neverBrand: '' },
  heatmap: { selected: new Set(), brand: 'cg', lastBrand: null }
};

/* ---------------- helpers ---------------- */
const h = (strings, ...vals) => strings.reduce((a, s, i) => a + s + (vals[i] ?? ''), '');

function toast(msg){
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

function openSheet(html, wire){
  sheetEl.innerHTML = `<div class="sheet-in">${html}</div>`;
  sheetEl.hidden = false;
  sheetEl.onclick = e => { if(e.target === sheetEl) closeSheet(); };
  wire?.(sheetEl);
}
function closeSheet(){ sheetEl.hidden = true; sheetEl.innerHTML = ''; }

const brandTally = list => {
  const by = new Map();
  list.forEach(x => by.set(x.song.brand_id, (by.get(x.song.brand_id) || 0) + 1));
  if(!by.size) return '';
  return `<div class="chips" style="margin-bottom:10px">
    ${DB.brands.filter(b => by.has(b.brand_id))
      .sort((a, b) => by.get(b.brand_id) - by.get(a.brand_id))
      .map(b => `<span class="chip mini" style="border-color:${b.color_primary};color:var(--ink)">${esc(b.short_name)} ${by.get(b.brand_id)}</span>`).join('')}
  </div>`;
};
const brandOf = id => DB.brand[id] || DB.brand.other;
const scaleLabel = id => DB.scaleById[id]?.label ?? id;
const eventLabel = id => DB.eventTypes.find(e => e.id === id)?.label ?? id;
const perfLabel = t => t === 'xr' ? 'xR' : t === 'mixed' ? 'キャスト+xR' : 'キャスト';

function chips(list, active, name){
  return list.map(o => `<button class="chip" type="button" data-f="${name}" data-v="${esc(o.id)}"
    aria-pressed="${active.has(o.id)}">${esc(o.label)}</button>`).join('');
}

/* ---------------- ticket stub ---------------- */
function stubHTML(live){
  const st = S.get();
  const att = st.attendance[live.live_id];
  const brand = brandOf(live.brand_id);
  const rows = DB.rowsByLive[live.live_id] || [];
  const idols = [...new Set(rows.flatMap(r => r.performers))].slice(0, 14);
  const stampCls = !att ? '' : att.mode === 'onsite' ? '' : att.mode === 'lv' ? 'lv' : 'stream';
  const stampTxt = !att ? '未' : att.mode === 'onsite' ? '済' : att.mode === 'lv' ? 'LV' : att.mode === 'stream' ? '配信' : 'ARCH';
  return `
  <button class="stub ${att ? '' : 'off'}" data-live="${esc(live.live_id)}"
          style="--band:${brand.color_primary}">
    <span class="stub-band"></span>
    <span class="stub-body">
      <span class="stub-tour">${esc(live.tour?.name_short || brand.short_name)}</span>
      <span class="stub-title">${esc(live.title)}${live.day_label ? ' ' + esc(live.day_label) : ''}</span>
      <span class="stub-meta">
        <span class="stub-date">${fmtDate(live.date)}</span>
        <span>${esc(live.venue?.name_short || live.venue?.name || '会場未設定')}</span>
        <span class="badge brand" style="--c:${brand.color_primary}">${esc(scaleLabel(live.scale))}</span>
        <span class="badge ${live.performance_type === 'xr' ? 'part' : 'none'}">${esc(perfLabel(live.performance_type))}</span>
        ${rows.length ? `<span>${rows.length}曲</span>` : `<span>セトリ未登録</span>`}
      </span>
      <span class="stub-dots">${idols.map(id =>
        `<span class="dot" style="--c:${DB.idol[id]?.color || '#999'}"></span>`).join('')}</span>
    </span>
    <span class="stub-tear">
      <span class="stamp ${stampCls}">${stampTxt}</span>
      <small>${live.live_id.slice(0, 8)}</small>
    </span>
  </button>`;
}

/* ---------------- view: lives ---------------- */
function viewLives(){
  const f = ui.lives;
  const years = [...new Set(DB.lives.map(l => l.year))].sort().reverse();
  let list = DB.lives;
  if(f.q){ const q = norm(f.q); list = list.filter(l => l._q.includes(q)); }
  if(f.brands.size) list = list.filter(l => f.brands.has(l.brand_id));
  if(f.years.size)  list = list.filter(l => f.years.has(l.year));
  if(f.scales.size) list = list.filter(l => f.scales.has(l.scale));
  if(f.perfs.size)  list = list.filter(l => f.perfs.has(l.performance_type));
  if(f.onlyUnset)   list = list.filter(l => !S.get().attendance[l.live_id]);

  const marked = Object.keys(S.get().attendance).length;

  view.innerHTML = `
  <section class="sec">
    <h2 class="sec-h">半券をもぎる</h2>
    <p class="sec-note">行った公演をタップして記録する。記録済み ${marked} / 全 ${DB.lives.length} 公演。</p>

    <details class="filters">
      <summary>絞り込み</summary>
      <div class="frow"><input type="search" id="q" placeholder="公演名・会場・ツアーで検索" value="${esc(f.q)}"></div>
      <div class="frow"><b>ブランド</b><div class="chips">
        ${chips(DB.brands.filter(b => !b.is_pseudo || b.brand_id === 'crossover')
          .map(b => ({ id: b.brand_id, label: b.short_name })), f.brands, 'brands')}
      </div></div>
      <div class="frow"><b>規模</b><div class="chips">
        ${chips(DB.scales.map(s => ({ id: s.id, label: s.label })), f.scales, 'scales')}
      </div></div>
      <div class="frow"><b>形式</b><div class="chips">
        ${chips([{id:'cast',label:'キャストライブ'},{id:'xr',label:'xR / CG'},{id:'mixed',label:'キャスト+xR'}], f.perfs, 'perfs')}
      </div></div>
      <div class="frow"><b>年</b><div class="chips">
        ${chips(years.map(y => ({ id: y, label: y })), f.years, 'years')}
      </div></div>
      <div class="frow"><button class="chip" type="button" data-toggle="onlyUnset"
        aria-pressed="${f.onlyUnset}">未記録のみ</button></div>
    </details>

    ${list.length ? list.map(stubHTML).join('')
      : `<p class="empty">条件に合う公演がありません。<br>絞り込みを緩めるか、data/lives.csv に公演を追加してください。</p>`}
  </section>`;

  view.querySelector('#q')?.addEventListener('input', e => { f.q = e.target.value; renderKeepScroll(viewLives); });
  view.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => {
    const set = f[b.dataset.f];
    set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v);
    renderKeepScroll(viewLives);
  }));
  view.querySelector('[data-toggle]')?.addEventListener('click', () => { f.onlyUnset = !f.onlyUnset; renderKeepScroll(viewLives); });
  view.querySelectorAll('.stub').forEach(b => b.addEventListener('click', () => liveSheet(b.dataset.live)));
}

function renderKeepScroll(fn){
  const y = window.scrollY;
  const open = view.querySelector('details.filters')?.open;
  fn();
  const d = view.querySelector('details.filters');
  if(d && open) d.open = true;
  window.scrollTo(0, y);
}

/* ---------------- live detail sheet ---------------- */
function liveSheet(liveId){
  const live = DB.live[liveId];
  const att = S.get().attendance[liveId];
  const rows = DB.rowsByLive[liveId] || [];
  const modes = [
    ['onsite', '現地', '会場で見た'],
    ['lv', 'ライブビューイング', '映画館などで見た'],
    ['stream', '配信', 'リアルタイム配信で見た', !live.has_stream],
    ['archive', 'アーカイブ', '後から配信で見た', !live.has_archive]
  ];
  openSheet(`
    <h3>${esc(live.title)}${live.day_label ? ' ' + esc(live.day_label) : ''}</h3>
    <p class="sub">${fmtDateJP(live.date)} / ${esc(live.venue?.name || '')} / ${esc(scaleLabel(live.scale))}</p>
    ${modes.map(([id, label, note, unavailable]) => `
      <button class="opt" data-mode="${id}" aria-pressed="${att?.mode === id}">
        ${label}<small>${note}${unavailable ? ' ／ この公演には記録がありません' : ''}</small>
      </button>`).join('')}
    <button class="opt" data-mode="">記録しない<small>この公演を一覧から外す</small></button>

    ${rows.length ? `
      <h3 style="margin-top:18px">セットリスト</h3>
      <p class="sub">オリメン判定はタップで切り替えられます（解釈は人によるので、あなたの判断が優先されます）。</p>
      <table class="lst"><tbody>
      ${rows.map(r => {
        const o = isOriginal(r);
        const cls = o === true ? 'orig' : o === false ? 'none' : 'part';
        const txt = o === true ? 'オリメン' : o === false ? '非オリメン' : '未判定';
        return `<tr>
          <td class="n">${r.seq}</td>
          <td>${esc(DB.song[r.song_id]?.title || r.song_id)}${r.stage_type ? ` <span class="badge part">${esc(perfLabel(r.stage_type))}</span>` : ''}${r.version ? ` <span class="badge none">${esc(S.VERSION_LABEL[r.version] || r.version)}</span>` : ''}
            <div style="margin-top:3px">${r.performers.map(p =>
              `<span class="dot" style="--c:${DB.idol[p]?.color};display:inline-block;margin-right:2px"></span>`).join('')}
              <span style="font-size:10.5px;color:var(--ink-soft)"> ${esc(r.performers.map(p => DB.idol[p]?.name || p).join('・'))}</span>
            </div></td>
          <td style="text-align:right"><button class="badge ${cls}" data-row="${esc(r.key)}"
            style="background:none;cursor:pointer">${txt}</button></td>
        </tr>`;
      }).join('')}
      </tbody></table>` : `<p class="sub" style="margin-top:16px">セットリスト未登録です。</p>`}

    <button class="btn ghost wide" data-close>閉じる</button>
  `, root => {
    root.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
      const m = b.dataset.mode;
      S.setAttendance(liveId, m ? { mode: m } : null);
      closeSheet();
      renderKeepScroll(viewLives);
      toast(m ? `${live.title} を記録しました` : '記録を外しました');
    }));
    root.querySelectorAll('[data-row]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      const key = b.dataset.row;
      const row = DB.rows.find(r => r.key === key);
      const cur = isOriginal(row);
      const next = cur === true ? false : cur === false ? null : true;
      S.setOverride(key, next);
      // シートのスクロール位置を保持したまま再描画
      const sheetIn = sheetEl.querySelector('.sheet-in');
      const scrollTop = sheetIn ? sheetIn.scrollTop : 0;
      liveSheet(liveId);
      requestAnimationFrame(() => {
        const newSheetIn = sheetEl.querySelector('.sheet-in');
        if(newSheetIn) newSheetIn.scrollTop = scrollTop;
      });
    }));
    root.querySelector('[data-close]').addEventListener('click', closeSheet);
  });
}

/* ---------------- view: stats ---------------- */
function viewStats(){
  const scope = S.get().settings.scope;
  const st = compute(scope);
  const base = scope === 'all' ? compute('onsite') : null;
  const diff = (a, b) => base ? `<i>+${a - b}</i>` : '';

  if(!st.liveCount){
    const stages = S.get().settings.stages || [];
    view.innerHTML = `<p class="empty">${stages.length
      ? 'まだ半券がありません。<br>「半券」タブで行った公演を選ぶと、ここに統計が出ます。'
      : '集計するライブ形式が選ばれていません。<br>画面右上のボタンから「キャストライブ」か「xR / CGライブ」を選んでください。'}</p>`;
    return;
  }

  const origDone = st.origSeen.size, origPoss = st.origPossible.size;
  const cov = coverage(st);
  const baseOrig = base ? pct(base.origSeen.size, base.origPossible.size) : null;
  const nowOrig = pct(origDone, origPoss);

  const barRow = (label, n, max, color) => `
    <div class="bar">
      <span class="bar-l" style="--c:${color || 'var(--ink-faint)'}">
        <i class="fill" style="width:${Math.max(n / max * 100, 4)}%"></i>
        <span class="txt">${esc(label)}</span>
      </span><span class="bar-n">${n}</span>
    </div>`;

  const topSongs = st.top(st.songN, 12).filter(([, n]) => n > 0);
  const maxSong = topSongs[0]?.[1] || 1;
  const topLineups = st.top(st.lineupN, 10);
  const maxLine = topLineups[0]?.[1] || 1;
  const topIdols = st.top(st.idolN, 12);
  const maxIdol = topIdols[0]?.[1] || 1;
  const topCv = st.top(st.cvN, 10);
  const maxCv = topCv[0]?.[1] || 1;
  const topVenue = st.top(st.venueN, 10);
  const maxVenue = topVenue[0]?.[1] || 1;
  const years = [...st.yearN.entries()].sort();
  const maxYear = Math.max(...years.map(y => y[1]), 1);

  view.innerHTML = `
  <section class="sec">
    <h2 class="sec-h">まとめ</h2>
    <p class="sec-note">${SCOPES_LABEL()}${base ? '／かっこ内は現地のみとの差' : ''}</p>
    <div class="tallies">
      ${[
        [st.liveCount, '参戦公演', '記録した公演の数。DAY1とDAY2は別に数える', diff(st.liveCount, base?.liveCount ?? 0)],
        [st.songTotal, '聴いた曲（延べ）', '同じ曲を何度聴いてもその回数だけ数える', diff(st.songTotal, base?.songTotal ?? 0)],
        [st.uniqueSongs, 'ユニーク曲', '重複を除いた曲数。「何曲と出会ったか」', diff(st.uniqueSongs, base?.uniqueSongs ?? 0)],
        [st.uniqueLineups, '編成', '曲×歌ったメンバーの組み合わせ数。同じ曲でも別メンバーなら別で数える', diff(st.uniqueLineups, base?.uniqueLineups ?? 0)],
        [nowOrig + '%', 'オリメン回収', 'オリメン披露のある曲のうち、オリメンで聴けた割合',
          base ? `<i>+${Math.round((nowOrig - baseOrig) * 10) / 10}pt</i>` : ''],
        [st.premiere, '初披露に立会', 'その公演が世界初披露だった曲の数', ''],
        [st.onceOnly, '一期一会の曲', '1回しか聴いていない曲の数', ''],
      ].map(([v, k, note, d]) => `
        <div class="tally"><b>${v}</b><span>${k} ${d}</span><em>${note}</em></div>`).join('')}
    </div>
    <p class="note" style="margin-top:8px">
      初参戦 ${st.firstDate ? fmtDateJP(st.firstDate) : '—'} ／ 直近 ${st.lastDate ? fmtDateJP(st.lastDate) : '—'}
    </p>
  </section>

  <section class="sec">
    <h2 class="sec-h">どれだけ聴いたか</h2>
    <p class="sec-note">分母は楽曲DBに登録されている曲数。<b>曲そのもののブランドで数えている</b>ので、
      越境公演で披露された学マス曲は学マスに入る。DBが増えれば割合は下がる。</p>
    ${(() => {
      // 優先ブランド（2段目固定）と残りブランド（3段目）に分ける
      const MAIN_BRANDS = ['765as', 'cg', 'ml', 'sm', 'sc', 'gk'];
      const covMap = new Map(cov.rows.map(r => [r.brand.brand_id, r]));
      const mainRows = MAIN_BRANDS.map(id => covMap.get(id)).filter(Boolean);
      const restRows = DB.brands
        .filter(b => !MAIN_BRANDS.includes(b.brand_id))
        .map(b => covMap.get(b.brand_id))
        .filter(Boolean);

      const tile = r => `
        <div class="tally cov-brand" style="--brand-c:${r.brand.color_primary}">
          <b>${pct(r.heard, r.total)}<span class="cov-unit">%</span></b>
          <span class="cov-frac">${r.heard} <span class="cov-slash">/</span> ${r.total}</span>
          <span>${esc(r.brand.short_name)}</span>
        </div>`;

      return `
      <div class="cov-section">
        <!-- 1段目: 全体 -->
        <div class="cov-row cov-row-1">
          <div class="tally cov-all">
            <b>${pct(cov.heard, cov.total)}<span class="cov-unit">%</span></b>
            <span class="cov-frac">${cov.heard} <span class="cov-slash">/</span> ${cov.total}</span>
            <span>全ブランド</span>
            <em>楽曲DB全体の回収率</em>
          </div>
        </div>
        <!-- 2段目: 765AS / CG / ML / SideM / SC / 学マス -->
        <div class="cov-row cov-row-2">
          ${mainRows.map(tile).join('')}
        </div>
        ${restRows.length ? `
        <!-- 3段目: その他のブランド -->
        <div class="cov-row cov-row-3">
          ${restRows.map(tile).join('')}
        </div>` : ''}
      </div>`;
    })()}
    <p class="note" style="margin-top:8px">延べ ${st.songTotal} 曲を聴いて、うち ${st.uniqueSongs} 曲がユニーク。
      1曲あたり平均 ${(st.songTotal / (st.uniqueSongs || 1)).toFixed(2)} 回。</p>
    ${(S.get().settings.stages || []).length > 1 ? `
    <div style="margin-top:6px; display:flex; gap:8px; flex-wrap:wrap; font-size:12px; color:var(--ink-soft)">
      <span>キャストライブ：延べ${st.byStage.cast.rows}曲 / ${st.byStage.cast.songs.size}曲</span>
      <span style="opacity:.4">｜</span>
      <span>xR / CGライブ：延べ${st.byStage.xr.rows}曲 / ${st.byStage.xr.songs.size}曲</span>
    </div>` : ''}
  </section>

  <section class="sec">
    <h2 class="sec-h">ブランド別 ライブ楽曲回収率</h2>
    <p class="sec-note">そのブランドのライブで<b>実際に披露されたことがある曲</b>のうち、自分が1回以上聴いた割合。
      楽曲DB全体ではなく「ライブ実績あり」の曲が分母なので、まだ披露されていない曲は含まない。</p>
    ${(() => {
      const MAIN_BRANDS = ['765as', 'cg', 'ml', 'sm', 'sc', 'gk'];
      const everPlayed = new Map();
      DB.rows.forEach(r => {
        const s = DB.song[r.song_id]; if(!s) return;
        const b = s.brand_id;
        if(!everPlayed.has(b)) everPlayed.set(b, new Set());
        everPlayed.get(b).add(r.song_id);
      });
      const myHeard = new Map();
      st.songN.forEach((_, sid) => {
        const s = DB.song[sid]; if(!s) return;
        if(!myHeard.has(s.brand_id)) myHeard.set(s.brand_id, new Set());
        myHeard.get(s.brand_id).add(sid);
      });
      const allRows = DB.brands.map(b => {
        const played = everPlayed.get(b.brand_id) || new Set();
        if(played.size === 0) return null;
        const heard = myHeard.get(b.brand_id) || new Set();
        let heardAndPlayed = 0;
        heard.forEach(sid => { if(played.has(sid)) heardAndPlayed++; });
        return { brand: b, played: played.size, heard: heardAndPlayed };
      }).filter(Boolean);
      if(!allRows.length) return '<p class="empty">データがありません。</p>';
      const totalPlayed = new Set(DB.rows.map(r => r.song_id)).size;
      const totalHeard = new Set([...st.songN.keys()].filter(sid => DB.rowsBySong?.[sid]?.length)).size;

      const rowMap = new Map(allRows.map(r => [r.brand.brand_id, r]));
      const mainRows = MAIN_BRANDS.map(id => rowMap.get(id)).filter(Boolean);
      const restRows = DB.brands
        .filter(b => !MAIN_BRANDS.includes(b.brand_id))
        .map(b => rowMap.get(b.brand_id))
        .filter(Boolean);

      const tile = r => `
        <div class="tally cov-brand" style="--brand-c:${r.brand.color_primary}">
          <b>${pct(r.heard, r.played)}<span class="cov-unit">%</span></b>
          <span class="cov-frac">${r.heard} <span class="cov-slash">/</span> ${r.played}</span>
          <span>${esc(r.brand.short_name)}</span>
        </div>`;

      return `
        <div class="cov-section">
          <div class="cov-row cov-row-1">
            <div class="tally cov-all">
              <b>${pct(totalHeard, totalPlayed)}<span class="cov-unit">%</span></b>
              <span class="cov-frac">${totalHeard} <span class="cov-slash">/</span> ${totalPlayed}</span>
              <span>全ブランド合算</span>
              <em>分母：ライブ披露実績のある曲（まだ披露されていない曲は除く）</em>
            </div>
          </div>
          <div class="cov-row cov-row-2">${mainRows.map(tile).join('')}</div>
          ${restRows.length ? `<div class="cov-row cov-row-3">${restRows.map(tile).join('')}</div>` : ''}
        </div>`;
    })()}
  </section>

  <section class="sec">
    <h2 class="sec-h">複数回聴いた曲</h2>
    <p class="sec-note">同じ曲を何回聴いたか。編成の違いは無視した集計。</p>
    <div class="bars">${topSongs.map(([sid, n]) => {
      const s = DB.song[sid];
      return barRow(s?.title || sid, n, maxSong, brandOf(s?.brand_id).color_primary);
    }).join('')}</div>
  </section>

  <section class="sec">
    <h2 class="sec-h">複数回聴いた「曲 × 編成」</h2>
    <p class="sec-note">同じ曲でも歌ったメンバーが違えば別物として数える。</p>
    <div class="bars">${topLineups.map(([key, n]) => {
      const r = st.lineupSample.get(key);
      const s = DB.song[r.song_id];
      const names = r.performers.map(p => DB.idol[p]?.name || p).join('・');
      return barRow(`${s?.title || r.song_id}（${names}）`, n, maxLine, brandOf(s?.brand_id).color_primary);
    }).join('')}</div>
  </section>

  <section class="sec">
    <h2 class="sec-h">オリメン回収</h2>
    <p class="sec-note">分母は全楽曲。オリメン披露のある曲のうち、オリメンで聴けた割合。</p>
    ${(() => {
      const MAIN_BRANDS = ['765as', 'cg', 'ml', 'sm', 'sc', 'gk'];
      const bMap = new Map(st.origByBrand.map(b => [b.brand.brand_id, b]));
      const mainRows = MAIN_BRANDS.map(id => bMap.get(id)).filter(Boolean);
      const restRows = DB.brands
        .filter(b => !MAIN_BRANDS.includes(b.brand_id))
        .map(b => bMap.get(b.brand_id))
        .filter(Boolean);

      const tile = b => `
        <div class="tally cov-brand" style="--brand-c:${b.brand.color_primary}">
          <b>${pct(b.done, b.total)}<span class="cov-unit">%</span></b>
          <span class="cov-frac">${b.done} <span class="cov-slash">/</span> ${b.total}</span>
          <span>${esc(b.brand.short_name)}</span>
        </div>`;

      return `
        <div class="cov-section">
          <div class="cov-row cov-row-1">
            <div class="tally cov-all">
              <b>${nowOrig}<span class="cov-unit">%</span></b>
              <span class="cov-frac">${origDone} <span class="cov-slash">/</span> ${origPoss}</span>
              <span>全ブランド</span>
              <em>オリメン披露のある ${origPoss} 曲中 ${origDone} 曲を回収</em>
            </div>
          </div>
          <div class="cov-row cov-row-2">${mainRows.map(tile).join('')}</div>
          ${restRows.length ? `<div class="cov-row cov-row-3">${restRows.map(tile).join('')}</div>` : ''}
        </div>`;
    })()}
    <a class="btn ghost wide" href="#/songs" style="display:block;text-align:center;text-decoration:none;margin-top:12px">未回収リストを見る</a>
  </section>

  ${topIdols.length ? `<section class="sec">
    <h2 class="sec-h">xRで見たアイドル</h2>
    <p class="sec-note">xR公演でその人が歌った曲を何曲聴いたか。キャストライブは含まない。</p>
    <div class="bars">${topIdols.map(([id, n]) =>
      barRow(DB.idol[id]?.name || id, n, maxIdol, DB.idol[id]?.color)).join('')}</div>
  </section>` : ''}

  ${topCv.length ? `<section class="sec">
    <h2 class="sec-h">よく遭遇したキャスト</h2>
    <p class="sec-note">キャストライブで公演日時点のCVで解決している。xR公演は含まない。</p>
    <div class="bars">${topCv.map(([cv, n]) => barRow(cv, n, maxCv, 'var(--ink-faint)')).join('')}</div>
  </section>` : ''}

  <section class="sec">
    <h2 class="sec-h">会場と規模</h2>
    <div class="bars">${topVenue.map(([vid, n]) =>
      barRow(DB.venue[vid]?.name || vid, n, maxVenue, 'var(--ink)')).join('')}</div>
    <div style="height:12px"></div>
    ${[...st.scaleN.entries()].sort((a, b) => (DB.scaleById[b[0]]?.rank ?? 0) - (DB.scaleById[a[0]]?.rank ?? 0))
      .map(([sc, n]) => `<div class="rate">
        <span class="rate-name">${esc(scaleLabel(sc))}</span>
        <span class="rate-track"><i style="width:${pct(n, st.liveCount)}%"></i></span>
        <span class="rate-num">${n}公演</span></div>`).join('')}
  </section>

  <section class="sec">
    <h2 class="sec-h">年別の参戦</h2>
    <div class="bars">${years.map(([y, n]) => barRow(y + '年', n, maxYear, 'var(--stamp)')).join('')}</div>
  </section>


  ${(() => {
    const overdue2 = overdueHeard(st, 50).filter(x => (st.songN.get(x.sid) || 0) >= 2 && x.days >= 365).slice(0, 10);
    if (!overdue2.length) return '';
    const maxDays = overdue2[0].days || 1;
    return '<section class="sec"><h2 class="sec-h">そろそろ再会したい曲 Top 10</h2><p class="sec-note">自分が2回以上聴いた曲のうち、最後に聴いてから最も日が経っているもの。次のライブで出たら熱い。（集計対象: 1年以上聴いていない曲）</p><div class="bars">' + overdue2.map((x, i) => {
      const color = brandOf(x.song?.brand_id)?.color_primary || 'var(--ink-faint)';
      return '<div class="bar"><span class="bar-l" style="--c:' + color + '"><i class="fill" style="width:' + Math.max(x.days / maxDays * 100, 4) + '%"></i><span class="txt">' + esc((i+1) + '. ' + (x.song?.title || x.sid)) + '<br><span style="font-size:10px;opacity:.7">' + esc(brandOf(x.song?.brand_id)?.short_name || '') + ' ／ 最終: ' + fmtDate(x.lastDate) + '（' + x.days + '日前）</span></span></span><span class="bar-n">' + x.days + '日</span></div>';
    }).join('') + '</div></section>';
  })()}



  ${(() => {
    const allRare = globalRareSongs(st, 200);   // 多めに取得して分類
    const withPrev  = allRare.filter(x => x.gapDays >= 0).slice(0, 20);  // 過去披露あり
    const noPrev    = allRare.filter(x => x.gapDays < 0);                // DB収録以来初
    if (!withPrev.length && !noPrev.length) return '';

    const fmtGap = (days) => {
      if (days < 365) return days + '日ぶり';
      const y = Math.floor(days / 365), m = Math.floor((days % 365) / 30);
      return y + '年' + (m ? m + 'ヶ月' : '') + 'ぶり';
    };

    let html = '<section class="sec"><h2 class="sec-h">レア度 Top 20（ブランド横断）</h2>' +
      '<p class="sec-note">自分が初めて聴いた時点で、直前の披露からどれだけ間が空いていたか（他のPにとっての「久しぶり」）。過去披露ありの曲のみ。</p>';

    if (withPrev.length) {
      const maxDays = withPrev[0].gapDays || 1;
      html += '<div class="bars">' + withPrev.map((x, i) => {
        const color = brandOf(x.song?.brand_id)?.color_primary || 'var(--ink-faint)';
        const w = Math.max(x.gapDays / maxDays * 100, 4);
        const prevLiveLabel = x.prevLive
          ? (DB.tour?.[x.prevLive.tour_id]?.name_short || x.prevLive.title?.slice(0,16) || '')
          : '';
        const prevStr = x.prevDate
          ? fmtDate(x.prevDate) + (prevLiveLabel ? '（' + prevLiveLabel + '）' : '') + ' 以来'
          : '';
        const sub = esc(prevStr + ' → ' + fmtDate(x.firstDate));
        return '<div class="bar"><span class="bar-l" style="--c:' + color + '">' +
          '<i class="fill" style="width:' + w + '%"></i>' +
          '<span class="txt">' + esc((i+1) + '. ' + (x.song?.title || x.sid)) +
          '<br><span style="font-size:10px;opacity:.7">' + esc(brandOf(x.song?.brand_id)?.short_name || '') + ' ／ ' + sub + '</span>' +
          '</span></span>' +
          '<span class="bar-n" style="font-size:10.5px">' + esc(fmtGap(x.gapDays)) + '</span></div>';
      }).join('') + '</div>';
    }

    if (noPrev.length) {
      html += '<h3 class="sec-h" style="margin-top:18px;font-size:13px">DB収録以来初披露に立ち会った曲</h3>' +
        '<p class="sec-note" style="margin-top:2px">DB上で直前の披露記録がなく、自分が聴いた時点での「ライブ初」候補。</p>' +
        '<div class="chips" style="flex-wrap:wrap;gap:4px">' +
        noPrev.map(x => '<span class="chip mini" style="border-color:' + brandOf(x.song?.brand_id)?.color_primary + '">' +
          esc(x.song?.title || x.sid) + ' <span style="font-size:9px;opacity:.7">' + esc(brandOf(x.song?.brand_id)?.short_name || '') + '</span></span>'
        ).join('') + '</div>';
    }

    html += '</section>';
    return html;
  })()}



  ${(() => {
    const byBrand = brandRareSongs(st, 5);
    if (!byBrand.length) return '';
    const fmtGap = (days) => {
      if (days < 365) return days + '日ぶり';
      const y = Math.floor(days / 365), m = Math.floor((days % 365) / 30);
      return y + '年' + (m ? m + 'ヶ月' : '') + 'ぶり';
    };
    const rows = byBrand.map(b => {
      const songs = b.songs;   // stats側で過去披露ありのみ絞り込み済み
      const maxDays = songs[0]?.gapDays || 1;
      return '<div style="margin-bottom:14px">' +
        '<div class="chips" style="margin-bottom:6px"><span class="chip mini" style="border-color:' + b.brand.color_primary + ';background:' + b.brand.color_primary + ';color:#fff;font-weight:bold">' + esc(b.brand.short_name) + '</span></div>' +
        songs.map((x, i) => {
          const w = Math.max(x.gapDays / maxDays * 100, 4);
          return '<div class="bar"><span class="bar-l" style="--c:' + b.brand.color_primary + '">' +
            '<i class="fill" style="width:' + w + '%"></i>' +
            '<span class="txt">' + esc((i+1) + '. ' + (x.song?.title || x.sid)) +
            '<br><span style="font-size:10px;opacity:.7">' + esc(fmtDate(x.prevDate) + ' 以来') + '</span>' +
            '</span></span><span class="bar-n" style="font-size:10.5px">' + esc(fmtGap(x.gapDays)) + '</span></div>';
        }).join('') + '</div>';
    }).filter(Boolean).join('');
    if (!rows) return '';
    return '<section class="sec"><h2 class="sec-h">ブランド別 レア度 Top 5</h2>' +
      '<p class="sec-note">各ブランドで自分が初めて聴いた時点の空白期間が長い順（他のPにとっての久しぶり度）。過去披露ありの曲のみ。</p>' + rows + '</section>';
  })()}


  ${(() => {
    const dist = monthDistribution(st);
    const maxM = Math.max(...dist, 1);
    const labels = ['1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'];
    if (!dist.some(n => n > 0)) return '';
    return '<section class="sec"><h2 class="sec-h">月別参戦分布</h2><p class="sec-note">どの月に行きやすいか一目でわかる。</p><div class="bars">' + dist.map((n, i) => n ? '<div class="bar"><span class="bar-l" style="--c:var(--stamp)"><i class="fill" style="width:' + Math.max(n / maxM * 100, 4) + '%"></i><span class="txt">' + labels[i] + '</span></span><span class="bar-n">' + n + '公演</span></div>' : '').join('') + '</div></section>';
  })()}

  ${(() => {
    const prefs = prefStats(st);
    if (prefs.length < 2) return '';
    const maxP = prefs[0]?.n || 1;
    return '<section class="sec"><h2 class="sec-h">都道府県別参戦</h2><p class="sec-note">' + prefs.length + '都道府県を制覇。</p><div class="bars">' + prefs.map(x => '<div class="bar"><span class="bar-l" style="--c:var(--ink)"><i class="fill" style="width:' + Math.max(x.n / maxP * 100, 4) + '%"></i><span class="txt">' + esc(x.pref) + '</span></span><span class="bar-n">' + x.n + '公演</span></div>').join('') + '</div></section>';
  })()}

  ${(() => {
    const streak = streakMonths(st);
    if (streak.best <= 1) return '';
    return '<section class="sec"><h2 class="sec-h">連続参戦ストリーク（月単位）</h2><div class="tallies"><div class="tally"><b>' + streak.best + '</b><span>最長連続参戦月数</span><em>' + (streak.bestStart ? streak.bestStart.replace('-','年') + '月〜' : '') + '</em></div><div class="tally"><b>' + (streak.current || '—') + '</b><span>現在の連続参戦月数</span><em>' + (streak.current ? streak.lastMonth.replace('-','年') + '月が直近' : '途切れ中') + '</em></div></div></section>';
  })()}

  <section class="sec">
    <h2 class="sec-h">画像として保存</h2>
    <p class="sec-note">「${fmtDateJP(new Date().toISOString().slice(0, 10))}時点」のタイトル付きでPNGを書き出す。</p>
    ${CARDS.map(c => `
      <div class="card-shot">
        <h4>${c.name}</h4><p>${c.desc}</p>
        <button class="btn" data-card="${c.id}">PNGを保存</button>
      </div>`).join('')}
  </section>`;

  view.querySelectorAll('[data-card]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true; const old = b.textContent; b.textContent = '書き出し中…';
    try{
      const blob = await renderCard(b.dataset.card, st);
      const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      download(blob, `ticketnote_${b.dataset.card}_${d}.png`);
      toast('画像を保存しました');
    }catch(e){
      console.error(e);
      toast('書き出しに失敗しました。もう一度試してください');
    }finally{ b.disabled = false; b.textContent = old; }
  }));
}
const SCOPES_LABEL = () => {
  const s = S.get().settings;
  const st = (s.stages || []).map(k => S.STAGES[k]?.label).filter(Boolean).join(' + ') || 'なし';
  const vm = S.VERSION_MODES[s.versionMode || 'all']?.label ?? '';
  return `集計対象：${S.SCOPES[s.scope].label} ／ ${st} ／ ${vm}`;
};

/* ---------------- view: songs ---------------- */
function viewSongs(){
  const f = ui.songs;
  const scope = S.get().settings.scope;
  const st = compute(scope);
  const scales = f.scales ?? DB.scales.map(s => s.id);
  const events = f.events ?? DB.eventTypes.map(e => e.id);
  const filt = { scales, eventTypes: events, includeExtra: f.includeExtra };

  const tabBtn = (id, label) => `<button class="chip" type="button" data-tab="${id}" aria-pressed="${f.tab === id}">${label}</button>`;

  const sortList = list => {
    const key = x => x.last?.date || '';
    if(f.sort === 'title') return list.sort((a, b) => a.song.title.localeCompare(b.song.title, 'ja'));
    if(f.sort === 'old')   return list.sort((a, b) => (key(a) || '9999').localeCompare(key(b) || '9999'));
    if(f.sort === 'count') return list.sort((a, b) => (st.songN.get(b.song?.song_id||b.song_id||'') || 0) - (st.songN.get(a.song?.song_id||a.song_id||'') || 0));
    return list.sort((a, b) => key(b).localeCompare(key(a)));
  };

  let body = '';
  if(f.tab === 'never'){
    let list = neverPerformed({ includeExtra: f.includeExtra, brandId: f.neverBrand || null });
    if(f.q){ const q = norm(f.q); list = list.filter(s => s._q.includes(q)); }
    if(f.brands.size) list = list.filter(s => f.brands.has(s.brand_id));
    const byBrand = new Map();
    list.forEach(s => byBrand.set(s.brand_id, (byBrand.get(s.brand_id) || 0) + 1));
    const brandFilter = DB.brands.filter(b => byBrand.has(b.brand_id));
    body = `
      <div class=\"chips\" style=\"margin-bottom:10px;flex-wrap:wrap;gap:4px\">
        <button class=\"chip mini\" type=\"button\" data-neverbrand=\"\" aria-pressed=\"${!f.neverBrand}\">全ブランド</button>
        ${brandFilter.map(b => `<button class=\"chip mini\" type=\"button\" data-neverbrand=\"${esc(b.brand_id)}\" aria-pressed=\"${f.neverBrand === b.brand_id}\" style=\"border-color:${b.color_primary};${f.neverBrand === b.brand_id ? 'background:' + b.color_primary + ';color:#fff;font-weight:bold' : ''}\">${esc(b.short_name)} ${byBrand.get(b.brand_id)}</button>`).join('')}
      </div>
      ${list.length ? brandTally(list.map(s => ({ song: s }))) + `
      <table class=\"lst\"><thead><tr><th>ライブ未披露楽曲</th><th>ブランド</th></tr></thead><tbody>
      ${list.slice(0, 300).map(s => `<tr>
        <td>${esc(s.title)}
          <div>${s.tags.map(t => `<span class="badge none">${esc(t)}</span>`).join('')}</div></td>
        <td><span class=\"badge brand\" style=\"--c:${brandOf(s.brand_id).color_primary}\">${esc(brandOf(s.brand_id).short_name)}</span></td>
      </tr>`).join('')}
      </tbody></table>
      <p class=\"note\" style=\"margin-top:8px\">${list.length} 曲（まだ一度もライブで披露されていない曲。表示は先頭300件）</p>`
      : `<p class=\"empty\">条件に合うライブ未披露曲はありません。</p>`}`;
  }else if(f.tab === 'cast'){
    let list = unmetCast(st);
    if(f.q){ const q = norm(f.q); list = list.filter(x => norm(x.cv).includes(q) || x.idols.some(i => i._q.includes(q))); }
    if(f.brands.size) list = list.filter(x => x.idols.some(i => f.brands.has(i.brand_id)));
    body = list.length ? `
      <table class="lst"><thead><tr><th>まだ会っていないキャスト</th><th>担当</th></tr></thead><tbody>
      ${list.map(x => `<tr>
        <td>${esc(x.cv)}</td>
        <td>${x.idols.map(i => `<span class="badge brand" style="--c:${i.color}">${esc(i.name)}</span>`).join(' ')}</td>
      </tr>`).join('')}</tbody></table>
      <p class="note" style="margin-top:8px">${list.length} 人。xR公演での登場はキャストに会ったとは数えていません。</p>`
      : `<p class="empty">未回収のキャストはいません。</p>`;
  }else if(f.tab === 'unheard'){
    let list = unheard(st, filt);
    if(f.q){ const q = norm(f.q); list = list.filter(x => x.song._q.includes(q)); }
    if(f.brands.size) list = list.filter(x => f.brands.has(x.song.brand_id));
    list = sortList(list);
    body = list.length ? brandTally(list) + `
      <table class="lst"><thead><tr><th>まだ聴いていない曲</th><th>前回披露</th></tr></thead><tbody>
      ${list.slice(0, 300).map(x => `<tr>
        <td>${esc(x.song.title)}
          <div><span class="badge brand" style="--c:${brandOf(x.song.brand_id).color_primary}">${esc(brandOf(x.song.brand_id).short_name)}</span></div></td>
        <td class="n">${x.last ? `${fmtDate(x.last.date)}<br><span style="font-size:10px">${esc(x.last.venue?.name_short || '')} / ${daysSince(x.last.date)}日前</span>`
          : '<span style="font-size:10px">条件内の披露なし</span>'}</td>
      </tr>`).join('')}</tbody></table>
      <p class="note" style="margin-top:8px">${list.length} 曲（表示は先頭300件）</p>`
      : `<p class="empty">条件に合う未回収曲はありません。</p>`;
  }else if(f.tab === 'orig'){
    let list = origMissing(st, filt);
    if(f.q){ const q = norm(f.q); list = list.filter(x => x.song._q.includes(q)); }
    if(f.brands.size) list = list.filter(x => f.brands.has(x.song.brand_id));
    list = sortList(list);
    body = list.length ? brandTally(list) + `
      <table class="lst"><thead><tr><th>オリメン未回収</th><th>前回のオリメン披露</th></tr></thead><tbody>
      ${list.map(x => `<tr>
        <td>${esc(x.song.title)}
          <div><span class="badge brand" style="--c:${brandOf(x.song.brand_id).color_primary}">${esc(brandOf(x.song.brand_id).short_name)}</span>
          ${x.heard ? '<span class="badge part">曲は聴いた</span>' : ''}</div></td>
        <td class="n">${x.last ? `${fmtDate(x.last.date)}<br><span style="font-size:10px">${esc(x.last.venue?.name_short || '')} / ${daysSince(x.last.date)}日前</span>`
          : '<span style="font-size:10px">条件内の披露なし</span>'}</td>
      </tr>`).join('')}</tbody></table>
      <p class="note" style="margin-top:8px">${list.length} 曲</p>`
      : `<p class="empty">オリメン未回収の曲はありません。</p>`;
  }else{
    let list = DB.songs.slice();
    if(f.q){ const q = norm(f.q); list = list.filter(s => s._q.includes(q)); }
    if(f.brands.size) list = list.filter(s => f.brands.has(s.brand_id));
    if(!f.includeExtra) list = list.filter(s => !isExtra(s));
    // count順対応: 回数を付与してソート
    let listWithCount = list.map(s => ({ s, count: st.songN.get(s.song_id) || 0 }));
    if(f.sort === 'count') listWithCount.sort((a, b) => b.count - a.count);
    else if(f.sort === 'title') listWithCount.sort((a, b) => a.s.title.localeCompare(b.s.title, 'ja'));
    else listWithCount.sort((a, b) => a.s.title.localeCompare(b.s.title, 'ja')); // デフォルト曲名順
    body = `
      <table class="lst"><thead><tr><th>楽曲</th><th>オリメン</th><th>聴いた</th></tr></thead><tbody>
      ${listWithCount.slice(0, 400).map(({s, count}) => `<tr>
        <td>${esc(s.title)}
          <div><span class="badge brand" style="--c:${brandOf(s.brand_id).color_primary}">${esc(brandOf(s.brand_id).short_name)}</span>
          ${s.tags.map(t => `<span class="badge none">${esc(t)}</span>`).join('')}</div></td>
        <td style="font-size:10.5px;color:var(--ink-soft)">${esc(s.original_members.map(i => DB.idol[i]?.name || i).join('・') || '—')}</td>
        <td class="n">${count}回${st.origSeen.has(s.song_id) ? '<br><span class="badge orig">オリメン済</span>' : ''}</td>
      </tr>`).join('')}</tbody></table>
      <p class="note" style="margin-top:8px">${listWithCount.length} 曲（表示は先頭400件）</p>`;
  }

  view.innerHTML = `
  <section class="sec">
    <h2 class="sec-h">楽曲と回収</h2>
    <p class="sec-note">前回披露は、下の「対象にする規模・種別」で絞った公演だけを見て計算する。</p>
    <div class="chips" style="margin-bottom:8px">
      ${tabBtn('unheard', '未回収楽曲')}${tabBtn('orig', 'オリメン未回収')}${tabBtn('never', 'ライブ未披露')}${tabBtn('cast', '未回収キャスト')}${tabBtn('all', '楽曲DB')}
    </div>
    <div class="chips" style="margin-bottom:10px;flex-wrap:wrap;gap:4px">
      <span class="note" style="align-self:center;margin-right:2px;font-size:11px">ブランド</span>
      <button class="chip mini" type="button" data-qbrand="" aria-pressed="${f.brands.size === 0}" style="font-weight:${f.brands.size === 0 ? 'bold' : 'normal'}">全て</button>
      ${DB.brands.map(b => `<button class="chip mini" type="button" data-qbrand="${esc(b.brand_id)}" aria-pressed="${f.brands.size === 1 && f.brands.has(b.brand_id)}" style="border-color:${b.color_primary};${f.brands.size === 1 && f.brands.has(b.brand_id) ? 'background:' + b.color_primary + ';color:#fff;font-weight:bold' : ''}">${esc(b.short_name)}</button>`).join('')}
    </div>
    ${(f.tab === 'cast' || f.tab === 'never') ? '' : `<div class="chips" style="margin-bottom:12px">
      <span class="note" style="align-self:center;margin-right:4px">並び順</span>
      <button class="chip mini" type="button" data-sort="recent" aria-pressed="${f.sort === 'recent'}">最終披露が新しい順</button>
      <button class="chip mini" type="button" data-sort="old" aria-pressed="${f.sort === 'old'}">古い順</button>
      <button class="chip mini" type="button" data-sort="count" aria-pressed="${f.sort === 'count'}">披露回数順</button>
      <button class="chip mini" type="button" data-sort="title" aria-pressed="${f.sort === 'title'}">曲名順</button>
      <button class="chip mini" type="button" data-extra aria-pressed="${f.includeExtra}">リミックス・カバーも含める</button>
    </div>`}
    <details class="filters">
      <summary>対象にする規模・種別</summary>
      <div class="frow"><input type="search" id="q" placeholder="曲名で検索" value="${esc(f.q)}"></div>
      <div class="frow"><b>会場規模</b><div class="chips">
        ${DB.scales.map(s => `<button class="chip mini" type="button" data-sc="${s.id}" aria-pressed="${scales.includes(s.id)}">${s.label}</button>`).join('')}
      </div>
      <div class="chips" style="margin-top:6px">
        <button class="chip mini" type="button" data-preset="all">すべて</button>
        <button class="chip mini" type="button" data-preset="hall">ホール以上</button>
        <button class="chip mini" type="button" data-preset="arena">アリーナ以上</button>
      </div></div>
      <div class="frow"><b>公演種別</b><div class="chips">
        ${DB.eventTypes.map(e => `<button class="chip mini" type="button" data-ev="${e.id}" aria-pressed="${events.includes(e.id)}">${e.label}</button>`).join('')}
      </div></div>
      <div class="frow"><b>ブランド</b><div class="chips">
        ${chips(DB.brands.map(b => ({ id: b.brand_id, label: b.short_name })), f.brands, 'brands')}
      </div></div>
    </details>
    ${body}
  </section>`;

  view.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { f.tab = b.dataset.tab; viewSongs(); }));
  view.querySelectorAll('[data-sort]').forEach(b => b.addEventListener('click', () => { f.sort = b.dataset.sort; renderKeepScroll(viewSongs); }));
  view.querySelector('[data-extra]')?.addEventListener('click', () => { f.includeExtra = !f.includeExtra; renderKeepScroll(viewSongs); });
  view.querySelector('#q')?.addEventListener('input', e => { f.q = e.target.value; renderKeepScroll(viewSongs); });
  view.querySelectorAll('[data-sc]').forEach(b => b.addEventListener('click', () => {
    const cur = new Set(f.scales ?? DB.scales.map(s => s.id));
    cur.has(b.dataset.sc) ? cur.delete(b.dataset.sc) : cur.add(b.dataset.sc);
    f.scales = [...cur]; renderKeepScroll(viewSongs);
  }));
  view.querySelectorAll('[data-ev]').forEach(b => b.addEventListener('click', () => {
    const cur = new Set(f.events ?? DB.eventTypes.map(e => e.id));
    cur.has(b.dataset.ev) ? cur.delete(b.dataset.ev) : cur.add(b.dataset.ev);
    f.events = [...cur]; renderKeepScroll(viewSongs);
  }));
  view.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    const p = b.dataset.preset;
    f.scales = p === 'all' ? null
      : DB.scales.filter(s => s.rank >= (p === 'hall' ? 2 : 3)).map(s => s.id);
    renderKeepScroll(viewSongs);
  }));
  view.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => {
    const set = f[b.dataset.f];
    set.has(b.dataset.v) ? set.delete(b.dataset.v) : set.add(b.dataset.v);
    renderKeepScroll(viewSongs);
  }));
  // ブランドクイックフィルタ（楽曲ページ上部の単独選択ボタン）
  view.querySelectorAll('[data-qbrand]').forEach(b => b.addEventListener('click', () => {
    const bid = b.dataset.qbrand;
    if (!bid) { f.brands.clear(); }
    else { f.brands.clear(); f.brands.add(bid); }
    renderKeepScroll(viewSongs);
  }));
  // ライブ未披露タブのブランドフィルタ
  view.querySelectorAll('[data-neverbrand]').forEach(b => b.addEventListener('click', () => {
    f.neverBrand = b.dataset.neverbrand;
    renderKeepScroll(viewSongs);
  }));
}

/* ---------------- view: settings ---------------- */

/* ---------------- ティア表 ---------------- */
let tierSel = null;   // 選択中の live_id

function viewTier(){
  const st = S.get();
  const attended = DB.lives.filter(l => st.attendance[l.live_id]);
  if(!attended.length){
    view.innerHTML = `<h1 class="sec-h">ライブ ティア表</h1>
      <p class="empty">半券をもぎった公演がありません。<br>「半券」タブで行った公演を選ぶと、ここに並びます。</p>`;
    return;
  }
  const item = l => {
    const b = brandOf(l.brand_id);
    const sel = tierSel === l.live_id;
    return `<button class="tchip${sel ? ' on' : ''}" type="button" data-live="${l.live_id}"
      style="--c:${b.color_primary}" title="${esc(l.title)}">
      <b>${esc(l.title)}</b><small>${esc(l.date.replace(/-/g, '.'))}${l.day_label ? ' ' + esc(l.day_label) : ''}</small></button>`;
  };
  const pool = attended.filter(l => !st.tiers[l.live_id]);

  view.innerHTML = `
    <h1 class="sec-h">ライブ ティア表</h1>
    <p class="sec-note">半券をもぎった ${attended.length} 公演を S〜F に並べられます。
      公演をタップして選び、置きたい段をタップします。もう一度タップで選択解除。</p>

    <div class="tier">
      ${S.TIERS.map(t => `
        <div class="tier-row" data-tier="${t.id}">
          <div class="tier-label" style="background:${t.color}">${t.id}</div>
          <div class="tier-slot">${attended.filter(l => st.tiers[l.live_id] === t.id).map(item).join('') || '<span class="tier-hint">ここをタップして入れる</span>'}</div>
        </div>`).join('')}
    </div>

    <h2 class="sec-h" style="margin-top:18px">未評価 <span class="note">${pool.length}</span></h2>
    <div class="tier-row plain" data-tier="">
      <div class="tier-slot">${pool.map(item).join('') || '<span class="tier-hint">すべて評価済みです</span>'}</div>
    </div>

    <div class="acts" style="margin-top:16px">
      <button class="btn" type="button" data-shot>画像を保存</button>
      <button class="btn ghost" type="button" data-reset>すべて未評価に戻す</button>
    </div>
    <p class="note">画像には評価済みの段だけが入ります。</p>
  `;

  view.querySelectorAll('[data-live]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    tierSel = tierSel === b.dataset.live ? null : b.dataset.live;
    renderKeepScroll(viewTier);
  }));
  view.querySelectorAll('[data-tier]').forEach(row => row.addEventListener('click', () => {
    if(!tierSel) return;
    S.setTier(tierSel, row.dataset.tier || null);
    tierSel = null;
    renderKeepScroll(viewTier);
  }));
  view.querySelector('[data-reset]').addEventListener('click', () => {
    attended.forEach(l => S.setTier(l.live_id, null));
    tierSel = null; renderKeepScroll(viewTier);
  });
  view.querySelector('[data-shot]').addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '書き出し中…';
    try{
      const rows = S.TIERS.map(t => ({
        id: t.id, color: t.color,
        items: attended.filter(l => S.get().tiers[l.live_id] === t.id).map(l => ({
          label: l.title, sub: l.date.replace(/-/g, '.') + (l.day_label ? ' ' + l.day_label : ''),
          color: brandOf(l.brand_id).color_primary
        }))
      })).filter(r => r.items.length);
      if(!rows.length){ toast('評価済みの公演がありません'); return; }
      const blob = await renderTierCard(rows);
      const d = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      download(blob, `ticketnote_tier_${d}.png`);
    }catch(err){ toast('画像を作れませんでした'); console.error(err); }
    finally{ btn.disabled = false; btn.textContent = '画像を保存'; }
  });
}

function viewSettings(){
  const s = S.get();
  const rules = [
    ['csv', 'CSVのフラグを優先', 'setlists の is_original を使う。空欄の行だけ自動判定で補う（推奨）'],
    ['auto_full', '完全一致のみ', '歌唱メンバーがオリメンと完全に一致したときだけ回収とみなす'],
    ['auto_superset', 'オリメン全員いればOK', 'ゲストが加わっていてもオリメンが揃っていれば回収とみなす']
  ];
  view.innerHTML = `
  <section class="sec">
    <h2 class="sec-h">あなたの設定</h2>
    <div class="frow"><b class="note">画像に入れる名前（任意）</b>
      <input type="text" id="dn" value="${esc(s.profile.displayName)}" placeholder="例：プロデューサー"></div>
  </section>

  <section class="sec">
    <h2 class="sec-h">オリメン判定のルール</h2>
    <p class="sec-note">個々の曲はセットリスト画面からいつでも上書きできる。上書きはこのルールより優先される。</p>
    ${rules.map(([id, t, d]) => `<button class="opt" data-rule="${id}"
      aria-pressed="${s.settings.originalRule === id}">${t}<small>${d}</small></button>`).join('')}
    <p class="note">個別に上書きした行：${Object.keys(s.origOverride).length} 件
      ${Object.keys(s.origOverride).length ? '<button class="chip mini" data-clearov>上書きを全部消す</button>' : ''}</p>
  </section>

  <section class="sec">
    <h2 class="sec-h">見た目</h2>
    <button class="opt" data-dark aria-pressed="${s.settings.dark}">開演前モード<small>暗転した客席の配色にする</small></button>
  </section>

  <section class="sec">
    <h2 class="sec-h">データの持ち出し</h2>
    <p class="sec-note">参戦記録はこの端末のブラウザにだけ保存される。機種変更の前に書き出しておく。</p>
    <div class="btnrow">
      <button class="btn" data-export>JSONを書き出す</button>
      <button class="btn ghost" data-import>JSONを読み込む</button>
      <button class="btn ghost" data-reset>記録を全部消す</button>
    </div>
    <input type="file" id="file" accept="application/json" hidden>
  </section>

  <section class="sec">
    <h2 class="sec-h">データベースの状態</h2>
    <p class="sec-note">公演 ${DB.lives.length} / 楽曲 ${DB.songs.length} / アイドル ${DB.idols.length} / セトリ ${DB.rows.length} 行</p>
    ${DB.warnings.length ? `<div class="warn"><b>整合性の警告 ${DB.warnings.length} 件</b><br>
      ${DB.warnings.slice(0, 20).map(esc).join('<br>')}</div>` : '<p class="note">整合性の警告はありません。</p>'}
    <div class="warn">公演・セットリストは提供された情報から起こしたもので、<b>すべて未検証</b>（<code>verified=false</code>）です。
      公演を足すときは <code>data/_source/lives/*.txt</code> に追記して
      <code>node scripts/build-lives.mjs</code>、楽曲は <code>data/_source/songs.tsv</code> に追記して
      <code>node scripts/build-songs.mjs</code> を実行してください。</div>
  </section>`;

  view.querySelector('#dn').addEventListener('change', e => { S.setProfile('displayName', e.target.value.trim()); toast('保存しました'); });
  view.querySelectorAll('[data-rule]').forEach(b => b.addEventListener('click', () => { S.setSetting('originalRule', b.dataset.rule); viewSettings(); }));
  view.querySelector('[data-clearov]')?.addEventListener('click', () => {
    Object.keys(S.get().origOverride).forEach(k => S.setOverride(k, null)); viewSettings(); toast('上書きを消しました');
  });
  view.querySelector('[data-dark]').addEventListener('click', () => {
    S.setSetting('dark', !S.get().settings.dark); applyTheme(); viewSettings();
  });
  view.querySelector('[data-export]').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S.get(), null, 2)], { type: 'application/json' });
    download(blob, `ticketnote-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`);
  });
  const file = view.querySelector('#file');
  view.querySelector('[data-import]').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files[0]; if(!f) return;
    try{ S.replaceAll(JSON.parse(await f.text())); applyTheme(); viewSettings(); toast('読み込みました'); }
    catch(e){ toast('このファイルは読み込めません'); }
  });
  view.querySelector('[data-reset]').addEventListener('click', () => {
    if(confirm('参戦記録と設定をすべて消します。元に戻せません。よろしいですか？')){ S.clearAll(); viewSettings(); toast('消しました'); }
  });
}

/* ---------------- scope + theme + router ---------------- */
function scopeSheet(){
  const s = S.get().settings;
  const stages = s.stages || ['cast'];
  openSheet(`
    <h3>何を「回収した」と数えるか</h3>
    <p class="sub">配信やxRを足すと回収率がどれだけ上がるかを見られます。</p>

    <b class="note">参戦のしかた</b>
    ${Object.entries(S.SCOPES).map(([id, o]) => `
      <button class="opt" data-scope="${id}" aria-pressed="${s.scope === id}">${o.label}
        <small>${o.modes.map(m => S.MODE_LABEL[m]).join(' / ')}</small></button>`).join('')}

    <b class="note" style="display:block;margin-top:14px">ライブの形式</b>
    ${Object.entries(S.STAGES).map(([id, o]) => `
      <button class="opt" data-stage="${id}" aria-pressed="${stages.includes(id)}">${o.label}
        <small>${o.note}</small></button>`).join('')}
    <p class="note"><b>現地で観た公演は、この選択に関係なく必ず数えます。</b>
      ここで効くのは配信・アーカイブで観た分だけです。
      xR公演に現地参戦していれば楽曲は回収されますが、キャストに会ったとは数えません。</p>

    <b class="note" style="display:block;margin-top:14px">フルじゃない披露の扱い</b>
    ${Object.entries(S.VERSION_MODES).map(([id, o]) => `
      <button class="opt" data-vmode="${id}" aria-pressed="${(s.versionMode || 'all') === id}">${o.label}
        <small>${o.note}</small></button>`).join('')}

    <button class="btn ghost wide" data-close>閉じる</button>
  `, root => {
    root.querySelectorAll('[data-scope]').forEach(b => b.addEventListener('click', () => {
      S.setSetting('scope', b.dataset.scope); syncScope(); scopeSheet(); route();
    }));
    root.querySelectorAll('[data-vmode]').forEach(b => b.addEventListener('click', () => {
      S.setSetting('versionMode', b.dataset.vmode); syncScope(); scopeSheet(); route();
    }));
    root.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', () => {
      const cur = new Set(S.get().settings.stages || ['cast']);
      cur.has(b.dataset.stage) ? cur.delete(b.dataset.stage) : cur.add(b.dataset.stage);
      S.setSetting('stages', [...cur]); syncScope(); scopeSheet(); route();
    }));
    root.querySelector('[data-close]').addEventListener('click', closeSheet);
  });
}
function syncScope(){
  const s = S.get().settings;
  const stages = s.stages || [];
  const tail = stages.length === 2 ? '' : stages[0] === 'xr' ? ' / xRのみ' : stages.length ? '' : ' / 形式未選択';
  document.getElementById('scopeBtn').textContent = S.SCOPES[s.scope].label + tail;
}
function applyTheme(){
  const dark = !!S.get().settings.dark;
  document.body.classList.toggle('dark', dark);
  if(dark) startPenlightShow(); else stopPenlightShow();
}

/* ---- 開演前モード: ペンライト演出 ---- */
let penlightTimer = null;

function stopPenlightShow(){
  if(penlightTimer){ clearInterval(penlightTimer); penlightTimer = null; }
  const stage = document.getElementById('penlight-stage');
  if(stage) stage.innerHTML = '';
}

function startPenlightShow(){
  stopPenlightShow();
  const stage = document.getElementById('penlight-stage');
  if(!stage) return;

  const colors = DB?.idols?.map(i => i.color).filter(Boolean) || [];
  if(!colors.length) return;

  stage.innerHTML = '';

  // グリッドのマスサイズに合わせて配置（背景のグリッドは24px）
  const CELL = 24; // app.css の background-size と同じ
  const cols = Math.ceil(window.innerWidth / CELL);
  const rows = Math.ceil(window.innerHeight / CELL);

  // 全マスのうちランダムに間引いて配置（密度35%くらい）
  const DENSITY = 0.35;

  for(let r = 0; r < rows; r++){
    for(let c = 0; c < cols; c++){
      if(Math.random() > DENSITY) continue;

      const color = colors[Math.floor(Math.random() * colors.length)];
      // マス中央 ± 小ジッター
      const x = (c + 0.5) * CELL + (Math.random() * 6 - 3);
      const y = (r + 0.5) * CELL + (Math.random() * 6 - 3);
      // 高さ14〜26px（グリッドマスの0.6〜1.1倍程度）
      const h = 14 + Math.floor(Math.random() * 12);
      // 振り角: 小さく ±10〜25度
      const base = 10 + Math.floor(Math.random() * 15);
      const jitter = Math.random() * 8 - 4;
      const dur = (1.8 + Math.random() * 3.0).toFixed(2);
      const delay = (Math.random() * -6).toFixed(2);
      // 明るさにばらつき（奥行き感）
      const peakOp = (0.4 + Math.random() * 0.5).toFixed(2);

      const wrap = document.createElement('div');
      wrap.className = 'penlight';
      wrap.style.cssText = [
        `left:${x}px`,
        `top:${y}px`,
        `--pcolor:${color}`,
        `--plh:${h}px`,
      ].join(';');

      const inner = document.createElement('div');
      inner.className = 'penlight-wrap';
      inner.style.cssText = [
        `--dur:${dur}s`,
        `--delay:${delay}s`,
        `--a0:${-(base + jitter)}deg`,
        `--a1:${ (base - jitter)}deg`,
      ].join(';');

      const glow = document.createElement('div');
      glow.className = 'penlight-glow';
      glow.style.cssText = [
        `--dur:${dur}s`,
        `--delay:${delay}s`,
        `--peak-op:${peakOp}`,
      ].join(';');

      inner.appendChild(glow);
      wrap.appendChild(inner);
      stage.appendChild(wrap);
    }
  }

  // 定期的にランダムなペンライトの色を変化させる
  penlightTimer = setInterval(() => {
    if(!document.body.classList.contains('dark')){ stopPenlightShow(); return; }
    const glows = stage.querySelectorAll('.penlight-glow');
    // 一度に数本まとめて変色（波及感）
    const count = 3 + Math.floor(Math.random() * 5);
    for(let i = 0; i < count; i++){
      const idx = Math.floor(Math.random() * glows.length);
      const gl = glows[idx];
      if(!gl) continue;
      const newColor = colors[Math.floor(Math.random() * colors.length)];
      gl.style.background = `linear-gradient(to top, transparent, ${newColor} 50%, rgba(255,255,255,0.9))`;
      gl.style.boxShadow = [
        `0 0 3px 1px ${newColor}`,
        `0 0 8px 3px ${newColor}88`,
        `0 0 18px 5px ${newColor}44`,
      ].join(',');
      // 親のCSS変数も更新
      const wp = gl.closest('.penlight');
      if(wp) wp.style.setProperty('--pcolor', newColor);
    }
  }, 800);
}

/* ---------------- view: 準備タブ ---------------- */
// 準備リスト用のステート（localStorageで永続化）
const PREP_KEY = 'ticketnote.preplist';
function loadPrepList(){ try{ return JSON.parse(localStorage.getItem(PREP_KEY) || '[]'); }catch{ return []; } }
function savePrepList(list){ localStorage.setItem(PREP_KEY, JSON.stringify(list)); }

function viewPrep(){
  const prepList = loadPrepList();
  const scope = S.get().settings.scope;
  const st = compute(scope);

  // 楽曲の披露情報を計算するヘルパー
  function getSongStats(songId){
    const allRows = DB.rows.filter(r => r.song_id === songId);
    const count = allRows.length;
    if(count === 0) return { count: 0, lastDate: null, lastLive: null, daysSinceStr: 'DBに披露記録なし' };
    const sorted = allRows
      .map(r => ({ row: r, live: DB.live[r.live_id] }))
      .filter(x => x.live?.date)
      .sort((a, b) => b.live.date.localeCompare(a.live.date));
    const latest = sorted[0];
    if(!latest) return { count, lastDate: null, lastLive: null, daysSinceStr: '日付不明' };
    const days = daysSince(latest.live.date);
    const daysStr = days < 30 ? `${days}日前` : days < 365 ? `約${Math.round(days/30)}ヶ月前` : `約${Math.round(days/365*10)/10}年前`;
    return { count, lastDate: latest.live.date, lastLive: latest.live, daysSinceStr: daysStr };
  }

  // 準備リストに含まれる曲の詳細
  const prepItems = prepList.map(songId => {
    const song = DB.song[songId];
    if(!song) return null;
    const stats = getSongStats(songId);
    const brand = brandOf(song.brand_id);
    return { songId, song, stats, brand };
  }).filter(Boolean);

  view.innerHTML = `
  <section class="sec">
    <h2 class="sec-h">次ライブへの準備</h2>
    <p class="sec-note">予習したい曲を登録しておくリスト。過去の披露回数・最終披露情報も確認できます。</p>

    <div style="position:relative;margin-bottom:16px">
      <input type="search" id="prep-q" placeholder="曲名で検索して追加…" autocomplete="off" style="padding-right:40px">
      <div id="prep-suggest" class="song-suggest" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:10"></div>
    </div>

    ${prepItems.length === 0
      ? `<p class="empty">まだ曲が登録されていません。<br>上の検索欄から追加してください。</p>`
      : `<ul class="prep-list">${prepItems.map(({ songId, song, stats, brand }) => `
        <li class="prep-item">
          <span class="pi-body">
            <span class="pi-title">${esc(song.title)}</span>
            <span class="pi-meta">
              <span class="badge brand" style="--c:${brand.color_primary}">${esc(brand.short_name)}</span>
              　DB全体での披露: <b>${stats.count}回</b>
              ${stats.lastLive ? ` ／ 最終: ${esc(stats.lastLive.title || '')}（${esc(stats.daysSinceStr)}）` : ' ／ 披露記録なし'}
            </span>
          </span>
          <button class="pi-del" data-del="${esc(songId)}" title="リストから削除">×</button>
        </li>`).join('')}
      </ul>
      <button class="btn ghost" data-clear-prep style="margin-top:8px;font-size:12px">リストを全部消す</button>`
    }
  </section>`;

  // 検索サジェスト
  const qEl = view.querySelector('#prep-q');
  const sugEl = view.querySelector('#prep-suggest');
  let sugTimer = null;

  qEl.addEventListener('input', () => {
    clearTimeout(sugTimer);
    const q = norm(qEl.value.trim());
    if(!q){ sugEl.style.display = 'none'; return; }
    sugTimer = setTimeout(() => {
      const hits = DB.songs.filter(s => s._q.includes(q) && !prepList.includes(s.song_id)).slice(0, 15);
      if(!hits.length){ sugEl.style.display = 'none'; return; }
      sugEl.innerHTML = hits.map(s => {
        const stats = getSongStats(s.song_id);
        const b = brandOf(s.brand_id);
        return `<button class="song-suggest-item" data-add="${esc(s.song_id)}">
          <b>${esc(s.title)}</b>
          <small>${esc(b.short_name)} ／ DB披露 ${stats.count}回${stats.lastDate ? ' ／ 最終: ' + fmtDate(stats.lastDate) : ''}</small>
        </button>`;
      }).join('');
      sugEl.style.display = 'block';
    }, 120);
  });

  document.addEventListener('click', e => {
    if(!sugEl.contains(e.target) && e.target !== qEl) sugEl.style.display = 'none';
  }, { once: false });

  sugEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-add]');
    if(!btn) return;
    const list = loadPrepList();
    if(!list.includes(btn.dataset.add)){ list.push(btn.dataset.add); savePrepList(list); }
    qEl.value = '';
    sugEl.style.display = 'none';
    viewPrep();
  });

  view.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const list = loadPrepList().filter(id => id !== b.dataset.del);
    savePrepList(list);
    viewPrep();
  }));

  view.querySelector('[data-clear-prep]')?.addEventListener('click', () => {
    if(confirm('準備リストを全部消しますか？')){ savePrepList([]); viewPrep(); }
  });
}

/* ---------------- セトリ表ラベル生成ヘルパー ---------------- */
function _liveMatrixLabel(live) {
  // 行1: ツアー略称（tours.name_short 優先）
  const tour = DB.tour?.[live.tour_id];
  let tourShort = '';
  if (tour?.name_short) {
    tourShort = tour.name_short;
  } else {
    const brand = DB.brand[live.brand_id];
    const bShort = brand ? brand.short_name : '';
    tourShort = live.title
      .replace(/THE IDOLM@STER\s*/i, '')
      .replace(/765PRO ALLSTARS\s*/i, '')
      .replace(/IDOLM@STER\s*/i, '')
      .replace(bShort, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 14);
  }
  // 行2: day_label 正規化（"DAY1"→"D1", "昼公演"→"昼", 空→""）
  const dayLabel = (live.day_label || '')
    .replace(/DAY(\d)/i, 'D$1')
    .replace(/公演$/, '')
    .trim();
  // 行3: YYYY/MM/DD
  const dateStr = live.date.slice(0, 10).replace(/-/g, '/');
  return { tourShort, dayLabel, dateStr };
}

/* ---------------- view: セトリ表 ---------------- */
function viewHeatmap(){
  const hm = ui.heatmap || (ui.heatmap = { selected: new Set(), brand: '' });

  // ブランド並び: DB.brands は sort_order 順（765AS→CG→ML→SideM→SC→学マス→他）
  const availBrands = DB.brands
    .filter(b => !b.is_pseudo && DB.idols.some(i => i.brand_id === b.brand_id))
    .map(b => b.brand_id);
  const activeBrand = hm.brand || '765as';

  // 選択ブランドのアイドル一覧
  const brandIdols = DB.idols.filter(i => i.brand_id === activeBrand && i.is_active !== 'false');

  if(hm.lastBrand !== activeBrand){
    hm.selected.clear();
    hm.lastBrand = activeBrand;
  }

  const selectedIdols = brandIdols.filter(i => hm.selected.has(i.idol_id));

  const brandSelector = `
    <div class="chips" style="margin-bottom:10px;flex-wrap:wrap;gap:4px">
      ${availBrands.map(bid => {
        const b = DB.brand[bid];
        return `<button class="chip mini" type="button" data-hmb="${esc(bid)}"
          style="border-color:${b.color_primary};${activeBrand===bid?'background:'+b.color_primary+';color:#fff;font-weight:bold':''}"
          aria-pressed="${activeBrand===bid}">${esc(b.short_name)}</button>`;
      }).join('')}
    </div>`;

  const idolSelector = `
    <div class="idol-selector" style="margin-bottom:12px">
      ${brandIdols.slice(0, 80).map(i => `
        <button class="ichip${hm.selected.has(i.idol_id) ? ' on' : ''}" type="button"
          style="--c:${i.color}" data-idol="${esc(i.idol_id)}">${esc(i.name)}</button>`).join('')}
    </div>`;

  if(selectedIdols.length === 0){
    view.innerHTML = `
    <section class="sec">
      <h2 class="sec-h">出演マトリクス</h2>
      <p class="sec-note">アイドルを選ぶと、そのアイドルが歌った曲（縦軸）× ブランド内全ライブ（横軸）で出演状況を一覧できます。<br>
        ★=オリメン歌唱　●=歌唱　薄灰=参加・この曲は未披露　ほぼ透明=不参加</p>
      ${brandSelector}
      <p class="sec-note">アイドルを選択（複数可）：</p>
      ${idolSelector}
      <p class="note" style="margin-top:8px">アイドルを選択するとマトリクス表が表示されます。</p>
    </section>`;
    _wireHeatmap();
    return;
  }

  const selectedIds = new Set(selectedIdols.map(i => i.idol_id));

  // ブランド内の全ライブ（時系列順）
  const allBrandLives = DB.lives
    .filter(l => l.brand_id === activeBrand)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.day_label||'').localeCompare(b.day_label||''));

  // アイドルが参加したライブID（=そのライブで performers に含まれる行が存在する）
  const idolParticipatedLives = new Set();
  DB.rows.forEach(r => {
    if(r.performers.some(p => selectedIds.has(p))) idolParticipatedLives.add(r.live_id);
  });

  // アイドルが歌った全曲（全ライブ横断）
  const songSet = new Set();
  DB.rows.forEach(r => {
    if(r.performers.some(p => selectedIds.has(p))) songSet.add(r.song_id);
  });

  if(songSet.size === 0){
    view.innerHTML = `<section class="sec"><h2 class="sec-h">出演マトリクス</h2>
      ${brandSelector}${idolSelector}
      <p class="empty">選択したアイドルの歌唱記録が見つかりませんでした。</p>
    </section>`;
    _wireHeatmap();
    return;
  }

  const songs = [...songSet].map(sid => DB.song[sid]).filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title, 'ja'));

  // cells[songId][liveId] = 'orig'|'sung'|null
  const cells = {};
  songs.forEach(s => { cells[s.song_id] = {}; });
  DB.rows.forEach(r => {
    if(!cells[r.song_id]) return;
    if(r.performers.some(p => selectedIds.has(p))){
      const o = isOriginal(r);
      cells[r.song_id][r.live_id] = o === true ? 'orig' : 'sung';
    }
  });

  const MAX_LIVES = Math.min(allBrandLives.length, 100);
  const MAX_SONGS = Math.min(songs.length, 150);
  const dispLives = allBrandLives.slice(0, MAX_LIVES);
  const dispSongs = songs.slice(0, MAX_SONGS);

  const liveHead = dispLives.map(l => {
    const { tourShort, dayLabel, dateStr } = _liveMatrixLabel(l);
    const tip = esc(l.title + (l.day_label ? ' ' + l.day_label : '') + '  ' + l.date);
    const participated = idolParticipatedLives.has(l.live_id);
    const cls = participated ? '' : ' style="opacity:.4"';
    // 3行: ツアー略称 / Day略 / YYYY/MM/DD
    const line1 = esc(tourShort);
    const line2 = dayLabel ? `<span class="lh-day">${esc(dayLabel)}</span>` : '';
    const line3 = `<span class="lh-date">${esc(dateStr)}</span>`;
    return `<th class="live-head" title="${tip}"${cls}>${line1}${line2 ? '<br>' + line2 : ''}<br>${line3}</th>`;
  }).join('');

  const bodyRows = dispSongs.map(s => {
    const tds = dispLives.map(l => {
      const cell = cells[s.song_id]?.[l.live_id];
      const participated = idolParticipatedLives.has(l.live_id);

      if(!participated){
        // 不参加ライブ
        return `<td class="hm-cell absent" title="${esc(l.date)} 不参加">　</td>`;
      }
      if(!cell){
        // 参加したが未披露
        return `<td class="hm-cell off" title="${esc(s.title)} 未披露">　</td>`;
      }
      // 歌唱
      const label = cell === 'orig' ? '★' : '●';
      const cls = cell === 'orig' ? 'orig' : 'part';
      return `<td class="hm-cell ${cls}" title="${esc(s.title)} / ${esc(l.date)}">${label}</td>`;
    }).join('');
    return `<tr><th class="song-name" title="${esc(s.title)}">${esc(s.title)}</th>${tds}</tr>`;
  }).join('');

  view.innerHTML = `
  <section class="sec">
    <h2 class="sec-h">出演マトリクス</h2>
    <p class="sec-note">★=オリメン歌唱　●=歌唱　暗灰=参加・未披露　白透明=不参加</p>
    ${brandSelector}
    ${idolSelector}
    <p class="note" style="margin-bottom:6px">
      選択: ${selectedIdols.map(i => esc(i.name)).join('・')} ／ ${dispLives.length}公演 × ${dispSongs.length}曲
      ${allBrandLives.length > MAX_LIVES ? `（全${allBrandLives.length}公演中先頭${MAX_LIVES}件）` : ''}
      ${songs.length > MAX_SONGS ? `（全${songs.length}曲中先頭${MAX_SONGS}件）` : ''}
    </p>
    <div class="heatmap-wrap">
      <table class="heatmap-table">
        <thead><tr><th class="song-name">楽曲</th>${liveHead}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <div style="margin-top:8px;display:flex;gap:16px;flex-wrap:wrap;font-size:11px;color:var(--ink-soft)">
      <span><b style="color:#E0402F">★</b> オリメン歌唱</span>
      <span><b style="color:#B58A2B">●</b> 歌唱</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:var(--paper-deep);opacity:.35;border-radius:2px;vertical-align:middle"></span> 参加・未披露</span>
      <span><span style="display:inline-block;width:10px;height:10px;background:var(--paper-deep);opacity:.1;border-radius:2px;vertical-align:middle"></span> 不参加</span>
    </div>
  </section>`;

  _wireHeatmap();
}

function _wireHeatmap(){
  view.querySelectorAll('[data-hmb]').forEach(b => b.addEventListener('click', () => {
    ui.heatmap.brand = b.dataset.hmb;
    ui.heatmap.selected.clear();
    ui.heatmap.lastBrand = null;
    renderKeepScroll(viewHeatmap);
  }));
  view.querySelectorAll('[data-idol]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.idol;
    ui.heatmap.selected.has(id) ? ui.heatmap.selected.delete(id) : ui.heatmap.selected.add(id);
    renderKeepScroll(viewHeatmap);
  }));
}

const ROUTES = { '#/lives': viewLives, '#/stats': viewStats, '#/songs': viewSongs, '#/prep': viewPrep, '#/heatmap': viewHeatmap, '#/tier': viewTier, '#/settings': viewSettings };
function route(){
  const hash = ROUTES[location.hash] ? location.hash : '#/lives';
  document.querySelectorAll('#tabs a').forEach(a =>
    a.setAttribute('aria-current', a.getAttribute('href') === hash ? 'page' : 'false'));
  window.scrollTo(0, 0);
  ROUTES[hash]();
}

/* ---------------- boot ---------------- */
(async function boot(){
  S.load();
  applyTheme();
  syncScope();
  document.getElementById('scopeBtn').addEventListener('click', scopeSheet);
  window.addEventListener('hashchange', route);
  try{
    await loadDB();
  }catch(e){
    view.innerHTML = `<div class="warn"><b>データを読み込めませんでした。</b><br>${esc(e.message)}<br>
      ローカルで開く場合は <code>python3 -m http.server</code> などのHTTPサーバ経由で開いてください（file:// では fetch が使えません）。</div>`;
    return;
  }
  // DB読み込み後にペンライト演出を有効化（開演前モード中なら即開始）
  if(S.get().settings.dark) startPenlightShow();
  if(!location.hash) location.hash = '#/lives';
  route();
})();
