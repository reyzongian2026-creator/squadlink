import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './support/http.mjs';

// A DOM emulator validates event handlers and state changes, not layout or media.
export async function domSmoke(Window) {
  const disposals = [];
  const f = fixture({ after: callback => disposals.push(callback) });
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
    globalThis.fetch = async (url, options) => {
      if (offline) throw new TypeError("sin conexión simulada");
      const res = await player.request(url, options?.body && JSON.parse(options.body));
      const chunks = [];
      for await (const chunk of res) chunks.push(chunk);
      return new Response(Buffer.concat(chunks), { status: res.statusCode });
    };
    // Server-Sent Events delivery is exercised separately by the HTTP suite.
    globalThis.EventSource = class extends win.EventTarget { close() {} };
    await import('../public/app.js');
    const el = id => win.document.getElementById(id);
    async function until(check) {
      const end = performance.now() + 3000;
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
    assert.match(code, /^[A-Z0-9]{6}$/);
    assert.equal(el('room-name').textContent, 'Sala QA');
    assert.match(el('privacy').textContent, /clave/);
    assert.match(el('members').textContent, /Prueba/);
    el('compact').click();
    assert.ok(document.body.classList.contains('in-match'));
    el('compact').click();
    document.querySelector('[data-game="reflex"]').click();
    await until(() => el('game-mount').querySelector('.reflex-pad'));
    el('game-mount').querySelector('button').click();
    assert.match(el('game-mount').textContent, /Espera/);
    document.querySelector('[data-dismiss="game-dialog"]').click();
    await until(() => !el('game-dialog').open);
    assert.equal(el('room-code').textContent, code);
    offline = true;
    el('leave').click();
    assert.ok(el('mic').disabled);
    await until(() => el('leave').textContent === 'Reintentar salida');
    offline = false;
    el('leave').click();
    await until(() => el('room').hidden);
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
    console.log('DOM y HTTP: crear con clave, código, modo partida, jugar, salir, recordar apodo, rechazo de clave y segundo jugador verificados.');
  } finally {
    for (const dispose of disposals) dispose();
    await win.happyDOM.abort();
  }
}
if (process.argv.includes('--run')) {
  const { Window } = await import(process.env.HAPPY_DOM_MODULE || 'happy-dom');
  await domSmoke(Window);
}
