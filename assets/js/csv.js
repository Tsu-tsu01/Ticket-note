// Minimal RFC4180-ish CSV parser. No dependencies, works offline.
export function parseCSV(text){
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = [], field = '', i = 0, quoted = false;
  while(i < text.length){
    const c = text[i];
    if(quoted){
      if(c === '"'){
        if(text[i+1] === '"'){ field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if(c === '"'){ quoted = true; i++; continue; }
    if(c === ','){ row.push(field); field = ''; i++; continue; }
    if(c === '\r'){ i++; continue; }
    if(c === '\n'){ row.push(field); field = ''; rows.push(row); row = []; i++; continue; }
    field += c; i++;
  }
  if(field !== '' || row.length){ row.push(field); rows.push(row); }
  if(!rows.length) return [];
  const head = rows.shift().map(s => s.trim());
  return rows
    .filter(r => r.some(v => v !== ''))
    .map(r => { const o = {}; head.forEach((h, k) => o[h] = (r[k] ?? '').trim()); return o; });
}

export const multi = v => (v ? String(v).split(';').map(s => s.trim()).filter(Boolean) : []);
export const bool  = v => String(v).toLowerCase() === 'true';
export const tri   = v => { const s = String(v).toLowerCase(); return s === 'true' ? true : s === 'false' ? false : null; };
