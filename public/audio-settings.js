const preferencesKey = 'squadlink.audio.v1';

export function readAudioSettings() {
  let stored;
  try { stored = JSON.parse(globalThis.window?.localStorage.getItem(preferencesKey) ?? 'null'); } catch {}
  return {
    inputId: typeof stored?.inputId === 'string' ? stored.inputId : '',
    outputId: typeof stored?.outputId === 'string' ? stored.outputId : '',
    noiseSuppression: stored?.noiseSuppression !== false
  };
}

export function saveAudioSettings(settings) {
  try { globalThis.window?.localStorage.setItem(preferencesKey, JSON.stringify(settings)); } catch {}
}

export function mountAudioSettings(container, getVoice, onStatus) {
  const field = (text, control) => {
    const label = document.createElement('label');
    label.append(text, control);
    return label;
  };
  const microphone = document.createElement('select');
  const speakers = document.createElement('select');
  const noise = document.createElement('input');
  noise.type = 'checkbox';
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'secondary';
  refresh.textContent = 'Actualizar dispositivos';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const media = navigator.mediaDevices;
  const outputSupported = typeof HTMLMediaElement.prototype.setSinkId === 'function';
  const noiseSupported = !!media?.getSupportedConstraints?.().noiseSuppression;
  const renderOptions = (select, devices, chosen, kind) => {
    select.replaceChildren(new Option('Predeterminado del sistema', ''));
    let number = 0;
    for (const item of devices.filter(d => d.kind === kind && d.deviceId && d.deviceId !== 'default')) {
      ++number;
      select.add(new Option(item.label || (kind === 'audioinput' ? 'Micrófono ' : 'Salida ') + number, item.deviceId));
    }
    if (chosen && ![...select.options].some(o => o.value === chosen))
      select.add(new Option('Dispositivo guardado', chosen));
    select.value = chosen;
  };
  let reading = 0;
  let saving = false;
  async function render() {
    const sequence = ++reading;
    let devices = [];
    try { devices = await media?.enumerateDevices?.() ?? []; } catch {}
    if (sequence !== reading) return;
    const settings = getVoice()?.settings ?? readAudioSettings();
    renderOptions(microphone, devices, settings.inputId, 'audioinput');
    renderOptions(speakers, devices, settings.outputId, 'audiooutput');
    noise.checked = settings.noiseSuppression;
    microphone.disabled = saving || !media;
    speakers.disabled = saving || !outputSupported;
    noise.disabled = saving || !noiseSupported;
    refresh.disabled = saving;
  }
  async function change(patch) {
    if (saving) return;
    saving = true;
    microphone.disabled = speakers.disabled = noise.disabled = refresh.disabled = true;
    try {
      const voice = getVoice();
      if (voice) await voice.configureAudio(patch);
      else saveAudioSettings({ ...readAudioSettings(), ...patch });
      status.textContent = 'Preferencia de audio actualizada.';
    } catch (err) {
      status.textContent = err.message;
      onStatus?.(err.message);
    } finally {
      saving = false;
      await render();
    }
  }
  microphone.onchange = () => change({ inputId: microphone.value });
  speakers.onchange = () => change({ outputId: speakers.value });
  noise.onchange = () => change({ noiseSuppression: noise.checked });
  refresh.onclick = async () => {
    await render();
    status.textContent = 'Lista actualizada. Activa el micrófono para ver los dispositivos autorizados.';
  };
  const note = document.createElement('p');
  note.textContent = outputSupported
    ? 'Activa el micrófono para que el navegador muestre los nombres de los dispositivos.'
    : 'La salida de audio se elige en los ajustes de sonido de tu sistema.';
  container.replaceChildren(field('Micrófono', microphone), field('Salida de audio', speakers),
    field('Reducir ruido de fondo', noise), refresh, note, status);
  media?.addEventListener?.('devicechange', render);
  render();
  return () => { ++reading; media?.removeEventListener?.('devicechange', render); };
}
