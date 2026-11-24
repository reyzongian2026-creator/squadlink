const {_electron,chromium}=require('playwright-core');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os'), https=require('node:https');
const {spawn,execFileSync}=require('node:child_process');
const {createHash,X509Certificate}=require('node:crypto');
const assert=require('node:assert/strict');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const base='http://127.0.0.1:4179';
const fixture=fs.readFileSync('test/windows/audio-fixture.js','utf8');
const boot='if(!window.testPeers && navigator.mediaDevices){'+fixture+'\n}';
const {radioStations}=require('../public/radio-stations.js');
const station=radioStations[0];
async function until(fn,label,timeout=18000){
 const end=Date.now()+timeout;
 while(Date.now()<end){const v=await fn();if(v)return v;await sleep(150);}
 throw Error('Tiempo agotado: '+label);
}
function streamRadio(key,cert) {
 // 128 kbit/s PCM. Deliver bytes at their real audio cadence instead of fulfilling an entire file instantly.
 const rate=8000,chunk=Buffer.alloc(3200),header=Buffer.alloc(44);const total=rate*2*180;
 header.write('RIFF');header.writeUInt32LE(36+total,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);
 header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(rate,24);header.writeUInt32LE(rate*2,28);
 header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(total,40);
 for(let i=0;i<chunk.length/2;i++)chunk.writeInt16LE(Math.round(500*Math.sin(2*Math.PI*440*i/rate)),i*2);
 const radio={bytes:0};
 radio.server=https.createServer({key,cert},(req,res)=>{
  res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':44+total,'Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
  res.write(header);let sent=0;
  function write(){res.write(chunk);sent+=chunk.length;radio.bytes+=chunk.length;}
  write();write();write();const tick=setInterval(()=>{write();if(sent>=total){clearInterval(tick);res.end();}},200);
  res.on('close',()=>clearInterval(tick));
 });
 return radio;
}
async function signal(page){
 return page.evaluate(async()=>{
  const pc=window.testPeers.find(p=>p.connectionState==='connected');if(!pc)return null;
  let rx=0,tx=0,energy=0;
  for(const s of (await pc.getStats()).values()){
   if(s.kind!=='audio')continue;
   if(s.type==='inbound-rtp'){rx+=s.bytesReceived;energy+=s.totalAudioEnergy||0;}
   if(s.type==='outbound-rtp')tx+=s.bytesSent;
  }
  const el=document.querySelector('#room-music audio');
  return {rx,tx,energy,radio:el&&!el.paused?el.currentTime:0};
 });
}
async function one(exe,version,run,radio,spki){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'squad-bench-'));
 fs.writeFileSync(path.join(dir,'desktop.json'),JSON.stringify({server:base,low:true}));
 let app,browser;
 try{
  app=await _electron.launch({executablePath:exe,args:['--user-data-dir='+dir,'--ignore-certificate-errors-spki-list='+spki],timeout:45000});
  const ctx=app.context();ctx.setDefaultTimeout(18000);
  await ctx.addInitScript({content:"if(location.hostname==='app'){"+boot+"}"});
  const surface=host=>until(async()=>{
   const active=await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0]?.contentView.children.at(-1)?.webContents?.getURL());
   if(!active?.startsWith('squad://'+host+'/'))return;
   return ctx.pages().find(p=>!p.isClosed()&&p.url().startsWith('squad://'+host+'/'));
  },'vista '+host);
  async function nav(page,name,host){
   try{await page.getByRole('button',{name,exact:true}).click();}
   catch(e){if(!/closed/i.test(e.message)||!page.isClosed())throw e;}
   return surface(host);
  }
  assert.equal(await app.evaluate(({app})=>app.getVersion()),'0.5.0-preview.'+version);
  let space=await surface('app');await space.evaluate(boot);
  await space.getByRole('button',{name:'Elegir apodo y guardar',exact:true}).click();
  await space.getByLabel('Tu apodo').fill('Pepe');await space.locator('#submit-entry').click();
  await space.getByText('Apariencia guardada.',{exact:true}).waitFor();
  const home=await nav(space,'Lobby de voz','home');
  space=await nav(home,'Crear sala','app');
  await space.locator('#name').fill('Medición '+run);await space.locator('#submit-entry').click();
  await space.locator('#room-name').waitFor({state:'visible'});
  await space.waitForFunction(()=>/^[A-Z0-9]{6}$/.test(document.querySelector('#room-code')?.textContent));
  const code=await space.locator('#room-code').textContent();await space.locator('#mic').click();
  browser=await chromium.launch({channel:process.platform==='win32'?'msedge':'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const peer=await browser.newPage();await peer.addInitScript({content:boot});await peer.goto(base+'/#main');
  await peer.getByRole('button',{name:'Unirme con código',exact:true}).first().click();
  await peer.locator('#nickname').fill('Segundo');await peer.locator('#code').fill(code);
  await peer.locator('#submit-entry').click();await peer.locator('#mic').click();
  await until(async()=>{const a=await signal(space),b=await signal(peer);return a?.energy>0 && b?.energy>0;},'audio bidireccional');
  const local='https://127.0.0.1:'+radio.server.address().port+'/stream.wav';
  await space.route(station.url,route=>route.fulfill({status:307,headers:{location:local,'access-control-allow-origin':'*'}}));
  const music=space.locator('#room-music');
  await music.getByText('Añadir música',{exact:true}).click();
  await music.locator('.genre-options').getByText(station.genre,{exact:true}).click();
  await music.locator('.station-options label').filter({hasText:station.name}).click();
  await music.getByRole('button',{name:'Escuchar solo aquí'}).click();
  await until(async()=>(await signal(space))?.radio>1,'radio HTTPS local con ritmo real');
  const lobby=await nav(space,'Lobby de voz',version===23?'home':'app');
  await lobby.getByRole('button',{name:'Mi sala',exact:true}).waitFor();
  const sample=async()=>{
   const pcm=await signal(space);
   const processInfo=await app.evaluate(({app,webContents})=>{
    const metrics=app.getAppMetrics();const frames=webContents.getAllWebContents().flatMap(w=>w.mainFrame.framesInSubtree.map(f=>({pid:f.osProcessId,url:f.url.split('?')[0]})));
    return {ram:metrics.reduce((a,m)=>a+m.memory.workingSetSize/1024,0),cpu:metrics.reduce((a,m)=>a+m.cpu.percentCPUUsage,0),
     renderers:metrics.filter(m=>m.type==='Tab').map(m=>({pid:m.pid,ram:m.memory.workingSetSize/1024})),frames};
   });
   return {t:performance.now()/1000,...processInfo,...pcm,radioBytes:radio.bytes};
  };
  const foreground=await sample();
  await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].minimize());
  await until(()=>app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].isMinimized()),'minimización');
  const zero=performance.now();
  const arr=[];
  for(let second=0;second<=30;second+=1){
   await sleep(Math.max(0,zero+second*1000-performance.now()));
   arr.push(await sample());
  }
  const a=arr[15],b=arr[30],elapsed=b.t-a.t;
  assert.ok(elapsed>=14 && elapsed<18 && b.rx>a.rx && b.tx>a.tx && b.energy>a.energy && b.radio-a.radio>13 && b.radioBytes>a.radioBytes,'Continuidad de la señal y de la radio');
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const unowned=b.renderers.filter(m=>!b.frames.some(f=>f.pid===m.pid));
  let commands='';
  if(unowned.length){
   const ids=unowned.map(m=>m.pid).join(',');
   commands=process.platform==='win32'?execFileSync('powershell.exe',['-NoProfile','-Command','Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in @('+ids+') } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress'],{encoding:'utf8'}):
     execFileSync('ps',['-p',ids,'-o','pid=,command='],{encoding:'utf8'});
  }
  let cdpInfo=[];
  try{
   const [port,wsPath]=fs.readFileSync(path.join(dir,'DevToolsActivePort'),'utf8').trim().split(/\r?\n/);
   cdpInfo=await new Promise((resolve,reject)=>{
    const ws=new WebSocket('ws://127.0.0.1:'+port+wsPath);
    const timer=setTimeout(()=>{ws.close();reject(Error('CDP timeout'));},1500);
    ws.onopen=()=>ws.send(JSON.stringify({id:1,method:'SystemInfo.getProcessInfo'}));
    ws.onmessage=e=>{const d=JSON.parse(e.data);if(d.id===1){clearTimeout(timer);ws.close();resolve(d.result.processInfo);}};
    ws.onerror=()=>{clearTimeout(timer);reject(Error('CDP'));};
   });
  }catch(e){console.log('Observación CDP adicional:',e.message);}
  console.log('MEDIDA '+JSON.stringify({version,run,foreground:foreground.ram,values:arr.filter((_,i)=>[0,5,15,20,25,30].includes(i)),
   medianRam:median(arr.slice(15).map(x=>x.ram)),medianCpu:median(arr.slice(16).map(x=>x.cpu)),
   meanCpu:arr.slice(16).reduce((v,r,i)=>v+r.cpu*(r.t-arr[15+i].t),0)/elapsed,
   rxKbps:8*(b.rx-a.rx)/1000/elapsed,txKbps:8*(b.tx-a.tx)/1000/elapsed,radioKbps:8*(b.radioBytes-a.radioBytes)/1000/elapsed,commands,cdpInfo}));
 }finally{await browser?.close();await app?.close();}
}
(async()=>{
 const [v23,v24,keyFile,certFile]=process.argv.slice(2);
 const key=fs.readFileSync(keyFile),cert=fs.readFileSync(certFile);
 const spki=createHash('sha256').update(new X509Certificate(cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
 const radio=streamRadio(key,cert);await new Promise(r=>radio.server.listen(0,'127.0.0.1',r));
 const backend=spawn(process.execPath,['test/windows/voice-lobby.mjs'],{stdio:'inherit'});
 try{
  await until(async()=>{try{return(await fetch(base+'/api/directory')).ok;}catch{}},'servidor');
  console.log('Máquina '+JSON.stringify({os:os.release(),cpu:os.cpus()[0].model,logical:os.cpus().length}));
  for(const [i,v] of [23,24,24,23].entries())await one(v===23?v23:v24,v,i+1,radio,spki);
 }finally{backend.kill();radio.server.closeAllConnections();radio.server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
