import assert from 'node:assert/strict';

// Drop a response only after the real server accepted the change. The room's
// status line is shared by several voice events and can change between polls.
export async function microphonePresenceSmoke(page) {
  const mic = page.locator('#mic');
  const endpoint = '**/api/member';
  const posts = [];
  const forwarded = [];
  const tracksDuringMute = [];
  let loseReplyFor = false;
  const routeMember = async route => {
    const data = route.request().postDataJSON();
    posts.push(data);
    if (data.muted) tracksDuringMute.push(await page.evaluate(() =>
      window.qaTracks.length > 0 && window.qaTracks.every(track => track.readyState === 'ended')));
    if (data.muted === loseReplyFor) {
      loseReplyFor = null;
      const response = await route.fetch();
      forwarded.push(response.status());
      await response.dispose();
      await route.abort('failed');
    } else {
      await route.continue();
    }
  };
  const notices = await page.evaluateHandle(() => {
    const node = document.querySelector('#voice-status');
    const messages = [];
    const observer = new MutationObserver(changes => {
      for (const change of changes) {
        for (const added of change.addedNodes) messages.push(added.textContent);
      }
    });
    observer.observe(node,{childList:true});
    return {messages,observer};
  });
  async function confirmClick(muted) {
    await Promise.all([
      page.waitForResponse(response => {
        const request = response.request();
        return new URL(response.url()).pathname === '/api/member' && request.method() === 'POST' &&
          request.postDataJSON()?.muted === muted && response.ok();
      },{timeout:15000}),
      mic.click()
    ]);
    await page.waitForFunction(expected => {
      const button = document.querySelector('#mic');
      const tracks = window.qaTracks;
      return !button.disabled && button.getAttribute('aria-pressed') === String(!expected) && tracks.length > 0 &&
        (expected ? tracks.every(track=>track.readyState==='ended') : tracks.some(track=>track.readyState==='live'));
    },muted,{timeout:10000});
    const {self,room} = await page.evaluate(() => fetch('/api/session').then(response=>response.json()));
    assert.equal(room.members.find(person=>person.id===self.id).muted,muted);
  }
  await page.route(endpoint,routeMember);
  try {
    await confirmClick(true);
    const messages = await notices.evaluate(state=>state.messages);
    assert.ok(messages.some(text=>text.includes('El micrófono se apagó')),
      'El estado accesible debe anunciar la desactivación. Avisos: '+JSON.stringify(messages));
    await confirmClick(false);
    loseReplyFor = true;
    await confirmClick(true);
    assert.deepEqual(forwarded,[200,200]);
    assert.deepEqual(posts.map(post=>post.muted),[false,true,false,true,true]);
    assert.ok(posts[0].room && posts[0].visitId);
    assert.ok(posts.every(post=>post.room===posts[0].room && post.visitId===posts[0].visitId));
    assert.deepEqual(tracksDuringMute,[true,true,true], 'el hardware ya está apagado al anunciar o reintentar el silencio');
  } catch (error) {
    const details = await page.evaluate(() => ({
      status:document.querySelector('#voice-status').textContent,
      button:document.querySelector('#mic').getAttribute('aria-pressed'),
      capture:window.qaTracks.map(t=>t.readyState),peers:window.qaPeers.map(pc=>({
        state:pc.connectionState,signaling:pc.signalingState,ice:pc.iceConnectionState,
        local:pc.localDescription?.type,remote:pc.remoteDescription?.type
      })),
      serviceWorker:Boolean(navigator.serviceWorker?.controller)
    }));
    throw new Error('No se confirmó el estado del micrófono. '+JSON.stringify({
      posts:posts.map(p=>p.muted),forwarded,tracksDuringMute,...details
    }),{cause:error});
  } finally {
    await notices.evaluate(state=>state.observer.disconnect());
    await notices.dispose();
    await page.unroute(endpoint,routeMember);
  }
}
