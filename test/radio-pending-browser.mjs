import assert from 'node:assert/strict';
import {radioStations} from '../public/radio-stations.js';

// Keep the real media request pending. A native play() must abort when this
// listener mutes, switches station or leaves, even if the response arrives late.
export async function radioPendingBrowser(guest) {
  const url = new URL('/qa-radio-pendiente',guest.url());
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) return;
  const context = await guest.context().browser().newContext();
  const page = await context.newPage();
  try {
    await page.route(url.href, route=>route.fulfill({contentType:'text/html',body:'<!doctype html><main></main>'}));
    await page.goto(url.href);
    await page.evaluate(async stations=>{
      const {createMusic}=await import('/music.js');
      const panel=document.querySelector('main'), messages=[];
      const ui=createMusic({mount:panel,api:async action=>messages.push(action)});
      const attempts=[];
      const play=HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play=function(){
        const entry={audio:this,result:'pending'};
        attempts.push(entry);
        const promise=play.call(this);
        promise.then(()=>{entry.result='playing'},error=>{entry.result=error.name});
        return promise;
      };
      function tune(index) {
        const {id:stationId,name:title}=stations[index];
        ui.update({code:'PRUEBA',music:{queue:[{id:String(index),kind:'radio',stationId,title}]}});
      }
      window.radioQA={attempts,tune,close:ui.close,messages};
      tune(0);
    },radioStations.slice(0,2));

    let pending=Promise.withResolvers();
    for(const station of radioStations.slice(0,2)) {
      await page.route(station.url,route=>{pending.resolve(route)});
    }
    const listen=page.locator('[data-listen]');
    for (const [index,action] of ['mute','switch','leave'].entries()) {
      if (index<2) await listen.click();
      const route=await Promise.race([pending.promise,page.waitForTimeout(8000).then(()=>{throw Error('No se inició la petición de radio: '+action)})]);
      assert.equal(await page.evaluate(i=>window.radioQA.attempts[i]?.result,index),'pending');
      pending=Promise.withResolvers();
      if (action==='mute') await listen.click();
      if (action==='switch') await page.evaluate(()=>window.radioQA.tune(1));
      if (action==='leave') await page.evaluate(()=>window.radioQA.close());
      // Chromium may already have canceled the route. A late reply has no listener.
      await route.fulfill({status:503,body:''}).catch(()=>{});
      await page.waitForFunction(i=>window.radioQA.attempts[i].result!=='pending',index,{timeout:5000});
      const result=await page.evaluate(i=>{
        const {audio,result}=window.radioQA.attempts[i];
        return {result,paused:audio.paused,url:audio.getAttribute('src'),count:document.querySelectorAll('[data-player] audio').length,
          shared:window.radioQA.messages.length,failed:document.querySelector('.music-notice').textContent.includes('No se pudo')};
      },index);
      assert.deepEqual(result,{result:'AbortError',paused:true,url:null,count:action==='switch'?1:0,shared:0,failed:false},action);
    }
  } finally { await context.close(); }
}
