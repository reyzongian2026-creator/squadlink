// Requires Playwright on the test machine only. A single process owns this isolated server.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from '../server.mjs';

async function socialSmoke(host, guest, spectator) {
  const socialWait = { timeout: 45000 };
  const refresh = page => page.evaluate(() => window.dispatchEvent(new Event('focus')));
  async function addFriend(from, to) {
    await to.waitForFunction(() => /^[a-f0-9]{16}$/i.test(document.querySelector('#friend-id')?.textContent.trim() || ''));
    const id = (await to.locator('#friend-id').innerText()).trim();
    await from.locator('#friend-code').fill(id);
    await from.locator('#friend-add').click();
    await from.locator('#friend-requests').getByText('Solicitud de amistad enviada').waitFor(socialWait);
    await refresh(to);
    await to.locator('[data-action="accept-friend"]').first().click(socialWait);
    await to.locator('#friends').getByText('Gian', { exact: true }).waitFor(socialWait);
    await refresh(from);
  }
  await addFriend(host, guest);
  await spectator.locator('#social-login').click();
  await spectator.getByLabel('Tu apodo').fill('Luz');
  await spectator.locator('#submit-entry').click();
  await addFriend(host, spectator);

  // Exercise the real time-bounded presence refresh. Share activity before knocking.
  const contact = host.locator('#friends');
  const owner = guest.locator('#friends');
  await contact.getByText('Ana', { exact: true }).waitFor(socialWait);
  await owner.getByText('Gian', { exact: true }).waitFor(socialWait);
  await contact.locator('.social-row').filter({ hasText: 'Luz' }).getByText(/En línea desde/).waitFor(socialWait);
  await guest.locator('#player-game').fill('Valorant');
  await guest.locator('#game-save').click();
  await guest.getByText('Actividad guardada.', { exact: true }).waitFor(socialWait);
  await refresh(host);
  await contact.getByText(/Valorant/i).first().waitFor(socialWait);
  await owner.locator('[data-action="knock"]').click(socialWait);
  await owner.getByText(/Solicitud enviada/).waitFor(socialWait);
  await refresh(host);

  // Waiting for the owner's decision must not expose the room or its members.
  await host.locator('#room-requests [data-action="admit"]').first().waitFor(socialWait);
  assert.ok(!await guest.locator('#room').isVisible(), 'petición pendiente aún fuera de sala');
  await host.locator('#room-requests [data-action="admit"]').first().click();
  await host.locator('#room-requests').waitFor({ state: 'hidden', timeout: 45000 });
  await refresh(guest);
  await guest.locator('[data-action="enter"]').first().click(socialWait);
  await host.locator('#members').getByText('Ana', { exact: true }).waitFor(socialWait);
  assert.equal(await guest.locator('#room-name').innerText(), 'Grupo de prueba');

  // Reload the profile holding the friend grant, then verify the same friend is still rendered.
  await guest.reload();
  await guest.locator('#friends').getByText('Gian', { exact: true }).waitFor(socialWait);
  await guest.getByRole('heading', { name: 'Grupo de prueba', exact: true }).waitFor(socialWait);
}

async function audioPreferencesSmoke(page) {
  const settings = page.locator('#audio-panel');
  const openSettings = async () => {
    await settings.waitFor();
    if (!await settings.evaluate(element => element.open)) await settings.locator('summary').click();
    await settings.locator('select option').first().waitFor({ state: 'attached' });
  };
  await openSettings();
  const noise = settings.getByLabel('Reducir ruido de fondo');
  assert.ok(await noise.isEnabled(), 'Chromium ofrece el control de supresión de ruido');
  const selected = !await noise.isChecked();
  await noise.setChecked(selected);
  await settings.getByText('Preferencia de audio actualizada.').waitFor();
  await page.reload();
  await openSettings();
  assert.equal(await noise.isChecked(), selected, 'la preferencia de audio persiste tras recargar');
}


export async function browserSmoke(chromium, sharedOrigin = process.env.SQUADLINK_TEST_ORIGIN) {
  const server = sharedOrigin ? null : createServer();
  let browser;
  try {
    if (server) {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
    }
    const origin = sharedOrigin || 'http://127.0.0.1:' + server.address().port;
    browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
    const errors = [];
    async function client() {
      const ctx = await browser.newContext({ permissions: ['microphone'] });
      await ctx.addInitScript(() => {
        window.qaPeers = [];
        window.qaTracks = [];
        const Original = window.RTCPeerConnection;
        window.RTCPeerConnection = class extends Original {
          constructor(...args) { super(...args); window.qaPeers.push(this); }
        };
        const media = navigator.mediaDevices;
        const capture = media.getUserMedia.bind(media);
        media.getUserMedia = async options => {
          const stream = await capture(options);
          window.qaTracks.push(...stream.getTracks());
          return stream;
        };
      });
      const page = await ctx.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin);
      return page;
    }
    const a = await client();
    const b = await client();
    for (const width of [360, 390, 1440]) {
      await a.setViewportSize({ width, height: 900 });
      assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desborde horizontal a ' + width);
    }
    const eagerResources = await a.evaluate(() => performance.getEntriesByType('resource').map(e => new URL(e.name).pathname));
    assert.ok(!eagerResources.includes('/arcade.js'), 'el arcade solo se descarga cuando se abre');
    await a.getByRole('button', { name: 'Crear sala', exact: true }).first().click();
    await a.getByLabel('Tu apodo').fill('Gian');
    await a.getByLabel('Nombre de la sala').fill('Grupo de prueba');
    await a.getByLabel('Clave').fill('solo-para-prueba');
    await a.locator('#submit-entry').click();
    await a.locator('#room-code').waitFor({ state: 'visible' });
    const code = await a.locator('#room-code').innerText();
    await b.getByRole('button', { name: 'Unirme con código' }).click();
    await b.getByLabel('Tu apodo').fill('Ana');
    await b.getByLabel('Código de sala').fill(code);
    await b.getByLabel('Clave').fill('incorrecta');
    await b.locator('#submit-entry').click();
    await b.waitForFunction(() => document.querySelector('#entry-error').textContent.trim().length > 0);
    await b.getByLabel('Clave').fill('solo-para-prueba');
    await b.locator('#submit-entry').click();
    await a.locator('#members').getByText('Ana', { exact: true }).waitFor();
    for (const page of [a,b]) await page.getByRole('button', { name: 'Activar micrófono' }).click();
    async function inbound(page, minBytes = 0) {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const sample = await page.evaluate(async min => {
        for (const pc of window.qaPeers) {
          if (pc.connectionState !== 'connected') continue;
          const stats = await pc.getStats();
          for (const record of stats.values()) {
            if (record.type === 'inbound-rtp' && record.kind === 'audio' && record.bytesReceived > min && record.totalAudioEnergy > 0) {
              return { bytes: record.bytesReceived, packets: record.packetsReceived, energy: record.totalAudioEnergy,
                codec: stats.get(record.codecId)?.mimeType };
            }
          }
        }
        return false;
        }, minBytes);
        if (sample && sample.energy > 0 && sample.bytes > minBytes && sample.packets > 0) return sample;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw Error('Sin evidencia de paquetes de voz recibidos con energía audible');
    }
    const initial = await Promise.all([inbound(a), inbound(b)]);
    await a.getByRole('button', { name: 'Medir conexión de voz' }).click();
    await a.locator('#voice-measurements').getByText(/Ana.*(Directa|Por retransmisor)/).waitFor();
    await a.locator('[data-game="reflex"]').click();
    await a.locator('#game-dialog[open]').waitFor();
    const activeGame = a.locator('#game-mount button').first();
    await activeGame.click();
    const during = await inbound(a, initial[0].bytes);
    await a.getByRole('button', { name: 'Cerrar minijuego' }).click();
    await a.locator('#mic').click();
    await a.waitForFunction(() => window.qaTracks.length > 0 && window.qaTracks.every(t => t.readyState === 'ended'));
    await b.getByRole('button', { name: 'Salir de la sala' }).click();
    await b.waitForFunction(() => window.qaTracks.length > 0 && window.qaTracks.every(t => t.readyState === 'ended') && window.qaPeers.every(p => p.connectionState === 'closed'));
    await a.waitForFunction(() => !document.querySelector('#members').textContent.includes('Ana'));
    await socialSmoke(a, b, await client());
    await audioPreferencesSmoke(a);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ initial, during, browser: browser.version() }));
  } finally {
    await browser?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }
}

if (process.argv.includes('--run')) {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  await browserSmoke(chromium);
}
