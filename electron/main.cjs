const {app,BrowserWindow,WebContentsView,protocol,session,ipcMain,dialog,shell,Menu,systemPreferences}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {relay,parseServer}=require('./gateway.cjs');
const {detect}=require('./detection.cjs');
const base='https://squadlink-lobby.onrender.com';
const repo='reyzongian2026-creator/squadlink';
const mac=process.platform==='darwin';
const channel=mac?{workflow:'electron-macos.yml',artifact:'Squadlink-Moderno-macOS-arm64'}:{workflow:'electron.yml',artifact:'Squadlink-Electron-Windows-x64'};
const titles={create:'Crear sala',join:'Unirme con código',lobby:'Mi sala',rooms:'Explorar salas',friends:'Amigos',player:'Mi jugador',arcade:'Arcade',guide:'Guía de sala',ranking:'Clasificación',settings:'Dispositivos de audio'};
const prefsFile=()=>path.join(app.getPath('userData'),'desktop.json');
const blank=()=>({joined:false,name:'',nickname:'',code:'',mic:false,canMic:false,members:[]});
let prefs={server:base,low:true},state=blank(),home,view,hostSection='home',action,ready=false,visit=0,closing=false,updateUrl='',microphone=false;
let detectTimer,scanning=false,generation=0,detected=null;
const locked=app.requestSingleInstanceLock();
if(!locked)app.quit();
function activateDesktop(){
 if(closing||!home||home.isDestroyed())return;
 reveal(home);
}
app.on('second-instance',activateDesktop);
if(mac)app.on('activate',activateDesktop);
protocol.registerSchemesAsPrivileged([{scheme:'squad',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,allowServiceWorkers:false}}]);
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const options={contextIsolation:true,nodeIntegration:false,sandbox:true,preload:path.join(__dirname,'preload.cjs'),partition:'persist:squadlink-modern'};
function reveal(w){if(w&&!w.isDestroyed()){if(w.isMinimized())w.restore();w.show();w.focus();}}
function snapshot(){return {...state,...prefs,hostSection:action?'workspace':hostSection,version:app.getVersion(),updateUrl};}
function publish(){if(home&&!home.isDestroyed())home.webContents.send('snapshot',snapshot());}
function guard(contents){
  contents.setWindowOpenHandler(()=>({action:'deny'}));
  contents.on('will-navigate',e=>e.preventDefault());
  contents.on('will-attach-webview',e=>e.preventDefault());
}
function isHome(e){return home&&!home.isDestroyed()&&e.sender===home.webContents&&e.senderFrame===home.webContents.mainFrame;}
function fromVoice(e){return view&&e.sender===view.webContents&&e.senderFrame===view.webContents.mainFrame;}
function hostPage(event){if(!isHome(event))throw Error('Acceso no disponible.');}
function send(data){if(view&&!view.webContents.isDestroyed())view.webContents.send('desk-message',data);}
function dispatch(key,code){send({type:'desktop:action',action:key,code,visit,low:prefs.low});}
function showHost(section='home'){
 if(action){
  home.contentView.removeChildView(view);
  action=null;
  visit++;
  if(ready)dispatch('background');
 }
 hostSection=section;
 publish();
 home.webContents.focus();
}
function contentBounds(){
  if(!action||!view)return;
  const [width,height]=home.getContentSize();view.setBounds({x:0,y:0,width,height});
}
function stopDetection(){generation++;clearInterval(detectTimer);detectTimer=null;detected=null;}
async function scan(){if(scanning||!detectTimer)return;scanning=true;const ticket=generation;
  try{const game=await detect(detected);if(ticket===generation&&game!==detected){detected=game;send({type:'squadlink:game',enabled:true,game});}}catch{}finally{scanning=false;}}
function disposeVoice(){
 stopDetection();ready=false;
 if(view){const old=view;view=null;if(action&&!home.isDestroyed())home.contentView.removeChildView(old);old.webContents.close();}
 action=null;
}
function createHome(){
 const w=new BrowserWindow({title:'Squadlink',width:1080,height:700,minWidth:700,minHeight:520,backgroundColor:'#0d1217',icon:path.join(__dirname,'Squadlink.ico'),autoHideMenuBar:true,webPreferences:options});
 guard(w.webContents);
 if(mac)w.once('ready-to-show',()=>reveal(w));
 w.on('resize',contentBounds);
 w.on('close',()=>{closing=true;disposeVoice();});
 w.loadURL('squad://home/');
 return w;
}
function ensureView(){
 if(view)return;
 view=new WebContentsView({webPreferences:options});const wc=view.webContents;guard(wc);
 wc.on('render-process-gone',()=>{if(view?.webContents!==wc)return;disposeVoice();state=blank();showHost();
 dialog.showMessageBox(home,{type:'warning',message:'El motor de la sala se cerró. Puedes volver a abrirla desde el lobby.'});});
 wc.on('before-input-event',(e,input)=>{if(input.type==='keyDown'&&(mac?input.meta:input.control)&&input.shift&&input.code==='KeyM'&&!input.isAutoRepeat&&state.canMic){e.preventDefault();dispatch('mic');}});
 wc.loadURL('squad://app/?server='+encodeURIComponent(prefs.server));
}
function open(key,code){
 if(key==='home'||key==='preferences'){showHost(key);return;}
 if(!Object.hasOwn(titles,key))throw Error('Opción desconocida.');
 if(state.joined&&['create','join'].includes(key))key='lobby';
 if(key==='lobby'&&!state.joined)key='rooms';
 ensureView();
 if(!action)home.contentView.addChildView(view);
 visit++;
 action={key,code};
 publish();
 contentBounds();
 view.webContents.focus();
 if(ready)dispatch(key,code);
}
function gameStatus(){send({type:'squadlink:game',enabled:Boolean(detectTimer),game:detected});}
ipcMain.on('home',e=>{if(fromVoice(e))showHost();});
ipcMain.on('desk-state',async(e,m)=>{
 if(!fromVoice(e)||!m||typeof m!=='object')return;
 if(m.type==='desktop:navigate'){
  if(['home','rooms','friends','player','arcade','ranking','guide','preferences'].includes(m.page))open(m.page);
 }else if(m.type==='desktop:state'){
  const before=state.joined;state={joined:m.joined===true,name:String(m.name||'').slice(0,80),nickname:String(m.nickname||'').slice(0,40),code:String(m.code||'').slice(0,6),mic:m.mic===true,canMic:m.canMic===true,members:Array.isArray(m.members)?m.members.slice(0,5):[]};publish();
  if(!ready){ready=true;if(action)dispatch(action.key,action.code);else dispatch('background');}
  if(state.joined&&!before)open('lobby');
  if(before&&!state.joined)showHost();
 }else if(m.type==='desktop:release'&&m.visit===visit&&!state.joined&&!action&&prefs.low)disposeVoice();
 else if(m.type==='squadlink:game:status'&&!mac)gameStatus();
 else if(m.type==='squadlink:game:set'){
  if(mac)return;
  if(!m.enabled){stopDetection();gameStatus();return;}
  if(detectTimer)return;
  const ticket=generation;
  const {response}=await dialog.showMessageBox(home,{type:'question',buttons:['Cancelar','Compartir'],defaultId:0,cancelId:0,message:'¿Compartir el juego detectado con tu grupo?'});
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
 if(next.server!==prefs.server){disposeVoice();state=blank();microphone=false;}
 prefs=next;if(ready&&action)dispatch(action.key,action.code);publish();
});
ipcMain.handle('updates',async e=>{
 hostPage(e);const url='https://api.github.com/repos/'+repo+'/actions/workflows/'+channel.workflow+'/runs?branch=preview%2Felectron-escritorio&status=success&per_page=1';
 const response=await fetch(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('No se pudo consultar GitHub.');
 const [run]=(await response.json()).workflow_runs;
 const build=Number(require('./package.json').squadBuild||0),attempt=Number(require('./package.json').squadAttempt||1);
 updateUrl='';
 if(run&&(run.run_number>build||(run.run_number===build&&run.run_attempt>attempt))){
 const assets=await fetch('https://api.github.com/repos/'+repo+'/actions/runs/'+run.id+'/artifacts',{signal:AbortSignal.timeout(10000)});
 if(!assets.ok)throw Error('No se pudo consultar el instalador.');
 const asset=(await assets.json()).artifacts.find(a=>a.name===channel.artifact&&!a.expired);
 if(asset)updateUrl='https://github.com/'+repo+'/actions/runs/'+run.id+'/artifacts/'+asset.id;
 }publish();return updateUrl?'Hay una nueva compilación disponible.':'Tienes la compilación más reciente disponible.';
});
ipcMain.handle('download',async e=>{hostPage(e);if(updateUrl)await shell.openExternal(updateUrl);});
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon'};
const csp="default-src 'self';script-src 'self';style-src 'self' 'unsafe-inline';img-src 'self' data:;connect-src 'self';media-src 'self' blob:;object-src 'none';frame-src 'self';base-uri 'none';form-action 'self'";
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
   if(['home.html','home.css','home.js','channels.css'].includes(name))dir=__dirname;
   else if(!['hero-art.webp','icon-192.png'].includes(name))return new Response(null,{status:404});
  }else name=name||'index.html';
  const type=mime[path.extname(name)];if(!type)return new Response(null,{status:404});
  try{return new Response(await fs.promises.readFile(path.join(dir,name)),{headers:{'Content-Type':type,'Content-Security-Policy':name==='doom-player.html' ? "frame-ancestors 'self'; object-src 'none'" : csp,'X-Content-Type-Options':'nosniff'}});}catch{return new Response(null,{status:404});}
 });
 const trusted=wc=>wc&&view?.webContents===wc&&wc.getURL().startsWith('squad://app/');
 ses.setPermissionCheckHandler((wc,p)=>trusted(wc)&&((p==='media'&&microphone)||p==='speaker-selection'||(p==='pointerLock'&&action?.key==='arcade')));
 ses.setPermissionRequestHandler(async(wc,p,done,details)=>{
  if(!trusted(wc))return done(false);
  if(p==='pointerLock')return done(action?.key==='arcade');
  if(['speaker-selection','clipboard-sanitized-write'].includes(p))return done(true);
  if(p!=='media'||!details.mediaTypes?.includes('audio')||details.mediaTypes.includes('video'))return done(false);
  if(!microphone){const answer=await dialog.showMessageBox(home,{type:'question',message:'¿Permitir que Squadlink use tu micrófono?',buttons:['Cancelar','Permitir'],cancelId:0,defaultId:0});microphone=answer.response===1&&trusted(wc);}
  if(microphone&&mac)microphone=await systemPreferences.askForMediaAccess('microphone');
  done(microphone&&trusted(wc));
 });
 if(mac)Menu.setApplicationMenu(Menu.buildFromTemplate([{role:'appMenu'},{role:'editMenu'},{role:'windowMenu'}]));
 else Menu.setApplicationMenu(null);
 home=createHome();
 // Restore presence and membership for returning players. Guests only start the voice renderer on demand.
 if((await ses.cookies.get({url:prefs.server,name:'squad_session'})).length)ensureView();
}
if(locked)app.whenReady().then(start);
app.on('window-all-closed',()=>app.quit());
