import assert from 'node:assert/strict';
import test from 'node:test';
import {createMusic} from '../public/music.js';
import {radioStations} from '../public/radio-stations.js';

// Run with the same Happy DOM installation used by test/dom-smoke.mjs.
const {Window} = await import(process.env.HAPPY_DOM_MODULE || 'happy-dom');
const flush = () => new Promise(resolve => setImmediate(resolve));

function mountRadio(t) {
  const win = new Window({url:'https://squadlink.test'});
  const doc = win.document, panel = doc.createElement('div');
  doc.body.append(panel);
  for (const [key,value] of Object.entries({window:win, document:doc, navigator:win.navigator, localStorage:win.localStorage})) {
    const original = Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true, value});
    t.after(()=>original ? Object.defineProperty(globalThis,key,original) : delete globalThis[key]);
  }
  t.mock.timers.enable({apis:['setTimeout']});
  const attempts = [], apiCalls = [];
  win.HTMLMediaElement.prototype.play = function () {
    const {promise,resolve,reject} = Promise.withResolvers();
    attempts.push({audio:this,resolve,reject});
    return promise;
  };
  win.HTMLMediaElement.prototype.pause = function () { this.dataset.paused='yes'; };
  win.HTMLMediaElement.prototype.load = function () {};
  const ui = createMusic({mount:panel, api:async(...args)=>apiCalls.push(args)});
  const queue = n => {
    const station=radioStations[n];
    ui.update({code:'PEPE01',music:{queue:[{id:'track-'+n,kind:'radio',stationId:station.id,title:station.name}]}});
  };
  t.after(()=>win.happyDOM.abort());
  queue(0);
  const get = selector => panel.querySelector(selector);
  const listen = () => get('[data-listen]').click();
  listen();
  return {attempts,apiCalls,queue,get,listen,ui};
}

test('rechazar el autoplay y reintentar una emisora lenta vuelve a mostrar el control de reintento',async t=>{
  const {attempts,get,ui}=mountRadio(t);
  attempts[0].reject(new DOMException('El navegador requiere un clic.','NotAllowedError'));
  await flush();
  const retry=get('[data-player] button');
  assert.equal(retry.textContent,'Reproducir');
  retry.click();
  assert.equal(attempts.length,2);
  t.mock.timers.tick(15_000);
  assert.equal(retry.hidden,false);
  assert.equal(retry.textContent,'Reintentar');
  ui.close();
});

test('un play anterior que rechaza tarde no sustituye el estado del intento actual',async t=>{
  const {attempts,get,ui}=mountRadio(t);
  t.mock.timers.tick(15_000);
  const retry=get('[data-player] button');
  retry.click();
  attempts[1].audio.onplaying();
  attempts[1].resolve();
  await flush();
  attempts[0].reject(new DOMException('Intento anterior.','NotSupportedError'));
  await flush();
  t.mock.timers.tick(1000);
  assert.equal(attempts.length,2);
  assert.equal(get('.music-notice').textContent,'');
  assert.equal(retry.hidden,true);
  ui.close();
});

test('silenciar, cambiar de emisora y salir cancelan una reproducción pendiente y sus eventos tardíos',async t=>{
  const {attempts,apiCalls,queue,get,listen,ui}=mountRadio(t);
  const first=attempts[0];
  const waiting=first.audio.onwaiting, ended=first.audio.onended;
  listen();
  first.resolve();
  waiting(); ended();
  await flush();
  t.mock.timers.tick(16_000);
  assert.equal(first.audio.dataset.paused,'yes');
  assert.equal(first.audio.hasAttribute('src'),false);
  assert.equal(get('audio'),null);
  queue(1);
  assert.equal(get('audio'),null);
  listen();
  const second=attempts[1];
  const lateError=second.audio.onerror;
  queue(2);
  second.reject(new DOMException('Antigua emisora.','NotAllowedError'));
  lateError();
  await flush();
  assert.equal(get('audio'),attempts[2].audio);
  assert.equal(get('[data-player] button').hidden,true);
  const third=attempts[2];
  const latePlaying=third.audio.onplaying;
  ui.close(); third.resolve(); latePlaying(); await flush();
  t.mock.timers.tick(16_000);
  assert.equal(get('audio'),null);
  assert.equal(get('[data-listen]').getAttribute('aria-pressed'),'false');
  assert.equal(get('.music-notice').textContent,'');
  assert.equal(attempts.length,3);
  assert.deepEqual(apiCalls,[]);
});
