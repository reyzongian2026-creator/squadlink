import assert from 'node:assert/strict';

// A generated PCM tone exercises the real decoder and the private room media route.
function sampleWav() {
  const rate = 8000, samples = 25 * rate;
  const bytes = Buffer.alloc(44 + 2 * samples);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length-8,4); bytes.write('WAVEfmt ',8);
  bytes.writeUInt32LE(16,16); bytes.writeUInt16LE(1,20); bytes.writeUInt16LE(1,22);
  bytes.writeUInt32LE(rate,24); bytes.writeUInt32LE(rate*2,28);
  bytes.writeUInt16LE(2,32); bytes.writeUInt16LE(16,34); bytes.write('data',36);
  bytes.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++) bytes.writeInt16LE(Math.round(900*Math.sin(2*Math.PI*440*i/rate)),44+2*i);
  return bytes;
}
export async function musicSmoke(host,guest) {
  const panel=page=>page.locator('#room-music');
  for(const page of [host,guest]) await panel(page).getByRole('button',{name:'Escuchar',exact:true}).click();
  await panel(host).getByText('Añadir música',{exact:true}).click();
  await panel(host).locator('select').selectOption('file');
  await panel(host).locator('input[type=file]').setInputFiles({name:'Prueba compartida.wav',mimeType:'audio/wav',buffer:sampleWav()});
  await panel(host).getByRole('button',{name:'Añadir a la cola'}).click();
  await Promise.all([host,guest].map(page=>page.waitForFunction(()=>{
    const audio=document.querySelector('#room-music audio');
    return audio && !audio.paused && audio.currentTime>0.15 && audio.duration===25;
  },null,{timeout:30000})));
  for(const page of [host,guest]) {
    assert.equal(await page.locator('#members [data-music-bot]').count(),1);
    assert.match(await page.locator('#count').innerText(), /2\s*\/\s*5/);
  }
  await panel(guest).getByText('Añadir música',{exact:true}).click();
  await panel(guest).locator('input[type=url]').fill('https://youtu.be/M7lc1UVf-VE');
  await panel(guest).getByLabel('Título (opcional)').fill('Video de prueba');
  await panel(guest).getByRole('button',{name:'Añadir a la cola'}).click();
  await panel(host).getByText('En cola (1)',{exact:true}).waitFor();
  // Retain the second track in the shared queue while both listeners mute locally.
  for(const page of [host,guest]) await panel(page).getByRole('button',{name:'Dejar de escuchar'}).click();
  await panel(host).getByRole('button',{name:'Siguiente'}).click();
  await panel(guest).locator('[data-title]').filter({hasText:'Video de prueba'}).waitFor();
  await panel(guest).getByRole('button',{name:'Siguiente'}).click();
  for(const page of [host,guest]) await page.locator('#members [data-music-bot]').waitFor({state:'detached'});
}
