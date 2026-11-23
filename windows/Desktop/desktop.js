const byId = id => document.getElementById(id);
const bridge = window.chrome.webview;
const pages = {
  lobby: ['home', 'room', 'news'],
  rooms: ['directory'],
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
  for (const [page, ids] of Object.entries(pages)) {
    for (const id of ids) byId(id).classList.toggle('desktop-inactive', page !== next);
  }
  profile.hidden = next !== 'player';
  if (next !== 'lobby' && document.body.classList.contains('in-match')) byId('compact').click();
  if (next === 'settings') byId('audio-panel').open = true;
  if (next === 'rooms') byId('directory-refresh').click();
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
    type: 'desktop:state', section, joined,
    name: joined ? byId('room-name').textContent : '',
    mic: byId('mic').getAttribute('aria-pressed') === 'true',
    canMic: joined && !byId('mic').disabled,
    canLeave: joined && !byId('leave').disabled
  };
  const key = JSON.stringify(state);
  if (key !== previous) { previous = key; bridge.postMessage(state); }
}
const observer = new MutationObserver(sync);
for (const id of ['room', 'mic', 'leave', 'room-name']) {
  observer.observe(byId(id), {attributes:true, attributeFilter:['hidden','disabled','aria-pressed'], childList:true, characterData:true, subtree:id === 'room-name'});
}
bridge.addEventListener('message', ({data}) => {
  if (data?.type !== 'desktop:action') return;
  if (Object.hasOwn(pages, data.action)) {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    show(data.action);
  } else if (inRoom && ['mic','leave'].includes(data.action)) {
    byId(data.action).click();
  }
  sync();
});
show('lobby');
sync();
