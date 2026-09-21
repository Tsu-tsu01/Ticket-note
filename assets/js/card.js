import { DB } from './db.js';
import { fmtDateJP, inkOn } from './text.js';
import { get, SCOPES, TIERS } from './store.js';
import { overdueHeard, globalRareSongs, brandRareSongs } from './stats.js';

const W = 1080, H = 1350;
const PAPER = '#E9EEF2', GRID = '#CBD8E3', STUB = '#FCFBF7',
      INK = '#1D2B45', SOFT = '#5B6B85', FAINT = '#93A1B5', STAMP = '#E0402F', EDGE = '#E3DED0';

async function readyFonts(sample){
  if(!document.fonts) return;
  await Promise.all([
    document.fonts.load('900 64px "Zen Maru Gothic"', sample),
    document.fonts.load('700 32px "Zen Maru Gothic"', sample),
    document.fonts.load('500 26px "Zen Kaku Gothic New"', sample),
    document.fonts.load('400 64px "DotGothic16"', '0123456789.%年月日'),
  ]);
  await document.fonts.ready;
}

function clip(ctx, text, max){
  if(ctx.measureText(text).width <= max) return text;
  let s = text;
  while(s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
  return s + '…';
}

function frame(ctx, subtitle){
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = GRID; ctx.lineWidth = 1;
  for(let x = 0; x <= W; x += 36){ ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H); ctx.stroke(); }
  for(let y = 0; y <= H; y += 36){ ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke(); }

  // masthead
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, 6);
  ctx.font = '900 46px "Zen Maru Gothic", sans-serif';
  ctx.fillStyle = INK; ctx.textBaseline = 'alphabetic';
  ctx.fillText('Ticket note', 64, 96);
  ctx.font = '400 20px "DotGothic16", monospace';
  ctx.fillStyle = FAINT;
  ctx.fillText('IM@S LIVE LOG', 320, 94);

  ctx.font = '400 26px "DotGothic16", monospace';
  ctx.fillStyle = SOFT;
  ctx.fillText(subtitle, 64, 138);
  ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(64, 162); ctx.lineTo(W - 64, 162); ctx.stroke();
}

function footer(ctx){
  ctx.font = '400 18px "DotGothic16", monospace';
  ctx.fillStyle = FAINT;
  ctx.fillText('Ticket note / 非公式ファンメイドツール', 64, H - 48);
}

function panel(ctx, x, y, w, h){
  ctx.fillStyle = STUB; ctx.strokeStyle = EDGE; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
}

function bigNums(ctx, items, y){
  const cols = items.length;
  const gap = 18, total = W - 128, cw = (total - gap * (cols - 1)) / cols;
  items.forEach((it, i) => {
    const x = 64 + i * (cw + gap);
    panel(ctx, x, y, cw, 150);
    ctx.textAlign = 'center';
    ctx.font = '400 64px "DotGothic16", monospace';
    ctx.fillStyle = INK;
    ctx.fillText(String(it.v), x + cw / 2, y + 88);
    ctx.font = '500 22px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = SOFT;
    ctx.fillText(it.k, x + cw / 2, y + 124);
    ctx.textAlign = 'left';
  });
  return y + 150 + 30;
}

function heading(ctx, text, y){
  ctx.fillStyle = STAMP;
  ctx.save(); ctx.translate(70, y - 10); ctx.rotate(Math.PI / 4); ctx.fillRect(-7, -7, 14, 14); ctx.restore();
  ctx.font = '700 30px "Zen Maru Gothic", sans-serif';
  ctx.fillStyle = INK;
  ctx.fillText(text, 92, y);
  return y + 26;
}

function barList(ctx, y, items){
  const max = Math.max(...items.map(i => i.n), 1);
  items.forEach((it, i) => {
    const top = y + i * 54;
    const w = (W - 128 - 120) * (it.n / max);
    ctx.fillStyle = '#DCE4EB';
    ctx.beginPath(); ctx.roundRect(64, top, W - 128 - 120, 40, 5); ctx.fill();
    ctx.fillStyle = it.color || FAINT; ctx.globalAlpha = .5;
    ctx.beginPath(); ctx.roundRect(64, top, Math.max(w, 8), 40, 5); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = '500 25px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = INK;
    ctx.fillText(clip(ctx, it.label, W - 128 - 140), 80, top + 28);
    ctx.textAlign = 'right';
    ctx.font = '400 28px "DotGothic16", monospace';
    ctx.fillStyle = SOFT;
    ctx.fillText(String(it.n) + (it.unit || ''), W - 64, top + 29);
    ctx.textAlign = 'left';
  });
  return y + items.length * 54 + 24;
}

const BUILDERS = {
  summary(ctx, st){
    let y = heading(ctx, 'まとめ', 250);
    y = bigNums(ctx, [
      { k: '参戦公演', v: st.liveCount },
      { k: '聴いた曲', v: st.songTotal },
      { k: 'ユニーク曲', v: st.uniqueSongs },
      { k: '編成', v: st.uniqueLineups }
    ], y + 6);

    const done = [...st.origSeen].length, poss = st.origPossible.size;
    y = bigNums(ctx, [
      { k: 'オリメン回収', v: (poss ? Math.round(done / poss * 100) : 0) + '%' },
      { k: '初披露立会', v: st.premiere },
      { k: 'レア度', v: st.rarity }
    ], y);

    y = heading(ctx, 'よく聴いた曲', y + 10);
    const items = st.top(st.songN, 6).map(([sid, n]) => {
      const s = DB.song[sid];
      return { label: s?.title ?? sid, n, unit: '回',
               color: DB.brand[s?.brand_id]?.color_primary };
    });
    barList(ctx, y + 6, items);
  },

  songs(ctx, st){
    let y = heading(ctx, 'よく聴いた曲 TOP10', 250);
    const items = st.top(st.songN, 10).map(([sid, n]) => {
      const s = DB.song[sid];
      return { label: s?.title ?? sid, n, unit: '回', color: DB.brand[s?.brand_id]?.color_primary };
    });
    y = barList(ctx, y + 10, items);
    ctx.font = '500 22px "Zen Kaku Gothic New", sans-serif';
    ctx.fillStyle = SOFT;
    ctx.fillText(`ユニーク ${st.uniqueSongs} 曲 / 総披露 ${st.songTotal} 回 / 一期一会 ${st.onceOnly} 曲`, 64, y + 10);
  },

  idols(ctx, st){
    const hasXR = st.idolN.size > 0;
    const hasCast = st.cvN.size > 0;
    let y = 250;
    if(hasXR){
      y = heading(ctx, 'xRで見たアイドル TOP10', y);
      const items = st.top(st.idolN, 10).map(([id, n]) => {
        const i = DB.idol[id];
        return { label: i?.name ?? id, n, unit: '曲', color: i?.color };
      });
      y = barList(ctx, y + 10, items);
    }
    if(hasCast){
      y = heading(ctx, 'よく遭遇したキャスト TOP10', y + (hasXR ? 20 : 0));
      const items = st.top(st.cvN, 10).map(([cv, n]) => ({ label: cv, n, unit: '曲', color: FAINT }));
      barList(ctx, y + 10, items);
    }
  },

  original(ctx, st){
    let y = heading(ctx, 'オリメン回収率', 250);
    y += 10;
    st.origByBrand.forEach((b, i) => {
      const top = y + i * 62;
      ctx.font = '500 25px "Zen Kaku Gothic New", sans-serif';
      ctx.fillStyle = INK;
      ctx.fillText(b.brand.short_name, 64, top + 26);
      const bx = 260, bw = W - 64 - bx - 150;
      ctx.fillStyle = '#DCE4EB';
      ctx.beginPath(); ctx.roundRect(bx, top + 8, bw, 22, 11); ctx.fill();
      ctx.fillStyle = b.brand.color_primary;
      ctx.beginPath(); ctx.roundRect(bx, top + 8, Math.max(bw * (b.done / b.total), 6), 22, 11); ctx.fill();
      ctx.textAlign = 'right';
      ctx.font = '400 26px "DotGothic16", monospace';
      ctx.fillStyle = SOFT;
      ctx.fillText(`${b.done}/${b.total}`, W - 64, top + 30);
      ctx.textAlign = 'left';
    });
    y += st.origByBrand.length * 62 + 20;
    const done = st.origSeen.size, poss = st.origPossible.size;
    bigNums(ctx, [
      { k: '回収済み', v: done },
      { k: '回収可能', v: poss },
      { k: '回収率', v: (poss ? Math.round(done / poss * 100) : 0) + '%' }
    ], y);
  },


  rare(ctx, st){
    const fmtGap = (days) => {
      if(days < 365) return days + '日ぶり';
      const y2 = Math.floor(days / 365), m = Math.floor((days % 365) / 30);
      return y2 + '年' + (m ? m + 'ヶ月' : '') + 'ぶり';
    };
    const items = globalRareSongs(st, 15).filter(x => x.gapDays >= 0);
    let y = heading(ctx, 'レア度 Top 15（ブランド横断）', 250);
    y += 10;
    const max = items[0]?.gapDays || 1;
    items.forEach((x, i) => {
      const top = y + i * 54;
      const color = DB.brand[x.song?.brand_id]?.color_primary || FAINT;
      const bw = (W - 128 - 160) * (x.gapDays / max);
      ctx.fillStyle = '#DCE4EB';
      ctx.beginPath(); ctx.roundRect(64, top, W - 128 - 160, 40, 5); ctx.fill();
      ctx.fillStyle = color; ctx.globalAlpha = .5;
      ctx.beginPath(); ctx.roundRect(64, top, Math.max(bw, 8), 40, 5); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = '500 22px "Zen Kaku Gothic New", sans-serif';
      ctx.fillStyle = INK;
      ctx.fillText(clip(ctx, (i+1) + '. ' + (x.song?.title || x.sid), W - 128 - 180), 80, top + 27);
      ctx.textAlign = 'right';
      ctx.font = '400 22px "DotGothic16", monospace';
      ctx.fillStyle = SOFT;
      ctx.fillText(fmtGap(x.gapDays), W - 64, top + 27);
      ctx.textAlign = 'left';
    });
  },

  overdue(ctx, st){
    const fmtD = (days) => {
      if(days < 365) return days + '日前';
      const y2 = Math.floor(days / 365), m = Math.floor((days % 365) / 30);
      return y2 + '年' + (m ? m + 'ヶ月' : '') + '前';
    };
    const items = overdueHeard(st, 50).filter(x => (st.songN.get(x.sid) || 0) >= 2 && x.days >= 365).slice(0, 15);
    let y = heading(ctx, 'そろそろ再会したい曲 Top 15', 250);
    y += 10;
    const max = items[0]?.days || 1;
    items.forEach((x, i) => {
      const top = y + i * 54;
      const color = DB.brand[x.song?.brand_id]?.color_primary || FAINT;
      const bw = (W - 128 - 140) * (x.days / max);
      ctx.fillStyle = '#DCE4EB';
      ctx.beginPath(); ctx.roundRect(64, top, W - 128 - 140, 40, 5); ctx.fill();
      ctx.fillStyle = color; ctx.globalAlpha = .5;
      ctx.beginPath(); ctx.roundRect(64, top, Math.max(bw, 8), 40, 5); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = '500 22px "Zen Kaku Gothic New", sans-serif';
      ctx.fillStyle = INK;
      ctx.fillText(clip(ctx, (i+1) + '. ' + (x.song?.title || x.sid), W - 128 - 160), 80, top + 27);
      ctx.textAlign = 'right';
      ctx.font = '400 22px "DotGothic16", monospace';
      ctx.fillStyle = SOFT;
      ctx.fillText(fmtD(x.days), W - 64, top + 27);
      ctx.textAlign = 'left';
    });
  },
  venues(ctx, st){
    let y = heading(ctx, '会場ランキング', 250);
    const items = st.top(st.venueN, 8).map(([vid, n]) => ({
      label: DB.venue[vid]?.name ?? vid, n, unit: '回', color: INK
    }));
    y = barList(ctx, y + 10, items);
    y = heading(ctx, '規模の内訳', y + 6);
    const s2 = st.top(st.scaleN, 8).map(([sc, n]) => ({
      label: DB.scaleById[sc]?.label ?? sc, n, unit: '公演', color: STAMP
    }));
    barList(ctx, y + 10, s2);
  }
};

export const CARDS = [
  { id: 'summary',  name: 'まとめ',              desc: '公演数・曲数・オリメン回収率・よく聴いた曲' },
  { id: 'songs',    name: 'よく聴いた曲 TOP10',  desc: '回数順のランキング' },
  { id: 'idols',    name: 'アイドル/キャスト',   desc: 'xRで見たアイドル・よく遭遇したキャスト' },
  { id: 'original', name: 'オリメン回収率',       desc: 'ブランド別の回収状況' },
  { id: 'venues',   name: '会場と規模',           desc: '会場ランキングと規模別の内訳' },
  { id: 'rare',     name: 'レア度 Top 15',        desc: '自分が初めて聴いた時点の直前空白期間が長い曲' },
  { id: 'overdue',  name: 'そろそろ再会したい曲 Top 15', desc: '2回以上聴いた曲で1年以上ご無沙汰の曲' },
];

export async function renderCard(id, st){
  const state = get();
  const dateLabel = fmtDateJP(new Date().toISOString().slice(0, 10)) + '時点';
  const who = state.profile.displayName ? `${state.profile.displayName} / ` : '';
  const subtitle = `${who}${dateLabel} — ${SCOPES[st.scopeKey].label}`;

  await readyFonts('Ticket note アイドル 参戦 回収');

  const dpr = 1;
  const cv = document.createElement('canvas');
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'alphabetic';

  frame(ctx, subtitle);
  (BUILDERS[id] || BUILDERS.summary)(ctx, st);
  footer(ctx);

  return new Promise(res => cv.toBlob(b => res(b), 'image/png'));
}

/* ---------------- ティア表 ---------------- */
/** ティア表は行数で高さが変わるので専用に描く。 */
export async function renderTierCard(rows){
  await readyFonts('Ticket note ティア表 SABCDEF');
  const PAD = 56, LBL = 108, ROW_PAD = 12, CHIP_H = 54, CHIP_GAP = 8;
  const innerW = W - PAD * 2 - LBL;

  const meas = document.createElement('canvas').getContext('2d');
  meas.font = '500 22px "Zen Kaku Gothic New", sans-serif';
  // 各行のチップを折り返して配置する
  const laid = rows.map(r => {
    const lines = [[]];
    let x = 0;
    for(const it of r.items){
      const w = Math.min(innerW - 16, meas.measureText(it.label).width + 46);
      if(x + w > innerW && lines[lines.length - 1].length){ lines.push([]); x = 0; }
      lines[lines.length - 1].push({ ...it, w });
      x += w + CHIP_GAP;
    }
    const h = Math.max(CHIP_H + ROW_PAD * 2, lines.length * (CHIP_H + CHIP_GAP) - CHIP_GAP + ROW_PAD * 2);
    return { ...r, lines, h };
  });

  const bodyH = laid.reduce((a, r) => a + r.h + 10, 0);
  const H2 = Math.max(760, 210 + bodyH + 120);

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H2;
  const ctx = cv.getContext('2d');
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H2);
  ctx.strokeStyle = GRID; ctx.lineWidth = 1;
  for(let x = 0; x <= W; x += 36){ ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, H2); ctx.stroke(); }
  for(let y = 0; y <= H2; y += 36){ ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke(); }
  ctx.fillStyle = INK; ctx.fillRect(0, 0, W, 6);

  const state = get();
  ctx.font = '900 46px "Zen Maru Gothic", sans-serif'; ctx.fillStyle = INK;
  ctx.fillText('Ticket note', PAD, 96);
  ctx.font = '400 20px "DotGothic16", monospace'; ctx.fillStyle = FAINT;
  ctx.fillText('LIVE TIER', 320, 94);
  ctx.font = '700 30px "Zen Maru Gothic", sans-serif'; ctx.fillStyle = INK;
  ctx.fillText('ライブ ティア表', PAD, 152);
  ctx.font = '500 22px "Zen Kaku Gothic New", sans-serif'; ctx.fillStyle = SOFT;
  const who = state.profile.displayName ? state.profile.displayName + ' / ' : '';
  ctx.fillText(who + fmtDateJP(new Date().toISOString().slice(0, 10)) + '時点', PAD, 186);

  let y = 210;
  for(const r of laid){
    ctx.fillStyle = r.color;
    ctx.fillRect(PAD, y, LBL, r.h);
    ctx.fillStyle = '#2A2622';
    ctx.font = '900 44px "Zen Maru Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(r.id, PAD + LBL / 2, y + r.h / 2 + 16);
    ctx.textAlign = 'left';

    ctx.fillStyle = STUB;
    ctx.fillRect(PAD + LBL, y, innerW + 0, r.h);
    ctx.strokeStyle = EDGE; ctx.strokeRect(PAD + LBL + .5, y + .5, innerW, r.h - 1);

    let cy = y + ROW_PAD;
    for(const line of r.lines){
      let cx = PAD + LBL + 8;
      for(const it of line){
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(cx, cy, it.w, CHIP_H);
        ctx.strokeStyle = EDGE; ctx.strokeRect(cx + .5, cy + .5, it.w - 1, CHIP_H - 1);
        ctx.fillStyle = it.color || SOFT; ctx.fillRect(cx, cy, 5, CHIP_H);
        ctx.fillStyle = INK;
        ctx.font = '500 22px "Zen Kaku Gothic New", sans-serif';
        ctx.fillText(clip(ctx, it.label, it.w - 30), cx + 16, cy + 27);
        ctx.font = '400 16px "DotGothic16", monospace'; ctx.fillStyle = FAINT;
        ctx.fillText(it.sub, cx + 16, cy + 46);
        cx += it.w + CHIP_GAP;
      }
      cy += CHIP_H + CHIP_GAP;
    }
    y += r.h + 10;
  }

  ctx.font = '400 18px "Zen Kaku Gothic New", sans-serif';
  ctx.fillStyle = FAINT;
  ctx.fillText('Ticket note / 非公式ファンメイドツール', PAD, H2 - 40);

  return new Promise(res => cv.toBlob(b => res(b), 'image/png'));
}

export function download(blob, filename){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
