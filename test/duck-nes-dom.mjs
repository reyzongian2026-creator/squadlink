// Isolated UI smoke. A DOM implementation is needed only on the test machine.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {NES, Controller} from '../public/duck-nes-core.js';
import {mountDuckNes} from '../public/duck-nes.js';
import {diagnosticCartridge} from './duck-nes-fixture.mjs';

export async function duckNesSmoke(Window) {
  const view = new Window({url: 'http://localhost', settings: {
    disableCSSFileLoading: true, disableJavaScriptFileLoading: true
  }});
  const doc = view.document;
  const mount = doc.createElement('div');
  const status = doc.createElement('p');
  doc.body.append(mount); mount.append(status);
  const callbacks = new Map();
  const contexts = [];
  let timer = 0, videoFrames = 0, soundBuffers = 0, now = 0, session;
  view.requestAnimationFrame = callback => { callbacks.set(++timer, callback); return timer; };
  view.cancelAnimationFrame = id => { callbacks.delete(id); };
  view.AudioContext = class {
    state = 'running'; sampleRate = 48000; currentTime = 0;
    constructor() { contexts.push(this); }
    async resume() {}
    async close() { this.state = 'closed'; }
    createBuffer(channels, count, rate) { return {duration: count / rate, copyToChannel() {}}; }
    createBufferSource() { return {connect() {}, start() { soundBuffers++; }}; }
  };
  view.HTMLCanvasElement.prototype.getContext = () => ({
    createImageData: (width, height) => ({data: new Uint8ClampedArray(width * height * 4)}),
    putImageData: () => { videoFrames++; },
  });
  const core = {Controller, NES: class extends NES {
    constructor(options) { super(options); session = this; }
  }};
  function step() {
    const pending = [...callbacks.values()];
    callbacks.clear(); now += 1000 / 60;
    for (const context of contexts) context.currentTime = now / 1000;
    for (const callback of pending) callback(now);
  }
  function choose(field, file) {
    Object.defineProperty(field, 'files', {configurable: true, value: [file]});
    field.dispatchEvent(new view.Event('change'));
  }

  let dispose = mountDuckNes(mount, status, async () => core);
  try {
    const field = mount.querySelector('input');
    const play = mount.querySelector('[data-control=play]');
    const start = mount.querySelector('[data-control=start]');
    const canvas = mount.querySelector('canvas');
    choose(field, new view.File(['wrong'], 'wrong.nes'));
    await delay(0);
    assert.ok(play.disabled);
    assert.match(status.textContent, /cabecera/);
    choose(field, new view.File([diagnosticCartridge()], 'diagnostico.nes'));
    for (let i=0; play.disabled && i<100; i++) await delay(5);
    assert.equal(play.disabled, false, status.textContent);
    play.click();
    await delay(0);
    for (let i = 0; i < 8; i++) step();
    assert.ok(videoFrames > 0 && videoFrames < 8 && soundBuffers > 0);
    assert.equal(start.hidden, false);
    canvas.getBoundingClientRect = () => ({left: 0, top: 0, width: 512, height: 480});
    const touch = type => new view.PointerEvent(type, {pointerId: 1, pointerType: 'touch', button: 0, clientX: 256, clientY: 240});
    canvas.dispatchEvent(touch('pointerdown'));
    canvas.dispatchEvent(touch('pointerup'));
    assert.deepEqual([session.mmap.zapperX, session.mmap.zapperY], [128, 120]);
    const key = (type,code,target=canvas) => target.dispatchEvent(new view.KeyboardEvent(type,{code,key:code,bubbles:true,cancelable:true}));
    key('keydown','ArrowRight',start);step();key('keyup','ArrowRight',start);
    assert.ok(session.mmap.zapperX > 128,'la mira responde aunque el foco esté en Start');
    key('keydown','Space');step();
    assert.ok(session.cpu.mem[0x10] & 0x10,'Espacio dispara con el teclado');
    for(let i=0;i<4;i++)step();
    canvas.dispatchEvent(touch('pointerdown'));canvas.dispatchEvent(touch('pointerup'));
    start.click();
    assert.equal(session.controllers[1].state[Controller.BUTTON_START], 0x41);
    step();
    assert.ok(session.cpu.mem[0x10] & 0x10, 'un toque rápido llega al cartucho durante un fotograma');
    for (let i = 0; i < 4; i++) step();
    assert.equal(session.cpu.mem[0x10] & 0x10, 0);
    assert.equal(session.controllers[1].state[Controller.BUTTON_START], 0x40);
    play.click();
    assert.equal(callbacks.size, 0);
    assert.equal(contexts[0].state, 'closed');
    play.click(); await delay(0); step();
    assert.equal(play.textContent, 'Pausar');
    dispose(); dispose = null;
    assert.equal(contexts.at(-1).state, 'closed');
    assert.equal(callbacks.size, 0);
    assert.equal(mount.querySelector('canvas'), null);

    // A close while an asynchronous engine import is pending cannot restart a game.
    let finish;
    dispose = mountDuckNes(mount, status, () => new Promise(resolve => { finish = resolve; }));
    choose(mount.querySelector('input'), new view.File([diagnosticCartridge()], 'diagnostico.nes'));
    await delay(0);
    mount.querySelector('[data-control=play]').click();
    dispose(); dispose = null;
    finish(core); await delay(0);
    assert.equal(contexts.at(-1).state, 'closed');
    assert.equal(callbacks.size, 0);
    assert.equal(mount.querySelector('canvas'), null);
    return {videoFrames, soundBuffers, audioContextsClosed: contexts.every(ctx => ctx.state === 'closed')};
  } finally {
    dispose?.();
    await view.happyDOM.abort();
  }
}
if (process.argv.includes('--run')) {
  const {Window} = await import(process.env.HAPPY_DOM_MODULE || 'happy-dom');
  console.log(await duckNesSmoke(Window));
}
