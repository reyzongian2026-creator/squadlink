import { mountDuckNes } from './duck-nes.js';

// Local adaptations of Web Aim Trainer and 2048. Upstream notices are at the end.
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(text, className, onClick) {
  const control = element('button', className, text);
  control.type = 'button';
  control.addEventListener('click', onClick);
  return control;
}

function record(id, score, lowerWins = false) {
  const key = 'squadlink.best.' + id;
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null && Number.isFinite(Number(saved))) {
      const prior = Number(saved);
      if (lowerWins ? prior <= score : prior >= score) return prior;
    }
    localStorage.setItem(key, String(score));
  } catch { /* Practice still works when storage is unavailable. */ }
  return score;
}

function aim(id, mount, status, report) {
  const speed = id === 'flick';
  const instructions = speed ? 'Acierta 12 blancos en el menor tiempo posible.'
    : 'Tienes 16 intentos. El blanco se reduce con cada acierto.';
  const arena = element('div', 'aim-arena');
  const target = element('button', 'aim-target');
  target.type = 'button';
  target.setAttribute('aria-label', 'Blanco');
  arena.append(target);
  let hits, shots, started;
  function position() {
    const size = speed ? 42 : Math.max(24, 48 - 2 * hits);
    target.style.setProperty('--diameter', size + 'px');
    for (const axis of ['left', 'top']) {
      const fraction = Math.random();
      target.style[axis] = 'calc(' + (fraction * 100) + '% + ' + ((0.5 - fraction) * (size + 8)) + 'px)';
    }
  }
  const start = button('Empezar', 'primary practice-start', () => {
    hits = shots = 0;
    started = performance.now();
    start.hidden = true;
    arena.hidden = false;
    position();
    target.focus({preventScroll:true});
    status.textContent = speed ? '0 de 12 blancos' : '0 de 16 intentos';
  });
  arena.addEventListener('click', event => {
    if (arena.hidden) return;
    shots++;
    if (event.target === target) hits++;
    if (speed ? hits === 12 : shots === 16) {
      const accuracy = Math.round(100 * hits / shots);
      if (speed) {
        const time = Math.max(1, Math.round(performance.now() - started));
        report(id,time);
        const best = record(id, time, true);
        status.textContent = (time/1000).toFixed(2) + ' s · Precisión ' + accuracy + ' % · Récord local ' + (best/1000).toFixed(2) + ' s.';
      } else {
        report(id,hits);
        const best = record(id, hits);
        status.textContent = hits + ' de 16 aciertos · ' + accuracy + ' % · Récord local ' + best + '/16.';
      }
      arena.hidden = true;
      start.hidden = false;
      start.textContent = 'Otra partida';
      start.focus();
      return;
    }
    if (event.target === target) position();
    status.textContent = speed ? hits + ' de 12 blancos · ' + (shots - hits) + ' fallos'
      : shots + ' de 16 intentos · ' + hits + ' aciertos';
  });
  arena.hidden = true;
  status.textContent = instructions;
  mount.append(arena, start);
}

const directions = {ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down'};

// Read each line from the destination edge; a newly merged tile is consumed once.
export function slide(board, direction) {
  const cells = board.slice();
  let points = 0;
  for (let line = 0; line < 4; line++) {
    const indexes = [];
    for (let step = 0; step < 4; step++) {
      const n = direction === 'right' || direction === 'down' ? 3 - step : step;
      indexes.push(direction === 'left' || direction === 'right' ? line * 4 + n : n * 4 + line);
    }
    const values = indexes.map(i => board[i]).filter(Boolean);
    const result = [];
    for (let i = 0; i < values.length; i++) {
      let value = values[i];
      if (value === values[i + 1]) { value *= 2; points += value; i++; }
      result.push(value);
    }
    indexes.forEach((index, i) => { cells[index] = result[i] || 0; });
  }
  return {cells, points, changed:cells.some((value, index) => value !== board[index])};
}

function addTile(board) {
  const empty = [];
  board.forEach((value, i) => { if (!value) empty.push(i); });
  if (empty.length) board[empty[Math.floor(Math.random() * empty.length)]] = Math.random() < 0.9 ? 2 : 4;
}

function puzzle(mount, status, report) {
  const grid = element('div', 'merge-board');
  grid.tabIndex = 0;
  grid.setAttribute('role','group');
  grid.setAttribute('aria-label','Tablero 2048. Mueve con las flechas.');
  const tiles = Array.from({length:16}, () => element('span', 'merge-tile'));
  grid.append(...tiles);
  let board, score, done;
  const arrows = element('div','merge-controls');
  for (const [direction, symbol, label] of [['left','←','Izquierda'],['up','↑','Arriba'],['down','↓','Abajo'],['right','→','Derecha']]) {
    const arrow = button(symbol, 'secondary', () => move(direction));
    arrow.setAttribute('aria-label',label);
    arrows.append(arrow);
  }
  function paint() {
    tiles.forEach((tile, i) => {
      const value = board[i];
      tile.textContent = value || '';
      tile.dataset.level = value ? Math.min(6, Math.log2(value)) : 0;
    });
  }
  function move(direction) {
    if (done) return;
    const next = slide(board, direction);
    if (!next.changed) return;
    board = next.cells;
    score += next.points;
    addTile(board);
    paint();
    const won = board.includes(2048);
    done = won || (!board.includes(0) && !Object.values(directions).some(dir => slide(board, dir).changed));
    report('merge',score);
    const best = record('merge', score);
    status.textContent = (won ? '¡Llegaste a 2048! · ' : done ? 'Sin movimientos · ' : '') + score + ' puntos · Récord local ' + best;
    if (done) Array.from(arrows.children).forEach(b => { b.disabled = true; });
  }
  function reset() {
    board = Array(16).fill(0);
    score = 0;
    done = false;
    addTile(board); addTile(board); paint();
    Array.from(arrows.children).forEach(b => { b.disabled = false; });
    status.textContent = 'Une fichas iguales hasta llegar a 2048. Usa las flechas o los botones.';
    grid.focus({preventScroll:true});
  }
  mount.addEventListener('keydown', keys);
  function keys(event) {
    if (Object.hasOwn(directions,event.key) && !event.altKey && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      move(directions[event.key]);
    }
  }
  mount.append(grid, arrows, button('Nueva partida', 'secondary practice-start', reset));
  reset();
  return () => mount.removeEventListener('keydown', keys);
}

const triples = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
export function winningLine(cells, mark) {
  return triples.find(line => line.every(index => cells[index] === mark));
}
export function botMove(cells) {
  const empty = [4,0,2,6,8,1,3,5,7].filter(index => !cells[index]);
  for (const mark of ['O','X']) {
    for (const index of empty) {
      const next = cells.slice();
      next[index] = mark;
      if (winningLine(next, mark)) return index;
    }
  }
  return empty[0];
}
function three(mount, status, report) {
  const grid = element('div','three-board');
  let started;
  const cells = Array(9).fill('');
  const moves = cells.map((_, index) => button('', 'three-cell', () => {
    if (moves[index].disabled) return;
    started ??= performance.now();
    if (place(index,'X')) return;
    place(botMove(cells),'O');
  }));
  function label(i) { return 'Fila ' + (1 + Math.floor(i / 3)) + ', columna ' + (1 + i % 3); }
  function place(index, mark) {
    cells[index] = mark;
    const control = moves[index];
    control.textContent = mark;
    control.setAttribute('aria-label',label(index) + ', ' + mark);
    control.disabled = true;
    const line = winningLine(cells,mark);
    if (!line && cells.includes('')) return false;
    if (line && mark === 'X') report('three',Math.max(1,Math.round(performance.now()-started)));
    line?.forEach(i => { moves[i].dataset.win = 'true'; });
    moves.forEach(b => { b.disabled = true; });
    status.textContent = line ? (mark === 'X' ? '¡Ganaste!' : 'Ganó la computadora.') : 'Empate.';
    return true;
  }
  function reset() {
    started = null;
    cells.fill('');
    moves.forEach((b,i) => { b.textContent = ''; b.disabled = false; delete b.dataset.win; b.setAttribute('aria-label', label(i)); });
    status.textContent = 'Eres X. Juega contra la computadora y alinea tres fichas.';
  }
  grid.append(...moves);
  mount.append(grid, button('Nueva partida', 'secondary practice-start', reset));
  reset();
}


function ducks(mount, status, report) {
  const pond = element('div', 'duck-pond');
  const total = 10;
  let current = 0, hits = 0, timer, active = false;
  const start = button('Empezar', 'primary practice-start', () => {
    current = hits = 0;
    active = true;
    start.hidden = true;
    pond.hidden = false;
    next();
  });
  function next() {
    clearTimeout(timer);
    pond.replaceChildren();
    if (current === total) {
      active = false;
      pond.hidden = true;
      start.hidden = false;
      start.textContent = 'Otra partida';
      report('ducks',hits);
      status.textContent = hits + ' de ' + total + ' patos · Récord local ' + record('ducks',hits) + '/10.';
      start.focus();
      return;
    }
    current++;
    const duration = 2600 - 85 * current;
    const duck = button('🦆', 'flying-duck', () => { hits++; next(); });
    duck.setAttribute('aria-label', 'Pato ' + current);
    duck.style.top = (8 + Math.random() * 54) + '%';
    duck.style.setProperty('--flight', Math.max(0, pond.clientWidth - 58) + 'px');
    duck.style.setProperty('--duration', duration + 'ms');
    duck.style.animationDirection = current % 2 ? 'normal' : 'reverse';
    pond.append(duck);
    duck.focus({preventScroll:true});
    status.textContent = 'Pato ' + current + ' de ' + total + ' · ' + hits + ' aciertos';
    timer = setTimeout(next, duration);
  }
  function visibility() {
    if (!active) return;
    clearTimeout(timer);
    pond.style.animationPlayState = document.hidden ? 'paused' : 'running';
    const duck = pond.firstElementChild;
    if (duck) duck.style.animationPlayState = pond.style.animationPlayState;
    if (!document.hidden) {
      current--;
      next();
    }
  }
  pond.hidden = true;
  status.textContent = 'Toca cada pato antes de que cruce la laguna. Pasan diez por partida.';
  mount.append(pond, start);
  document.addEventListener('visibilitychange', visibility);
  return () => { active = false; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
}

function doom(mount, status, report) {
  let player;
  function gameExit(event) {
    if (!player || event.source !== player.contentWindow) return;
    if (event.data?.type === 'squadlink:doom:maps') report('doom',event.data.count);
    if (event.data === 'squadlink:doom:closed')
      mount.closest('dialog')?.close();
  }
  window.addEventListener('message', gameExit);
  const start = button('Cargar DOOM', 'primary practice-start', () => {
    if (!navigator.onLine) {
      status.textContent = 'Conéctate a internet y vuelve a pulsar Cargar DOOM.';
      return;
    }
    start.hidden = true;
    player = element('iframe', 'doom-player');
    player.title = 'Chocolate Doom con Freedoom';
    player.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    player.setAttribute('allow', "microphone 'none'; camera 'none'; geolocation 'none'");
    player.referrerPolicy = 'no-referrer';
    status.textContent = 'WASD para moverte, ratón para girar, clic izquierdo para disparar y Espacio para abrir puertas. Esc libera el cursor.';
    mount.append(player);
    player.src = '/doom-player.html';
  });
  status.textContent = 'Juega Freedoom: Phase 1 en el motor Chocolate Doom. La primera carga requiere internet y unos 35 MB.';
  mount.append(start);
  return () => {
    window.removeEventListener('message', gameExit);
    player?.remove();
    player = null;
  };
}

export function openPractice(id, mount, loadout) {
  if (!['flick','precision','merge','three','ducks','duck-nes','mario3','doom'].includes(id)) throw Error('Juego desconocido');
  if (!document.querySelector('link[data-practice-style]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = '/arcade-practice.css';
    style.dataset.practiceStyle = '';
    document.head.append(style);
  }
  const status = element('p', 'practice-status');
  status.setAttribute('role', 'status');
  mount.replaceChildren(status);
  if (!loadout?.ranked?.()) {
    const hint = element('small','practice-account','Modo práctica · Elige tu apodo antes de jugar para registrar récords.');
    mount.append(hint);
  }
  const report = (game,value) => loadout?.report?.(game,value);
  let dispose;
  if (id === 'merge') dispose = puzzle(mount, status, report);
  else if (id === 'three') three(mount, status, report);
  else if (id === 'ducks') dispose = ducks(mount, status, report);
  else if (id === 'duck-nes' || id === 'mario3') dispose = mountDuckNes(mount, status, undefined, {game:id,report});
  else if (id === 'doom') dispose = doom(mount, status, report);
  else aim(id, mount, status, report);
  return () => { dispose?.(); mount.replaceChildren(); };
}

/*
Web Aim Trainer — https://github.com/Aymaan-HS/Aim-Trainer (target placement and scoring adapted)
MIT License

Copyright (c) 2026 Aymaan Haider Saiyad

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


2048 — https://github.com/gabrielecirulli/2048 (movement, spawning and merge rules adapted)
The MIT License (MIT)

Copyright (c) 2014 Gabriele Cirulli

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

*/

/*
Three-in-a-row: https://github.com/KUBERACHAR/Tic-Tac-Toe (classic board adapted with local computer opponent)
MIT License

Copyright (c) 2025 KUBERACHAR

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
