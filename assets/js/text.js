// Japanese-friendly search normalisation: NFKC, hiragana->katakana, drop long marks/spaces.
export function norm(s){
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u3041-\u3096]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/[ー－―‐\-・･]/g, '')
    .replace(/\s+/g, '');
}
export const fmtDate = iso => {
  const [y, m, d] = String(iso).split('-');
  return d ? `${y}.${m}.${d}` : (m ? `${y}.${m}` : y);
};
export const fmtDateJP = iso => {
  const [y, m, d] = String(iso).split('-');
  return d ? `${y}年${+m}月${+d}日` : `${y}年${+m || ''}月`;
};
export const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : 0);
export function inkOn(hex){
  const h = (hex || '').replace('#','');
  if(h.length !== 6) return '#1D2B45';
  const lin = [0,2,4].map(i => parseInt(h.slice(i,i+2),16) / 255)
    .map(v => v <= .03928 ? v/12.92 : Math.pow((v+.055)/1.055, 2.4));
  return (.2126*lin[0] + .7152*lin[1] + .0722*lin[2]) > .45 ? '#1D2B45' : '#FFFFFF';
}
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
