// A local mono WAV. Its peak is -20 dBFS even with voice boost at 200 %.
function speakerTones() {
  const rate = 16000, note = 3840, gap = 1600, fade = 320;
  const frames = 2 * note + gap;
  const bytes = new Uint8Array(44 + frames * 2);
  const wav = new DataView(bytes.buffer);
  function text(offset, value) {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  }
  text(0, 'RIFF'); wav.setUint32(4, bytes.length - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true); wav.setUint16(22, 1, true);
  wav.setUint32(24, rate, true); wav.setUint32(28, rate * 2, true);
  wav.setUint16(32, 2, true); wav.setUint16(34, 16, true);
  text(36, 'data'); wav.setUint32(40, frames * 2, true);
  for (const [start, hz] of [[0, 440], [note + gap, 554.37]]) {
    for (let i = 0; i < note; i++) {
      const edge = Math.min(1, i / fade, (note - 1 - i) / fade);
      const envelope = (1 - Math.cos(Math.PI * edge)) / 2;
      const sample = Math.sin(2 * Math.PI * hz * i / rate) * envelope;
      wav.setInt16(44 + 2 * (start + i), Math.round(3276 * sample), true);
    }
  }
  return bytes;
}

export function mountSpeakerTest(container, preferences) {
  const doc = container.ownerDocument, view = doc.defaultView;
  const button = doc.createElement('button'), status = doc.createElement('p');
  const title = 'Probar altavoz';
  button.type = 'button'; button.className = 'secondary'; button.textContent = title;
  status.setAttribute('role', 'status');
  container.replaceChildren(button, status);
  let active;
  function cancel() {
    const run = active;
    active = undefined;
    if (run) {
      view.clearTimeout(run.timer);
      run.audio.onended = run.audio.onerror = null;
      run.audio.pause();
      run.audio.removeAttribute('src');
      run.audio.load();
      if (run.url) view.URL.revokeObjectURL(run.url);
    }
    button.textContent = title; status.textContent = '';
  }
  button.onclick = async () => {
    if (active) { cancel(); status.textContent = 'Prueba detenida.'; return; }
    const {outputId, listenVolume} = preferences();
    const volume = Number.isFinite(listenVolume) ? Math.max(0, Math.min(1, listenVolume)) : 0.7;
    if (volume === 0) { status.textContent = 'Sube el volumen de las voces para probar el altavoz.'; return; }
    const audio = doc.createElement('audio');
    const run = {audio};
    active = run;
    const finish = message => {
      if (active !== run) return;
      cancel();
      status.textContent = message;
    };
    button.textContent = 'Detener prueba de altavoz';
    status.textContent = 'Preparando la salida de audio…';
    run.timer = view.setTimeout(() => finish('La salida no respondió. Vuelve a probar.'), 8000);
    try {
      if (outputId) {
        if (typeof audio.setSinkId !== 'function') throw Error();
        await audio.setSinkId(outputId);
      }
      if (active !== run) return;
      if ((preferences().outputId || '') !== (outputId || '')) { cancel(); return; }
      run.url = view.URL.createObjectURL(new view.Blob([speakerTones()], {type:'audio/wav'}));
      audio.volume = volume;
      audio.src = run.url;
      audio.onended = () => finish('Prueba de altavoz terminada.');
      audio.onerror = () => finish('No se pudieron reproducir los tonos en la salida elegida.');
      await audio.play();
      if (active === run) status.textContent = 'Reproduciendo dos tonos en este equipo.';
    } catch {
      finish('No se pudo usar la salida elegida. Comprueba el dispositivo y vuelve a probar.');
    }
  };
  const panel = doc.getElementById('audio-panel');
  const devices = view.navigator.mediaDevices;
  const host = view.squadBridge ?? view.chrome?.webview;
  const closePanel = () => { if (!panel.open) cancel(); };
  const hidden = () => { if (doc.hidden) cancel(); };
  const navigate = ({data}) => { if (data?.type === 'desktop:action' && data.action !== 'settings') cancel(); };
  const audioState = () => { if (active && container.closest('[hidden]')) cancel(); };
  panel?.addEventListener('toggle', closePanel);
  devices?.addEventListener?.('devicechange', cancel);
  host?.addEventListener('message', navigate);
  doc.addEventListener('visibilitychange', hidden);
  view.addEventListener('hashchange', cancel);
  view.addEventListener('pagehide', cancel);
  view.addEventListener('squadlink:audio-state', audioState);
  return {cancel, dispose() {
    cancel();
    button.onclick = null;
    panel?.removeEventListener('toggle', closePanel);
    devices?.removeEventListener?.('devicechange', cancel);
    host?.removeEventListener('message', navigate);
    doc.removeEventListener('visibilitychange', hidden);
    view.removeEventListener('hashchange', cancel);
    view.removeEventListener('pagehide', cancel);
    view.removeEventListener('squadlink:audio-state', audioState);
  }};
}
