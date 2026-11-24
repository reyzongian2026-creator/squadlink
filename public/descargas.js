const releases = 'https://api.github.com/repos/reyzongian2026-creator/squadlink/releases';
const versionLabel = document.getElementById('version');
const windows = document.getElementById('windows');
const mac = document.getElementById('mac');
const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/;

function versionParts(version) {
  const match = version.match(versionPattern);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? Infinity)];
}

function newer(candidate, current) {
  for (let i = 0; i < current.length; i++) {
    if (candidate[i] !== current[i]) return candidate[i] > current[i];
  }
  return false;
}

async function showLatest() {
  let best = versionParts(versionLabel.textContent);
  const prefix = 'moderno-v';
  const signal = AbortSignal.timeout(5000);
  for (let page = 1; ; page++) {
    const response = await fetch(releases + '?per_page=100&page=' + page, { signal, credentials: 'omit' });
    if (!response.ok) return;
    const batch = await response.json();
    for (const release of batch) {
      if (release.draft || !release.tag_name.startsWith(prefix)) continue;
      const version = release.tag_name.slice(prefix.length);
      const parts = versionParts(version);
      if (!parts || !newer(parts, best)) continue;
      const assets = release.assets.filter(asset => asset.state === 'uploaded' && asset.size > 0);
      const exe = 'Squadlink-Moderno-Setup-x64.exe';
      const zip = 'Squadlink-Moderno-macOS-arm64.zip';
      if (![exe, zip].every(name => assets.some(asset => asset.name === name))) continue;
      const base = 'https://github.com/reyzongian2026-creator/squadlink/releases/download/' + release.tag_name + '/';
      windows.href = base + exe;
      mac.href = base + zip;
      versionLabel.textContent = version;
      best = parts;
    }
    if (batch.length < 100) return;
  }
}

// Los enlaces incorporados en el HTML siguen disponibles si GitHub limita la consulta.
showLatest().catch(() => {}).finally(() => { document.documentElement.dataset.releaseReady = 'true'; });
