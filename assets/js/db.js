import { parseCSV, multi, bool, tri } from './csv.js';
import { norm } from './text.js';

const BASE = './data/';

async function grab(path){
  const res = await fetch(BASE + path, { cache: 'no-cache' });
  if(!res.ok) throw new Error(`${path} が読めませんでした (HTTP ${res.status})`);
  return parseCSV(await res.text());
}

export const DB = {
  brands: [], idols: [], units: [], songs: [], venues: [], tours: [], lives: [], rows: [],
  byId: {}, scales: [], eventTypes: [], scaleById: {}, warnings: []
};

const index = (arr, key) => Object.fromEntries(arr.map(o => [o[key], o]));

export async function loadDB(){
  const mani = await (await fetch(BASE + 'manifest.json', { cache: 'no-cache' })).json();
  DB.scales = mani.scales;
  DB.eventTypes = mani.event_types;
  DB.scaleById = index(mani.scales, 'id');

  const [brands, idols, cvs, units, songs, venues, tours, lives] = await Promise.all([
    grab('brands.csv'), grab('idols.csv'), grab('cv_assignments.csv'), grab('units.csv'),
    grab('songs.csv'), grab('venues.csv'), grab('tours.csv'), grab('lives.csv')
  ]);
  const setlistFiles = await Promise.all(mani.setlists.map(grab));

  DB.brands = brands.map(b => ({ ...b, sort_order: +b.sort_order || 999, is_pseudo: bool(b.is_pseudo) }))
    .sort((a, b) => a.sort_order - b.sort_order);
  DB.brand = index(DB.brands, 'brand_id');

  DB.idols = idols.map(i => ({
    ...i,
    color: i.color || (DB.brand[i.brand_id]?.color_primary ?? '#8C8C8C'),
    hasColor: !!i.color,
    alias: multi(i.alias),
    _q: norm([i.name, i.name_kana, i.name_en, i.cv_name, i.alias].join(' '))
  }));
  DB.idol = index(DB.idols, 'idol_id');

  DB.cvHistory = {};
  cvs.forEach(c => (DB.cvHistory[c.idol_id] ||= []).push(c));

  DB.units = units.map(u => ({ ...u, member_idol_ids: multi(u.member_idol_ids), alias: multi(u.alias) }));
  DB.unit = index(DB.units, 'unit_id');

  DB.songs = songs.map(s => ({
    ...s,
    original_members: multi(s.original_members),
    tags: multi(s.tags),
    _q: norm([s.title, s.title_kana, s.source].join(' '))
  }));
  DB.song = index(DB.songs, 'song_id');

  DB.venues = venues.map(v => ({
    ...v,
    rank: DB.scaleById[v.scale]?.rank ?? 0,
    scaleLabel: DB.scaleById[v.scale]?.label ?? v.scale,
    alias: multi(v.alias),
    _q: norm([v.name, v.name_short, v.city, v.prefecture, v.alias].join(' '))
  }));
  DB.venue = index(DB.venues, 'venue_id');

  DB.tours = tours;
  DB.tour = index(tours, 'tour_id');

  DB.lives = lives.map(l => {
    const v = DB.venue[l.venue_id];
    return {
      ...l,
      year: String(l.date).slice(0, 4),
      venue: v,
      scale: v?.scale ?? 'online',
      rank: v?.rank ?? 0,
      tour: DB.tour[l.tour_id],
      performance_type: l.performance_type || 'cast',
      has_stream: bool(l.has_stream), has_lv: bool(l.has_lv), has_archive: bool(l.has_archive),
      _q: norm([l.title, l.day_label, DB.tour[l.tour_id]?.name, DB.tour[l.tour_id]?.name_short,
                v?.name, v?.name_short, v?.alias].join(' '))
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.live_id.localeCompare(b.live_id));
  DB.live = index(DB.lives, 'live_id');

  DB.rows = setlistFiles.flat().map(r => {
    const performers = multi(r.performers);
    return {
      ...r,
      key: `${r.live_id}#${r.seq}`,
      seq: +r.seq,
      performers,
      lineupKey: `${r.song_id}::${performers.slice().sort().join(';')}`,
      is_original: tri(r.is_original),
      is_premiere: bool(r.is_premiere),
      stage_type: r.stage_type || '',
      version: r.version || ''
    };
  });

  // referential integrity — surfaced in the app, never silently swallowed
  DB.rows.forEach(r => {
    if(!DB.live[r.live_id]) DB.warnings.push(`setlist: 未知の live_id "${r.live_id}"`);
    if(!DB.song[r.song_id]) DB.warnings.push(`setlist: 未知の song_id "${r.song_id}" (${r.key})`);
    r.performers.forEach(p => { if(!DB.idol[p]) DB.warnings.push(`setlist: 未知の idol_id "${p}" (${r.key})`); });
  });
  DB.rows = DB.rows.filter(r => DB.live[r.live_id] && DB.song[r.song_id]);

  DB.rowsByLive = {};
  DB.rowsBySong = {};
  DB.rows.forEach(r => {
    (DB.rowsByLive[r.live_id] ||= []).push(r);
    (DB.rowsBySong[r.song_id] ||= []).push(r);
  });
  Object.values(DB.rowsByLive).forEach(a => a.sort((x, y) => x.seq - y.seq));

  return DB;
}

/** CV name valid on a given date (falls back to idols.cv_name). */
export function cvOn(idolId, date){
  const hist = DB.cvHistory[idolId];
  if(hist){
    const hit = hist.find(h => (!h.valid_from || h.valid_from <= date) && (!h.valid_to || date <= h.valid_to));
    if(hit) return hit.cv_name;
  }
  return DB.idol[idolId]?.cv_name || '';
}

/** Auto judgement of how a lineup relates to the song's credited original members. */
export function autoJudge(row){
  const orig = DB.song[row.song_id]?.original_members || [];
  if(!orig.length) return 'UNKNOWN';
  const set = new Set(row.performers);
  const hit = orig.filter(id => set.has(id)).length;
  if(hit === 0) return 'NONE';
  if(hit < orig.length) return 'PARTIAL';
  return set.size === orig.length ? 'FULL' : 'SUPERSET';
}
