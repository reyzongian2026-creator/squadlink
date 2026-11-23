// A game owns its DOM and timeouts. Nothing runs once its dialog closes.
export function openArcade(id, mount) {
  if (!['reflex', 'sequence'].includes(id)) throw new Error('Minijuego desconocido');
  if (!document.querySelector('link[data-arcade-style]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/arcade.css';
    css.dataset.arcadeStyle = '';
    document.head.append(css);
  }
  const timers = new Set();
  function later(callback, delay) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      callback();
    }, delay);
    timers.add(timer);
  }
  function cancel() {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  }
  const status = document.createElement('p');
  status.className = 'arcade-status';
  status.setAttribute('aria-live', 'polite');
  const board = document.createElement('div');
  board.className = 'arcade-board';
  mount.replaceChildren(status, board);
  function button(label, action, parent = board) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = label;
    el.addEventListener('click', action);
    parent.append(el);
    return el;
  }
  function best(score, better) {
    const key = 'squadlink.best.' + id;
    try {
      const previous = Number(localStorage.getItem(key));
      const result = previous > 0 && better(previous, score) ? previous : score;
      localStorage.setItem(key, String(result));
      return result;
    } catch { return score; }
  }
  if (id === 'reflex') {
    let phase = 'idle';
    let start;
    status.textContent = 'Pulsa al ver la señal verde. Si te adelantas, repite el intento.';
    const target = button('Empezar', () => {
      if (phase === 'wait') {
        cancel();
        end('Te adelantaste. Espera a que aparezca ¡Ahora!');
      } else if (phase === 'go') {
        const ms = Math.max(1, Math.round(performance.now() - start));
        end(ms + ' ms · Tu récord: ' + best(ms, (a, b) => a < b) + ' ms.');
      } else {
        phase = 'wait';
        target.dataset.phase = phase;
        target.textContent = 'Espera…';
        status.textContent = 'Atención a la señal.';
        later(() => {
          start = performance.now();
          phase = 'go';
          target.dataset.phase = phase;
          target.textContent = '¡Ahora!';
        }, 1200 + Math.random() * 2400);
      }
    });
    target.className = 'reflex-pad';
    function end(message) {
      phase = 'idle';
      target.dataset.phase = phase;
      target.textContent = 'Otro intento';
      status.textContent = message;
    }
  } else {
    let sequence = [];
    let cursor = 0;
    let listening = false;
    const grid = document.createElement('div');
    grid.className = 'sequence-grid';
    board.append(grid);
    const pads = ['▲', '◆', '●', '■'].map((symbol, index) => {
      const pad = button(symbol, () => choose(index), grid);
      pad.className = 'sequence-pad';
      pad.setAttribute('aria-label', ['Triángulo', 'Rombo', 'Círculo', 'Cuadrado'][index]);
      pad.disabled = true;
      return pad;
    });
    const startButton = button('Empezar', () => { sequence = []; nextRound(); });
    startButton.className = 'primary';
    status.textContent = 'Mira qué figuras se iluminan y repite el orden.';
    function nextRound() {
      listening = false;
      cursor = 0;
      pads.forEach(p => { p.disabled = true; delete p.dataset.lit; });
      startButton.hidden = true;
      sequence.push(Math.floor(Math.random() * pads.length));
      status.textContent = 'Ronda ' + sequence.length + ' · Observa la secuencia.';
      sequence.forEach((index, i) => {
        later(() => { pads[index].dataset.lit = 'true'; }, 350 + i * 600);
        later(() => { delete pads[index].dataset.lit; }, 730 + i * 600);
      });
      later(() => {
        listening = true;
        pads.forEach(p => { p.disabled = false; });
        status.textContent = 'Tu turno · Repite las ' + sequence.length + ' figuras.';
      }, 350 + sequence.length * 600);
    }
    function choose(index) {
      if (!listening) return;
      if (index !== sequence[cursor++]) {
        listening = false;
        status.textContent = 'Completaste ' + (sequence.length - 1) + ' rondas.';
        pads.forEach(p => { p.disabled = true; });
        startButton.textContent = 'Otra partida';
        startButton.hidden = false;
      } else if (cursor === sequence.length) {
        listening = false;
        pads.forEach(p => { p.disabled = true; });
        status.textContent = '¡Correcto! · Récord: ' + best(sequence.length, (a, b) => a > b) + ' rondas.';
        later(nextRound, 850);
      }
    }
  }
  return () => { cancel(); mount.replaceChildren(); };
}
