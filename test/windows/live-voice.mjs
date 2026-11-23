import {chromium} from 'playwright-core';
import {access, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import assert from 'node:assert/strict';

const [code, directory] = process.argv.slice(2);
assert.match(code, /^[A-Z0-9]{6}$/);
const browser = await chromium.launch({channel:'msedge', headless:true, args:[
  '--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required'
]});
try {
  const page = await browser.newPage({permissions:['microphone']});
  await page.addInitScript(() => {
    const Base = window.RTCPeerConnection;
    window.testPeers = [];
    window.RTCPeerConnection = class extends Base {
      constructor(...args) { super(...args); window.testPeers.push(this); }
    };
  });
  await page.goto('http://127.0.0.1:4179');
  await page.locator('#join').click();
  await page.locator('#nickname').fill('Segundo jugador');
  await page.locator('#code').fill(code);
  await page.locator('#submit-entry').click();
  await page.locator('#mic').click();
  await page.waitForFunction(() => document.querySelector('#mic').getAttribute('aria-pressed') === 'true');
  async function incoming() {
    return page.evaluate(async () => {
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
    first=await incoming();
    if(first[0]>0 && first[1]>0) break;
    await delay(250);
  }
  assert.ok(first[0]>0 && first[1]>0, 'El cliente debe recibir voz sintética del instalador.');
  await writeFile(join(directory,'connected'),String(first[0]));
  for(let i=0;i<240;i++){
    if(await access(join(directory,'finish')).then(()=>true,()=>false))break;
    await delay(500);
  }
  const last=await incoming();
  assert.ok(last[0]>first[0] && last[1]>first[1], 'La voz debe continuar después del cambio de perfil.');
  console.log('Voz recibida desde Windows durante ambos perfiles.', first, last);
} finally { await browser.close(); }
