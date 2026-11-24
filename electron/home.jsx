import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DesktopShell,Lobby} from './lobby.jsx';
const api=window.squad;
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
 const prefs=state?.hostSection==='preferences';
 useEffect(()=>{const off=api.listen(update);api.state().then(update).catch(e=>setError(e.message));return off},[]);
 const server=state?.server;
 useEffect(()=>{if(server)setAddress(server)},[server]);
 async function run(work){setError('');try{return await work()}catch(e){setError(e.message.replace(/^Error invoking remote method.*?Error: /,''));}}
 function open(key,code){run(()=>api.open(code?{key,code}:key))}
 if(!state)return <main><p role="status">{error||'Abriendo Squadlink…'}</p></main>;
 // The workspace covers the home window. Keep its state, release its artwork and controls.
 if(state.low && state.hostSection==='workspace')return null;
 return <DesktopShell state={state} open={open} prefs={prefs}>
   {prefs ? <main className="config">
     <h1>Ajustes</h1>
     <section aria-labelledby="performance-title">
       <h2 id="performance-title">Rendimiento</h2>
       <p>En Bajo consumo, el lobby libera memoria mientras estás en la sala o juegas con el lobby minimizado. La voz y la radio siguen funcionando.</p>
       <div className="choices" role="group" aria-labelledby="performance-title">
         {[[true,'Bajo consumo'],[false,'Experiencia completa']].map(([value,label])=>
           <button key={label} aria-pressed={state.low===value} onClick={()=>run(()=>api.prefs({low:value}))}>{label}</button>)}
       </div>
       {state.canChooseLobby && state.low && <label className="lobby-memory-choice">
         <input type="checkbox" checked={state.integratedLobby} onChange={e=>run(()=>api.prefs({integratedLobby:e.target.checked}))}/>
         <span>Usar menos memoria con el lobby visible<small>Si sueles jugar con Squadlink minimizado, deja esta opción desactivada.</small></span>
       </label>}
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
   </main> : <Lobby state={state} open={open} call={action=>run(()=>api.action(action))} error={error} active={state.hostSection==='home'}/>}
 </DesktopShell>;
}
createRoot(document.getElementById('root')).render(<App/>);
