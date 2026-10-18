function listCaptureSources(o, displays) {
  const sources = [];
  for (const [type, inputType, key] of [['screen', 'monitor_capture', 'monitor_id'], ['window', 'window_capture', 'window']]) {
    const input = o.InputFactory.create(inputType, `enumerate-${type}-${Date.now()}`);
    try {
      const property = input.properties.get(key) || (type === 'screen' && input.properties.get('monitor'));
      if (!property) continue;
      for (const item of property.details.items) {
        if (item.enabled === false || item.value === '' || item.value === 'Auto') continue;
        let name = item.name;
        let displayId;
        if (type === 'screen') {
          // OBS's labels contain DPI-scaled desktop coordinates, not capture pixels.
          const match = name.match(/(\d+)x(\d+)\s*@\s*(-?\d+),\s*(-?\d+)/);
          const display = match && displays.find(d => d.bounds.x === Number(match[3]) && d.bounds.y === Number(match[4])
            && d.size.width === Number(match[1]) && d.size.height === Number(match[2]));
          if(display)displayId=String(display.id);
          if (display) name = name.replace(`${match[1]}x${match[2]}`, `${Math.round(display.size.width * display.scaleFactor)}×${Math.round(display.size.height * display.scaleFactor)} 像素`);
          else name = name.replace(/:\s*\d+x\d+\s*@\s*-?\d+,\s*-?\d+/, '');
        }
        sources.push({ id: item.value, type, name, ...(displayId ? {displayId} : {}) });
      }
    } finally { input.release(); }
  }
  return sources;
}
function attachCapturePreviews(sources, previews) {
  const windows=previews.filter(p=>p.id.startsWith('window:')),screens=previews.filter(p=>p.id.startsWith('screen:'));
  return sources.map(source=>{
    let candidates;
    if(source.type==='screen')candidates=source.displayId?screens.filter(p=>p.display_id===source.displayId):screens.length===1?screens:[];
    else {
      const title=String(source.name).replace(/^\[[^\]]+\]:\s*/,''),selector=typeof source.id==='string'?source.id.split(':')[0]:'';
      candidates=windows.filter(p=>p.name===title||p.name===selector);
      // OBS selectors and Chromium IDs are different. An ambiguous title must not show another window's content.
      if(sources.filter(s=>s.type==='window'&&String(s.name).replace(/^\[[^\]]+\]:\s*/,'')===title).length>1)candidates=[];
    }
    if(candidates.length!==1)return source;
    try {const image=candidates[0].thumbnail;if(image&&!image.isEmpty())return {...source,thumbnail:image.toDataURL()};}catch{}
    return source;
  });
}
module.exports = { listCaptureSources, attachCapturePreviews };
