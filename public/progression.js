import {arcadeBoards, validRecord, improvesRecord, formatRecord} from './arcade-boards.js';
import {avatarOptions, defaultAvatar, evolutions, MAX_LEVEL, normalizeAvatar, progressForXp} from './character-model.js';
import {voxelAvatar} from './character-art.js';
export {voxelAvatar};

const colors = {
  skin: ["#f9ceaf", "#e5b588", "#cb956e", "#b97954", "#935e43", "#694432"],
  outfit: ["#c4fa69", "#7ee0ee", "#b192fd", "#ff8e70", "#658df8", "#efc162"],
};
const receiptKey = "squadlink.progress.receipt.v1";
const localAppearanceKey = owner => "squadlink.character.pending." + owner;
const $ = id => document.getElementById(id);

function pendingAppearance(owner) {
  if (!owner) return null;
  try {
    const value = JSON.parse(localStorage.getItem(localAppearanceKey(owner)));
    return value ? normalizeAvatar(value) : null;
  } catch { return null; }
}

export function mountLoadout({api, getSelf, tell}) {
  if (!document.querySelector('link[data-progression-style]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet'; style.href = '/progression.css'; style.dataset.progressionStyle = '';
    document.head.append(style);
  }
  const root = $('loadout');
  root.innerHTML = `
    <div class="kit-heading"><h2 id="kit-heading">Mi personaje</h2></div>
    <div class="kit-panels"><article class="kit-editor">
      <div class="kit-portrait">
        <div class="kit-stage"><div id="kit-voxel" role="img" aria-label="Vista previa de tu personaje"></div></div>
        <div class="kit-card-info"><span id="kit-level">Nivel 1 / 50</span><h3 id="kit-nick">Invitado</h3>
          <p id="kit-evolution"></p>
          <div class="kit-xp"><progress id="kit-xp" max="100" value="0" aria-label="Progreso al siguiente nivel"></progress><span id="kit-xp-label"></span></div>
          <details class="kit-path"><summary>Evoluciones</summary><ol id="kit-stages"></ol></details>
        </div>
      </div>
      <div class="kit-controls"><div id="kit-options"></div>
        <button class="primary" type="button" id="kit-save" disabled>Guardar apariencia</button>
        <p id="kit-status" role="status"></p>
      </div></article>
      <article class="kit-ranking"><div class="kit-ranking-head"><h3>Clasificación del arcade</h3>
      <button class="secondary small" type="button" id="kit-rank-refresh">Actualizar</button></div>
      <label class="rank-choice">Juego o desafío<select id="kit-rank-game">${Object.entries(arcadeBoards).map(([id, board]) =>
        '<option value="' + id + '">' + board.name + '</option>').join('')}</select></label>
      <p id="kit-rank-scope"></p><ol id="kit-ranking"></ol><p id="kit-rank-status" role="status"></p><p id="kit-sync" role="status"></p></article></div>`;
  const groups = {
    gender: 'Identidad del personaje', species: 'Especie', build: 'Silueta', facialHair: 'Vello facial',
    skin: 'Tono base', outfit: 'Chaqueta', headgear: 'Accesorio',
  };
  let profile, draft = {...defaultAvatar}, dirty = false, saving = false, saveAfterLogin = false;
  let selectedGame = 'reflex', rankVersion = 0, profileVersion = 0, lastArt = '';
  const selectors = {};
  const stageList = evolutions.map(stage => {
    const item = document.createElement('li');
    const value = document.createElement('span');
    const name = document.createElement('strong');
    value.textContent = 'Nv. ' + stage.level;
    name.textContent = stage.name;
    item.append(value, name); $('kit-stages').append(item);
    return item;
  });
  for (const [key, caption] of Object.entries(groups)) {
    const group = document.createElement('fieldset');
    const title = document.createElement('legend');
    title.textContent = caption;
    group.append(title);
    selectors[key] = avatarOptions[key].map((option, index) => {
      const label = key === 'gender' && index === 2 ? 'Especie no identificada' : option;
      const color = colors[key]?.[index];
      const button = document.createElement('button');
      button.type = 'button'; button.title = label;
      button.setAttribute('aria-label', label);
      if (color) {
        button.className = 'kit-swatch'; button.style.setProperty('--sample', color);
      } else button.textContent = label;
      button.onclick = () => {
        if (draft[key] === index) return;
        draft[key] = index;
        dirty = true;
        $('kit-status').textContent = 'Cambios sin guardar.';
        render();
      };
      group.append(button);
      return button;
    });
    $('kit-options').append(group);
  }
  function render() {
    const xp = profile?.xp || 0;
    const {level, levelXp, nextLevelXp, evolution, nextEvolution} = progressForXp(xp);
    const guest = !getSelf();
    const creating = !profile?.characterCreated && !pendingAppearance(profile?.id);
    $('kit-heading').textContent = creating ? 'Crea tu personaje' : 'Mi personaje';
    $('kit-nick').textContent = profile?.nick || getSelf()?.nick || 'Tu personaje';
    $('kit-level').textContent = 'Nivel ' + level + ' / ' + MAX_LEVEL;
    $('kit-evolution').textContent = evolution.name;
    $('kit-xp-label').textContent = (nextLevelXp ? levelXp + ' / ' + nextLevelXp + ' XP' : 'Nivel máximo') + ' · ' + xp + ' XP totales';
    $('kit-xp').value = levelXp;
    $('kit-xp').setAttribute('aria-label', nextEvolution ? 'Progreso al siguiente nivel' : 'Nivel máximo alcanzado');
    stageList.forEach((item, i) => {
      item.classList.toggle('achieved', evolutions[i].level <= level);
      if (evolutions[i] === evolution) item.setAttribute('aria-current','step');
      else item.removeAttribute('aria-current');
    });
    $('kit-save').textContent = guest ? 'Elegir apodo y guardar' : saving ? 'Guardando…' : creating ? 'Crear personaje' : 'Guardar apariencia';
    $('kit-save').disabled = saving || (!guest && (!profile || (!dirty && !creating)));
    $('kit-rank-refresh').textContent = guest ? 'Elegir apodo' : 'Actualizar';
    const artKey = JSON.stringify([draft, level]);
    if (artKey !== lastArt) {
      $('kit-voxel').innerHTML = voxelAvatar(draft, level);
      $('kit-voxel').setAttribute('aria-label', avatarOptions.species[draft.species] + ' · ' + avatarOptions.gender[draft.gender] + ' · ' + evolution.name + ' · Nivel ' + level);
      lastArt = artKey;
    }
    for (const [key, buttons] of Object.entries(selectors)) {
      buttons.forEach((btn, i) => btn.setAttribute('aria-pressed', String(i === draft[key])));
    }
  }
  function apply(data) {
    if (!data.profile) return;
    if (data.profile.id === profile?.id && data.profile.revision < profile.revision) return;
    const changedOwner = profile && profile.id !== data.profile.id;
    profile = data.profile;
    if (changedOwner) { dirty = false; saveAfterLogin = false; }
    if (!dirty) draft = pendingAppearance(profile.id) || normalizeAvatar(profile.avatar);
    if (data.receipt) {
      try {
        localStorage.setItem(receiptKey, data.receipt);
        window.dispatchEvent(new window.Event('squadlink:player-saved'));
      } catch {}
    }
    render();
  }
  async function leaderboard() {
    const version = ++rankVersion;
    const game = selectedGame;
    $('kit-ranking').replaceChildren();
    $('kit-rank-scope').textContent = '';
    if (!profile) { $('kit-rank-status').textContent = 'Elige un apodo para ver las mejores marcas.'; return; }
    $('kit-rank-status').textContent = 'Cargando marcas…';
    try {
      const data = await api('progress/ranking', {game});
      if (version !== rankVersion) return;
      const scope = {local: 'Este servidor', session: 'Esta sesión del servidor', global: 'Comunidad'};
      $('kit-rank-scope').textContent = (scope[data.scope] || 'Comunidad') + ' · ' +
        arcadeBoards[game].rule;
      data.players.forEach((p, i) => {
        const row = document.createElement('li');
        for (const [className, value] of [
          ['place', String(i + 1).padStart(2,'0')], ['name', p.nick], ['mark', formatRecord(game, p.best[game])]
        ]) {
          const span = document.createElement('span'); span.className = className; span.textContent = value; row.append(span);
        }
        $('kit-ranking').append(row);
      });
      $('kit-rank-status').textContent = data.players.length ? '' : 'Aún no hay marcas. Juega una ronda para registrar la primera.';
    } catch (error) { if (version === rankVersion) $('kit-rank-status').textContent = error.message; }
  }
  async function refresh() {
    const version = ++profileVersion;
    if (!getSelf()) {
      if (profile) { dirty = false; draft = {...defaultAvatar}; }
      profile = null;
      render(); await leaderboard();
      $('kit-status').textContent = 'Elige un apodo para guardar tu personaje y ganar XP.';
      return;
    }
    let receipt;
    try { receipt = localStorage.getItem(receiptKey); } catch {}
    try {
      let data;
      try { data = await api('progress/profile', receipt ? {receipt} : {}); }
      catch (error) {
        if (!receipt || ![400,403].includes(error.status)) throw error;
        data = await api('progress/profile', {});
      }
      if (version !== profileVersion) return;
      const local = pendingAppearance(data.profile.id);
      const finishCreation = saveAfterLogin && !data.profile.characterCreated && !local;
      if (saveAfterLogin && !finishCreation) dirty = false;
      saveAfterLogin = false;
      apply(data);
      const oldServer = typeof profile.characterCreated !== 'boolean';
      if (!dirty) $('kit-status').textContent = local && oldServer ? 'Apariencia guardada en este dispositivo. Pendiente de sincronizar con la sala.' : '';
      if (finishCreation || (local && !oldServer && !profile.characterCreated && !dirty)) await saveAppearance();
      else if (local && profile.characterCreated && !dirty) {
        try { localStorage.removeItem(localAppearanceKey(profile.id)); } catch {}
        draft = normalizeAvatar(profile.avatar); render();
      }
      if (Object.keys(pending(profile.id)).length) schedule(0);
      await leaderboard();
    } catch (error) { if (version === profileVersion) $('kit-status').textContent = error.message; }
  }
  async function saveAppearance() {
    if (!profile || saving) return;
    const owner = profile.id;
    const saved = {...draft};
    saving = true; render();
    try {
      const data = await api('progress/avatar', saved);
      if (profile?.id !== owner || data.profile?.id !== owner) return;
      dirty = Object.keys(saved).some(key => saved[key] !== draft[key]);
      const complete = data.profile.characterCreated === true &&
        Object.keys(saved).every(key => saved[key] === data.profile.avatar?.[key]);
      if (complete) {
        try { localStorage.removeItem(localAppearanceKey(owner)); } catch {}
      } else {
        localStorage.setItem(localAppearanceKey(owner), JSON.stringify(saved));
      }
      apply(data);
      if (dirty) $('kit-status').textContent = 'Cambios sin guardar.';
      else $('kit-status').textContent = complete ? 'Apariencia guardada.' :
        'Apariencia guardada en este dispositivo. Pendiente de sincronizar con la sala.';
    } catch (error) {
      if (profile?.id === owner) $('kit-status').textContent = error.message;
    } finally { saving = false; render(); }
  }
  $('kit-save').onclick = () => {
    if (getSelf()) { void saveAppearance(); return; }
    dirty = true;
    saveAfterLogin = true;
    $('profile').click();
  };
  $('entry').addEventListener('close', () => { if (!getSelf()) saveAfterLogin = false; });
  window.addEventListener('squadlink:player-restoring', () => { dirty = false; saveAfterLogin = false; });
  $('kit-rank-game').onchange = event => {
    selectedGame = event.target.value;
    void leaderboard();
  };
  // Keep unsent personal bests per profile. A late acknowledgement only
  // removes the value it saved, so an improvement made meanwhile survives.
  const pendingByOwner = new Map();
  let timer, flushing = false;
  function pending(owner) {
    if (!pendingByOwner.has(owner)) {
      let saved = {};
      try { saved = JSON.parse(localStorage.getItem('squadlink.records.' + owner)) || {}; } catch {}
      pendingByOwner.set(owner, Object.fromEntries(Object.entries(saved).filter(([g,v]) => validRecord(g,v))));
    }
    return pendingByOwner.get(owner);
  }
  function persist(owner) {
    try { localStorage.setItem('squadlink.records.' + owner, JSON.stringify(pending(owner))); } catch {}
  }
  function schedule(delay) {
    if (timer || flushing) return;
    timer = setTimeout(() => { timer = null; void flush(); }, delay);
  }
  async function flush() {
    const owner = profile?.id;
    if (!owner || !getSelf() || flushing) return;
    flushing = true;
    let retry = false;
    try {
      const marks = pending(owner);
      for (const [game,value] of Object.entries(marks)) {
        if (owner !== profile?.id || !getSelf()) break;
        const data = await api('progress/record', {game,value});
        if (owner !== profile?.id || data.profile.id !== owner) break;
        apply(data);
        if (marks[game] === value) delete marks[game];
        persist(owner);
        if (game === selectedGame) void leaderboard();
      }
      if (!Object.keys(marks).length) $('kit-sync').textContent = '';
    } catch {
      retry = true;
      $('kit-sync').textContent = 'Récord pendiente de sincronización. Se reintentará automáticamente.';
    } finally {
      flushing = false;
      if (profile && Object.keys(pending(profile.id)).length) schedule(retry ? 30000 : 1500);
    }
  }
  function report(game, value) {
    const owner = profile?.id;
    if (!owner || !getSelf() || !validRecord(game,value)) return;
    const marks = pending(owner);
    if (!improvesRecord(game,value,marks[game]) || !improvesRecord(game,value,profile.best[game])) return;
    marks[game] = value;
    persist(owner);
    $('kit-sync').textContent = 'Sincronizando récord…';
    schedule(1500);
  }
  window.addEventListener('online', () => { void flush(); });
  $('kit-rank-refresh').onclick = () => {
    if (!getSelf()) $('profile').click();
    else if (profile) leaderboard();
    else refresh();
  };
  render();
  return {
    refresh, report, ranked: () => Boolean(profile),
    start: game => api('progress/start', {game}),
    async finish(body) {
      const data = await api('progress/finish', body);
      apply(data);
      if (data.earned > 0) {
        tell('+' + data.earned + ' XP');
        void leaderboard();
      }
      return data;
    }
  };
}
