import assert from 'node:assert/strict';
import {radioStations} from '../../public/radio-stations.js';

// A generated PCM tone exercises the real decoder and the private room media route.
function sampleWav(seconds=25) {
  const rate = 8000, samples = seconds * rate;
  const bytes = Buffer.alloc(44 + 2 * samples);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length-8,4); bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(rate,24); bytes.writeUInt32LE(rate*2,28);
  bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34); bytes.write('data',36);
  bytes.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++) bytes.writeInt16LE(Math.round(900*Math.sin(2*Math.PI*440*i/rate)),44+2*i);
  return bytes;
}
// The focused renderer can be the desktop lobby while the player and RTP live
// in a different WebContents. Only public room controls and receiver stats are read.
export async function assertRadioShortcut(listener,other,press,label) {
  async function state(page) {
    return page.evaluate(async () => {
      const panel=document.querySelector('#room-music'), audio=panel?.querySelector('audio');
      const connection=(window.testPeers || window.qaPeers || []).find(pc=>pc.connectionState==='connected');
      if (!connection) throw Error('Falta la llamada de voz en la prueba del atajo.');
      const inbound=[...(await connection.getStats()).values()].find(s=>s.type==='inbound-rtp' && s.kind==='audio');
      return {listening:panel.querySelector('[data-listen]').getAttribute('aria-pressed')==='true',
        playing:Boolean(audio&&!audio.paused),time:audio?.currentTime,source:audio?.currentSrc,
        title:panel.querySelector('[data-title]').textContent,code:document.querySelector('#room-code').textContent,
        mic:document.querySelector('#mic').getAttribute('aria-pressed'),energy:inbound?.totalAudioEnergy};
    });
  }
  async function reportTimeout(error) {
    const readings=await Promise.allSettled([listener,other].map(state));
    throw new Error(label+' · '+JSON.stringify(readings),{cause:error});
  }
  const before=await Promise.all([listener,other].map(state));
  await press();
  await listener.waitForFunction(()=>document.querySelector('#room-music [data-listen]')?.getAttribute('aria-pressed')==='false'
      && !document.querySelector('#room-music audio'),null,{timeout:5000,polling:100}).catch(reportTimeout);
  await other.waitForFunction(time=>{
    const audio=document.querySelector('#room-music audio');
    return audio && !audio.paused && audio.currentTime>time+0.4;
  },before[1].time,{timeout:5000,polling:100}).catch(reportTimeout);
  const muted=await Promise.all([listener,other].map(state));
  for(const [i,reading] of muted.entries()){
    assert.equal(reading.listening,i===1,label);
    assert.equal(reading.code,before[i].code,label);
    assert.equal(reading.title,before[i].title,label);
    assert.equal(reading.mic,'true',label+' cambió el micrófono');
    assert.ok(reading.energy>before[i].energy,label+' interrumpió la voz');
  }
  await press();
  await listener.waitForFunction(src=>{
    const panel=document.querySelector('#room-music'), audio=panel?.querySelector('audio');
    return panel?.querySelector('[data-listen]').getAttribute('aria-pressed')==='true' &&
      audio?.currentSrc===src && !audio.paused && audio.currentTime>0.3;
  },before[0].source,{timeout:8000,polling:100}).catch(reportTimeout);
  const resumed=await state(other);
  assert.ok(resumed.playing && resumed.source===before[1].source && resumed.time>=muted[1].time,label);
  console.log('Atajo de radio local verificado',label);
}

export async function musicSmoke(host,guest,whileBothListen) {
  const panel=page=>page.locator('#room-music');
  const listen=(page,on)=>panel(page).locator('[data-listen][aria-pressed="'+on+'"]');
  await panel(host).getByText('Añadir música',{exact:true}).click();
  await panel(host).locator('.source-options').getByText('Archivo de audio',{exact:true}).click();
  await panel(host).locator('input[type=file]').setInputFiles({name:'Prueba compartida.wav',mimeType:'audio/wav',buffer:sampleWav()});
  await panel(host).getByRole('button',{name:'Añadir a la sala'}).click();
  for (const page of [host,guest]) {
    await panel(page).locator('[data-title]').filter({hasText:'Prueba compartida'}).waitFor();
    await listen(page,false).click();
  }
  await Promise.all([host,guest].map(page=>page.waitForFunction(()=>{
    const audio=document.querySelector('#room-music audio');
    return audio && !audio.paused && audio.currentTime>0.15 && audio.duration===25;
  },null,{timeout:30000})));
  for(const page of [host,guest]) {
    assert.equal(await page.locator('#members [data-music-bot], .music-header .room-dj').count(),1);
    assert.match(await page.locator('#count').innerText(), /2\s*\/\s*5/);
  }
  await panel(guest).getByText('Añadir música',{exact:true}).click();
  const station = radioStations[0];
  await panel(guest).locator('.genre-options').getByText(station.genre,{exact:true}).click();
  const offered = await panel(guest).locator('.station-options input').evaluateAll(
    options => options.map(option => option.value)
  );
  assert.deepEqual(offered, radioStations.filter(item => item.genre === station.genre).map(item => item.id));
  await panel(guest).locator('.station-options label').filter({hasText:station.name}).click();
  await panel(guest).getByRole('button',{name:'Añadir a la sala'}).click();
  await panel(host).getByText('En cola (1)',{exact:true}).waitFor();
  for (const page of [host,guest]) await listen(page,true).click();
  await panel(host).getByRole('button',{name:'Siguiente'}).click();
  await panel(guest).locator('[data-title]').filter({hasText:station.name}).waitFor();
  assert.equal(await panel(guest).locator('audio').count(),0);

  // Authenticate and advance the real room while keeping the station independent of the public stream.
  let offline = true;
  const radioSample = sampleWav(90);
  const online = route => route.fulfill({status:200,contentType:'audio/wav',body:radioSample});
  const stream = route => offline ? route.abort('failed') : online(route);
  await host.route(station.url, stream);
  await guest.route(station.url, online);
  try {
    await listen(host,false).click();
    const retry = panel(host).getByRole('button',{name:'Reintentar'});
    await retry.waitFor();
    offline = false;
    await retry.click();
    await host.waitForFunction(url=>{
      const audio=document.querySelector('#room-music audio');
      return audio?.currentSrc===url && !audio.paused && audio.currentTime>0.1;
    },station.url,{timeout:15000});
    await listen(guest,false).click();
    const playing = page => page.waitForFunction(url=>{
      const audio = document.querySelector('#room-music audio');
      return audio?.currentSrc === url && !audio.paused && audio.currentTime > 0.15;
    },station.url,{timeout:15000});
    await playing(guest);
    await assertRadioShortcut(guest,host,()=>guest.keyboard.press('Alt+Shift+KeyR'),'navegador enfocado');
    if (whileBothListen) await whileBothListen();
    const hostTime = await panel(host).locator('audio').evaluate(audio=>audio.currentTime);
    await listen(guest,true).click();
    await panel(guest).locator('audio').waitFor({state:'detached'});
    await host.waitForFunction(time=>{
      const audio=document.querySelector('#room-music audio');
      return audio && !audio.paused && audio.currentTime>time+0.35;
    },hostTime);
    await listen(host,true).waitFor();
    await panel(guest).locator('[data-title]').filter({hasText:station.name}).waitFor();
    await listen(guest,false).click();
    await Promise.all([playing(guest),playing(host)]);
    await listen(guest,true).click();
    const volume = panel(host).getByRole('slider',{name:'Volumen de música'});
    await volume.focus(); await volume.press('Home'); await volume.press('ArrowRight');
    assert.equal(await panel(host).locator('audio').evaluate(audio=>audio.volume), 0.01);
    await listen(host,true).click();
  } finally {
    await host.unroute(station.url, stream);
    await guest.unroute(station.url, online);
  }
  await panel(guest).getByRole('button',{name:'Siguiente'}).click();
  for(const page of [host,guest]) await page.locator('#members [data-music-bot]').waitFor({state:'detached'});
}
