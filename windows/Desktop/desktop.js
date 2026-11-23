import { desktopNickname, enterFromWindows, onConfirmedGuest, canReleaseGuestWorkspace, openDesktopProgress } from './app.js';
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

const pageIds = new Set(Object.values(pages).flat());
let section = 'lobby';
function show(next) {
  if (!Object.hasOwn(pages, next)) return;
  section = next;
  document.body.dataset.workspace = next;
  for (const id of pageIds) {
    byId(id).classList.toggle('desktop-inactive', !pages[next].includes(id));
  }
  profile.hidden = next !== 'player';
  if (next !== 'lobby' && document.body.classList.contains('in-match')) byId('compact').click();
  if (['player','ranking','arcade'].includes(next)) openDesktopProgress();
  if (next === 'settings') byId('audio-panel').open = true;

  document.scrollingElement.scrollTop = 0;
}

const friendRows = byId('friends');
const memberRows = byId('members');
const requestRows = byId('room-requests');

function sameRows(current, next) {
  return current.length === next.length && current.every((text, index) => text === next[index]);
}

// The host accepts 32 KiB of JSON. Bound each of the 25 contact and five member
// lines even when the serializer escapes every non-ASCII UTF-16 code unit.
function rosterLine(parts) {
  const text = parts.filter(Boolean).join(' · ');
  let budget = 960;
  let end = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    const cost = code < 32 || code > 126 ? 6 * character.length : character === '"' || character === '\\' ? 2 : 1;
    if (cost > budget) return text.slice(0, end) + '…';
    budget -= cost;
    end += character.length;
  }
  return text;
}

let previous;
let contacts = [];
let members = [];
let hasMoreContacts = false;
let requests = 0;
let inRoom = !byId('room').hidden;
function sync(records = observer.takeRecords()) {
  if (!previous || records.some(record => friendRows.contains(record.target))) {
    const rows = friendRows.querySelectorAll('.social-row');
    hasMoreContacts = rows.length > 25;
    const next = Array.prototype.slice.call(rows, 0, 25).map(row => rosterLine([
      row.querySelector('strong')?.textContent,
      row.querySelector('p.status')?.textContent || (row.querySelector('.dot.online') ? 'En línea' : 'Desconectado')
    ]));
    if (!sameRows(contacts, next)) contacts = next;
  }
  if (!previous || records.some(record => memberRows.contains(record.target))) {
    const next = Array.prototype.slice.call(memberRows.querySelectorAll('li'), 0, 5).map(row => rosterLine([
      row.querySelector('strong')?.textContent,
      ...Array.from(row.querySelectorAll('small'), detail => detail.textContent)
    ]));
    if (!sameRows(members, next)) members = next;
  }
  if (!previous || records.some(record => requestRows.contains(record.target))) {
    requests = requestRows.querySelectorAll('[data-action="admit"]').length;
  }
  const joined = !byId('room').hidden;
  if (joined !== inRoom) {
    inRoom = joined;
    show('lobby');
  }
  const state = {
    type: 'desktop:state', section, joined, nickname: desktopNickname(), identified: /^[A-F0-9]{16}$/i.test(byId('friend-id').textContent),
    requests,
    code: joined ? byId('room-code').textContent : '',
    voiceStatus: joined ? byId('voice-status').textContent.slice(0,140) : '',
    contacts, members, hasMoreContacts,
    name: joined ? byId('room-name').textContent : '',
    mic: byId('mic').getAttribute('aria-pressed') === 'true',
    canMic: joined && !byId('mic').disabled,
    canLeave: joined && !byId('leave').disabled
  };
  if (!previous || Object.keys(state).some(key => state[key] !== previous[key])) {
    previous = state;
    bridge.postMessage(state);
  }
}
const observer = new MutationObserver(sync);
observer.observe(roomPanel, {attributeFilter: ['hidden']});
observer.observe(byId('mic'), {attributeFilter: ['disabled', 'aria-pressed']});
observer.observe(byId('leave'), {attributeFilter: ['disabled']});
const textChanges = {childList: true, characterData: true, subtree: true};
for (const id of ['room-name', 'friend-id', 'members', 'room-code', 'voice-status']) {
  observer.observe(byId(id), textChanges);
}
observer.observe(friendRows, {...textChanges, attributeFilter: ['class']});
observer.observe(requestRows, {childList: true, subtree: true, attributeFilter: ['data-action']});
let releaseTimer;
bridge.addEventListener('message', ({data}) => {
  if (data?.type === 'desktop:submit') {
    clearTimeout(releaseTimer);
    enterFromWindows(data.data).then(
      () => bridge.postMessage({type:'desktop:entry-result',token:data.token}),
      err => bridge.postMessage({type:'desktop:entry-result',token:data.token,error:err.message})
    );
    return;
  }
  if (data?.type !== 'desktop:action') return;
  document.body.classList.toggle("low-power", data.low === true);
  clearTimeout(releaseTimer);
  if (data.action === 'background') {
    for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    if (!data.low) return;
    releaseTimer = setTimeout(async () => {
      if (await canReleaseGuestWorkspace()) bridge.postMessage({type:'desktop:release', visit:data.visit});
    }, 3000);
  } else if (data.action === 'login') {
    show('friends');
    if (!byId('social-login').hidden && !byId('entry').open) byId('social-login').click();
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
onConfirmedGuest(() => bridge.postMessage({type: 'desktop:session', status: 'guest'}));
