import assert from 'node:assert/strict';
import {diagnosticCartridge} from './duck-nes-fixture.mjs';

// Runs inside the browser smoke suite's isolated arcade page and uses no commercial ROM.
export async function duckNesBrowser(page) {
  await page.route('**/duck-nes.nes', route => route.fulfill({status:404,body:''}));
  await page.locator('[data-game="duck-nes"]').click();
  const panel = page.locator('.duck-nes');
  const input = panel.locator('input[type=file]');
  const play = panel.getByRole('button', {name: 'Jugar', exact: true});
  assert.ok(await play.isDisabled());
  await input.setInputFiles({name: 'truncado.nes', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2])});
  await page.locator('#game-mount [role=status]').filter({hasText: 'cabecera iNES'}).waitFor();
  assert.ok(await play.isDisabled());
  await input.setInputFiles({
    name: 'diagnostico.nes', mimeType: 'application/octet-stream', buffer: Buffer.from(diagnosticCartridge()),
  });
  await play.click();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.duck-nes canvas');
    if (!canvas || canvas.hidden) return false;
    return canvas.getContext('2d').getImageData(128, 120, 1, 1).data[0] === 255;
  });
  await panel.locator('canvas').click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('p');
  await panel.getByRole('button', {name: 'Reanudar', exact: true}).waitFor();
  await page.keyboard.press('p');
  await panel.getByRole('button', {name: 'Pausar', exact: true}).waitFor();
  await page.getByRole('button', {name: 'Cerrar minijuego'}).click();
  await panel.waitFor({state: 'detached'});
}
