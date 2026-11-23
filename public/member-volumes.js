// Keep local listening preferences separate from the other player's microphone settings.
const key = 'squadlink.member-volumes.v1';
const limit = 128;
const validId = id => typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id);
const validPercent = n => Number.isInteger(n) && n >= 0 && n <= 100;

export function readMemberVolumes() {
  const volumes = new Map();
  try {
    const entries = JSON.parse(window.localStorage.getItem(key) || '[]');
    if (Array.isArray(entries)) {
      for (const entry of entries.slice(-limit)) {
        if (Array.isArray(entry) && validId(entry[0]) && validPercent(entry[1])) volumes.set(entry[0], entry[1]);
      }
    }
  } catch {}
  return volumes;
}

export function saveMemberVolume(id, percent) {
  if (!validId(id) || !validPercent(percent)) return;
  const volumes = readMemberVolumes();
  volumes.delete(id);
  if (percent !== 100) volumes.set(id, percent);
  try { window.localStorage.setItem(key, JSON.stringify([...volumes].slice(-limit))); } catch {}
}
