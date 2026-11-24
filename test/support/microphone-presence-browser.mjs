import assert from 'node:assert/strict';

// The server applies the first POST but the browser loses the response.
export async function microphonePresenceSmoke(page) {
  const mic = page.locator('#mic');
  const endpoint = '**/api/member';
  let loseReplyFor = false;
  const posts = [];
  const tracksDuringMute = [];
  await page.route(endpoint, async route => {
    const data = route.request().postDataJSON();
    posts.push(data);
    if (data.muted) tracksDuringMute.push(await page.evaluate(() =>
      window.qaTracks.length > 0 && window.qaTracks.every(track => track.readyState === 'ended')));
    if (data.muted === loseReplyFor) {
      loseReplyFor = null;
      await route.fetch();
      await route.abort('failed');
    } else {
      await route.continue();
    }
  });
  try {
    await mic.click();
    await page.locator('#voice-status').filter({hasText:'El micrófono se apagó'}).waitFor();
    await page.waitForFunction(() => !document.querySelector('#mic').disabled);
    assert.equal(await mic.getAttribute('aria-pressed'), 'false');
    await mic.click();
    await page.waitForFunction(() => !document.querySelector('#mic').disabled && document.querySelector('#mic').getAttribute('aria-pressed') === 'true');
    loseReplyFor = true;
    await mic.click();
    await page.waitForFunction(() => !document.querySelector('#mic').disabled && document.querySelector('#mic').getAttribute('aria-pressed') === 'false');
    assert.deepEqual(posts.map(post => post.muted),[false,true,false,true,true]);
    assert.ok(posts[0].room && posts[0].visitId);
    assert.ok(posts.every(post => post.room === posts[0].room && post.visitId === posts[0].visitId));
    assert.deepEqual(tracksDuringMute,[true,true,true], 'el hardware ya está apagado al anunciar o reintentar el silencio');
    const {self,room} = await page.evaluate(() => fetch('/api/session').then(response=>response.json()));
    assert.equal(room.members.find(person=>person.id===self.id).muted,true);
  } finally {
    await page.unroute(endpoint);
  }
}
