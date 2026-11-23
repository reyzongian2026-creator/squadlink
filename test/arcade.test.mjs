import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openArcade} from '../public/arcade.js';

function harness(t) {
  class Element {
    children = [];
    dataset = {};
    attributes = {};
    listeners = {};
    append(node) { this.children.push(node); }
    replaceChildren(...nodes) { this.children = nodes; }
    addEventListener(type, fn) { this.listeners[type] = fn; }
    setAttribute(name, value) { this.attributes[name] = value; }
    click() { if (!this.disabled) this.listeners.click?.(); }
  }
  const timers = new Map();
  let next = 0;
  const original = globalThis.document;
  globalThis.document = {head:new Element(), createElement:() => new Element(), querySelector:() => undefined};
  t.after(() => { if (original) globalThis.document = original; else delete globalThis.document; });
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => { timers.set(++next, {fn,ms}); return next; });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  return {
    mount: new Element(), timers,
    advance() {
      const [key, {fn}] = [...timers].sort((a,b) => a[1].ms-b[1].ms)[0];
      timers.delete(key);
      fn();
    }
  };
}

test('Reflejos cancela la espera al adelantar el clic y al cerrar el juego', t => {
  const h = harness(t);
  const close = openArcade('reflex', h.mount);
  const [status, board] = h.mount.children;
  const [button] = board.children;
  button.click();
  button.click();
  assert.match(status.textContent, /adelantaste/);
  assert.equal(h.timers.size, 0);
  button.click();
  h.advance();
  assert.equal(button.textContent, '¡Ahora!');
  button.click();
  assert.match(status.textContent, /ms/);
  button.click();
  close();
  assert.equal(h.timers.size, 0);
  assert.equal(h.mount.children.length, 0);
});

test('Memoria valida aciertos y fallos, y libera todos sus temporizadores', t => {
  const h = harness(t);
  t.mock.method(Math, 'random', () => 0);
  const close = openArcade('sequence', h.mount);
  const [status, board] = h.mount.children;
  const [grid, start] = board.children;
  start.click();
  assert.ok(grid.children.every(p => p.disabled));
  while (h.timers.size) h.advance();
  grid.children[0].click();
  assert.match(status.textContent, /Correcto/);
  while (h.timers.size) h.advance();
  grid.children[1].click();
  assert.match(status.textContent, /Completaste 1/);
  start.click();
  close();
  assert.equal(h.timers.size, 0);
});

test('Reflejos clasificado envía el intento sin declarar un puntaje local', async t => {
  const h = harness(t);
  const sent = [];
  const progression = {
    ranked: () => true,
    start: async game => {
      assert.equal(game, 'reflex');
      return {runId:'intento',delayMs:1600};
    },
    finish: async body => {
      sent.push(body);
      return {earned:12, done:true, score:320};
    }
  };
  const close = openArcade('reflex', h.mount, progression);
  const [status, board] = h.mount.children;
  const [target] = board.children;
  target.click();
  await Promise.resolve();
  assert.equal(target.textContent, 'Espera…');
  h.advance();
  target.click();
  await Promise.resolve();
  assert.deepEqual(sent,[{runId:'intento'}]);
  assert.match(status.textContent,/320 ms.*12 XP/);
  close();
});

test('Memoria clasificada envía la respuesta de cada ronda y termina al fallar', async t => {
  const h = harness(t);
  const answers = [];
  const progression = {
    ranked: () => true,
    start: async () => ({runId:'memoria',round:1,sequence:[2]}),
    finish: async body => {
      answers.push(body);
      return body.round === 1
        ? {earned:5,done:false,score:1,round:2,sequence:[2,3]}
        : {earned:0,done:true,score:1};
    }
  };
  const close = openArcade('sequence',h.mount,progression);
  const [status,board] = h.mount.children;
  const [grid,start] = board.children;
  start.click();
  await Promise.resolve();
  while(h.timers.size) h.advance();
  grid.children[2].click();
  await Promise.resolve();
  assert.match(status.textContent,/5 XP/);
  while(h.timers.size) h.advance();
  grid.children[0].click();
  grid.children[1].click();
  await Promise.resolve();
  assert.deepEqual(answers, [
    {runId:'memoria',round:1,answer:[2]},
    {runId:'memoria',round:2,answer:[0,1]},
  ]);
  assert.match(status.textContent,/Completaste 1/);
  close();
});
