// The bundled 0.3.99 package declares TypeScript const enums but does not export
// them at runtime. Values below match obs-studio-node/module.d.ts.
module.exports = Object.freeze({
  Stereo: 2, NV12: 2, CS709: 2, Partial: 1, Bicubic: 2, CommonFPS: 0, ScaleInner: 2,
});
