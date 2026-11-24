import assert from 'node:assert/strict';
import {diagnosticCartridge} from './duck-nes-fixture.mjs';

// Runs inside the browser smoke suite's isolated arcade page and uses no commercial ROM.
export async function duckNesBrowser(page, installDiagnostics) {
  const native = new URL(page.url()).protocol === 'squad:';
  if (!native) await page.route('**/duck-nes.nes', route => route.fulfill({status:404,body:''}));
  await page.locator('[data-game="duck-nes"]').click();
  const panel = page.locator('.duck-nes');
  const input = panel.locator('input[type=file]');
  const play = panel.getByRole('button', {name: 'Jugar', exact: true});
  await input.waitFor({state:'visible'});
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

  // Importing Duck Hunt must leave Mario's slot empty. Both slots then survive remount.
  await page.locator('[data-game="mario3"]').click();
  await input.waitFor({state:'visible'});
  assert.ok(await play.isDisabled());
  await input.setInputFiles({name:'mario-prueba.nes', mimeType:'application/octet-stream', buffer:Buffer.from(diagnosticCartridge())});
  await page.locator('#game-mount [role=status]').filter({hasText:'Cartucho guardado en este dispositivo'}).waitFor();
  await page.getByRole('button', {name:'Cerrar minijuego'}).click();
  for (const game of ['duck-nes','mario3']) {
    await page.locator('[data-game="' + game + '"]').click();
    await page.locator('#game-mount [role=status]').filter({hasText:'Cartucho guardado en este dispositivo'}).waitFor();
    assert.ok(await input.isHidden());
    await play.press('Enter');
    await panel.getByRole('button', {name:'Pausar', exact:true}).waitFor();
    await page.getByRole('button', {name:'Cerrar minijuego'}).click();
  }

  // Both desktop slots can start with a bundled diagnostic ROM on a fresh profile.
  const origin = new URL(page.url());
  if (origin.protocol !== 'squad:' && !['localhost','127.0.0.1','[::1]'].includes(origin.hostname)) return;
  if (native && !installDiagnostics) return;
  const removeDiagnostics = native ? await installDiagnostics(diagnosticCartridge()) : undefined;
  try {
    for (const game of ['duck-nes', 'mario3']) {
      const route = '**/' + game + '.nes';
      if (!native) await page.route(route, request => request.fulfill({contentType:'application/octet-stream', body:Buffer.from(diagnosticCartridge())}));
      try {
        await page.locator('[data-game="' + game + '"]').click();
        await page.locator('#game-mount [role=status]').filter({hasText:'Cartucho instalado'}).waitFor();
        assert.ok(await input.isHidden());
        await play.press('Enter');
        await panel.getByRole('button', {name:'Pausar', exact:true}).waitFor();
        await page.getByRole('button', {name:'Cerrar minijuego'}).click();
        await panel.waitFor({state:'detached'});
      } finally {
        if (!native) await page.unroute(route);
      }
    }
  } finally {
    await removeDiagnostics?.();
  }
}
