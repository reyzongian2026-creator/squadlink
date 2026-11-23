import { channels } from './channels.js';

const bridge = window.squadBridge;
const main = document.getElementById('main');
const footer = document.querySelector('footer');
const column = document.createElement('div');
column.className = 'workspace-column';
const rail = document.createElement('aside');
rail.className = 'channel-rail';
const brand = document.createElement('div');
brand.className = 'channel-brand';
const logo = document.createElement('img');
logo.src = '/icon-192.png';
logo.alt = '';
const name = document.createElement('span');
name.className = 'rail-label';
name.textContent = 'Squadlink';
brand.append(logo, name);
const nav = document.createElement('nav');
nav.className = 'channel-list';
nav.setAttribute('aria-label', 'Canales');
const buttons = new Map();
for (const [key, label, shape] of channels) {
  const button = document.createElement('button');
  button.type = 'button';
  button.title = label;
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(icon.namespaceURI, 'path');
  path.setAttribute('d', shape);
  path.setAttribute('fill','none');
  path.setAttribute('stroke','currentColor');
  path.setAttribute('stroke-width','1.7');
  path.setAttribute('stroke-linecap','round');
  path.setAttribute('stroke-linejoin','round');
  icon.append(path);
  const text = document.createElement('span');
  text.className = 'rail-label';
  text.textContent = label;
  button.append(icon, text);
  button.onclick = () => bridge.postMessage({ type: 'desktop:navigate', page: key });
  buttons.set(key, button);
  nav.append(button);
}
rail.append(brand, nav);
const sectionTitle = document.createElement('h1');
sectionTitle.className = 'workspace-heading';
function updateSection() {
  const section = document.body.dataset.workspace;
  const title = buttons.get(section)?.title ?? ({lobby:'Sala de voz',settings:'Dispositivos de audio'})[section];
  sectionTitle.textContent = title || 'Lobby';
  for (const [key, button] of buttons) {
    if (key === section || (key === 'home' && section === 'lobby')) button.setAttribute('aria-current','page');
    else button.removeAttribute('aria-current');
  }
}
document.body.classList.add('desktop-shell');
main.before(rail,column);
column.append(sectionTitle, main);
if (footer) {
  footer.classList.add('workspace-footer');
  column.append(footer);
}
new MutationObserver(updateSection).observe(document.body, { attributes: true, attributeFilter: ['data-workspace'] });
updateSection();
