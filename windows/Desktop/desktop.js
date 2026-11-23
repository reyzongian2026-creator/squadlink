import { canReleaseGuestWorkspace } from './app.js';
const byId = id => document.getElementById(id);
const bridge = window.chrome.webview;
byId('hero-title').textContent = 'Mi sala';
const occupants = document.createElement('aside');
occupants.id = 'desktop-members';
const membersTitle = document.createElement('h3');
membersTitle.textContent = 'Participantes';
occupants.setAttribute('aria-label', 'Participantes en la llamada');
occupants.append(membersTitle, byId('members'));
const details = document.createElement('div');
details.className = 'desktop-room-details';
const roomPanel = byId('room');
while (roomPanel.firstChild) details.append(roomPanel.firstChild);
roomPanel.append(details, occupants);

const pages = {
  lobby: ['home', 'room'],
  ranking: ['loadout'],
  friends: ['social'],
  arcade: ['arcade'],
  player: ['loadout'],
  settings: ['desktop-settings']
};

const settings = document.createElement('section');
settings.id = 'desktop-settings';
const heading = document.createElement('h2');
heading.textContent = 'Ajustes de voz';
settings.append(heading, byId('audio-panel'));
byId('main').append(settings);
const profile = document.createElement('button');
profile.type = 'button';
profile.className = 'secondary';
profile.textContent = 'Editar mi apodo';
profile.onclick = () => byId('profile').click();
byId('loadout').before(profile);
profile.dataset.desktopPage = 'player';

let section = 'lobby';
function show(next) {
  if (!Object.hasOwn(pages, next)) return;
  section = next;
  document.body.dataset.workspace = next;
  for (const id of new Set(Object.values(pages).flat())) {
    byId(id).classList.toggle('desktop-inactive', !pages[next].includes(id));
  }
  profile.hidden = next !== 'player';
  if (next !== 'lobby' && document.body.classList.contains('in-match')) byId('compact').click();
  if (next === 'settings') byId('audio-panel').open = true;

  document.scrollingElement.scrollTop = 0;
}

let previous;
let inRoom = !byId('room').hidden;
function sync() {
  const joined = !byId('room').hidden;
  if (joined !== inRoom) {
    inRoom = joined;
    show('lobby');
  }
  const state = {
    type: 'desktop:state', section, joined, identified: /^[A-F0-9]{16}$/i.test(byId('friend-id').textContent),
    name: joined ? byId('room-name').textContent : '',
    mic: byId('mic').getAttribute('aria-pressed') === 'true',
    canMic: joined && !byId('mic').disabled,
    canLeave: joined && !byId('leave').disabled
  };
  const key = JSON.stringify(state);
  if (key !== previous) { previous = key; bridge.postMessage(state); }
}
const observer = new MutationObserver(sync);
for (const id of ['room', 'mic', 'leave', 'room-name', 'friend-id']) {
  observer.observe(byId(id), {attributes:true, attributeFilter:['hidden','disabled','aria-pressed'], childList:true, characterData:true, subtree:id === 'room-name' || id === 'friend-id'});
}
let releaseTimer;
bridge.addEventListener('message', ({data}) => {
  if (data?.type !== 'desktop:action') return;
  clearTimeout(releaseTimer);
  if (data.action === 'background') {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    releaseTimer = setTimeout(async () => {
      if (await canReleaseGuestWorkspace()) bridge.postMessage({type:'desktop:release', visit:data.visit});
    }, 3000);
  } else if (['create','join'].includes(data.action)) {
    show('lobby');
    if (!inRoom) {
      byId(data.action).click();
      if (data.action === 'join' && /^[A-Z0-9]{6}$/.test(data.code || '')) byId('code').value = data.code;
    }
  } else if (Object.hasOwn(pages, data.action)) {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    show(data.action);
  } else if (inRoom && ['mic','leave'].includes(data.action)) {
    byId(data.action).click();
  }
  sync();
});
show('lobby');
sync();
