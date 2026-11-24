import assert from 'node:assert/strict';

// Isolate the local audio test from real rooms, contacts and other browser clients.
export async function micSampleBrowser(browser,origin) {
  const context=await browser.newContext({permissions:['microphone']});
  try {
    const page=await context.newPage();
    await page.goto(origin);
    await page.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration())?.active),null,{timeout:15000});
    if (!await page.evaluate(()=>Boolean(navigator.serviceWorker.controller))) await page.reload();
    await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),null,{timeout:10000});
    // Open the real settings panel, register its worklet cache and remember preferences.
    await page.goto(origin+'/#main');
    const panel=page.locator('#audio-panel');
    await panel.locator('summary').click();
    const record=panel.getByRole('button',{name:'Grabar prueba de 4 segundos'});
    await record.waitFor();
    await page.waitForFunction(async()=>Boolean(await caches.match('/voice-cleaner-worklet.js',{cacheName:'squadlink-mic-worklet-v1'})));
    const volume=panel.getByRole('slider',{name:'Volumen de las voces que escucho'});
    await volume.focus();
    await volume.press('End');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('squadlink.audio.v1')).listenVolume===2);
    const restore=panel.getByRole('button',{name:/Restablecer|Restaurar/});
    await restore.click();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('squadlink.audio.v1')).listenVolume===0.7);
    await context.setOffline(true);
    const pcm=await page.evaluate(async()=>{
      // Use the same Blob, output element and gain curve used by the actual mic test.
      const {localSamplePlayer}=await import('/mic-test.js');
      const rate=48000, frames=rate*2, wav=new ArrayBuffer(44+frames*2), data=new DataView(wav);
      function text(at,string){for(let i=0;i<string.length;i++)data.setUint8(at+i,string.charCodeAt(i));}
      text(0,'RIFF');data.setUint32(4,36+frames*2,true);text(8,'WAVE');text(12,'fmt ');
      data.setUint32(16,16,true);data.setUint16(20,1,true);data.setUint16(22,1,true);
      data.setUint32(24,rate,true);data.setUint32(28,rate*2,true);data.setUint16(32,2,true);data.setUint16(34,16,true);
      text(36,'data');data.setUint32(40,frames*2,true);
      for(let i=0;i<frames;i++)data.setInt16(44+i*2,Math.round(2000*Math.sin(2*Math.PI*500*i/rate)),true);
      const url=URL.createObjectURL(new Blob([wav],{type:'audio/wav'}));
      const readings=[];
      try {
        for(const level of [1,2]){
          const made=[],create=document.createElement;
          let player;
          document.createElement=function(tag,...args){
            const element=create.call(this,tag,...args);if(tag==='audio')made.push(element);return element;
          };
          try{ player=localSamplePlayer(url,{listenVolume:level,outputId:''},()=>{},()=>{}); }
          finally{document.createElement=create;}
          const measure=new AudioContext();
          try {
            await Promise.all([player.play(),measure.resume()]);
            const output=made.at(-1);
            const source=measure.createMediaStreamSource(output.srcObject || output.captureStream());
            const analyser=measure.createAnalyser();analyser.fftSize=2048;
            const silent=measure.createGain();silent.gain.value=0;
            source.connect(analyser).connect(silent).connect(measure.destination);
            const block=new Float32Array(2048);let total=0,peak=0,windows=0;
            // Skip startup buffers and observe enough windows to avoid a single partial frame.
            for(let i=0;i<10;i++){
              await new Promise(resolve=>setTimeout(resolve,60));
              analyser.getFloatTimeDomainData(block);
              if(i<3)continue;
              for(const value of block){total+=value*value;peak=Math.max(peak,Math.abs(value));}
              windows++;
            }
            readings.push({db:10*Math.log10(total/(windows*block.length)),peak,boosted:!!output.srcObject,volume:output.volume});
          } finally {player.close();await measure.close();}
        }
      } finally{URL.revokeObjectURL(url);}
      return readings;
    });
    assert.ok(Number.isFinite(pcm[0].db) && pcm[0].db>-36 && pcm[0].db < -20,JSON.stringify(pcm));
    assert.ok(Math.abs(pcm[1].db-pcm[0].db-6.02)<0.8,JSON.stringify(pcm));
    assert.deepEqual(pcm.map(p=>[p.boosted,p.volume]),[[false,1],[true,1]]);
    // A first activation with the PWA already open must still load the worklet offline.
    await page.evaluate(async()=>{
      const ctx=new AudioContext();
      try { await ctx.audioWorklet.addModule('/voice-cleaner-worklet.js'); } finally {await ctx.close();}
      const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      window.sampleTracks=[];
      navigator.mediaDevices.getUserMedia=async options=>{
        const stream=await original(options);window.sampleTracks.push(...stream.getAudioTracks());return stream;
      };
    });
    await record.click();
    const listen=panel.getByRole('button',{name:'Escuchar mi prueba'});
    await listen.waitFor({timeout:12000});
    assert.ok(await page.evaluate(()=>window.sampleTracks.length===1 && window.sampleTracks[0].readyState==='ended'));
    await listen.click();
    await panel.getByText(/Prueba terminada/).waitFor({timeout:12000});
    // A permission fulfilled after a navigation must release the track immediately.
    await page.evaluate(()=>{
      const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      let finish;
      const pending=new Promise(r=>{finish=r;});
      window.finishMicPermission=finish;
      navigator.mediaDevices.getUserMedia=async options=>{await pending;return original(options);};
    });
    await record.click();
    await page.evaluate(()=>{location.hash='arcade';});
    await page.waitForFunction(()=>document.body.dataset.channel==='arcade');
    await page.evaluate(()=>window.finishMicPermission());
    await page.waitForFunction(()=>window.sampleTracks.length===2 && window.sampleTracks.every(t=>t.readyState==='ended'));
    const response=await page.goto(origin+'/?mic-offline=1');
    assert.equal(response.status(),503);
    assert.equal(await page.title(),'Squadlink · Sin conexión');
    await page.getByText('No se pudo conectar al servidor de voz.').waitFor();
    console.log('Prueba local sin red, permiso tardío, valores recomendados y RMS de reproducción al 100/200 %:',JSON.stringify(pcm));
  } finally {await context.close();}
}
