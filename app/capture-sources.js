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
        if (type === 'screen') {
          // OBS's labels contain DPI-scaled desktop coordinates, not capture pixels.
          const match = name.match(/(\d+)x(\d+)\s*@\s*(-?\d+),\s*(-?\d+)/);
          const display = match && displays.find(d => d.bounds.x === Number(match[3]) && d.bounds.y === Number(match[4])
            && d.size.width === Number(match[1]) && d.size.height === Number(match[2]));
          if (display) name = name.replace(`${match[1]}x${match[2]}`, `${Math.round(display.size.width * display.scaleFactor)}×${Math.round(display.size.height * display.scaleFactor)} 像素`);
          else name = name.replace(/:\s*\d+x\d+\s*@\s*-?\d+,\s*-?\d+/, '');
        }
        sources.push({ id: item.value, type, name });
      }
    } finally { input.release(); }
  }
  return sources;
}
module.exports = { listCaptureSources };
