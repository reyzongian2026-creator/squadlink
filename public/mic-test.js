// A short local sample. Only the player's explicit clicks can start capture or playback.
export function mountMicTest(container, constraints, preferences) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  container.replaceChildren(button, status);
  const record = 'Grabar prueba de 4 segundos', listen = 'Escuchar mi prueba';
  let version = 0, timer, stream, recorder, url, player;
  function stopInput() {
    clearTimeout(timer);
    if (recorder) {
      recorder.onstop = recorder.ondataavailable = recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
      recorder = null;
    }
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
  }
  function cancel() {
    version++;
    stopInput();
    if (player) {
      player.onended = player.onerror = null;
      player.pause();
      player.removeAttribute('src');
      player.load();
      player = null;
    }
    if (url) URL.revokeObjectURL(url);
    url = null;
    button.textContent = record;
    status.textContent = '';
  }
  function fail(message) { cancel(); status.textContent = message; }
  button.onclick = async () => {
    if (player || button.textContent === 'Cancelar prueba') { cancel(); return; }
    const id = ++version;
    if (url) {
      button.textContent = 'Cancelar prueba';
      try {
        player = document.createElement('audio');
        const {outputId, listenVolume} = preferences();
        player.volume = listenVolume;
        if (outputId && player.setSinkId) await player.setSinkId(outputId);
        if (version !== id) return;
        player.src = url;
        player.onended = () => { cancel(); status.textContent = 'Prueba terminada.'; };
        player.onerror = () => fail('No se pudo reproducir la muestra.');
        await player.play();
      } catch { if (id === version) fail('Revisa el dispositivo de salida y vuelve a probar.'); }
      return;
    }
    button.textContent = 'Cancelar prueba';
    status.textContent = 'Esperando permiso del micrófono…';
    try {
      const input = await navigator.mediaDevices.getUserMedia({audio: constraints(), video: false});
      if (id !== version) { input.getTracks().forEach(track => track.stop()); return; }
      stream = input;
      recorder = new MediaRecorder(input);
      const parts = [];
      recorder.ondataavailable = event => { if (id === version && event.data.size) parts.push(event.data); };
      recorder.onerror = () => fail('No se pudo grabar la muestra.');
      recorder.onstop = () => {
        if (id !== version) return;
        const type = recorder.mimeType;
        stopInput();
        if (!parts.length) { fail('La muestra quedó vacía. Comprueba el micrófono.'); return; }
        url = URL.createObjectURL(new Blob(parts, {type}));
        button.textContent = listen;
        status.textContent = 'Muestra local lista. El micrófono está cerrado.';
      };
      recorder.start();
      status.textContent = 'Habla y deja un momento de silencio. Solo tú podrás escuchar la muestra.';
      timer = setTimeout(() => { if (id === version && recorder?.state === 'recording') recorder.stop(); }, 4000);
    } catch { if (id === version) fail('No se pudo grabar. Comprueba el permiso y la entrada de micrófono.'); }
  };
  const panel = document.getElementById('audio-panel');
  const closePanel = () => { if (!panel?.open) cancel(); };
  const hidden = () => { if (document.hidden) cancel(); };
  const host = window.chrome?.webview;
  const navigate = ({data}) => { if (data?.type === 'desktop:action' && data.action !== 'settings') cancel(); };
  cancel();
  if (typeof MediaRecorder !== 'function' || !navigator.mediaDevices?.getUserMedia) {
    button.disabled = true;
    status.textContent = 'La prueba local no está disponible en este equipo.';
  }
  panel?.addEventListener('toggle', closePanel);
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', cancel);
  host?.addEventListener('message', navigate);
  return { cancel, dispose() {
    cancel();
    panel?.removeEventListener('toggle', closePanel);
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', cancel);
    host?.removeEventListener('message', navigate);
  }};
}
