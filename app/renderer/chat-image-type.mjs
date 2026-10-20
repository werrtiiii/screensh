// Clipboard exports and downloaded stickers can carry the wrong extension/MIME.
export function chatImageType(bytes) {
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  const text=String.fromCharCode(...bytes.slice(0,12));
  if(/^GIF8[79]a/.test(text))return 'image/gif';
  if(text.slice(0,4)==='RIFF'&&text.slice(8,12)==='WEBP')return 'image/webp';
  return null;
}
