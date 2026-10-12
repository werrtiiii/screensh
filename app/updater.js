const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG = { repository: '' };

function readConfig(baseDir) {
  const configPath = path.join(baseDir, 'update-config.json');
  try {
    const value = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return { ...DEFAULT_CONFIG, ...value };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function normalizeRepository(value) {
  const raw = String(value || '').trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git\/?$/, '')
    .replace(/^\/+|\/+$/g, '');
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(raw) ? raw : '';
}

function compareVersions(left, right) {
  const parse = value => String(value).replace(/^v/i, '').split(/[+-]/, 1)[0].split('.').map(n => Number.parseInt(n, 10) || 0);
  const a = parse(left), b = parse(right);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) - (b[i] || 0);
  return 0;
}

async function checkForUpdate({ currentVersion, baseDir, repository = process.env.SCREENSH_GITHUB_REPO } = {}) {
  const config = readConfig(baseDir);
  const repo = normalizeRepository(repository || config.repository);
  if (!repo) throw new Error('未配置 GitHub 更新仓库');
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ScreenSh-updater' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
  const release = await response.json();
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find(item => /win-x64(?:-[^/]+)?\.zip$/i.test(item.name || '') && item.browser_download_url);
  const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
  if (!latestVersion) throw new Error('GitHub Release 缺少版本号');
  return {
    repository: repo,
    currentVersion,
    latestVersion,
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    releaseName: release.name || release.tag_name,
    releaseUrl: release.html_url,
    downloadUrl: asset?.browser_download_url || release.html_url,
    assetName: asset?.name || null,
    publishedAt: release.published_at || null,
  };
}

module.exports = { checkForUpdate, compareVersions, normalizeRepository };
