import { nesMousePoint } from './practice-mouse.js';
// The cartridge stays in this renderer. Only the emulator module is imported.
const WIDTH = 256;
const HEIGHT = 240;
const FRAME_MS = 1000 / 60;
const MAX_ROM_BYTES = 4 * 1024 * 1024;

export function readCartridge(bytes) {
  if (bytes.length < 16 || bytes[0] !== 0x4e || bytes[1] !== 0x45 || bytes[2] !== 0x53 || bytes[3] !== 0x1a) {
    throw Error('Elige un cartucho .nes con cabecera iNES.');
  }
  const extended = (bytes[7] & 12) === 8;
  function bankBytes(low, upper, unit) {
    if (!extended) return low * unit;
    if (upper === 15) return 2 ** (low >> 2) * (2 * (low & 3) + 1);
    return ((upper << 8) + low) * unit;
  }
  const program = bankBytes(bytes[4], bytes[9] & 15, 16384);
  const tiles = bankBytes(bytes[5], bytes[9] >> 4, 8192);
  const required = 16 + ((bytes[6] & 4) ? 512 : 0) + program + tiles;
  if (!program || bytes.length > MAX_ROM_BYTES || required > bytes.length) {
    throw Error('El cartucho está incompleto o supera los 4 MiB.');
  }
  return bytes;
}

export function zapperPoint(event, rect) {
  event = nesMousePoint(event, rect);
  return [
    Math.min(WIDTH - 1, Math.max(0, Math.floor((event.clientX - rect.left) * WIDTH / rect.width))),
    Math.min(HEIGHT - 1, Math.max(0, Math.floor((event.clientY - rect.top) * HEIGHT / rect.height))),
  ];
}

function makeAudio(context) {
  const size = 1024;
  const leftSamples = new Float32Array(size);
  const rightSamples = new Float32Array(size);
  let index = 0;
  let next = 0;
  return (left, right) => {
    if (context.state !== 'running') return;
    leftSamples[index] = left;
    rightSamples[index++] = right;
    if (index < size) return;
    index = 0;
    const now = context.currentTime;
    if (next > now + 0.20) return;
    const buffer = context.createBuffer(2, size, context.sampleRate);
    buffer.copyToChannel(leftSamples, 0);
    buffer.copyToChannel(rightSamples, 1);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    next = Math.max(now + 0.015, next);
    source.start(next);
    next += buffer.duration;
  };
}

export function mountDuckNes(mount, status, loadCore = () => import('./duck-nes-core.js')) {
  const view = mount.ownerDocument.defaultView;
  const doc = mount.ownerDocument;
  const aborter = new view.AbortController();
  const listen = (target, type, action) => target.addEventListener(type, action, { signal: aborter.signal });
  const panel = doc.createElement('div');
  panel.className = 'duck-nes';
  panel.innerHTML = `<label>Cartucho de Duck Hunt (.nes)<input type="file" accept=".nes"></label>
    <p>Selecciona tu ROM local. El juego original contiene destellos rápidos.</p>
    <canvas width="256" height="240" hidden tabindex="0" aria-label="Pantalla NES. Apunta y dispara con el ratón o toca la pantalla."></canvas>
    <div class="duck-nes-controls">
      <button type="button" class="primary" data-control="play" disabled>Jugar</button>
      <button type="button" class="secondary" data-control="select" hidden>Select</button>
      <button type="button" class="secondary" data-control="start" hidden>Start</button>
    </div>`;
  const fileField = panel.querySelector('input');
  const canvas = panel.querySelector('canvas');
  const control = key => panel.querySelector('[data-control="' + key + '"]');
  const play = control('play');
  const select = control('select');
  const start = control('start');
  mount.append(panel);
  if (!doc.querySelector('link[data-duck-nes]')) {
    const link = doc.createElement('link');
    link.rel = 'stylesheet'; link.href = '/duck-nes.css'; link.dataset.duckNes = '';
    doc.head.append(link);
  }

  let closed = false, version = 0, cartridge = null, nes = null, buttons = null;
  let audio = null, animation = 0, running = false, pointer = null;
  let frame = 0, nextTick = null, triggerUntil = 0;
  const buttonReleases = new Map();
  status.textContent = 'Abre tu copia de Duck Hunt para jugar con el Zapper.';

  function clearInput() {
    pointer = null;
    triggerUntil = 0;
    nes?.zapperFireUp();
    for (const key of buttonReleases.keys()) nes?.buttonUp(1, key);
    buttonReleases.clear();
  }
  function stop() {
    running = false;
    view.cancelAnimationFrame(animation);
    animation = 0; nextTick = null;
    clearInput();
    if (audio && audio.state !== 'closed') audio.close().catch(() => {});
    audio = null;
    if (nes) nes.opts.onAudioSample = null;
  }
  function showPaused() {
    stop();
    play.textContent = 'Reanudar';
    status.textContent = 'Juego en pausa.';
  }

  function advance(now) {
    if (!running || closed) return;
    if (doc.hidden) { showPaused(); return; }
    if (nextTick === null || now - nextTick > 4 * FRAME_MS) nextTick = now;
    try {
      while (nextTick <= now) {
        nes.frame();
        frame++;
        if (triggerUntil && frame >= triggerUntil && pointer === null) {
          nes.zapperFireUp();
          triggerUntil = 0;
        }
        for (const [key, until] of buttonReleases) {
          if (frame >= until) { nes.buttonUp(1, key); buttonReleases.delete(key); }
        }
        nextTick += FRAME_MS;
      }
      animation = view.requestAnimationFrame(advance);
    } catch {
      stop(); nes = null; select.hidden = start.hidden = true; play.textContent = 'Reiniciar';
      status.textContent = 'El emulador se detuvo. Comprueba que el cartucho sea compatible.';
    }
  }

  listen(fileField, 'change', async () => {
    const id = ++version;
    stop(); nes = null; cartridge = null;
    play.disabled = true; play.textContent = 'Jugar';
    select.hidden = start.hidden = canvas.hidden = true;
    const file = fileField.files?.[0];
    if (!file) { status.textContent = 'Elige tu cartucho .nes.'; return; }
    status.textContent = 'Leyendo el cartucho local…';
    try {
      if (file.size > MAX_ROM_BYTES) throw Error('El cartucho supera los 4 MiB.');
      const bytes = readCartridge(new Uint8Array(await file.arrayBuffer()));
      if (id !== version || closed) return;
      cartridge = bytes;
      play.disabled = false;
      status.textContent = 'Cartucho listo. Pulsa Jugar.';
    } catch (error) {
      if (id === version && !closed) status.textContent = error.message;
    }
  });

  listen(play, 'click', async () => {
    if (running) { showPaused(); return; }
    if (!cartridge || closed || play.disabled) return;
    const id = version;
    play.disabled = true;
    try {
      const Context = view.AudioContext || view.webkitAudioContext;
      if (Context) {
        try {
          audio = new Context();
          audio.resume().catch(() => {});
        } catch { audio = null; }
      }
      const { NES, Controller } = await loadCore();
      if (id !== version || closed) return;
      const sample = audio ? makeAudio(audio) : null;
      if (!nes) {
        const ctx = canvas.getContext('2d', {alpha: false});
        if (!ctx) throw Error('Vídeo no disponible');
        const image = ctx.createImageData(WIDTH, HEIGHT);
        const pixels = new Uint32Array(image.data.buffer);
        nes = new NES({
          sampleRate: audio?.sampleRate || 48000,
          onAudioSample: sample,
          onFrame(buffer) {
            for (let i = 0; i < pixels.length; i++) pixels[i] = 0xff000000 | buffer[i];
            ctx.putImageData(image, 0, 0);
          },
        });
        nes.loadROM(cartridge);
        nes.zapperMove(0, 0);
        buttons = Controller;
        frame = 0;
      } else nes.opts.onAudioSample = sample;
      canvas.hidden = start.hidden = select.hidden = false;
      play.textContent = 'Pausar'; play.disabled = false;
      status.textContent = 'Apunta y haz clic o toca para disparar. Usa Select y Start para el menú.';
      running = true;
      nextTick = null;
      animation = view.requestAnimationFrame(advance);
      canvas.focus({preventScroll: true});
    } catch {
      if (id !== version || closed) return;
      stop(); nes = null; play.disabled = false; play.textContent = 'Reintentar';
      status.textContent = 'No se pudo iniciar el cartucho. Comprueba el archivo .nes y vuelve a intentar.';
    }
  });

  function pulse(key) {
    if (!running) return;
    nes.buttonDown(1, key);
    buttonReleases.set(key, frame + 3);
  }
  listen(select, 'click', () => { if (buttons) pulse(buttons.BUTTON_SELECT); });
  listen(start, 'click', () => { if (buttons) pulse(buttons.BUTTON_START); });
  listen(canvas, 'keydown', event => {
    if (event.key === 'Enter' || event.key === 'Shift') {
      event.preventDefault();
      if (buttons && !event.repeat) pulse(event.key === 'Enter' ? buttons.BUTTON_START : buttons.BUTTON_SELECT);
    }
  });
  listen(canvas, 'pointerdown', event => {
    if (!running || pointer !== null || event.button !== 0) return;
    event.preventDefault();
    pointer = event.pointerId;
    if (doc.pointerLockElement !== canvas) canvas.setPointerCapture?.(pointer);
    nes.zapperMove(...zapperPoint(event, canvas.getBoundingClientRect()));
    triggerUntil = frame + 3;
    nes.zapperFireDown();
  });
  listen(canvas, 'pointermove', event => {
    if (running && (pointer === null || pointer === event.pointerId)) {
      nes.zapperMove(...zapperPoint(event, canvas.getBoundingClientRect()));
    }
  });
  function release(event) {
    if (event.pointerId !== pointer) return;
    pointer = null;
    if (frame >= triggerUntil) { nes?.zapperFireUp(); triggerUntil = 0; }
  }
  listen(canvas, 'pointerup', release);
  listen(canvas, 'pointercancel', release);
  listen(canvas, 'lostpointercapture', release);
  listen(doc, 'visibilitychange', () => { if (doc.hidden && running) showPaused(); });
  listen(view, 'blur', clearInput);
  return () => {
    closed = true; version++;
    aborter.abort(); stop(); nes = buttons = cartridge = null;
    fileField.value = ''; panel.remove();
  };
}
