import assert from 'node:assert/strict';

// Exercise the local tools through the same UI outside a room, with the browser's
// actual WAV decoder, MediaRecorder, AudioWorklet, playback elements and Web Audio.
export async function localAudioBrowser(page) {
  const panel=page.locator('#audio-panel');
  if (!await panel.evaluate(el=>el.open)) await panel.locator(':scope > summary').click();
  const slider=panel.getByRole('slider',{name:'Volumen de las voces que escucho'});
  await slider.waitFor();
  const originalLevel=await slider.inputValue();
  await slider.focus(); await slider.press('End');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('squadlink.audio.v1')||'{}').listenVolume===2);
  await page.evaluate(()=>{
    const media=navigator.mediaDevices, capture=media.getUserMedia, play=HTMLMediaElement.prototype.play;
    const Context=window.AudioContext, create=URL.createObjectURL, revoke=URL.revokeObjectURL;
    const qa=window.localAudioQA={inputs:[],contexts:[],elements:[],urls:new Set(),readers:[],playbacks:[],peak:0,
      peersBefore:(window.testPeers||window.qaPeers||[]).length};
    media.getUserMedia=async function(...args){
      const stream=await capture.apply(this,args);qa.inputs.push(...stream.getTracks());return stream;
    };
    window.AudioContext=class extends Context {constructor(...args){super(...args);qa.contexts.push(this);}};
    URL.createObjectURL=function(blob){const url=create.call(this,blob);qa.urls.add(url);return url;};
    URL.revokeObjectURL=function(url){qa.urls.delete(url);return revoke.call(this,url);};
    HTMLMediaElement.prototype.play=function(){
      const observation={stream:Boolean(this.srcObject),volume:this.volume,progress:0};
      qa.elements.push(this);qa.playbacks.push(observation);
      this.addEventListener('timeupdate',()=>{observation.progress=Math.max(observation.progress,this.currentTime)});
      if (this.srcObject) {
        const ctx=new Context(), source=ctx.createMediaStreamSource(this.srcObject), analyser=ctx.createAnalyser();
        source.connect(analyser);
        const samples=new Float32Array(analyser.fftSize);
        const timer=setInterval(()=>{
          if(ctx.state!=='running')return;
          analyser.getFloatTimeDomainData(samples);
          for(const s of samples)qa.peak=Math.max(qa.peak,Math.abs(s));
        },45);
        ctx.resume().catch(()=>{});
        qa.readers.push(async()=>{clearInterval(timer);source.disconnect();analyser.disconnect();await ctx.close();});
        qa.lastOutputTracks=this.srcObject.getTracks();
      }
      return play.call(this);
    };
    qa.clean=async()=>{
      media.getUserMedia=capture;window.AudioContext=Context;HTMLMediaElement.prototype.play=play;
      URL.createObjectURL=create;URL.revokeObjectURL=revoke;
      await Promise.all(qa.readers.map(stop=>stop()));delete window.localAudioQA;
    };
  });
  try {
    await panel.getByRole('button',{name:'Probar altavoz',exact:true}).click();
    await panel.getByText('Prueba de altavoz terminada.',{exact:true}).waitFor({timeout:12000});
    const tone=await page.evaluate(()=>{
      const q=window.localAudioQA;return {inputs:q.inputs.length,urls:q.urls.size,contexts:q.contexts.length,
        played:q.playbacks.length,elapsed:q.playbacks[0]?.progress,volume:q.playbacks[0]?.volume};
    });
    assert.equal(tone.inputs,0);assert.equal(tone.urls,0);assert.equal(tone.contexts,0);
    assert.equal(tone.played,1);assert.ok(tone.elapsed>.15,'El decodificador no avanzó en el WAV');assert.equal(tone.volume,1);
    await panel.getByRole('button',{name:'Grabar prueba de 4 segundos',exact:true}).click();
    await panel.getByRole('meter',{name:'Nivel del micrófono'}).waitFor({timeout:7000});
    const listen=panel.getByRole('button',{name:'Escuchar mi prueba',exact:true});
    await listen.waitFor({timeout:12000});
    assert.ok(await page.evaluate(()=>localAudioQA.inputs.length===1 && localAudioQA.inputs.every(t=>t.readyState==='ended')));
    await slider.focus();
    await slider.press('Home');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('squadlink.audio.v1')).listenVolume===0);
    await listen.click();
    await panel.getByText('Sube el volumen de las voces para escuchar la muestra.').waitFor();
    await slider.press('End');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('squadlink.audio.v1')).listenVolume===2);
    await listen.click();
    await panel.getByText(/^Prueba terminada\./).waitFor({timeout:15000});
    await page.waitForFunction(()=>window.localAudioQA.contexts.every(c=>c.state==='closed') && !localAudioQA.urls.size);
    const measured=await page.evaluate(()=>{
      const q=window.localAudioQA;
      return {routed:q.playbacks.some(p=>p.stream),peak:q.peak,stopped:q.lastOutputTracks?.every(t=>t.readyState==='ended'),
        released:q.elements.every(el=>!el.srcObject && !el.hasAttribute('src')),
        peers:(window.testPeers||window.qaPeers||[]).length-q.peersBefore};
    });
    assert.ok(measured.routed,'El volumen 200 % debe reproducir la señal amplificada');
    assert.ok(measured.peak>.001 && measured.peak<1,'La muestra debe contener audio reproducido sin recorte: '+measured.peak);
    assert.ok(measured.stopped && measured.released);assert.equal(measured.peers,0);
    console.log('Audio local: dos tonos, cero aperturas de micro al probar altavoz, muestra grabada y reproducida al 200 %, pico '+measured.peak.toFixed(3));
  } finally {
    await page.evaluate(()=>window.localAudioQA?.clean());
    await slider.evaluate((el,value)=>{el.value=value;el.dispatchEvent(new Event('input'));el.dispatchEvent(new Event('change'));},originalLevel);
    await page.waitForFunction(value=>Math.round(JSON.parse(localStorage.getItem('squadlink.audio.v1')||'{}').listenVolume*100)===Number(value), originalLevel);
  }
}
