const {app,BrowserWindow,BaseWindow,WebContentsView,protocol,session,ipcMain,dialog,shell,Menu}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {relay,parseServer}=require('./gateway.cjs');
const {detect}=require('./detection.cjs');
const base='https://squadlink-lobby.onrender.com';
const repo='reyzongian2026-creator/squadlink';
const titles={create:'Crear sala',join:'Unirme con código',lobby:'Mi sala',rooms:'Explorar salas',friends:'Amigos',player:'Mi jugador',arcade:'Minijuegos',ranking:'Clasificación',settings:'Dispositivos de audio'};
const prefsFile=()=>path.join(app.getPath('userData'),'desktop.json');
const blank=()=>({joined:false,name:'',nickname:'',code:'',mic:false,canMic:false,members:[]});
let prefs={server:base,low:true},state=blank(),home,settings,view,current,action,ready=false,visit=0,closing=false,updateUrl='',microphone=false;
let detectTimer,scanning=false,generation=0,detected=null;
const windows=new Map();
const locked=app.requestSingleInstanceLock();
if(!locked)app.quit();
app.on('second-instance',()=>reveal(home));
protocol.registerSchemesAsPrivileged([{scheme:'squad',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,allowServiceWorkers:false}}]);
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const options={contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(__dirname,'preload.cjs'),partition:'persist:squadlink-modern'};
function reveal(w){if(w&&!w.isDestroyed()){if(w.isMinimized())w.restore();w.show();w.focus();}}
function snapshot(){return {...state,...prefs,version:app.getVersion(),updateUrl};}
function publish(){for(const w of [home,settings])if(w&&!w.isDestroyed())w.webContents.send('snapshot',snapshot());}
function guard(contents){
  contents.setWindowOpenHandler(()=>({action:'deny'}));
  contents.on('will-navigate',e=>e.preventDefault());
  contents.on('will-attach-webview',e=>e.preventDefault());
}
function isHome(e){return [home,settings].some(w=>w&&!w.isDestroyed()&&e.sender===w.webContents&&e.senderFrame===w.webContents.mainFrame);}
function fromVoice(e){return view&&e.sender===view.webContents&&e.senderFrame===view.webContents.mainFrame;}
function hostPage(event){if(!isHome(event))throw Error('Acceso no disponible.');}
function send(data){if(view&&!view.webContents.isDestroyed())view.webContents.send('desk-message',data);}
function dispatch(key,code){send({type:'desktop:action',action:key,code,visit,low:prefs.low});}
function focusHome(){reveal(home);}
function contentBounds(){
  if(!current||current.isDestroyed()||!view)return;
  const [width,height]=current.getContentSize();view.setBounds({x:0,y:0,width,height});
}
function stopDetection(){generation++;clearInterval(detectTimer);detectTimer=null;detected=null;}
async function scan(){if(scanning||!detectTimer)return;scanning=true;const ticket=generation;
  try{const game=await detect(detected);if(ticket===generation&&game!==detected){detected=game;send({type:'squadlink:game',enabled:true,game});}}catch{}finally{scanning=false;}}
function disposeVoice(){
 stopDetection();ready=false;
 if(view){const old=view;view=null;if(current&&!current.isDestroyed())current.contentView.removeChildView(old);old.webContents.close();}
 current=null;action=null;
}
function createHome(pref=false){
 const w=new BrowserWindow({title:pref?'Ajustes · Squadlink':'Squadlink',width:pref?690:1080,height:pref?640:700,
 minWidth:pref?490:700,minHeight:pref?450:520,backgroundColor:'#0d1217',icon:path.join(__dirname,'Squadlink.ico'),autoHideMenuBar:true,webPreferences:options});
 guard(w.webContents);
 w.loadURL('squad://home/'+(pref?'?page=preferences':''));
 if(!pref)w.on('close',()=>{closing=true;disposeVoice();for(const win of windows.values())win.destroy();settings?.destroy();});
 return w;
}
function feature(key){
 let w=windows.get(key);
 if(w&&!w.isDestroyed())return w;
 w=new BaseWindow({title:titles[key]+' · Squadlink',width:900,height:700,minWidth:540,minHeight:440,show:false,backgroundColor:'#141b20',icon:path.join(__dirname,'Squadlink.ico'),autoHideMenuBar:true});
 windows.set(key,w);
 w.on('resize',()=>{if(w===current)contentBounds();});
 w.on('close',e=>{if(closing)return;e.preventDefault();w.hide();if(w===current&&ready){visit++;action=null;dispatch('background');}focusHome();});
 return w;
}
function ensureView(){
 if(view)return;
 view=new WebContentsView({webPreferences:options});const wc=view.webContents;guard(wc);
 wc.on('render-process-gone',()=>{if(view?.webContents!==wc)return;disposeVoice();state=blank();publish();focusHome();
 dialog.showMessageBox(home,{type:'warning',message:'El motor de la sala se cerró. Puedes volver a abrirla desde el lobby.'});});
 wc.on('before-input-event',(e,input)=>{if(input.type==='keyDown'&&input.control&&input.shift&&input.code==='KeyM'&&!input.isAutoRepeat&&state.canMic){e.preventDefault();dispatch('mic');}});
 wc.loadURL('squad://app/?server='+encodeURIComponent(prefs.server));
}
function open(key,code){
 if(key==='preferences'){if(!settings||settings.isDestroyed()){settings=createHome(true);settings.on('closed',()=>settings=null);}reveal(settings);return;}
 if(!Object.hasOwn(titles,key))throw Error('Opción desconocida.');
 if(state.joined&&['create','join'].includes(key))key='lobby';
 if(key==='lobby'&&!state.joined)key='rooms';
 ensureView();visit++;action={key,code};
 const next=feature(key);
 if(current!==next){if(current&&!current.isDestroyed()){current.contentView.removeChildView(view);current.hide();}
 current=next;current.contentView.addChildView(view);}
 contentBounds();reveal(current);view.webContents.focus();
 if(ready)dispatch(key,code);
}
function gameStatus(){send({type:'squadlink:game',enabled:Boolean(detectTimer),game:detected});}
ipcMain.on('home',e=>{if(fromVoice(e))focusHome();});
ipcMain.on('desk-state',async(e,m)=>{
 if(!fromVoice(e)||!m||typeof m!=='object')return;
 if(m.type==='desktop:state'){
  const before=state.joined;state={joined:m.joined===true,name:String(m.name||'').slice(0,80),nickname:String(m.nickname||'').slice(0,40),code:String(m.code||'').slice(0,6),mic:m.mic===true,canMic:m.canMic===true,members:Array.isArray(m.members)?m.members.slice(0,5):[]};publish();
  if(!ready){ready=true;if(action)dispatch(action.key,action.code);}
  if(state.joined&&!before)open('lobby');
  if(before&&!state.joined){if(current?.isVisible())current.hide();visit++;action=null;dispatch('background');focusHome();}
 }else if(m.type==='desktop:release'&&m.visit===visit&&!state.joined&&!current?.isVisible()&&prefs.low)disposeVoice();
 else if(m.type==='squadlink:game:status')gameStatus();
 else if(m.type==='squadlink:game:set'){
  if(!m.enabled){stopDetection();gameStatus();return;}
  if(detectTimer)return;
  const ticket=generation;
  const {response}=await dialog.showMessageBox(current||home,{type:'question',buttons:['Cancelar','Compartir'],defaultId:0,cancelId:0,message:'¿Compartir el juego detectado con tu grupo?'});
  if(response===1&&generation===ticket&&fromVoice(e)){detectTimer=setInterval(scan,30000);gameStatus();scan();}
 }
});
ipcMain.handle('snapshot',e=>{hostPage(e);return snapshot();});
ipcMain.handle('open',(e,value)=>{hostPage(e);open(typeof value==='string'?value:value?.key,/^[A-Z0-9]{6}$/.test(value?.code)?value.code:undefined);});
ipcMain.handle('call',(e,key)=>{hostPage(e);if(state.joined&&['mic','leave'].includes(key))dispatch(key);});
ipcMain.handle('prefs',(e,data)=>{
 hostPage(e);let next={...prefs};
 if(typeof data?.low==='boolean')next.low=data.low;
 if(typeof data?.server==='string'){next.server=parseServer(data.server);if(next.server!==prefs.server&&state.joined)throw Error('Sal de la llamada antes de cambiar de servidor.');}
 fs.mkdirSync(path.dirname(prefsFile()),{recursive:true});fs.writeFileSync(prefsFile()+'.tmp',JSON.stringify(next));fs.renameSync(prefsFile()+'.tmp',prefsFile());
 if(next.server!==prefs.server){current?.hide();disposeVoice();state=blank();microphone=false;}
 prefs=next;if(ready&&action)dispatch(action.key,action.code);publish();
});
ipcMain.handle('updates',async e=>{
 hostPage(e);const url='https://api.github.com/repos/'+repo+'/actions/workflows/electron.yml/runs?branch=preview%2Felectron-escritorio&status=success&per_page=1';
 const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('No se pudo consultar GitHub.');
 const [run]=(await response.json()).workflow_runs;
 const build=Number(require('./package.json').squadBuild||0),attempt=Number(require('./package.json').squadAttempt||1);
 updateUrl='';
 if(run&&(run.run_number>build||(run.run_number===build&&run.run_attempt>attempt))){
 const assets=await fetch('https://api.github.com/repos/'+repo+'/actions/runs/'+run.id+'/artifacts',{signal:AbortSignal.timeout(10000)});
 if(!assets.ok)throw Error('No se pudo consultar el instalador.');
 const asset=(await assets.json()).artifacts.find(a=>a.name==='Squadlink-Electron-Windows-x64'&&!a.expired);
 if(asset)updateUrl='https://github.com/'+repo+'/actions/runs/'+run.id+'/artifacts/'+asset.id;
 }publish();return updateUrl?'Hay una nueva compilación disponible.':'Tienes la compilación más reciente disponible.';
});
ipcMain.handle('download',async e=>{hostPage(e);if(updateUrl)await shell.openExternal(updateUrl);});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const csp="default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;connect-src 'self';media-src 'self' blob:;object-src 'none';frame-src 'none';base-uri 'none';form-action 'self'";
async function start(){
 try{const saved=JSON.parse(fs.readFileSync(prefsFile(),'utf8'));prefs={server:parseServer(saved.server),low:saved.low!==false};}catch{}
 const ses=session.fromPartition(options.partition);
 ses.protocol.handle('squad',async req=>{
  const {hostname,pathname}=new URL(req.url);if(!['home','app'].includes(hostname))return new Response(null,{status:404});
  if(pathname.startsWith('/api/')){
   if(hostname==='home'&&(pathname!=='/api/directory'||req.method!=='GET'))return new Response(null,{status:403});
   return relay(req,prefs.server,ses.cookies);
  }
  if(req.method!=='GET'||!/^\/(?:[a-zA-Z0-9_.-]+)?$/.test(pathname))return new Response(null,{status:404});
  let name=pathname.slice(1),dir=path.join(__dirname,'client');
  if(hostname==='home'){
   name=name||'home.html';
   if(['home.html','home.css','home.js'].includes(name))dir=__dirname;
   else if(!['hero-art.webp','icon-192.png'].includes(name))return new Response(null,{status:404});
  }else name=name||'index.html';
  const type=mime[path.extname(name)];if(!type)return new Response(null,{status:404});
  try{return new Response(await fs.promises.readFile(path.join(dir,name)),{headers:{'Content-Type':type,'Content-Security-Policy':csp,'X-Content-Type-Options':'nosniff'}});}catch{return new Response(null,{status:404});}
 });
 const trusted=wc=>wc&&view?.webContents===wc&&wc.getURL().startsWith('squad://app/');
 ses.setPermissionCheckHandler((wc,p)=>trusted(wc)&&((p==='media'&&microphone)||p==='speaker-selection'));
 ses.setPermissionRequestHandler(async(wc,p,done,details)=>{
  if(!trusted(wc))return done(false);
  if(['speaker-selection','clipboard-sanitized-write'].includes(p))return done(true);
  if(p!=='media'||!details.mediaTypes?.includes('audio')||details.mediaTypes.includes('video'))return done(false);
  if(!microphone){const answer=await dialog.showMessageBox(current||home,{type:'question',message:'¿Permitir que Squadlink use tu micrófono?',buttons:['Cancelar','Permitir'],cancelId:0,defaultId:0});microphone=answer.response===1&&trusted(wc);}
  done(microphone);
 });
 Menu.setApplicationMenu(null);home=createHome();
}
if(locked)app.whenReady().then(start);
app.on('window-all-closed',()=>app.quit());
