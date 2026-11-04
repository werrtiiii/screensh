const path=require('node:path');

// Only filter actual language packs in locale folders; preserve indexes,
// licenses and other resources even when their names resemble a language.
function keepLocaleFile(file) {
  if(!/^(locale|locales)$/i.test(path.basename(path.dirname(file))))return true;
  const name=path.basename(file);
  if(!/^[a-z]{2,3}(?:[-_][a-z0-9]+)*\.(pak|ini)$/i.test(name))return true;
  return /^(en|zh)(?:[-_]|\.)/i.test(name);
}
module.exports={keepLocaleFile};
