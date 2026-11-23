import {chromium} from 'playwright-core';
import {access, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';

const [code, directory] = process.argv.slice(2);
assert.match(code, /^[A-Z0-9]{6}$/);
// The build runner supplies a local tone in place of its missing sound card.
function installToneAndStats() {
  const Base = window.RTCPeerConnection;
  window.testPeers = [];
  window.RTCPeerConnection = class extends Base {
    constructor(...args) { super(...args); window.testPeers.push(this); }
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const context = new AudioContext();
    const tone = context.createOscillator();
    const sink = context.createMediaStreamDestination();
    tone.frequency.value = 440;
    tone.connect(sink); tone.start(); await context.resume();
    const track = sink.stream.getAudioTracks()[0];
    const stop = track.stop.bind(track);
    track.stop = () => { stop(); tone.stop(); void context.close(); };
    return sink.stream;
  };
}
const host = await chromium.connectOverCDP('http://127.0.0.1:9227',{timeout:20000});
const native = host.contexts().flatMap(context => context.pages()).find(page => page.url().startsWith('http://127.0.0.1:4179/'));
assert.ok(native,'Ventana del cliente de prueba en el lobby local');
await native.evaluate(installToneAndStats);
await writeFile(join(directory,'source-ready'),'ok');
const browser = await chromium.launch({channel:'msedge', headless:true, args:[
  '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'
]});
try {
  const page = await browser.newPage({permissions:['microphone']});
  await page.addInitScript(installToneAndStats);
  await page.goto('http://127.0.0.1:4179');
  await page.locator('#join').click();
  await page.locator('#nickname').fill('Segundo jugador');
  await page.locator('#code').fill(code);
  await page.locator('#submit-entry').click();
  await page.locator('#mic').click();
  await page.waitForFunction(() => document.querySelector('#mic').getAttribute('aria-pressed') === 'true');
  async function incoming(target) {
    return target.evaluate(async () => {
      for (const peer of window.testPeers) {
        if (peer.connectionState !== 'connected') continue;
        for (const r of (await peer.getStats()).values()) {
          if (r.type === 'inbound-rtp' && r.kind === 'audio') return [r.packetsReceived,r.totalAudioEnergy ?? 0];
        }
      }
      return [0,0];
    });
  }
  let first;
  for(let i=0;i<120;i++){
    first=(await Promise.all([incoming(page),incoming(native)])).flat();
    if(first.every(x=>x>0)) break;
    await delay(250);
  }
  assert.ok(first.every(x=>x>0), 'El cliente debe recibir voz sintética del instalador.');
  await writeFile(join(directory,'connected'),String(first[0]));
  for(let i=0;i<240;i++){
    if(await access(join(directory,'finish')).then(()=>true,()=>false))break;
    await delay(500);
  }
  const last=(await Promise.all([incoming(page),incoming(native)])).flat();
  assert.ok(last.every((v,i)=>v>first[i]), 'La voz debe continuar después del cambio de perfil.');
  console.log('Voz recibida desde Windows durante ambos perfiles.', first, last);
} finally { await browser.close(); await host.close(); }
