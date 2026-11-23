const { _electron,chromium }=require('playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'squadlink-e2e-'));
 fs.writeFileSync(path.join(profile,'desktop.json'),JSON.stringify({low:true,server:'http://127.0.0.1:4179'}));
 const executablePath=process.argv[2]||require('electron');
 const backend=spawn(process.execPath,['test/windows/voice-lobby.mjs'],{cwd:path.join(__dirname,'..'),stdio:'inherit'});
 let app,browser;
 try{
 let available=false;for(let i=0;i<100;i++){try{available=(await fetch('http://127.0.0.1:4179/api/directory')).ok;}catch{}if(available)break;await delay(100);}assert.ok(available);
 app=await _electron.launch({executablePath,args:['--user-data-dir='+profile],timeout:45000});
 const home=await app.firstWindow();
 const diagnostics=page=>{page.on('pageerror',err=>console.log('RENDER',err.message));page.on('console',m=>{if(m.type()==='error')console.log('RENDER',m.text())});};
 diagnostics(home);app.context().on('page',diagnostics);
 const capture=path.resolve(__dirname,'../artifacts/capturas');fs.mkdirSync(capture,{recursive:true});
 await home.getByRole('button',{name:'Crear sala',exact:true}).waitFor();
 await home.getByText('Todavía no hay salas públicas.').waitFor();
 await home.screenshot({path:path.join(capture,'Inicio-Moderno.png')});
 async function memory(label){const values=await app.evaluate(({app})=>app.getAppMetrics().map(m=>m.memory.workingSetSize));console.log('RAM '+label+' MiB: '+(values.reduce((a,b)=>a+b,0)/1024).toFixed(1));}
 await memory('inicio');console.log('Inicio React correcto');
 await home.getByRole('button',{name:'Ajustes',exact:true}).click();
 const config=await app.context().waitForEvent('page',{predicate:p=>p.url().includes('preferences'),timeout:1000}).catch(()=>app.context().pages().find(p=>p.url().includes('preferences')));
 assert.ok(config);await config.getByRole('button',{name:'Experiencia completa'}).click();
 await home.getByRole('button',{name:'Experiencia completa'}).waitFor();
 await config.getByRole('button',{name:'Bajo consumo'}).click();await config.close();
 const fixture=fs.readFileSync(path.join(__dirname,'../test/windows/audio-fixture.js'),'utf8');
 await app.context().addInitScript({content:fixture});
 await home.getByRole('button',{name:'Crear sala',exact:true}).click();
 let space;
 for(let i=0;i<120&&!space;i++){space=app.context().pages().find(p=>p.url().startsWith('squad://app/'));if(!space)await delay(100);}
 assert.ok(space,'El motor debe abrir su ventana de Electron.');
 await space.locator('#entry[open]').waitFor();await space.locator('#nickname').fill('Prueba Electron');await space.locator('#name').fill('Escuadra Lima');
 await space.screenshot({path:path.join(capture,'Crear-sala-Moderna.png')});await space.locator('#submit-entry').click();
 await home.getByRole('heading',{name:'Escuadra Lima'}).waitFor();
 const code=await space.locator('#room-code').innerText();assert.match(code,/^[A-Z0-9]{6}$/);
 await home.getByRole('button',{name:'Activar micrófono',exact:true}).click();
 await home.getByRole('button',{name:'Silenciar',exact:true}).waitFor();
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 const peer=await browser.newPage();await peer.addInitScript({content:fixture});await peer.goto('http://127.0.0.1:4179');
 await peer.locator('#join').click();await peer.locator('#nickname').fill('Amigo');await peer.locator('#code').fill(code);await peer.locator('#submit-entry').click();await peer.locator('#mic').click();
 const sample=p=>p.evaluate(async()=>{for(const pc of window.testPeers){for(const stat of (await pc.getStats()).values()){if(stat.type==='inbound-rtp'&&stat.kind==='audio')return stat.totalAudioEnergy||0;}}return 0;});
 async function audio(previous){let values;for(let i=0;i<100;i++){values=await Promise.all([sample(space),sample(peer)]);if(values.every((v,j)=>v>previous[j]))return values;await delay(250);}throw Error('Falta voz bidireccional '+JSON.stringify(values));}
 const first=await audio([0,0]);await memory('voz');
 await home.getByRole('button',{name:'Minijuegos',exact:true}).click();await space.getByRole('button',{name:/Reflejos/}).waitFor();
 await home.getByRole('button',{name:'Dispositivos de audio'}).click();await space.getByText('Ganancia automática del micrófono').waitFor();
 await home.getByRole('button',{name:'Mi sala',exact:true}).click();await space.locator('#room-name').waitFor({state:'visible'});
 await space.screenshot({path:path.join(capture,'Sala-Moderna.png')});
 console.log('Voz bidireccional durante la navegación',first,await audio(first));
 await home.getByRole('button',{name:'Salir de sala'}).click();await home.getByRole('button',{name:'Unirme con código'}).click();
 await space.locator('#code').fill(code);await space.locator('#submit-entry').click();await home.getByRole('heading',{name:'Escuadra Lima'}).waitFor();
 console.log('Instalación, ajustes, sala, entrada por código y continuidad de voz verificados.');
 }finally{await browser?.close();await app?.close();backend.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});