const { compareVersions } = require('./updater');

const versionPattern = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const validBuild = build => Number.isInteger(build) && build >= 1 && build <= 65535;

function updateKey({ version, build = 1 }) {
  if (typeof version !== 'string' || !versionPattern.test(version) || !validBuild(build)) throw Error('无效的更新版本或构建号');
  return build === 1 ? version : `${version}-b${build}`;
}

function parseUpdateKey(key) {
  const match = typeof key === 'string' && /^([\d.]+)(?:-b([1-9]\d{0,4}))?$/.exec(key);
  if (!match || !versionPattern.test(match[1])) return null;
  const build = match[2] ? Number(match[2]) : 1;
  return validBuild(build) && match[2] !== '1' ? { version: match[1], build } : null;
}

function compareUpdateKeys(left, right) {
  const a = parseUpdateKey(left), b = parseUpdateKey(right);
  if (!a || !b) throw Error('无效的更新身份');
  return compareVersions(a.version, b.version) || a.build - b.build;
}

module.exports = { updateKey, parseUpdateKey, compareUpdateKeys };
