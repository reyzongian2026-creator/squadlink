import {portraitBadge, updatePortrait} from './portrait-badge.js';
import {voxelAvatar, portraitAvatar} from './character-art.js';
import {avatarOptions, defaultAvatar, normalizeAvatar, progressForXp} from './character-model.js';
export {voxelAvatar};
const skins = [
  ["Porcelana", "#f9ceaf"], ["Trigo", "#e5b588"], ["Canela", "#cb956e"],
  ["Cobre", "#b97954"], ["Cacao", "#935e43"], ["Ébano", "#694432"],
];
const outfits = [
  ["Lima", "#c4fa69"], ["Glaciar", "#7ee0ee"], ["Orquídea", "#b192fd"],
  ["Coral", "#ff8e70"], ["Cobalto", "#658df8"], ["Ámbar", "#efc162"],
];
const receiptKey = "squadlink.progress.receipt.v1";
const $ = id => document.getElementById(id);

export function mountLoadout({api, getSelf, tell}) {
  if (!document.querySelector('link[data-progression-style]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet'; style.href = '/progression.css'; style.dataset.progressionStyle = '';
    document.head.append(style);
  }
  const root = $('loadout');
  root.innerHTML = `
    <div class="kit-heading"><h2>Mi personaje</h2><span id="kit-level">Nivel 1</span></div>
    <div class="kit-panels"><article class="kit-editor">
      <div class="kit-stage"><button type="button" id="kit-closeup" aria-pressed="false" aria-controls="kit-voxel">Acercar rostro</button><div id="kit-voxel" role="img" aria-label="Vista previa de tu personaje"></div></div>
      <div class="kit-controls"><h3 id="kit-nick">Invitado</h3>
        <div class="kit-xp"><span id="kit-xp-label">0 / 100 XP</span><progress id="kit-xp" max="100" value="0" aria-label="Progreso al siguiente nivel"></progress></div>
        <div id="kit-options"></div>
        <button class="secondary small" type="button" id="kit-save" disabled>Guardar apariencia</button>
        <p id="kit-status" role="status"></p>
      </div></article>
      <article class="kit-ranking"><div class="kit-ranking-head"><h3>Clasificación del arcade</h3>
      <button class="secondary small" type="button" id="kit-rank-refresh">Actualizar</button></div>
      <div class="kit-tabs" role="group" aria-label="Clasificación por minijuego"><button type="button" data-rank="reflex" aria-pressed="true">Reflejos</button>
      <button type="button" data-rank="sequence" aria-pressed="false">Memoria</button></div>
      <p id="kit-rank-scope"></p><ol id="kit-ranking"></ol><p id="kit-rank-status" role="status"></p></article></div>`;
  const groups = {gender:'Identidad del personaje', species:'Especie', build:'Silueta', hairStyle:'Cabello', hairColor:'Color de cabello', facialHair:'Vello facial',
    skin:'Tono base', outfit:'Chaqueta', headgear:'Accesorio'};
  const hairSamples = [null, "#25212b", "#86583c", "#dfb875", "#be5143", "#5689c9", "#9674c6", "#e0e0e9"];
  const sets = Object.fromEntries(Object.keys(groups).map(key =>
    [key, key === 'skin' ? skins : key === 'outfit' ? outfits : avatarOptions[key].map((label, index) => [label, key === 'hairColor' ? hairSamples[index] : null])]));
  let lastArt = '';
  let stageVisible = !window.IntersectionObserver;
  let profile, draft = {...defaultAvatar}, dirty = false, saving = false;
  let selectedGame = 'reflex', rankVersion = 0, profileVersion = 0;
  let closeup = false;
  $('kit-closeup').onclick = () => {
    closeup = !closeup;
    $('kit-closeup').setAttribute('aria-pressed', String(closeup));
    $('kit-voxel').classList.toggle('kit-closeup', closeup);
    render();
  };
  const selectors = {};
  const hairGroups = {};
  for (const [key, items] of Object.entries(sets)) {
    const group = document.createElement('fieldset');
    if (key === 'hairStyle' || key === 'hairColor') hairGroups[key] = group;
    const title = document.createElement('legend');
    title.textContent = groups[key];
    group.append(title);
    selectors[key] = items.map(([label, color], index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.title = label;
      button.setAttribute('aria-label', label);
      if (color) {
        button.className = 'kit-swatch'; button.style.setProperty('--sample', color);
      } else button.textContent = label;
      button.onclick = () => {
        draft[key] = index; dirty = true; render();
        $('kit-status').textContent = 'Cambios sin guardar.';
      };
      group.append(button);
      return button;
    });
    $('kit-options').append(group);
  }
  function render() {
    const xp = profile?.xp || 0;
    $('kit-nick').textContent = profile?.nick || getSelf()?.nick || 'Invitado';
    const {level, levelXp, nextLevelXp, evolution} = progressForXp(xp);
    $('kit-level').textContent = 'Nivel ' + level + ' / 50 · ' + evolution.name;
    $('kit-xp-label').textContent = (nextLevelXp ? levelXp + ' / 100 XP' : 'Nivel máximo') + ' · ' + xp + ' XP totales';
    $('kit-xp').value = levelXp;
    const guest = !getSelf();
    $('kit-save').textContent = guest ? 'Elegir apodo' : profile && !profile.characterCreated ? 'Crear mi personaje' : 'Guardar apariencia';
    $('kit-save').disabled = !guest && (saving || !profile || (!dirty && profile.characterCreated));
    $('kit-rank-refresh').textContent = guest ? 'Elegir apodo' : 'Actualizar';
    const key = JSON.stringify([draft, evolution.aura, closeup]);
    if (stageVisible && key !== lastArt) {
      $('kit-voxel').innerHTML = (closeup ? portraitAvatar : voxelAvatar)(draft, level);
      $('kit-voxel').setAttribute('aria-label', [avatarOptions.species[draft.species], avatarOptions.gender[draft.gender], evolution.name].join(' · '));
      lastArt = key;
    }
    const hasHair = draft.species === 0 || draft.species === 1;
    hairGroups.hairStyle.hidden = !hasHair;
    hairGroups.hairColor.hidden = !hasHair || draft.hairStyle === 1;
    for (const [key, buttons] of Object.entries(selectors)) {
      buttons.forEach((btn, i) => btn.setAttribute('aria-pressed', String(i === draft[key])));
    }
  }
  function apply(data) {
    if (!data.profile) return;
    if (data.profile.id === profile?.id && data.profile.revision < profile.revision) return;
    profile = data.profile;
    if (!dirty) draft = normalizeAvatar(profile.avatar);
    if (data.receipt) {
      try { localStorage.setItem(receiptKey, data.receipt); } catch {}
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
        (game === 'reflex' ? 'Menor tiempo' : 'Más rondas seguidas');
      const previousFaces = rankFaces;
      rankFaces = new Map();
      data.players.forEach((p, i) => {
        const row = document.createElement('li');
        for (const [className, value] of [
          ['place', String(i + 1).padStart(2,'0')], ['name', p.nick], ['mark', game === 'reflex' ? p.best.reflex + ' ms' : String(p.best.sequence) + (p.best.sequence === 1 ? ' ronda' : ' rondas')]
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
    if (!getSelf()) {
      profile = null; dirty = false; draft = {...defaultAvatar};
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
      apply(data); $('kit-status').textContent = ''; await leaderboard();
    } catch (error) { if (version === profileVersion) $('kit-status').textContent = error.message; }
  }
  $('kit-save').onclick = async () => {
    if (!getSelf()) { $('profile').click(); return; }
    const saved = {...draft};
    saving = true; render();
    try {
      const data = await api('progress/avatar', saved);
      dirty = Object.keys(saved).some(key => saved[key] !== draft[key]); apply(data);
      $('kit-status').textContent = 'Apariencia guardada.';
    } catch (error) { $('kit-status').textContent = error.message; }
    finally { saving = false; render(); }
  };
  const tabs = [...root.querySelectorAll('[data-rank]')];
  for (const tab of tabs) tab.onclick = () => {
    selectedGame = tab.dataset.rank;
    for (const other of tabs) other.setAttribute('aria-pressed', String(other === tab));
    void leaderboard();
  };
  $('kit-rank-refresh').onclick = () => {
    if (!getSelf()) $('profile').click();
    else if (profile) leaderboard();
    else refresh();
  };
  if (window.IntersectionObserver) {
    const observer = new window.IntersectionObserver(([entry]) => {
      stageVisible = entry.isIntersecting;
      if (stageVisible) render();
    });
    observer.observe(root.querySelector('.kit-stage'));
  }
  render();
  return {
    refresh, ranked: () => Boolean(profile),
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
