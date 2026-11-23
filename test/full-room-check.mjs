import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const clients = [];
const password = randomUUID();
try {
  let code;
  for (let i = 0; i < 5; i++) {
    const context = await browser.newContext({permissions:['microphone']});
    await context.addInitScript(() => {
      window.testPeers = [];
      const NativePeer = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePeer {
        constructor(...args) { super(...args); window.testPeers.push(this); }
      };
    });
    const page = await context.newPage();
    await page.goto('https://squadlink-lobby.onrender.com/');
    await page.getByRole('button',{name: i ? 'Unirme con código' : 'Crear sala',exact:true}).first().click();
    await page.getByLabel('Tu apodo').fill('Prueba ' + (i + 1));
    if (i) await page.getByLabel('Código de sala').fill(code);
    else await page.getByLabel('Nombre de la sala').fill('Verificación privada');
    await page.getByLabel('Clave').fill(password);
    await page.locator('#submit-entry').click();
    await page.locator('#room-code').waitFor({state:'visible'});
    code = await page.locator('#room-code').innerText();
    clients.push(page);
  }
  for (const page of clients) await page.getByRole('button',{name:'Activar micrófono'}).click();
  const counts = await Promise.all(clients.map(async page => {
    const result = await page.waitForFunction(async () => {
      let audible = 0;
      for (const peer of window.testPeers) {
        if (peer.connectionState !== 'connected') continue;
        const reports = [...(await peer.getStats()).values()];
        if (reports.some(r => r.type === 'inbound-rtp' && r.kind === 'audio'
          && r.packetsReceived > 5 && r.totalAudioEnergy > 0)) audible++;
      }
      return audible === 4 && audible;
    }, null, {timeout:60000});
    return result.jsonValue();
  }));
  assert.deepEqual(counts,[4,4,4,4,4]);
  console.log('Audio remoto recibido por participante:', counts.join(', '));
} finally {
  for (const page of clients) {
    const leave = page.getByRole('button',{name:'Salir de la sala'});
    if (await leave.isVisible()) await leave.click({timeout:3000}).catch(()=>{});
  }
  await browser.close();
}
