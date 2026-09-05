const KEY = 'ticketnote.v1';
const LEGACY_KEY = 'hankencho.v1';

const DEFAULTS = () => ({
  version: 1,
  profile: { displayName: '', tantou: [] },
  attendance: {},        // live_id -> { mode, seat, memo }
  tiers: {},             // live_id -> 'S'|'A'|…|'F'
  origOverride: {},      // "<live_id>#<seq>" -> true | false
  settings: {
    scope: 'onsite',           // onsite | onsite_lv | all
    stages: ['cast'],          // 回収に数えるライブ形式: cast | xr
    versionMode: 'all',        // 回収に数える尺: all | no_medley | full
    originalRule: 'csv',       // csv | auto_full | auto_superset
    scales: null,              // null = all; otherwise array of scale ids used by 前回披露/未回収
    eventTypes: null,
    dark: false
  }
});

let state = DEFAULTS();
const subs = new Set();

export function load(){
  try{
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
    if(raw){
      const p = JSON.parse(raw);
      state = { ...DEFAULTS(), ...p, tiers: p.tiers || {}, settings: { ...DEFAULTS().settings, ...(p.settings || {}) },
                profile: { ...DEFAULTS().profile, ...(p.profile || {}) } };
    }
  }catch(e){ console.warn('保存データを読めなかったため初期化しました', e); }
  return state;
}
export const get = () => state;
export const subscribe = fn => { subs.add(fn); return () => subs.delete(fn); };

function commit(){
  try{ localStorage.setItem(KEY, JSON.stringify(state)); }
  catch(e){ console.warn('保存に失敗しました', e); }
  subs.forEach(fn => fn(state));
}

export function setAttendance(liveId, patch){
  if(patch === null) delete state.attendance[liveId];
  else state.attendance[liveId] = { ...(state.attendance[liveId] || {}), ...patch };
  commit();
}
export function setOverride(key, val){
  if(val === null) delete state.origOverride[key];
  else state.origOverride[key] = val;
  commit();
}
export function setSetting(k, v){ state.settings[k] = v; commit(); }
export function setProfile(k, v){ state.profile[k] = v; commit(); }
export function replaceAll(obj){
  state = { ...DEFAULTS(), ...obj, settings: { ...DEFAULTS().settings, ...(obj.settings || {}) } };
  commit();
}
export function clearAll(){ state = DEFAULTS(); commit(); }

export const VERSION_LABEL = {
  '': 'フル', medley: 'メドレー', half: 'ハーフ', short: 'ショート',
  game: 'ゲームサイズ', acoustic: 'アコースティック'
};
export const VERSION_MODES = {
  all:       { label: 'ぜんぶ数える',       note: 'メドレーもショートも1曲として回収に数える' },
  no_medley: { label: 'メドレーは数えない', note: 'メドレー中の披露は回収に入れない。ショート・ゲームサイズは数える' },
  full:      { label: 'フル尺のみ',         note: 'ショート／ハーフ／ゲームサイズ／メドレーをすべて除く' }
};
/** その披露の尺を、いまの設定で回収に数えるか */
export function versionCounts(version, mode){
  if(mode === 'all') return true;
  if(mode === 'no_medley') return version !== 'medley';
  return !version;
}

export const STAGES = {
  cast: { label: 'キャストライブ', note: '声優本人が歌うライブ' },
  xr:   { label: 'xR / CGライブ', note: 'キャラクターが登場するライブ' }
};
/** 公演または個々の曲を、いま数える形式かどうか */
export function stageCounts(type, allowed){
  if(!type || type === 'mixed') return allowed.length > 0;
  return allowed.includes(type);
}

export const SCOPES = {
  onsite:    { label: '現地のみ',   modes: ['onsite'] },
  onsite_lv: { label: '現地 + LV',  modes: ['onsite', 'lv'] },
  all:       { label: '配信込み',   modes: ['onsite', 'lv', 'stream', 'archive'] }
};
export const MODE_LABEL = { onsite: '現地', lv: 'LV', stream: '配信', archive: 'アーカイブ' };

/** ティア表の割り当て。tier に null を渡すと未評価に戻す。 */
export const TIERS = [
  { id: 'S', color: '#FF7F7F' }, { id: 'A', color: '#FFBF7F' }, { id: 'B', color: '#FFDF7F' },
  { id: 'C', color: '#FFFF7F' }, { id: 'D', color: '#BFFF7F' }, { id: 'E', color: '#7FE5E5' },
  { id: 'F', color: '#BFBFFF' }
];
export function setTier(liveId, tier){
  if(!tier) delete state.tiers[liveId];
  else state.tiers[liveId] = tier;
  commit();
}
