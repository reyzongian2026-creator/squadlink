import assert from 'node:assert/strict';

// The server applies the first POST but the browser loses the response.
export async function microphonePresenceSmoke(page) {
  const mic = page.locator('#mic');
  const endpoint = '**/api/member';
  const actual = () => page.evaluate(() => ({
    status:document.querySelector('#voice-status').textContent,
    disabled:document.querySelector('#mic').disabled,
    mic:document.querySelector('#mic').getAttribute('aria-pressed'),
    changes:window.qaStatusChanges,
    controlledByServiceWorker:navigator.serviceWorker?.controller?.scriptURL || 'none',
    tracks:window.qaTracks.map(t=>({ready:t.readyState,enabled:t.enabled})),
    peers:window.qaPeers.map(pc=>({state:pc.connectionState,signaling:pc.signalingState,
      senders:pc.getSenders().map(s=>s.track && {ready:s.track.readyState,enabled:s.track.enabled})}))
  }));
  await page.evaluate(()=>{
    const el=document.querySelector('#voice-status');
    window.qaStatusChanges=[el.textContent];
    new MutationObserver(()=>window.qaStatusChanges.push(el.textContent)).observe(el,{subtree:true,childList:true,characterData:true});
  });
  const traffic=[];
  page.on('request',req=>{if(new URL(req.url()).pathname==='/api/member')traffic.push(['request',req.method()]);});
  page.on('response',res=>{if(new URL(res.url()).pathname==='/api/member')traffic.push(['response',res.status(),res.fromServiceWorker()]);});
  page.on('requestfailed',req=>{if(new URL(req.url()).pathname==='/api/member')traffic.push(['failed',req.failure()]);});
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
      const result=await route.fetch();
      traffic.push(['intercept forwarded',result.status()]);
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
    console.log('MIC_DIAGNOSTIC_PASSED',JSON.stringify({browser:await actual(),traffic,posts,tracksDuringMute}));
  } catch (err) {
    console.log('MIC_DIAGNOSTIC',JSON.stringify({browser:await actual(),traffic,posts,tracksDuringMute}));
    throw err;
  } finally {
    await page.unroute(endpoint);
  }
}
