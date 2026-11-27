import assert from 'node:assert/strict';

export async function practiceMouseBrowser(page) {
  await page.evaluate(async () => {
    const {openPractice} = await import('/arcade-practice.js');
    const host = document.createElement('main');
    host.style.cssText = 'position:fixed;inset:0;background:#111;z-index:99999;padding:24px';
    document.body.append(host);
    window.endMousePractice = openPractice('precision',host);
  });
  const arena = page.locator('.aim-arena');
  try {
    await page.getByText('Ajustes del ratón',{exact:true}).click();
    const dpi = page.getByLabel('DPI de práctica');
    await dpi.fill('1600');
    await dpi.press('Tab');
    await page.locator('.practice-start').click();
    await page.getByRole('button',{name:'Usar mira de práctica'}).click();
    await page.waitForFunction(() => !document.querySelector('.practice-sight').hidden);
    const x = () => page.locator('.practice-sight').evaluate(el => parseFloat(el.style.left));
    const initial = await x();
    await arena.dispatchEvent('pointermove',{movementX:8,movementY:0});
    assert.equal(await x(),initial + 16);
    await page.evaluate(() => {
      const target = document.querySelector('.aim-target');
      const board = target.parentElement.getBoundingClientRect();
      const sight = document.querySelector('.practice-sight').getBoundingClientRect();
      target.style.left = (sight.left + sight.width/2 - board.left - 1)+'px';
      target.style.top = (sight.top + sight.height/2 - board.top - 1)+'px';
    });
    const hit = await page.evaluate(() => {
      const sight = document.querySelector('.practice-sight').getBoundingClientRect();
      const el = document.elementFromPoint(sight.left+sight.width/2,sight.top+sight.height/2);
      return el?.className;
    });
    assert.equal(hit,'aim-target');
    await page.mouse.down();
    await page.mouse.up();
    assert.match(await page.locator('.practice-status').textContent(),/1 de 16 intentos · 1 aciertos/);
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => document.querySelector('.practice-sight').hidden);
    await page.locator('.aim-target').focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.practice-status').textContent.includes('2 aciertos'));
    assert.equal(await page.evaluate(async () => (await import('/practice-mouse.js')).readMouseProfile().targetDpi),1600);
  } finally {
    await page.evaluate(() => {
      const host = document.querySelector('.practice-sight-host');
      window.endMousePractice(); host?.remove();
    });
  }
}
