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
  await page.addInitScript({path:'test/windows/audio-fixture.js'});
  await page.goto('http://127.0.0.1:4179');
  await page.getByRole('link', {name:'Lobby de voz', exact:true}).click();
  await page.getByRole('button', {name:'Unirme con código', exact:true}).click();
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
    first=(await Promise.all([incoming(page),fetch('http://127.0.0.1:4179/api/test-audio').then(r=>r.json())])).flat();
    if(first.every(x=>x>0)) break;
    await delay(250);
  }
  assert.ok(first.every(x=>x>0), `Falta audio en los dos sentidos (paquetes y energía, navegador y escritorio): ${JSON.stringify(first)}`);
  await writeFile(join(directory,'connected'),String(first[0]));
  for(let i=0;i<240;i++){
    if(await access(join(directory,'finish')).then(()=>true,()=>false))break;
    await delay(500);
  }
  const last=(await Promise.all([incoming(page),fetch('http://127.0.0.1:4179/api/test-audio').then(r=>r.json())])).flat();
  assert.ok(last.every((v,i)=>v>first[i]), `La voz debe continuar tras cambiar de perfil: ${JSON.stringify({first,last})}`);
  console.log('Voz recibida desde Windows durante ambos perfiles.', first, last);
} finally { await browser.close(); }
