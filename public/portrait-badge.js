import {portraitAvatar} from './character-art.js';

const rendered = new WeakMap();
const waiting = new WeakMap();

function showPendingPortraits() {
  if (document.hidden) return;
  document.removeEventListener('visibilitychange', showPendingPortraits);
  for (const badge of document.querySelectorAll('[data-pending-portrait]')) {
    const state = waiting.get(badge);
    if (state) updatePortrait(badge, state.appearance, state.nick);
  }
}

export function portraitBadge() {
  const badge = document.createElement('span');
  badge.className = 'player-portrait';
  badge.setAttribute('aria-hidden', 'true');
  return badge;
}

export function updatePortrait(badge, appearance, nick) {
  if (document.hidden) {
    waiting.set(badge, {appearance,nick});
    badge.dataset.pendingPortrait = '';
    document.addEventListener('visibilitychange', showPendingPortraits);
    return;
  }
  if (waiting.delete(badge)) delete badge.dataset.pendingPortrait;
  const key = appearance
    ? JSON.stringify([appearance.avatar,appearance.level])
    : nick.trim().split(/\s+/).slice(0,2).map(word => [...word][0]).join('').toLocaleUpperCase('es');
  if (rendered.get(badge) === key) return;
  rendered.set(badge, key);
  if (appearance) badge.innerHTML = portraitAvatar(appearance.avatar, appearance.level);
  else badge.textContent = key;
}
