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

const cartridges = {
  'duck-nes': {title:'Duck Hunt', sha:'ca0d31e6f3aa70204fa5af67803c6533851a28fa48a133e15d772d3667fa675a'},
  mario3: {title:'Super Mario Bros. 3', sha:'4377a7f5e6eb50bdd2ac6f249bf1a7085500aca8eb41f38545c3a2731c51a579'},
};
const marioKeys = {ArrowLeft:'LEFT',ArrowRight:'RIGHT',ArrowUp:'UP',ArrowDown:'DOWN',KeyZ:'A',Space:'A',KeyX:'B'};
export function cartridgeMarks(game, mem) {
  if (game === 'mario3') return {mario3:10*(mem[0x715]*65536+mem[0x716]*256+mem[0x717]), mario3world:mem[0x727]+1};
  const decimal = byte => (byte >> 4) <= 9 && (byte & 15) <= 9 ? (byte >> 4)*10+(byte & 15) : NaN;
  return {ducknes:decimal(mem[0xc4])*10000+decimal(mem[0xc5])*100+decimal(mem[0xc6]), ducknesround:decimal(mem[0xc1])};
}

export function mountDuckNes(mount, status, loadCore = () => import('./duck-nes-core.js'), {game='duck-nes', report=()=>{}} = {}) {
  const {title,sha} = cartridges[game];
  const mario = game === 'mario3';
  const view = mount.ownerDocument.defaultView;
  const doc = mount.ownerDocument;
  const checkInstalled = ['localhost','127.0.0.1','[::1]'].includes(view.location.hostname) || view.location.protocol === 'squad:';
  const aborter = new view.AbortController();
  const listen = (target, type, action, capture=false) => target.addEventListener(type, action, { signal: aborter.signal, capture });
  const panel = doc.createElement('div');
  panel.className = 'duck-nes';
  const help = mario
    ? 'Enter para Start. En el mapa usa las flechas y Espacio para entrar al nivel. Durante la partida, Espacio o Z salta y X corre.'
    : 'Enter para Start y Mayús para Select. Apunta con el ratón o las flechas y dispara con clic o Espacio.';
  panel.innerHTML = `<details ${checkInstalled ? 'hidden' : 'open'} class="nes-cartridge"><summary>Cartucho de ${title}</summary><label>Seleccionar archivo .nes<input type="file" accept=".nes"></label></details>
    <p class="nes-help">${help}${mario ? '' : ' El cartucho contiene destellos rápidos.'}</p>
    <div class="nes-screen"><canvas width="256" height="240" hidden tabindex="0" aria-label="Pantalla NES de ${title}"></canvas>
      <span class="nes-sight" aria-hidden="true" hidden></span></div>
    <div class="duck-nes-controls">
      <button type="button" class="primary" data-control="play" disabled>Jugar</button>
      <button type="button" class="secondary" data-control="select" hidden>Select</button>
      <button type="button" class="secondary" data-control="start" hidden>Start</button>
      <button type="button" class="secondary" data-control="full" aria-pressed="false">Pantalla completa · F</button>
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
  let rankedCart = false, startedGame = false;
  const held = new Set();
  const keyOwners = new Map();
  const pressFrame = new Map();
  const aiming = new Set();
  const sight = panel.querySelector('.nes-sight');
  let aimX = WIDTH / 2, aimY = HEIGHT / 2;
  function setAim(x,y,keyboard) {
    aimX=x; aimY=y;
    nes.zapperMove(x,y);
    sight.hidden=!keyboard;
    if (keyboard) {
      sight.style.left=(100*x/WIDTH)+'%';
      sight.style.top=(100*y/HEIGHT)+'%';
    }
  }
  const buttonReleases = new Map();
  const chooseMessage = 'Selecciona tu cartucho de ' + title + '.';
  status.textContent = checkInstalled ? 'Abriendo ' + title + '…' : chooseMessage;

  const full = control('full');
  let expandedHere = false;
  async function toggleFull() {
    const root = doc.documentElement;
    if (!doc.fullscreenElement && !root.requestFullscreen) return;
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else { await root.requestFullscreen(); expandedHere = true; }
      if (closed) {
        if (expandedHere && doc.fullscreenElement === root) await doc.exitFullscreen();
      } else if (!canvas.hidden) canvas.focus({preventScroll:true});
    } catch { if (!closed) status.textContent = 'La ventana no pudo entrar en pantalla completa.'; }
  }
  full.hidden = !doc.documentElement.requestFullscreen;
  listen(full,'click',toggleFull);
  listen(doc,'fullscreenchange',() => {
    const active = Boolean(doc.fullscreenElement);
    if (!active) expandedHere = false;
    full.setAttribute('aria-pressed',String(active));
    full.textContent = active ? 'Salir de pantalla completa · F' : 'Pantalla completa · F';
  });
  function clearInput() {
    pointer = null;
    triggerUntil = 0;
    nes?.zapperFireUp();
    for (const key of buttonReleases.keys()) nes?.buttonUp(1, key);
    buttonReleases.clear();
    for (const key of held) nes?.buttonUp(1,key);
    held.clear(); keyOwners.clear(); pressFrame.clear(); aiming.clear();
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
    status.textContent = 'Juego en pausa. Pulsa P para reanudar.';
  }

  function advance(now) {
    if (!running || closed) return;
    if (doc.hidden) { showPaused(); return; }
    if (nextTick === null || now - nextTick > 4 * FRAME_MS) nextTick = now;
    try {
      while (nextTick <= now) {
        if (aiming.size) {
          const dx = Number(aiming.has('ArrowRight')) - Number(aiming.has('ArrowLeft'));
          const dy = Number(aiming.has('ArrowDown')) - Number(aiming.has('ArrowUp'));
          setAim(Math.max(0,Math.min(WIDTH-1,aimX+3*dx)),Math.max(0,Math.min(HEIGHT-1,aimY+3*dy)),true);
        }
        nes.frame();
        frame++;
        if (rankedCart && startedGame && frame % 15 === 0) {
          for (const [board,value] of Object.entries(cartridgeMarks(game,nes.cpu.mem))) report(board,value);
        }
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

  async function loadFile(file, installed=false) {
    const id = ++version;
    stop(); nes = null; cartridge = null; rankedCart = startedGame = false;
    play.disabled = true; play.textContent = 'Jugar';
    select.hidden = start.hidden = canvas.hidden = true;
    if (!file) { status.textContent = 'Elige tu cartucho .nes.'; return; }
    try {
      if (file.size > MAX_ROM_BYTES) throw Error('El cartucho supera los 4 MiB.');
      const bytes = readCartridge(new Uint8Array(await file.arrayBuffer()));
      let matches = false;
      if (view.crypto?.subtle) {
        const digest = await view.crypto.subtle.digest('SHA-256',bytes);
        matches = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2,'0')).join('') === sha;
      }
      if (id !== version || closed) return;
      const chooser = panel.querySelector('.nes-cartridge');
      chooser.hidden = installed;
      rankedCart = matches;
      cartridge = bytes;
      play.disabled = false;
      if (!mount.contains(doc.activeElement) || doc.activeElement === fileField) play.focus({preventScroll:true});
      status.textContent = (installed ? 'Cartucho instalado. ' : 'Cartucho listo. ') + 'Pulsa Enter para jugar.' +
        (matches ? '' : ' Esta edición se juega en modo práctica.');
    } catch (error) {
      if (id === version && !closed) status.textContent = error.message;
    }
  }
  listen(fileField, 'change', () => { void loadFile(fileField.files?.[0]); });
  if (checkInstalled) {
    view.fetch('/' + game + '.nes', {signal:aborter.signal}).then(async response => {
      if (!response.ok) return;
      const file = await response.blob();
      if (!version && !closed) await loadFile(file,true);
    }).catch(() => {}).finally(() => {
      if (closed || cartridge) return;
      const chooser = panel.querySelector('.nes-cartridge');
      chooser.hidden = false;
      chooser.open = true;
      if (!version) status.textContent = chooseMessage;
    });
  }

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
        const ctx = canvas.getContext('2d', {alpha:false, willReadFrequently:doc.body.classList.contains('low-power')});
        if (!ctx) throw Error('Vídeo no disponible');
        const image = ctx.createImageData(WIDTH, HEIGHT);
        const pixels = new Int32Array(image.data.buffer);
        nes = new NES({
          sampleRate: audio?.sampleRate || 48000,
          onAudioSample: sample,
          onFrame(buffer) {
            let first = pixels.length, last = -1;
            for (let i = 0; i < pixels.length; i++) {
              const color = 0xff000000 | buffer[i];
              if (color === pixels[i]) continue;
              pixels[i] = color;
              if (i < first) first = i;
              last = i;
            }
            if (last >= 0) {
              const top = Math.floor(first/WIDTH);
              ctx.putImageData(image,0,0,0,top,WIDTH,Math.floor(last/WIDTH)-top+1);
            }
          },
        });
        nes.loadROM(cartridge);
        nes.zapperMove(aimX, aimY);
        buttons = Controller;
        frame = 0;
      } else nes.opts.onAudioSample = sample;
      canvas.hidden = start.hidden = select.hidden = false;
      play.textContent = 'Pausar'; play.disabled = false;
      status.textContent = 'P para pausar o reanudar.';
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
    if (key === buttons.BUTTON_START) startedGame = true;
    nes.buttonDown(1, key);
    buttonReleases.set(key, frame + 3);
  }
  listen(select, 'click', () => { if (buttons) pulse(buttons.BUTTON_SELECT); canvas.focus({preventScroll:true}); });
  listen(start, 'click', () => { if (buttons) pulse(buttons.BUTTON_START); canvas.focus({preventScroll:true}); });
  function hold(key) {
    if (!running || !buttons) return;
    key = buttons['BUTTON_' + key]; buttonReleases.delete(key); held.add(key); nes.buttonDown(1,key); pressFrame.set(key,frame);
  }
  function unhold(key) {
    if (!buttons) return;
    key = buttons['BUTTON_' + key]; held.delete(key);
    // Polling occurs once per emulated frame. Preserve even a very short tap.
    if (running && pressFrame.get(key) === frame) buttonReleases.set(key,frame+1);
    else nes?.buttonUp(1,key);
    pressFrame.delete(key);
  }
  if (mario) {
    const pad = doc.createElement('div');
    pad.className = 'nes-pad';
    for (const [key,label] of [['LEFT','←'],['UP','↑'],['DOWN','↓'],['RIGHT','→'],['B','B · Correr'],['A','A · Saltar']]) {
      const button = doc.createElement('button');
      button.type = 'button'; button.textContent = label; button.className = 'secondary';
      listen(button,'pointerdown',event => {
        event.preventDefault(); button.setPointerCapture?.(event.pointerId); hold(key);
      });
      listen(button,'lostpointercapture',()=>unhold(key));
      listen(button,'click',event=>{ if (!event.detail && buttons) pulse(buttons['BUTTON_'+key]); });
      pad.append(button);
    }
    panel.append(pad);
  }
  const gameRegion = mount.closest('dialog') || mount;
  function keyCode(event) {
    return event.code || ({' ':'Space',z:'KeyZ',x:'KeyX',p:'KeyP',Shift:'ShiftLeft'}[event.key] || event.key);
  }
  listen(gameRegion, 'keydown', event => {
    if (closed || event.metaKey || event.altKey || event.ctrlKey ||
        event.target.closest?.('input,select,textarea,summary,[contenteditable="true"]')) return;
    const code = keyCode(event);
    if (code === 'KeyF' && !full.hidden) { event.preventDefault(); if (!event.repeat) void toggleFull(); return; }
    if (code === 'KeyP' && cartridge) {
      event.preventDefault();
      if (!event.repeat && !play.disabled) play.click();
      return;
    }
    if (!running && cartridge && !play.disabled && ['Enter','NumpadEnter','Space'].includes(code)
        && (!event.target.closest?.('button') || event.target.closest('button') === play)) {
      event.preventDefault();
      if (!event.repeat) play.click();
      return;
    }
    if (!running || !buttons) return;
    // Keep keyboard activation of focusable dialog buttons accessible.
    if (event.target.closest?.('button') && ['Space','Enter','NumpadEnter'].includes(code)) return;
    if (['Enter','NumpadEnter','ShiftLeft','ShiftRight'].includes(code)) {
      event.preventDefault();
      if (!event.repeat) pulse(code.startsWith('Shift') ? buttons.BUTTON_SELECT : buttons.BUTTON_START);
      return;
    }
    if (mario && marioKeys[code]) {
      event.preventDefault();
      canvas.focus({preventScroll:true});
      if (!keyOwners.has(code)) { keyOwners.set(code,marioKeys[code]); hold(marioKeys[code]); }
    } else if (!mario && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(code)) {
      event.preventDefault(); canvas.focus({preventScroll:true}); aiming.add(code);
    } else if (!mario && code === 'Space') {
      event.preventDefault();
      if (!event.repeat) { setAim(aimX,aimY,!sight.hidden); nes.zapperFireDown(); triggerUntil=frame+3; }
    }
  },true);
  listen(view,'keyup',event => {
    const code = keyCode(event);
    if (aiming.delete(code)) event.preventDefault();
    const key = keyOwners.get(code);
    if (!key) return;
    event.preventDefault(); keyOwners.delete(code);
    if (![...keyOwners.values()].includes(key)) unhold(key);
  },true);
  listen(canvas, 'pointerdown', event => {
    if (mario || !running || pointer !== null || event.button !== 0) return;
    event.preventDefault();
    pointer = event.pointerId;
    canvas.setPointerCapture?.(pointer);
    setAim(...zapperPoint(event, canvas.getBoundingClientRect()),false);
    triggerUntil = frame + 3;
    nes.zapperFireDown();
  });
  listen(canvas, 'pointermove', event => {
    if (!mario && running && (pointer === null || pointer === event.pointerId)) {
      setAim(...zapperPoint(event, canvas.getBoundingClientRect()),false);
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
    if (expandedHere && doc.fullscreenElement) doc.exitFullscreen().catch(()=>{});
    aborter.abort(); stop(); nes = buttons = cartridge = null;
    fileField.value = ''; panel.remove();
  };
}
