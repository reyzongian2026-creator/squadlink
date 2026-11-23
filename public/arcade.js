// A game owns its DOM and timeouts. Nothing runs once its dialog closes.
export function openArcade(id, mount, progression) {
  if (!['reflex', 'sequence'].includes(id)) throw new Error('Minijuego desconocido');
  if (!document.querySelector('link[data-arcade-style]')) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/arcade.css';
    css.dataset.arcadeStyle = '';
    document.head.append(css);
  }
  let alive = true;
  const ranked = Boolean(progression?.ranked());
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
    let start, runId;
    status.textContent = ranked
      ? 'Pulsa al ver la señal verde. La marca del servidor incluye la latencia de red.'
      : 'Práctica · Pulsa al ver la señal verde. Si te adelantas, repite el intento.';
    function end(message) {
      phase = 'idle';
      target.disabled = false;
      target.dataset.phase = phase;
      target.textContent = 'Otro intento';
      status.textContent = message;
    }
    function arm(delay) {
      phase = 'wait';
      target.disabled = false;
      target.dataset.phase = phase;
      target.textContent = 'Espera…';
      status.textContent = 'Atención a la señal.';
      later(() => {
        start = performance.now();
        phase = 'go';
        target.dataset.phase = phase;
        target.textContent = '¡Ahora!';
      }, delay);
    }
    const target = button('Empezar', async () => {
      try {
        if (phase === 'wait') {
          cancel();
          end('Te adelantaste. Espera a que aparezca ¡Ahora!');
        } else if (phase === 'go') {
          const ms = Math.max(1, Math.round(performance.now() - start));
          if (!ranked) {
            end(ms + ' ms · Tu récord local: ' + best(ms, (a, b) => a < b) + ' ms.');
            return;
          }
          phase = 'saving'; target.disabled = true;
          const result = await progression.finish({runId});
          if (alive) end(result.earned > 0
            ? result.score + ' ms · +' + result.earned + ' XP.'
            : 'Intento fuera del intervalo de puntuación. Puedes volver a jugar.');
        } else if (phase === 'idle') {
          if (!ranked) { arm(1200 + Math.random() * 2400); return; }
          phase = 'starting'; target.disabled = true;
          status.textContent = 'Preparando ronda…';
          const result = await progression.start(id);
          if (!alive) return;
          runId = result.runId; arm(result.delayMs);
        }
      } catch (error) { if (alive) end(error.message); }
    });
    target.className = 'reflex-pad';
  } else {
    let sequence = [], answer = [];
    let listening = false, runId, round;
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
    const startButton = button('Empezar', async () => {
      startButton.disabled = true;
      try {
        if (!ranked) { round = 1; play([Math.floor(Math.random() * pads.length)]); return; }
        status.textContent = 'Preparando secuencia…';
        const result = await progression.start(id);
        if (!alive) return;
        runId = result.runId; round = result.round; play(result.sequence);
      } catch (error) { if (alive) end(error.message); }
    });
    startButton.className = 'primary';
    status.textContent = (ranked ? '' : 'Práctica · ') + 'Mira qué figuras se iluminan y repite el orden.';
    function lock() { listening = false; pads.forEach(pad => { pad.disabled = true; }); }
    function end(message) {
      lock(); status.textContent = message;
      startButton.textContent = 'Otra partida'; startButton.hidden = false; startButton.disabled = false;
    }
    function play(values) {
      sequence = values; answer = []; lock();
      pads.forEach(pad => { delete pad.dataset.lit; });
      startButton.hidden = true;
      status.textContent = 'Ronda ' + round + ' · Observa la secuencia.';
      sequence.forEach((index, i) => {
        later(() => { pads[index].dataset.lit = 'true'; }, 350 + i * 600);
        later(() => { delete pads[index].dataset.lit; }, 730 + i * 600);
      });
      later(() => {
        listening = true;
        pads.forEach(pad => { pad.disabled = false; });
        status.textContent = 'Tu turno · Repite ' + (sequence.length === 1 ? 'la figura.' : 'las ' + sequence.length + ' figuras.');
      }, 350 + sequence.length * 600);
    }
    async function choose(index) {
      if (!listening) return;
      const correct = index === sequence[answer.length];
      answer.push(index);
      if ((ranked || correct) && answer.length !== sequence.length) return;
      lock();
      if (!ranked) {
        if (!correct) { end('Completaste ' + (round - 1) + ' rondas.'); return; }
        status.textContent = '¡Correcto! · Récord local: ' + best(round, (a, b) => a > b) + ' rondas.';
        if (round === 12) { end('¡Completaste las 12 rondas!'); return; }
        round++;
        later(() => play([...sequence, Math.floor(Math.random() * pads.length)]), 850);
        return;
      }
      try {
        const result = await progression.finish({runId, round, answer});
        if (!alive) return;
        if (result.done) {
          end(result.earned > 0 ? '¡Completaste las 12 rondas! +' + result.earned + ' XP.'
            : 'Completaste ' + result.score + ' rondas.');
        } else {
          status.textContent = '¡Correcto! · +' + result.earned + ' XP.';
          round = result.round;
          later(() => play(result.sequence), 850);
        }
      } catch (error) { if (alive) end(error.message); }
    }
  }
  return () => { alive = false; cancel(); mount.replaceChildren(); };
}
