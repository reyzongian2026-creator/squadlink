import { prepareVoiceCapture } from './voice-capture.js';
import { limitingCurve } from './voice-playback.js';
import { monitorMicrophone } from './mic-test-level.js';
// Blob playback uses the same gain and soft limiter as received voice. Only the
// selected output element plays to a device, including when gain exceeds unity.
export function localSamplePlayer(url, {listenVolume,outputId}, ended, failed) {
  const level = Number.isFinite(listenVolume) ? Math.max(0, Math.min(2,listenVolume)) : 1;
  let source = document.createElement('audio'), output = source, context, destination, closed = false;
  const nodes = [];
  function releaseGraph() {
    for (const node of nodes.splice(0)) node.disconnect();
    destination?.stream.getTracks().forEach(track => track.stop());
    destination = null;
    if (context && context.state !== 'closed') context.close().catch(() => {});
    context = null;
  }
  if (level > 1) {
    try {
      context = new AudioContext({latencyHint:'interactive'});
      destination = context.createMediaStreamDestination();
      destination.channelCount = 1;
      const gain = context.createGain(), limiter = context.createWaveShaper();
      const input = context.createMediaElementSource(source);
      nodes.push(input,gain,limiter);
      gain.gain.value = level / 2;
      limiter.curve = limitingCurve();
      input.connect(gain).connect(limiter).connect(destination);
      output = document.createElement('audio');
      output.srcObject = destination.stream;
    } catch {
      releaseGraph();
      source = output = document.createElement('audio');
    }
  }
  source.src = url;
  source.onended = ended;
  output.onerror = source.onerror = failed;
  output.volume = Math.min(1,level);
  return {
    limitedToUnity:level > 1 && !context,
    async play() {
      const ready = context && context.state !== 'running' ? context.resume() : Promise.resolve();
      const routed = outputId && output.setSinkId ? output.setSinkId(outputId) : Promise.resolve();
      await Promise.all([ready,routed]);
      if (closed) return;
      await Promise.all(output === source ? [source.play()] : [output.play(),source.play()]);
    },
    close() {
      closed = true;
      for (const element of new Set([source,output])) {
        element.onended = element.onerror = null;
        element.pause();
        element.srcObject = null;
        element.removeAttribute('src');
        element.load();
      }
      releaseGraph();
    },
  };
}

// A short local sample. Only the player's explicit clicks can start capture or playback.
export function mountMicTest(container, constraints, preferences) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const meter = document.createElement('meter');
  meter.min = -60; meter.max = 0; meter.value = -60; meter.hidden = true;
  meter.setAttribute('aria-label','Nivel del micrófono en dBFS');
  container.replaceChildren(button, meter, status);
  const record = 'Grabar prueba de 4 segundos', listen = 'Escuchar mi prueba';
  const supported = typeof MediaRecorder === 'function' && !!navigator.mediaDevices?.getUserMedia;
  let active = false;
  let version = 0, timer, stream, capture, recorder, url, player, monitor, feedback = '';
  function stopInput() {
    clearTimeout(timer);
    monitor?.stop(); monitor = null;
    if (recorder) {
      recorder.onstop = recorder.ondataavailable = recorder.onerror = null;
      if (recorder.state !== 'inactive') recorder.stop();
      recorder = null;
    }
    capture?.close();
    capture = null;
    stream?.getTracks().forEach(track => track.stop());
    stream = null;
  }
  function cancel() {
    version++;
    active = false;
    stopInput();
    player?.close();
    player = null;
    feedback = '';
    if (url) URL.revokeObjectURL(url);
    url = null;
    button.textContent = record;
    status.textContent = supported ? '' : 'La prueba local no está disponible en este equipo.';
  }
  function fail(message) { cancel(); status.textContent = message; }
  button.onclick = async () => {
    if (active) { cancel(); return; }
    if (!supported) return;
    if (url && preferences().listenVolume === 0) {
      status.textContent = 'Sube el volumen de las voces para escuchar la muestra.';
      return;
    }
    active = true;
    const id = ++version;
    if (url) {
      button.textContent = 'Cancelar prueba';
      try {
        const done = () => {
          if (id !== version) return;
          const result = feedback;
          cancel();
          status.textContent = 'Prueba terminada. ' + result;
        };
        player = localSamplePlayer(url, preferences(), done, () => {
          if (id === version) fail('No se pudo reproducir la muestra.');
        });
        status.textContent = player.limitedToUnity ? 'La amplificación no está disponible. La muestra se reproduce al 100 %.' : feedback;
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
      capture = prepareVoiceCapture(input, preferences());
      await capture.ready;
      if (id !== version) return;
      recorder = new MediaRecorder(capture.stream);
      const parts = [];
      recorder.ondataavailable = event => { if (id === version && event.data.size) parts.push(event.data); };
      recorder.onerror = () => { if (id === version) fail('No se pudo grabar la muestra.'); };
      recorder.onstop = () => {
        if (id !== version) return;
        const type = recorder.mimeType;
        feedback = monitor?.summary() || '';
        stopInput();
        if (!parts.length) { fail('La muestra quedó vacía. Comprueba el micrófono.'); return; }
        active = false;
        url = URL.createObjectURL(new Blob(parts, {type}));
        button.textContent = listen;
        status.textContent = ['Muestra local lista. El micrófono está cerrado.',feedback].filter(Boolean).join(' ');
      };
      recorder.start();
      monitor = monitorMicrophone(input,capture,meter);
      status.textContent = 'Habla y deja un momento de silencio. Solo tú podrás escuchar la muestra.';
      timer = setTimeout(() => { if (id === version && recorder?.state === 'recording') recorder.stop(); }, 4000);
    } catch { if (id === version) fail('No se pudo grabar. Comprueba el permiso y la entrada de micrófono.'); }
  };
  const panel = document.getElementById('audio-panel');
  const closePanel = () => { if (!panel?.open) cancel(); };
  const hidden = () => { if (document.hidden) cancel(); };
  const host = window.squadBridge ?? window.chrome?.webview;
  const navigate = ({data}) => { if (data?.type === 'desktop:action' && data.action !== 'settings') cancel(); };
  cancel();
  button.disabled = !supported;
  if (supported && navigator.serviceWorker && /^https?:$/.test(window.location.protocol)) {
    navigator.serviceWorker.ready.then(registration => registration.active?.postMessage('squadlink:prepare-mic-test')).catch(() => {});
  }
  panel?.addEventListener('toggle', closePanel);
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', cancel);
  window.addEventListener('hashchange', cancel);
  host?.addEventListener('message', navigate);
  return { cancel, cancelActive() { if (active) cancel(); }, dispose() {
    cancel();
    panel?.removeEventListener('toggle', closePanel);
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('pagehide', cancel);
    window.removeEventListener('hashchange', cancel);
    host?.removeEventListener('message', navigate);
  }};
}
