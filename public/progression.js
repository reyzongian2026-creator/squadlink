import {createCharacterDraft} from './character-draft.js';
import {portraitBadge, updatePortrait} from './portrait-badge.js';
import {arcadeBoards, validRecord, improvesRecord, formatRecord} from './arcade-boards.js';
import {avatarOptions, defaultAvatar, evolutions, MAX_LEVEL, normalizeAvatar, progressForXp} from './character-model.js';
import {voxelAvatar, portraitAvatar} from './character-art.js';
export {voxelAvatar};

const colors = {
  skin: ["#f9ceaf", "#e5b588", "#cb956e", "#b97954", "#935e43", "#694432"],
  hairColor: [null, "#25212b", "#86583c", "#dfb875", "#be5143", "#5689c9", "#9674c6", "#e0e0e9"],
  outfit: ["#c4fa69", "#7ee0ee", "#b192fd", "#ff8e70", "#658df8", "#efc162"],
};
const reviewAppearance = 'El perfil cambió desde tu último guardado. Revisa la apariencia y pulsa Guardar si quieres aplicar tus cambios.';
const receiptKey = "squadlink.progress.receipt.v1";
const localAppearanceKey = owner => "squadlink.character.pending." + owner;
const $ = id => document.getElementById(id);

function pendingAppearance(owner) {
  if (!owner) return null;
  try {
    const value = JSON.parse(localStorage.getItem(localAppearanceKey(owner)));
    if (!value || typeof value !== 'object') return null;
    // Older clients stored a bare avatar when their server predated character creation.
    const avatar = normalizeAvatar(value.avatar ?? value);
    const fields = Object.keys(defaultAvatar).filter(key =>
      value.avatar ? Array.isArray(value.fields) && value.fields.includes(key) : Object.hasOwn(value,key));
    return {avatar, fields, revision:value.revision};
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
        <div class="kit-stage"><button type="button" id="kit-closeup" aria-pressed="false" aria-controls="kit-voxel">Acercar rostro</button><div id="kit-voxel" role="img" aria-label="Vista previa de tu personaje"></div></div>
        <div class="kit-card-info"><span id="kit-level">Nivel 1 / 50</span><h3 id="kit-nick">Invitado</h3>
          <p id="kit-evolution"></p>
          <div class="kit-xp"><progress id="kit-xp" max="100" value="0" aria-label="Progreso al siguiente nivel"></progress><span id="kit-xp-label"></span></div>
          <details class="kit-path"><summary>Evoluciones</summary><ol id="kit-stages"></ol></details>
        </div>
      </div>
      <div class="kit-controls"><div id="kit-options"></div>
        <button class="primary" type="button" id="kit-save" disabled>Guardar apariencia</button>
        <div id="kit-draft" hidden><span>Borrador en este equipo</span>
          <button class="secondary small" type="button" id="kit-recover">Recuperar borrador</button>
          <button class="secondary small" type="button" id="kit-drop">Descartar borrador</button></div>
        <p id="kit-status" role="status"></p>
      </div></article>
      <article class="kit-ranking"><div class="kit-ranking-head"><h3>Clasificación del arcade</h3>
      <button class="secondary small" type="button" id="kit-rank-refresh">Actualizar</button></div>
      <label class="rank-choice">Juego o desafío<select id="kit-rank-game">${Object.entries(arcadeBoards).map(([id, board]) =>
        '<option value="' + id + '">' + board.name + '</option>').join('')}</select></label>
      <p id="kit-rank-scope"></p><ol id="kit-ranking"></ol><p id="kit-rank-status" role="status"></p><p id="kit-sync" role="status"></p></article></div>`;
  const groups = {
    gender: 'Identidad del personaje', species: 'Especie', build: 'Silueta', hairStyle: 'Cabello', hairColor: 'Color de cabello', facialHair: 'Vello facial',
    skin: 'Tono base', outfit: 'Chaqueta', headgear: 'Accesorio',
  };
  let profile, draftBase, draft = {...defaultAvatar}, dirty = false, saving = false, saveAfterLogin = false;
  let selectedGame = 'reflex', rankVersion = 0, profileVersion = 0, lastArt = '';
  let closeup = false;
  $('kit-closeup').onclick = () => {
    closeup = !closeup;
    $('kit-closeup').setAttribute('aria-pressed', String(closeup));
    $('kit-voxel').classList.toggle('kit-closeup', closeup);
    render();
  };
  const localDraft = createCharacterDraft();
  let offeredDraft = {};
  $('kit-recover').onclick = () => {
    if (!profile || saving || getSelf()?.id !== sessionId) return;
    Object.assign(draft, offeredDraft);
    dirty = true;
    render();
    $('kit-status').textContent = 'Borrador recuperado. Pulsa Guardar para aplicar tu apariencia.';
    $('kit-save').focus();
  };
  $('kit-drop').onclick = () => {
    if (!profile) return;
    localDraft.acknowledge(profile.id, offeredDraft);
    render();
    $('kit-status').textContent = 'Borrador descartado.';
    selectors.gender[draft.gender].focus();
  };
  window.addEventListener('storage', event => {
    if (localDraft.invalidate(profile?.id, event.key)) render();
  });
  const sampleNames = {};
  const selectors = {};
  const hairGroups = {};
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
    if (key === 'hairStyle' || key === 'hairColor') hairGroups[key] = group;
    const title = document.createElement('legend');
    title.textContent = caption;
    if (['hairColor', 'skin', 'outfit'].includes(key)) {
      const selected = document.createElement('span');
      selected.className = 'kit-choice-name';
      selected.setAttribute('aria-hidden', 'true');
      title.append(selected);
      sampleNames[key] = selected;
    }
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
        const base = normalizeAvatar(saving?.avatar ?? draftBase?.avatar ?? profile?.avatar);
        if (profile && getSelf()?.id === sessionId) localDraft.remember(profile.id, key, index, base[key]);
        draft[key] = index;
        dirty = Object.keys(draft).some(field => draft[field] !== base[field]);
        $('kit-status').textContent = dirty ? 'Cambios sin guardar.' : '';
        render();
      };
      group.append(button);
      return button;
    });
    group.onkeydown = event => {
      const buttons = selectors[key];
      const i = buttons.indexOf(event.target);
      if (i < 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const last = buttons.length - 1;
      const previous = (i + last) % buttons.length, nextIndex = (i + 1) % buttons.length;
      const indices = {ArrowLeft: previous, ArrowUp: previous, ArrowRight: nextIndex, ArrowDown: nextIndex, Home: 0, End: last};
      if (!Object.hasOwn(indices, event.key)) return;
      event.preventDefault();
      const next = buttons[indices[event.key]];
      next.focus();
      next.click();
    };
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
    const artKey = JSON.stringify([draft, level, closeup]);
    if (artKey !== lastArt) {
      $('kit-voxel').innerHTML = (closeup ? portraitAvatar : voxelAvatar)(draft, level);
      $('kit-voxel').setAttribute('aria-label', avatarOptions.species[draft.species] + ' · ' + avatarOptions.gender[draft.gender] + ' · ' + evolution.name + ' · Nivel ' + level);
      lastArt = artKey;
    }
    offeredDraft = !dirty && !saving && profile ? Object.fromEntries(
      Object.entries(localDraft.read(profile.id)).filter(([key, value]) => value !== draft[key])
    ) : {};
    $('kit-draft').hidden = !Object.keys(offeredDraft).length;
    for (const [field, name] of Object.entries(sampleNames)) name.textContent = avatarOptions[field][draft[field]];
    const hasHair = draft.species === 0 || draft.species === 1;
    hairGroups.hairStyle.hidden = !hasHair;
    hairGroups.hairColor.hidden = !hasHair || draft.hairStyle === 1;
    for (const [key, buttons] of Object.entries(selectors)) {
      buttons.forEach((btn, i) => {
        btn.setAttribute('aria-pressed', String(i === draft[key]));
        btn.tabIndex = i === draft[key] ? 0 : -1;
      });
    }
  }
  let sessionId = getSelf()?.id;
  function clearPlayer() {
    profile = draftBase = null;
    draft = {...defaultAvatar};
    saving = dirty = saveAfterLogin = false;
    ++rankVersion;
  }
  function apply(data) {
    if (!data.profile) return;
    if (data.profile.id === profile?.id && data.profile.revision < profile.revision) return;
    const changedOwner = profile && profile.id !== data.profile.id;
    profile = data.profile;
    if (changedOwner) { dirty = false; saveAfterLogin = false; }
    if (!dirty) {
      draftBase = profile;
      draft = normalizeAvatar(profile.avatar);
      const local = pendingAppearance(profile.id);
      if (local) for (const key of local.fields) draft[key] = local.avatar[key];
    }
    if (data.receipt) {
      try {
        localStorage.setItem(receiptKey, data.receipt);
        window.dispatchEvent(new window.Event('squadlink:player-saved'));
      } catch {}
    }
    render();
  }
  let rankFaces = new Map();
  async function leaderboard() {
    const version = ++rankVersion;
    const game = selectedGame;
    $('kit-ranking').replaceChildren();
    $('kit-rank-scope').textContent = '';
    if (!profile) { rankFaces.clear(); $('kit-rank-status').textContent = 'Elige un apodo para ver las mejores marcas.'; return; }
    $('kit-rank-status').textContent = 'Cargando marcas…';
    try {
      const data = await api('progress/ranking', {game});
      if (version !== rankVersion) return;
      const scope = {local: 'Este servidor', session: 'Esta sesión del servidor', global: 'Comunidad'};
      $('kit-rank-scope').textContent = (scope[data.scope] || 'Comunidad') + ' · ' +
        arcadeBoards[game].rule;
      const previousFaces = rankFaces;
      rankFaces = new Map();
      data.players.forEach((p, i) => {
        const row = document.createElement('li');
        for (const [className, value] of [
          ['place', String(i + 1).padStart(2,'0')], ['name', p.nick], ['mark', formatRecord(game, p.best[game])]
        ]) {
          if (className === 'name') {
            const badge = previousFaces.get(p.id) ?? portraitBadge();
            updatePortrait(badge,p.characterCreated ? p : null,p.nick);
            rankFaces.set(p.id,badge);
            row.append(badge);
          }
          const span = document.createElement('span'); span.className = className; span.textContent = value; row.append(span);
        }
        $('kit-ranking').append(row);
      });
      $('kit-rank-status').textContent = data.players.length ? '' : 'Aún no hay marcas. Juega una ronda para registrar la primera.';
    } catch (error) { if (version === rankVersion) $('kit-rank-status').textContent = error.message; }
  }
  async function refresh() {
    const version = ++profileVersion;
    const session = getSelf();
    if (profile && (!session || session.id !== sessionId)) {
      clearPlayer();
      render();
    }
    sessionId = session?.id;
    if (!session) {
      render(); await leaderboard();
      if (version === profileVersion) $('kit-status').textContent = 'Elige un apodo para guardar tu personaje y ganar XP.';
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
      if (version !== profileVersion || !getSelf() || session.id !== getSelf().id) return;
      if (profile?.id === data.profile.id && data.profile.revision < profile.revision) return;
      const local = pendingAppearance(data.profile.id);
      const finishCreation = saveAfterLogin && !data.profile.characterCreated && !local;
      if (!finishCreation && (saveAfterLogin || (!profile && data.profile.characterCreated))) dirty = false;
      saveAfterLogin = false;
      apply(data);
      if (!dirty) $('kit-status').textContent = '';
      if (finishCreation) await saveAppearance(data.profile.revision);
      else if (local && !dirty) {
        const supported = typeof profile.characterCreated === 'boolean' && local.fields.every(key => Object.hasOwn(profile.avatar,key));
        const matches = local.fields.every(key => local.avatar[key] === profile.avatar[key]);
        if (!supported) {
          $('kit-status').textContent = 'Apariencia guardada en este dispositivo. Pendiente de sincronizar con la sala.';
        } else if (matches && profile.characterCreated) {
          localStorage.removeItem(localAppearanceKey(profile.id));
          draft = normalizeAvatar(profile.avatar); render();
        } else if (local.revision === profile.revision || (local.revision === undefined && !profile.characterCreated)) {
          await saveAppearance(profile.revision);
        } else {
          dirty = true; render();
          $('kit-status').textContent = reviewAppearance;
        }
      }
      if (version !== profileVersion || !profile) return;
      if (Object.keys(pending(profile.id)).length) schedule(0);
      await leaderboard();
    } catch (error) { if (version === profileVersion) $('kit-status').textContent = error.message; }
  }
  async function saveAppearance(expectedRevision) {
    if (!profile || saving) return;
    const owner = profile.id;
    const before = normalizeAvatar(draftBase?.avatar ?? profile.avatar);
    const previousPending = pendingAppearance(owner);
    const saved = {...draft};
    const attempt = {avatar:saved};
    saving = attempt;
    const active = () => saving === attempt && profile?.id === owner && getSelf() && getSelf().id === sessionId;
    render();
    try {
      const data = await api('progress/avatar', expectedRevision === undefined ? saved : {...saved,expectedRevision});
      if (!active() || data.profile?.id !== owner) return;
      const edits = Object.entries(draft).filter(([key,value]) => value !== saved[key]);
      const accepted = data.profile.avatar ?? {};
      const fields = Object.keys(saved).filter(key => Object.hasOwn(accepted,key)
        ? saved[key] !== accepted[key]
        : saved[key] !== before[key] || previousPending?.fields.includes(key));
      const complete = data.profile.characterCreated === true && !fields.length;
      if (complete) {
        try { localStorage.removeItem(localAppearanceKey(owner)); } catch {}
      } else {
        localStorage.setItem(localAppearanceKey(owner), JSON.stringify({avatar:saved,fields,revision:data.profile.revision}));
      }
      localDraft.acknowledge(owner, saved);
      const newer = profile.revision > data.profile.revision;
      dirty = false;
      apply(newer ? {profile} : data);
      dirty = edits.some(([key,value]) => value !== draft[key]);
      for (const [key,value] of edits) draft[key] = value;
      if (dirty) $('kit-status').textContent = 'Cambios sin guardar.';
      else if (newer && Object.keys(saved).some(key => saved[key] !== draftBase.avatar[key]))
        $('kit-status').textContent = 'Se muestra la apariencia más reciente del perfil.';
      else $('kit-status').textContent = complete ? 'Apariencia guardada.' :
        'Apariencia guardada en este dispositivo. Pendiente de sincronizar con la sala.';
    } catch (error) {
      if (active()) {
        if (expectedRevision !== undefined && error.status === 409) {
          let latest;
          try { latest = await api('progress/profile', {}); }
          catch (readError) { if (active()) $('kit-status').textContent = readError.message; return; }
          if (!active() || latest.profile.id !== owner) return;
          const edits = Object.entries(draft).filter(([key,value]) => value !== before[key]);
          dirty = false;
          apply(latest.profile.revision < profile.revision ? {profile} : latest);
          for (const [key,value] of edits) draft[key] = value;
          dirty = Object.keys(draft).some(key => draft[key] !== profile.avatar[key]);
          $('kit-status').textContent = dirty ? reviewAppearance : 'Apariencia guardada.';
        } else $('kit-status').textContent = error.message;
      }
    } finally {
      if (saving === attempt) { saving = false; render(); }
    }
  }
  $('kit-save').onclick = () => {
    if (getSelf()) {
      void saveAppearance(draftBase?.revision ?? profile?.revision);
      return;
    }
    dirty = true;
    saveAfterLogin = true;
    $('profile').click();
  };
  $('entry').addEventListener('close', () => { if (!getSelf()) saveAfterLogin = false; });
  window.addEventListener('squadlink:player-restoring', () => {
    ++profileVersion;
    clearPlayer();
    render();
  });
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
      const owner = profile?.id;
      const session = getSelf()?.id;
      const data = await api('progress/finish', body);
      if (!owner || profile?.id !== owner || !getSelf() || getSelf().id !== session || data.profile?.id !== owner) return data;
      apply(data);
      if (data.earned > 0) {
        tell('+' + data.earned + ' XP');
        void leaderboard();
      }
      return data;
    }
  };
}
