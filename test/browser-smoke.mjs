// Requires Playwright on the test machine only. A single process owns this isolated server.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer } from '../server.mjs';

async function openChannel(page, channel) {
  const link = page.locator('#channel-list a[href="#' + channel + '"]');
  if (!await link.isVisible()) await page.locator('#channels-toggle').click();
  await link.click();
  await page.waitForFunction(id => document.body.dataset.channel === id, channel);
  assert.equal(await link.getAttribute('aria-current'), 'page');
}

async function footerLayout(page) {
  await openChannel(page, 'social');
  assert.ok(await page.evaluate(() => {
    const footer = document.querySelector('body > footer.site-footer');
    return Math.abs(footer.getBoundingClientRect().bottom - document.documentElement.clientHeight) <= 1;
  }), 'el pie llega al fondo de una pantalla corta');
  await openChannel(page, 'directory');
  // Populate only this browser DOM. The shared pilot directory receives no test rooms.
  const belowResults = await page.evaluate(() => {
    const list = document.getElementById('directory-list');
    const samples = Array.from({ length: 70 }, (_, index) => {
      const card = document.createElement('article');
      card.className = 'directory-card';
      card.textContent = 'Sala para verificar el desplazamiento ' + (index + 1);
      return card;
    });
    list.append(...samples);
    try {
      const bottom = samples.at(-1).getBoundingClientRect().bottom;
      const footer = document.querySelector('body > footer.site-footer').getBoundingClientRect();
      return footer.top >= bottom && bottom > document.documentElement.clientHeight;
    } finally {
      samples.forEach(card => card.remove());
    }
  });
  assert.ok(belowResults, 'el pie queda después del último resultado cuando hay desplazamiento');
  await openChannel(page, 'main');
}

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
  for (const page of [host, guest, spectator]) await openChannel(page, 'social');
  await addFriend(host, guest);
  await spectator.locator('#social-login').click();
  await spectator.getByLabel('Tu apodo').fill('Luz');
  await spectator.locator('#submit-entry').click();
  await addFriend(host, spectator);
  for (const width of [360, 900, 1440]) {
    await host.setViewportSize({width, height:900});
    assert.ok(await host.evaluate(() => {
      const roster = document.querySelector('.friend-roster').getBoundingClientRect();
      const form = document.querySelector('#friend-form').getBoundingClientRect();
      return roster.bottom <= form.top && document.documentElement.scrollWidth <= innerWidth;
    }), 'los contactos aparecen primero y los controles caben a ' + width);
  }

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
  await openChannel(host, 'main');
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
  await openChannel(guest, 'social');
  await guest.locator('#friends').getByText('Gian', { exact: true }).waitFor(socialWait);
  await openChannel(guest, 'main');
  await guest.getByRole('heading', { name: 'Grupo de prueba', exact: true }).waitFor(socialWait);
}

async function directorySmoke(host, visitor, roomCode) {
  const description = 'Práctica QA ' + randomUUID().slice(0, 8);
  const gameCode = 'QA-' + randomUUID().slice(0, 8);
  const cardButton = visitor.locator('#directory-list [data-room-code="' + roomCode + '"]');
  const openEditor = async () => {
    await openChannel(host, 'main');
    await host.locator('#edit-room-fields').click();
  };

  async function refreshDirectory() {
    await openChannel(visitor, 'directory');
    await Promise.all([
      visitor.waitForResponse(response => new URL(response.url()).pathname === '/api/directory' && response.request().method() === 'GET'),
      visitor.locator('#directory-refresh').click()
    ]);
  }
  await refreshDirectory();
  assert.equal(await cardButton.count(), 0, 'una sala privada queda fuera del directorio');
  await openEditor();
  await host.locator('#directory-publish').check();
  await host.locator('#directory-description').fill(description);
  await host.locator('#directory-game').fill('VALORANT');
  await host.locator('#directory-level').fill('Intermedio');
  await host.locator('#directory-game-code').fill(gameCode);
  await host.locator('#submit-entry').click();
  await host.waitForFunction(code => document.querySelector('#match-code')?.textContent.trim() === code, gameCode);
  await refreshDirectory();
  await cardButton.waitFor();
  await visitor.locator('#directory-query').fill('Juego inexistente ' + randomUUID());
  await cardButton.waitFor({ state: 'hidden' });
  await visitor.locator('#directory-query').fill('Intermedio');
  await cardButton.waitFor();
  assert.ok(!(await visitor.locator('#directory-list').innerText()).includes(gameCode), 'el directorio oculta el código de juego');
  await cardButton.click();
  assert.equal(await visitor.locator('#code').inputValue(), roomCode);
  await visitor.locator('#password').fill('incorrecta');
  await visitor.locator('#submit-entry').click();
  await visitor.waitForFunction(() => Boolean(document.querySelector('#entry-error').textContent.trim()));
  assert.ok(!await visitor.locator('#room').isVisible());
  await visitor.locator('#password').fill('solo-para-prueba');
  await visitor.locator('#submit-entry').click();
  await visitor.waitForFunction(code => document.querySelector('#match-code')?.textContent.trim() === code, gameCode);
  await visitor.getByRole('button', { name: 'Salir de la sala' }).click();
  await visitor.locator('#room').waitFor({ state: 'hidden' });
  await openEditor();
  await host.locator('#directory-publish').uncheck();
  await host.locator('#submit-entry').click();
  await host.locator('#entry').waitFor({ state: 'hidden' });
  await refreshDirectory();
  await cardButton.waitFor({ state: 'detached' });

  // Simulate an expired session while preserving the player's own local profile.
  await visitor.context().clearCookies();
  const restored = visitor.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/session' && response.request().method() === 'POST' && response.ok());
  await visitor.reload();
  const body = await (await restored).json();
  assert.equal(body.self.nick, 'Luz');
  assert.equal(await visitor.locator('#profile').innerText(), 'Luz');
}

async function progressionSmoke(player, observer, playForRank) {
  await openChannel(player, 'loadout');
  await player.getByText(/Menor tiempo/).waitFor();
  await player.locator('#kit-options').getByRole('button', { name: 'Gorra', exact: true }).click();
  await player.locator('#kit-save').click();
  await player.getByText('Apariencia guardada.', { exact: true }).waitFor();
  await player.reload();
  await player.waitForFunction(() =>
    document.querySelector('#kit-options [aria-label="Gorra"]')?.getAttribute('aria-pressed') === 'true');
  assert.equal(await player.locator('#kit-nick').innerText(), 'Luz');

  await player.locator('[data-rank="sequence"]').click();
  await player.getByText(/Más rondas seguidas/).waitFor();
  if (!playForRank) {
    assert.match(await player.locator('#kit-rank-scope').innerText(), /Comunidad/,
      'el piloto debe servir el ranking desde almacenamiento compartido');
    return;
  }

  await openChannel(player, 'arcade');
  await player.locator('[data-game="reflex"]').click();
  await player.locator('#game-dialog').getByRole('button', { name: 'Empezar' }).click();
  const target = player.locator('#game-dialog').getByRole('button', { name: '¡Ahora!' });
  const finished = player.waitForResponse(response => new URL(response.url()).pathname === '/api/progress/finish');
  // A realistic press duration keeps the test within the server's accepted reaction window.
  await target.click({ delay: 180 });
  const response = await finished;
  assert.ok(response.ok(), 'el servidor aceptó la ronda completada en el arcade');
  const { earned, profile } = await response.json();
  assert.ok(earned > 0 && profile.xp >= earned && profile.best.reflex >= 80);
  await player.getByRole('button', { name: 'Cerrar minijuego' }).click();
  await player.waitForFunction(xp => document.querySelector('#kit-xp-label')?.textContent.includes(xp + ' XP totales'), profile.xp);
  await openChannel(observer, 'loadout');
  await observer.locator('[data-rank="reflex"]').click();
  await observer.locator('#kit-ranking li').filter({ has: observer.getByText('Luz', { exact: true }) })
    .getByText(profile.best.reflex + ' ms', { exact: true }).waitFor();
}

async function audioPreferencesSmoke(page) {
  await openChannel(page, 'main');
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
  const server = sharedOrigin ? null : createServer({ progression: { env: { RENDER: 'true', SQUADLINK_RECEIPT_SECRET: randomUUID() } } });
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
    const downloads = a.getByRole('group', { name: 'Descargar Squadlink Moderno' });
    for (const [label, suffix] of [['Windows x64', '.exe'], ['Mac con Apple Silicon', '.zip']]) {
      const link = downloads.getByRole('link', { name: label });
      const href = await link.getAttribute('href');
      assert.ok(href.startsWith('https://github.com/reyzongian2026-creator/squadlink/releases/download/') && href.endsWith(suffix));
      if (sharedOrigin) {
        const response = await a.request.head(href);
        assert.equal(response.status(), 200, 'descarga pública de ' + label);
        assert.ok(Number(response.headers()['content-length']) > 1_000_000);
      }
    }
    for (const width of [360, 390, 1440]) {
      await a.setViewportSize({ width, height: 900 });
      await footerLayout(a);
      assert.ok(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desborde horizontal a ' + width);
    }
    const eagerResources = await a.evaluate(() => performance.getEntriesByType('resource').map(e => new URL(e.name).pathname));
    assert.ok(!eagerResources.includes('/arcade.js'), 'el arcade solo se descarga cuando se abre');
    await a.getByRole('button', { name: 'Crear sala', exact: true }).first().click();
    await a.getByLabel('Tu apodo').fill('Gian');
    await a.getByLabel('Nombre de la sala').fill('Grupo de prueba');
    assert.ok(await a.locator('#directory-publish').isChecked());
    await a.locator('#directory-publish').uncheck();
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
    await openChannel(a, 'arcade');
    await a.locator('[data-game="reflex"]').click();
    await a.locator('#game-dialog[open]').waitFor();
    const activeGame = a.locator('#game-mount button').first();
    await activeGame.click();
    const during = await inbound(a, initial[0].bytes);
    await a.getByRole('button', { name: 'Cerrar minijuego' }).click();
    await openChannel(a, 'main');
    await a.locator('#mic').click();
    await a.waitForFunction(() => window.qaTracks.length > 0 && window.qaTracks.every(t => t.readyState === 'ended'));
    await b.getByRole('button', { name: 'Salir de la sala' }).click();
    await b.waitForFunction(() => window.qaTracks.length > 0 && window.qaTracks.every(t => t.readyState === 'ended') && window.qaPeers.every(p => p.connectionState === 'closed'));
    await a.waitForFunction(() => !document.querySelector('#members').textContent.includes('Ana'));
    const spectator = await client();
    await socialSmoke(a, b, spectator);
    await directorySmoke(a, spectator, code);
    await progressionSmoke(spectator, b, !sharedOrigin);
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
