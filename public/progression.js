const skins = [
  ["Porcelana", "#f9ceaf"], ["Trigo", "#e5b588"], ["Canela", "#cb956e"],
  ["Cobre", "#b97954"], ["Cacao", "#935e43"], ["Ébano", "#694432"],
];
const outfits = [
  ["Lima", "#c4fa69"], ["Glaciar", "#7ee0ee"], ["Orquídea", "#b192fd"],
  ["Coral", "#ff8e70"], ["Cobalto", "#658df8"], ["Ámbar", "#efc162"],
];
const headgear = ["Al natural", "Audífonos", "Gorra", "Visor"];
const defaultAvatar = {skin: 2, outfit: 0, headgear: 1};
const receiptKey = "squadlink.progress.receipt.v1";
const $ = id => document.getElementById(id);

function shade(color, multiplier) {
  const channel = index => Math.min(255, Math.round(parseInt(color.slice(index, index + 2), 16) * multiplier));
  return 'rgb(' + [channel(1), channel(3), channel(5)].join(',') + ')';
}

// Static orthographic voxel illustration. Coordinates are projected once per edit.
export function voxelAvatar(avatar) {
  const skin = (skins[avatar.skin] || skins[2])[1];
  const outfit = (outfits[avatar.outfit] || outfits[0])[1];
  const parts = [];
  function point(x, y, z) { return [78 + x * 5.4 + z * 2.35, 118 - y * 5.4 - z * 1.45 + x * 0.65].join(','); }
  function block(x, y, z, w, h, d, color) {
    const a = point(x, y, z), b = point(x + w, y, z);
    const c = point(x, y + h, z), e = point(x + w, y + h, z);
    const f = point(x + w, y, z + d), g = point(x + w, y + h, z + d);
    const k = point(x, y + h, z + d);
    parts.push('<polygon fill="' + shade(color, .66) + '" points="' + [b,f,g,e].join(' ') + '"/>',
      '<polygon fill="' + shade(color, 1.14) + '" points="' + [c,e,g,k].join(' ') + '"/>',
      '<polygon fill="' + color + '" points="' + [a,b,e,c].join(' ') + '"/>');
  }
  const dark = "#302c40", pants = "#4d4860", hair = "#453443";
  for (const x of [-2.7, .25]) {
    block(x, 1, 0, 2.45, 4, 2.7, pants);
    block(x - .15, 0, -.55, 2.7, 1.25, 3.35, dark);
    block(x - .15, 0, -.63, 2.7, .35, .3, outfit);
  }
  block(-2.85, 5, 0, 5.7, 5.7, 3, outfit);
  block(-2.85, 5, -.05, 5.7, .7, .16, pants);
  block(-1.05, 8.4, -.13, 2.1, .5, .18, dark);
  for (const x of [-4.5, 2.95]) {
    block(x, 5.35, .1, 1.5, 2, 2.4, skin);
    block(x, 7.25, .1, 1.6, 2.95, 2.55, dark);
    block(x, 8.9, .05, 1.65, 1.5, 2.65, outfit);
  }
  block(-2.65, 10.7, -.15, 5.4, 5.25, 4.4, skin);
  block(-2.7, 14.7, -.26, 5.55, 1.6, 4.65, hair);
  block(-2.7, 14, -.35, 1.65, 1.1, .3, hair);
  for (const x of [-1.7, .8]) block(x, 12.9, -.26, .8, .6, .2, dark);
  block(-.5, 11.7, -.29, 1.15, .22, .2, "#805548");
  if (avatar.headgear === 1) {
    block(-2.9, 15.9, .6, 5.9, .75, 1.45, dark);
    for (const x of [-3.25, 2.75]) {
      block(x, 12.2, .5, .65, 2.25, 1.7, outfit);
      block(x, 14.3, .75, .55, 1.8, 1.15, dark);
    }
  }
  if (avatar.headgear === 2) {
    block(-2.9, 14.95, -.4, 5.9, 1.8, 4.6, dark);
    block(-2.95, 14.7, -2, 6, .55, 3.3, outfit);
  }
  if (avatar.headgear === 3) {
    block(-2.85, 12.7, -.5, 5.85, 1.35, 3, dark);
    block(-2.5, 12.94, -.65, 5.15, .84, .2, outfit);
  }
  return '<svg aria-hidden="true" viewBox="40 12 96 120" xmlns="http://www.w3.org/2000/svg">' +
    '<ellipse cx="84" cy="119" rx="28" ry="4" fill="#080811" opacity=".65"/>' + parts.join('') + '</svg>';
}

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
      <div class="kit-stage"><div id="kit-voxel" role="img" aria-label="Vista previa de tu personaje"></div></div>
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
  const sets = {skin: skins, outfit: outfits, headgear: headgear.map(label => [label])};
  const groups = {skin: 'Tono de piel', outfit: 'Chaqueta', headgear: 'Accesorio'};
  let profile, draft = {...defaultAvatar}, dirty = false, saving = false;
  let selectedGame = 'reflex', rankVersion = 0, profileVersion = 0;
  const selectors = {};
  for (const [key, items] of Object.entries(sets)) {
    const group = document.createElement('fieldset');
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
      button.onclick = () => { draft[key] = index; dirty = true; render(); };
      group.append(button);
      return button;
    });
    $('kit-options').append(group);
  }
  function render() {
    const xp = profile?.xp || 0;
    $('kit-nick').textContent = profile?.nick || getSelf()?.nick || 'Invitado';
    $('kit-level').textContent = 'Nivel ' + (profile?.level || 1);
    $('kit-xp-label').textContent = (xp % 100) + ' / 100 XP · ' + xp + ' XP totales';
    $('kit-xp').value = xp % 100;
    const guest = !getSelf();
    $('kit-save').textContent = guest ? 'Elegir apodo' : 'Guardar apariencia';
    $('kit-save').disabled = !guest && (saving || !profile || !dirty);
    $('kit-rank-refresh').textContent = guest ? 'Elegir apodo' : 'Actualizar';
    $('kit-voxel').innerHTML = voxelAvatar(draft);
    for (const [key, buttons] of Object.entries(selectors)) {
      buttons.forEach((btn, i) => btn.setAttribute('aria-pressed', String(i === draft[key])));
    }
  }
  function apply(data) {
    if (!data.profile) return;
    if (data.profile.id === profile?.id && data.profile.revision < profile.revision) return;
    profile = data.profile;
    if (!dirty) draft = {...profile.avatar};
    if (data.receipt) {
      try { localStorage.setItem(receiptKey, data.receipt); } catch {}
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
        (game === 'reflex' ? 'Menor tiempo' : 'Más rondas seguidas');
      data.players.forEach((p, i) => {
        const row = document.createElement('li');
        for (const [className, value] of [
          ['place', String(i + 1).padStart(2,'0')], ['name', p.nick], ['mark', game === 'reflex' ? p.best.reflex + ' ms' : String(p.best.sequence) + (p.best.sequence === 1 ? ' ronda' : ' rondas')]
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
