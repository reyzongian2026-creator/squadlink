import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {channels} from './channels.js';
import {watchLobbyDirectory} from './lobby-directory.mjs';
const api=window.squad;
const shapes={
  sound:<><path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/></>,
  group:<><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3c3 1 3 3 3 5"/></>,
  game:<><path d="M7 8h10c3 0 4 4 5 9 .4 3-2 4-4 2l-3-3H9l-3 3c-2 2-5 1-4-2 1-5 2-9 5-9Z"/><path d="M6 12h4m-2-2v4m8-3h.1m2 2h.1"/></>,
  trophy:<><path d="M7 4h10v6a5 5 0 0 1-10 0Zm0 2H3v2a4 4 0 0 0 4 4m10-6h4v2a4 4 0 0 1-4 4m-5 3v5m-4 0h8"/></>,
  person:<><circle cx="12" cy="8" r="3"/><path d="M5 20v-2a7 7 0 0 1 14 0v2"/></>,
  sliders:<><path d="M4 6h8m4 0h4M4 12h3m4 0h9M4 18h10m4 0h2"/><circle cx="14" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="16" cy="18" r="2"/></>,
  headset:<><path d="M4 14V11a8 8 0 0 1 16 0v3m-2 4c0 3-3 3-5 3"/><rect x="3" y="11" width="4" height="7" rx="2"/><rect x="17" y="11" width="4" height="7" rx="2"/></>,
  mic:<><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v4m-4 0h8"/></>,
  grid:<><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
  plus:<path d="M12 5v14M5 12h14"/>,code:<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20"/>,arrow:<path d="m9 5 7 7-7 7"/>,exit:<path d="M10 3H5v18h5m-1-9h12m-5-5 5 5-5 5"/>
};
function Icon({id}){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{shapes[id]}</svg>}
function UpdatePanel({state,run}){
 const {phase,version,percent,message}=state.update;
 useEffect(()=>{if(phase==='idle')run(()=>api.updates());},[phase]);
 const title=({
  checking:'Buscando una versión nueva…', current:'Tienes la última versión.',
  available:'Versión disponible · '+version, downloading:'Descargando '+version+'…',
  ready:'Versión '+version+' verificada y lista para instalar.',
  installing:'Preparando la instalación. Squadlink volverá a abrirse.'
 }[phase] || '');
 const reminder=phase==='ready' && state.joined ? 'Sal de la sala cuando quieras reiniciar.' : '';
 const status=[title,message,reminder].filter(Boolean).join(' ');
 return <section aria-labelledby="updates-title">
   <h2 id="updates-title">Actualizaciones</h2>
   <p>Versión instalada · {state.version}</p>
   <p role="status" aria-live="polite">{status}</p>
   {phase==='downloading'&&<div className="download-progress"><progress max="100" value={percent} aria-label="Descarga de la actualización"/><span>{percent} %</span></div>}
   <div className="choices">
    {['idle','current','check-error'].includes(phase)&&<button onClick={()=>run(()=>api.updates())}>Buscar actualizaciones</button>}
    {phase==='available'&&<button onClick={()=>run(()=>api.download())}>{message?'Reintentar descarga':'Descargar actualización'}</button>}
    {phase==='downloading'&&<button onClick={()=>run(()=>api.cancelDownload())}>Cancelar descarga</button>}
    {phase==='ready'&&<>
      <button disabled={state.joined} onClick={()=>run(()=>api.install())}>Instalar y reiniciar</button>
      <button onClick={()=>run(()=>api.updates())}>Buscar otra versión</button>
    </>}
   </div>
 </section>;
}
function App(){
 const [state,update]=useState(null),[error,setError]=useState(''),[serverFeedback,setServerFeedback]=useState(''),[address,setAddress]=useState('');
 const [rooms,setRooms]=useState([]),[directoryStatus,setDirectoryStatus]=useState('Buscando salas…');
 const directory=useRef(null);
 const [directoryFailed,setDirectoryFailed]=useState(false);
 const prefs=state?.hostSection==='preferences';
 useEffect(()=>{const off=api.listen(update);api.state().then(update).catch(e=>setError(e.message));return off},[]);
 const server=state?.server;
 useEffect(()=>{if(server)setAddress(server)},[server]);
 const lobbyVisible=state?.hostSection==='home';
 useEffect(()=>{
  if(!server||!lobbyVisible)return;
  setRooms([]);setDirectoryFailed(false);setDirectoryStatus('Buscando salas…');
  const watcher=watchLobbyDirectory(items=>{
   setRooms(items);setDirectoryFailed(false);
   setDirectoryStatus(items.length?'':'Todavía no hay salas públicas.');
  },()=>setDirectoryFailed(true));
  directory.current=watcher;
  return ()=>{watcher.stop();directory.current=null};
 },[server,lobbyVisible,state?.code]);
 async function run(work){setError('');try{return await work()}catch(e){setError(e.message.replace(/^Error invoking remote method.*?Error: /,''));}}
 function open(key,code){run(()=>api.open(code?{key,code}:key))}
 if(!state)return <main><p role="status">{error||'Abriendo Squadlink…'}</p></main>;
 // The workspace covers the home window. Keep its state, release its artwork and controls.
 if(state.low && state.hostSection==='workspace')return null;
 return <div className="desktop-shell">
   <aside className="channel-rail">
     <div className="channel-brand"><img src="/icon-192.png" alt=""/><span className="rail-label">Squadlink</span></div>
     <nav className="channel-list" aria-label="Canales">
       {channels.map(([key,label,path])=>
         <button key={key} title={label} onClick={()=>open(key)} aria-current={key===(prefs?'preferences':'home')?'page':undefined}>
           <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={path}/></svg>
           <span className="rail-label">{label}</span>
         </button>)}
     </nav>
     <div className="account-row"><button title="Editar mi apodo" aria-label="Editar mi apodo" onClick={()=>open('player')}>
       <span className="channel-avatar" aria-hidden="true">{(state.nickname||'J').slice(0,1).toUpperCase()}</span>
       <span className="rail-label account-name">{state.nickname||'Invitado'}</span>
     </button></div>
   </aside>
   <div className="channel-column">
     <header className="channel-heading"><Icon id={prefs?'sliders':'headset'}/>{prefs?'Preferencias':'Lobby'}</header>
   {prefs ? <main className="config">
     <h1>Ajustes</h1>
     <section aria-labelledby="performance-title">
       <h2 id="performance-title">Rendimiento</h2>
       <p>En Bajo consumo, el lobby libera memoria mientras estás en la sala o juegas con el lobby minimizado. La voz y la radio siguen funcionando.</p>
       <div className="choices" role="group" aria-labelledby="performance-title">
         {[[true,'Bajo consumo'],[false,'Experiencia completa']].map(([value,label])=>
           <button key={label} aria-pressed={state.low===value} onClick={()=>run(()=>api.prefs({low:value}))}>{label}</button>)}
       </div>
     </section>
     <section>
       <h2><label htmlFor="server-address">Servidor del grupo</label></h2>
       <form onSubmit={e=>{e.preventDefault();run(async()=>{await api.prefs({server:address});setServerFeedback('Servidor guardado.')})}}>
         <input id="server-address" type="url" required value={address} onChange={e=>{setAddress(e.target.value);setServerFeedback('')}}/>
         <button>Guardar</button>
       </form>
       <p role="status">{serverFeedback}</p>
     </section>
     <UpdatePanel state={state} run={run}/>

     {error && <p className="error" role="alert">{error}</p>}
   </main> : <main>
     <section className="hero" aria-labelledby="room-title">
       <div className="scene" aria-hidden="true"></div>
       <div className="hero-copy">
         <h1 id="room-title">{state.joined?state.name:'Tu sala de voz'}</h1>
         <p>{state.joined?state.members.length+' en la sala · Código '+state.code:'Crea una sala o entra con el código de tu grupo.'}</p>
         <div className="actions">{state.joined ? <>
           <button className="primary" onClick={()=>open('lobby')}><Icon id="headset"/>Mi sala</button>
           <button disabled={!state.canMic} onClick={()=>run(()=>api.action('mic'))}><Icon id="mic"/>{state.mic?'Silenciar':'Activar micrófono'}</button>
           {state.radioState && state.radioState!=='empty' && <button aria-keyshortcuts="Alt+Shift+R" title="Alt + Mayús + R" aria-pressed={state.radioState==='playing'} onClick={()=>run(()=>api.action('radio'))}>{state.radioState==='playing'?'Silenciar mi radio':'Reanudar mi radio'}</button>}
           <button className="exit" onClick={()=>run(()=>api.action('leave'))}><Icon id="exit"/>Salir de sala</button>
         </> : <>
           <button className="primary" onClick={()=>open('create')}><Icon id="plus"/>Crear sala</button>
           <button onClick={()=>open('join')}><Icon id="code"/>Unirme con código</button>
         </>}</div>
       </div>
     </section>
     {error && <p className="error" role="alert">{error}</p>}
     <div className="columns">
       <section className="block" aria-labelledby="public-title">
         <div className="section-head"><h2 id="public-title">Salas públicas</h2>
           <button onClick={()=>open('rooms')} aria-label="Ver directorio de salas">Ver todas <span aria-hidden="true">→</span></button>
         </div>
         {rooms.length ? <ul>{rooms.map(r=>{
           const full=r.count>=r.capacity;
           return <li key={r.code}><button disabled={r.code!==state.code && (state.joined || full)} onClick={()=>r.code===state.code?open('lobby'):open('join',r.code)}>
             <span className="room-symbol"><Icon id="sound"/></span>
             <span className="room-label"><b>{r.name}</b><small>{[r.game,r.level].filter(Boolean).join(' · ')||'Sala de voz'}</small></span>
             <em aria-label={(r.code===state.code?'Tu sala · ':'')+r.count+' de '+r.capacity+' plazas ocupadas'}>{r.code===state.code?'Volver a mi sala':full?'Llena':r.count+'/'+r.capacity}</em>
           </button></li>})}</ul> :
           !directoryFailed && <p className="empty" role="status"><Icon id="headset"/>{directoryStatus}</p>}
         {directoryFailed && <div className="directory-retry">
           <p role="status">{rooms.length?'Se muestran las últimas salas disponibles.':'No se pudo cargar el directorio.'}</p>
           <button onClick={()=>directory.current?.retry()}>Reintentar</button>
         </div>}
       </section>
     </div>
   </main>}
     <footer>
       <button onClick={()=>open('settings')}><Icon id="mic"/>Dispositivos de audio</button>
       {!prefs && <button onClick={()=>open('preferences')}><i aria-hidden="true"/>{state.low?'Bajo consumo':'Experiencia completa'}</button>}
     </footer>
   </div>
 </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
