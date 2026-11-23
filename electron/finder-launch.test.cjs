const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { chromium } = require('playwright-core');

test('LaunchServices abre la app empaquetada y muestra el formulario de sala', { timeout: 60000 }, async t => {
  const bundle = process.env.SQUADLINK_TEST_APP;
  assert.ok(bundle, 'Se requiere la ruta al paquete compilado');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'squadlink-finder-'));
  t.after(() => fs.rm(profile, { recursive: true, force: true }));
  await fs.writeFile(path.join(profile, 'desktop.json'), JSON.stringify({ server: 'http://127.0.0.1:4179', low: true }));
  execFileSync('/usr/bin/open', ['-n', '-a', bundle, '--args',
    '--user-data-dir=' + profile, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0']);
  let port;
  for (let attempt = 0; attempt < 100 && !port; attempt++) {
    try { port = Number((await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!port) await delay(250);
  }
  assert.ok(port, 'La app debe iniciar desde Finder con un perfil nuevo');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
  t.after(async () => {
    try { await (await browser.newBrowserCDPSession()).send('Browser.close'); }
    catch (error) { if (browser.isConnected()) throw error; }
  });
  const context = browser.contexts()[0];
  async function pageAt(host) {
    for (let i = 0; i < 100; i++) {
      const page = context.pages().find(p => p.url().startsWith('squad://' + host + '/'));
      if (page) return page;
      await delay(100);
    }
    assert.fail('Falta la ventana ' + host);
  }
  const home = await pageAt('home');
  await home.getByRole('button', { name: 'Crear sala', exact: true }).click({ timeout: 10000 });
  const form = (await pageAt('app')).locator('#entry[open]');
  await form.waitFor({ state: 'visible', timeout: 10000 });
  assert.ok(await form.locator('#nickname').isVisible());
});
