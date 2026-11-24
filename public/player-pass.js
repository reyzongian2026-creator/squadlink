// A nickname is a display label. The pre-existing device key identifies the player on every server.
const slots = {
  deviceKey: 'squadlink.device.v1', nick: 'squadlink.nick',
  contacts: 'squadlink.contacts.v1', receipt: 'squadlink.progress.receipt.v1',
};
const importing = 'squadlink.pass-import.v1';
const secret = /^[a-f0-9]{64}$/;
export const maxPassBytes = 65536;
const invalid = () => Error('Este archivo no es un pase de Squadlink válido.');

function validNick(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 24 && !/[\u0000-\u001f\u007f]/.test(value);
}
export function readPass(raw) {
  if (typeof raw !== 'string' || raw.length > maxPassBytes) throw invalid();
  let value;
  try { value = JSON.parse(raw); } catch { throw invalid(); }
  if (value?.format !== 'squadlink-player-v1' || typeof value.deviceKey !== 'string' || !secret.test(value.deviceKey)
    || !validNick(value.nick) || !Array.isArray(value.contacts) || value.contacts.length > 64
    || typeof value.receipt !== 'string' || value.receipt.length > 12000
    || (value.receipt && !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.receipt))) throw invalid();
  const contacts = value.contacts.map(c => {
    if (!c || typeof c.id !== 'string' || !/^[A-F0-9]{16}$/.test(c.id) || !validNick(c.nick)
      || typeof c.token !== 'string' || !secret.test(c.token)) throw invalid();
    return {id:c.id,nick:c.nick,token:c.token};
  });
  return {format:value.format,deviceKey:value.deviceKey,nick:value.nick.trim(),contacts,receipt:value.receipt};
}
export function getPlayerPass(storage) {
  const contacts = JSON.parse(storage.getItem(slots.contacts) || '[]');
  return readPass(JSON.stringify({format:'squadlink-player-v1',deviceKey:storage.getItem(slots.deviceKey),
    nick:storage.getItem(slots.nick),contacts,receipt:storage.getItem(slots.receipt) || ''}));
}
export function finishImport(storage) {
  const raw = storage.getItem(importing);
  if (!raw) return;
  const pass = readPass(raw);
  const current = storage.getItem(slots.deviceKey);
  if (current && current !== pass.deviceKey) throw Error('Ya hay otro jugador guardado en este dispositivo.');
  storage.setItem(slots.deviceKey,pass.deviceKey);
  storage.setItem(slots.nick,pass.nick);
  storage.setItem(slots.contacts,JSON.stringify(pass.contacts));
  if (pass.receipt) storage.setItem(slots.receipt,pass.receipt);
  else storage.removeItem(slots.receipt);
  storage.removeItem(importing);
}
export function importPass(raw,storage) {
  const pass = readPass(raw);
  if (storage.getItem(slots.deviceKey)) throw Error('Ya tienes un jugador en este dispositivo.');
  storage.setItem(importing,JSON.stringify(pass));
  finishImport(storage);
  return pass.nick;
}
function exclusive(task) {
  return globalThis.navigator?.locks ? navigator.locks.request('squadlink-player-v1',task) : Promise.resolve().then(task);
}
export function getPlayerKey() {
  return exclusive(() => {
    finishImport(localStorage);
    let key = localStorage.getItem(slots.deviceKey);
    if (!key) {
      key = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
      localStorage.setItem(slots.deviceKey,key);
    }
    if (!secret.test(key)) throw Error('Tu llave local está dañada. Conserva tu pase de jugador.');
    return key;
  });
}

export function mountPlayerPass({getSelf,tell,signedIn}) {
  const $ = id => document.getElementById(id);
  const bridge = window.squadBridge;
  let lastSaved = '', reported = false;
  function remember() {
    if (!bridge?.savePlayerPass) return;
    let raw;
    try { raw = JSON.stringify(getPlayerPass(localStorage)); } catch { return; }
    if (raw === lastSaved) return;
    lastSaved = raw;
    bridge.savePlayerPass(raw).catch(() => {
      if (lastSaved === raw) lastSaved = '';
      if (!reported) tell('Guarda tu pase de jugador. El respaldo automático del equipo no está disponible.');
      reported = true;
    });
  }
  window.addEventListener('squadlink:player-saved',remember);
  async function restoreDevice() {
    await exclusive(async () => {
      finishImport(localStorage);
      if (!bridge?.loadPlayerPass) return;
      const raw = await bridge.loadPlayerPass();
      if (!raw) return;
      const pass = readPass(raw);
      const current = localStorage.getItem(slots.deviceKey);
      if (!current) { importPass(raw,localStorage); return; }
      if (current !== pass.deviceKey) return;
      if (!localStorage.getItem(slots.nick)) localStorage.setItem(slots.nick,pass.nick);
      if (localStorage.getItem(slots.contacts) === null) localStorage.setItem(slots.contacts,JSON.stringify(pass.contacts));
      if (pass.receipt && !localStorage.getItem(slots.receipt)) localStorage.setItem(slots.receipt,pass.receipt);
    });
  }
  function show(hasPlayer) {
    $('player-pass-hint').textContent = hasPlayer
      ? 'Puedes cambiar de apodo y conservar tu personaje, amigos y récords. Guarda tu pase privado para entrar en otro equipo. Si pierdes tus dispositivos y el pase, perderás el acceso.'
      : 'Elige tu apodo una vez o abre el pase de tu otro equipo.';
    $('player-pass-save').hidden = !hasPlayer;
    $('player-pass-open').hidden = hasPlayer;
    $('player-pass-note').textContent = '';
    $('player-pass-file').value = '';
  }
  $('player-pass-save').onclick = async () => {
    try {
      if (!getSelf()) throw Error('Elige tu apodo primero.');
      await getPlayerKey();
      const raw = JSON.stringify(getPlayerPass(localStorage));
      if (bridge?.exportPlayerPass) {
        if (!await bridge.exportPlayerPass(raw)) return;
      } else {
        const url = URL.createObjectURL(new Blob([raw],{type:'application/octet-stream'}));
        const link = document.createElement('a');
        link.href = url; link.download = 'Mi-jugador.squadlink'; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url),1000);
      }
      $('player-pass-note').textContent = 'Guarda el archivo en un lugar privado. Quien lo tenga puede entrar a tu perfil.';
    } catch(error) { $('player-pass-note').textContent = error.message; }
  };
  $('player-pass-open').onclick = () => $('player-pass-file').click();
  $('player-pass-file').onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (file.size > maxPassBytes) throw invalid();
      const raw = await file.text();
      const nick = await exclusive(() => importPass(raw,localStorage));
      window.dispatchEvent(new window.Event('squadlink:player-restoring'));
      $('nickname').value = nick;
      remember();
      await signedIn(nick);
      show(true);
      tell('Jugador recuperado. Tu pase se guardó en este dispositivo.');
    } catch(error) { $('player-pass-note').textContent = error.message; }
    finally { event.target.value = ''; }
  };
  return {restoreDevice,remember,show};
}
