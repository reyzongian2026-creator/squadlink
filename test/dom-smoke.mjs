import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './support/http.mjs';

// A DOM emulator validates event handlers and state changes, not layout or media.
export async function domSmoke(Window) {
  const disposals = [];
  const f = fixture({ after: callback => disposals.push(callback) }, { progression: { env: { RENDER: 'true', SQUADLINK_RECEIPT_SECRET: randomBytes(32).toString('hex') } } });
  const player = f.player();
  const win = new Window({ url: 'http://localhost', settings: {
    disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true
  }});
  try {
    win.document.write(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'));
    for (const key of ['document','window','location','history','localStorage','navigator']) {
      Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? win : win[key] });
    }
    let offline = false;
    let holdSession;
    let holdDirectory;
    let lastLeave;
    globalThis.fetch = async (url, options) => {
      if (url === '/api/leave') lastLeave = JSON.parse(options.body);
      if (offline) throw new TypeError("sin conexión simulada");
      const res = await player.request(url, options?.body && JSON.parse(options.body));
      const chunks = [];
      for await (const chunk of res) chunks.push(chunk);
      if (holdSession && url === '/api/session' && !options?.method) {
        const hold = holdSession;
        holdSession = null;
        hold.received();
        await hold.untilReleased;
      }
      if (holdDirectory && url === '/api/directory' && options?.method === 'POST') {
        const hold = holdDirectory;
        holdDirectory = null;
        hold.received();
        await hold.untilReleased;
      }
      return new Response(Buffer.concat(chunks), { status: res.statusCode });
    };
    // Server-Sent Events delivery is exercised separately by the HTTP suite.
    let roomEvents;
    globalThis.EventSource = class extends win.EventTarget {
      constructor() { super(); roomEvents = this; }
      close() {}
    };
    await import('../public/app.js');
    const el = id => win.document.getElementById(id);
    async function until(check, timeout = 3000) {
      const end = performance.now() + timeout;
      while (!check()) {
        if (performance.now() >= end) throw Error('No alcanzó el estado esperado');
        await delay(10);
      }
    }
    el('create').click();
    assert.ok(el('entry').open);
    el('nickname').value = 'Prueba';
    el('name').value = 'Sala QA';
    el('password').value = 'clave-prueba';
    el('entry-form').requestSubmit();
    await until(() => !el('mic').disabled && !el('room').hidden && !el('entry').open);
    const code = el('room-code').textContent;
    const initialVisit = (await player.hit('session')).data.room.members[0].visitId;
    assert.match(code, /^[A-Z0-9]{6}$/);
    assert.equal(el('room-name').textContent, 'Sala QA');
    assert.match(el('privacy').textContent, /clave/);
    assert.match(el('members').textContent, /Prueba/);

    await until(() => el('kit-rank-scope')?.textContent.includes('Menor tiempo'));
    document.querySelector('#kit-options [aria-label="Gorra"]').click();
    el('kit-save').click();
    await until(() => el('kit-status').textContent.includes('Apariencia guardada'));
    assert.equal((await player.hit('progress/profile', {})).data.profile.avatar.headgear, 2);
    document.querySelector('[data-rank="sequence"]').click();
    await until(() => el('kit-rank-scope').textContent.includes('Más rondas seguidas'));

    const outsider = f.player();
    assert.ok((await outsider.hit('directory')).data.rooms.some(item => item.code === code), 'La nueva sala aparece para otro jugador por defecto');
    el('edit-room-fields').click();
    el('directory-game').value = 'VALORANT';
    el('directory-level').value = 'Intermedio';
    el('directory-description').value = 'Para practicar en equipo';
    el('directory-game-code').value = 'QA-PRACTICA';
    el('directory-publish').checked = true;
    el('entry-form').requestSubmit();
    await until(() => !el('entry').open && el('match-code').textContent === 'QA-PRACTICA');
    const listing = (await outsider.hit('directory')).data.rooms.find(item => item.code === code);
    assert.ok(listing);
    assert.equal(listing.description, 'Para practicar en equipo');
    assert.equal(listing.level, 'Intermedio');
    assert.ok(!JSON.stringify(listing).includes('QA-PRACTICA'));
    el('edit-room-fields').click();
    el('directory-publish').checked = false;
    el('entry-form').requestSubmit();
    await until(() => !el('entry').open);
    assert.ok(!(await outsider.hit('directory')).data.rooms.some(item => item.code === code));

    // A different window updates the directory after our edit reaches the server,
    // while the first window is still waiting for its HTTP response.
    let received, release;
    const editReceived = new Promise(resolve => { received = resolve; });
    holdDirectory = {received, untilReleased:new Promise(resolve => { release = resolve; })};
    el('edit-room-fields').click();
    el('directory-description').value = 'Primera edición';
    el('entry-form').requestSubmit();
    await editReceived;
    const recent = await player.hit('directory', {published:false, description:'Última edición'});
    assert.equal(recent.status, 200);
    roomEvents.dispatchEvent(new win.MessageEvent('room', {data:JSON.stringify(recent.data.room)}));
    assert.equal(el('room-description').textContent, 'Última edición');
    release();
    await until(() => !el('submit-entry').disabled);
    assert.equal(el('room-description').textContent, 'Última edición', 'Una respuesta antigua no revierte el evento más reciente');

    // The owner exercises the UI, while a separately authenticated client signs its own requests.
    await until(() => /^[A-F0-9]{16}$/.test(el('friend-id').textContent));
    const ownerId = el('friend-id').textContent;
    const visitor = f.player();
    await visitor.hit('session', { nick: 'Luz' });
    const device = await visitor.hit('social/connect', { deviceKey: randomBytes(32).toString('hex'), contacts: [] });
    assert.equal(device.status, 200);
    assert.equal((await visitor.hit('social/request', { id: ownerId })).status, 200);
    win.dispatchEvent(new win.Event('focus'));
    const action = name => document.querySelector('[data-action="' + name + '"]');
    await until(() => action('accept-friend'));
    action('accept-friend').click();
    await until(() => el('friends').textContent.includes('Luz'));
    assert.equal((await visitor.hit('social/game', { game: 'VALORANT' })).status, 200);
    assert.equal((await visitor.hit('social/knock', { id: ownerId })).status, 200);
    win.dispatchEvent(new win.Event('focus'));
    await until(() => action('admit'));
    assert.match(el('friends').textContent, /Jugando VALORANT desde/);
    assert.equal((await visitor.hit('session')).data.room, null);
    action('admit').click();
    await until(() => el('room-requests').hidden);
    const admitted = await visitor.hit('social/enter', {});
    assert.equal(admitted.status, 200);
    assert.equal(admitted.data.room.code, code);
    assert.equal((await visitor.hit('leave', {})).status, 200);

    el('compact').click();
    assert.ok(document.body.classList.contains('in-match'));
    el('compact').click();
    document.querySelector('[data-game="reflex"]').click();
    await until(() => el('game-mount').querySelector('.reflex-pad'));
    el('game-mount').querySelector('button').click();
    await until(() => el('game-mount').textContent.includes('Espera'));
    await until(() => el('game-mount').querySelector('button').dataset.phase === 'go', 5000);
    await delay(180); // Simulate human reaction within the documented 80–3000 ms scoring interval.
    el('game-mount').querySelector('button').click();
    await until(() => el('kit-xp').value > 0);
    const ranking = (await visitor.hit('progress/ranking', { game: 'reflex' })).data;
    assert.ok(ranking.players.some(profile => profile.nick === 'Prueba' && profile.best.reflex >= 80));
    document.querySelector('[data-dismiss="game-dialog"]').click();
    await until(() => !el('game-dialog').open);
    assert.equal(el('room-code').textContent, code);
    offline = true;
    el('leave').click();
    assert.ok(el('mic').disabled);
    await until(() => el('leave').textContent === 'Reintentar salida');
    assert.equal(lastLeave.room, code);
    assert.equal(lastLeave.visitId, initialVisit);
    offline = false;
    el('leave').click();
    await until(() => el('room').hidden);
    const preflight = Promise.withResolvers(), resume = Promise.withResolvers();
    holdSession = {received:preflight.resolve, untilReleased:resume.promise};
    el('create').click();
    el('entry-form').requestSubmit();
    await preflight.promise;
    document.querySelector('[data-dismiss="entry"]').click();
    el('create').click();
    el('name').value = 'Borrador nuevo sin enviar';
    resume.resolve();
    await until(() => !el('submit-entry').disabled);
    assert.ok(el('entry').open && el('room').hidden);
    assert.equal((await player.hit('session')).data.room, null, 'Cancelar antes de enviar evita la creación al volver la red');
    document.querySelector('[data-dismiss="entry"]').click();
    el('join').click();
    assert.equal(el('nickname').value, 'Prueba');
    const friend = f.player();
    await friend.hit('session', { nick: 'Ana' });
    const {data} = await friend.hit('rooms', { name: 'Partida de Ana', password: 'otra-clave' });
    el('code').value = data.room.code;
    el('password').value = 'erronea';
    el('entry-form').requestSubmit();
    await until(() => el('entry-error').textContent.length > 0);
    assert.ok(el('entry').open && el('room').hidden);
    el('password').value = 'otra-clave';
    el('entry-form').requestSubmit();
    await until(() => el('room-name').textContent === 'Partida de Ana' && !el('room').hidden);
    assert.match(el('members').textContent, /Ana/);
    assert.match(el('members').textContent, /Prueba/);
    console.log('DOM y HTTP: personaje, XP, ranking, publicación y retiro de sala, privacidad del código, amistad, actividad, admisión a sala protegida, código manual, arcade, preferencias de apodo y reintento de salida verificados.');
  } finally {
    for (const dispose of disposals) dispose();
    await win.happyDOM.abort();
  }
}
if (process.argv.includes('--run')) {
  const { Window } = await import(process.env.HAPPY_DOM_MODULE || 'happy-dom');
  await domSmoke(Window);
}
