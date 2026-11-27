const storageKey = 'squadlink.practice.mouse.v1';
const defaults = {dpi:800, targetDpi:800, sensitivity:1};
const limits = {dpi:[50,64000], targetDpi:[50,64000], sensitivity:[0.01,20]};
const sights = new WeakMap();

function valid(key, value) {
  const [min,max] = limits[key];
  return Number.isFinite(value) && value >= min && value <= max &&
    (key === 'sensitivity' || Number.isInteger(value));
}

export function readMouseProfile() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(storageKey)); } catch {}
  const profile = {...defaults};
  for (const key of Object.keys(defaults)) {
    if (valid(key, saved?.[key])) profile[key] = saved[key];
  }
  return profile;
}

export function mouseScale({dpi,targetDpi,sensitivity}) {
  return targetDpi / dpi * sensitivity;
}

export function nesMousePoint(event, rect) {
  const point = sights.get(event.currentTarget);
  return point ? {clientX:rect.left + point.x, clientY:rect.top + point.y} : event;
}

export function mountPracticeMouse(mount, game) {
  const doc = mount.ownerDocument;
  const profile = readMouseProfile();
  const settings = doc.createElement('details');
  settings.className = 'practice-mouse';
  settings.innerHTML = '<summary>Ajustes del ratón</summary><div class="mouse-fields"></div><p>Indica el DPI configurado en tu ratón. El DPI de práctica solo cambia la velocidad dentro del juego.</p>';
  const fields = settings.querySelector('.mouse-fields');
  for (const [key,title] of Object.entries({dpi:'DPI de mi ratón',targetDpi:'DPI de práctica',sensitivity:'Sensibilidad'})) {
    const label = doc.createElement('label');
    const field = doc.createElement('input');
    const [min,max] = limits[key];
    field.type = 'number'; field.min = min; field.max = max;
    field.step = key === 'sensitivity' ? 'any' : '1'; field.value = profile[key];
    label.append(title,field); fields.append(label);
    field.addEventListener('change', () => {
      if (!valid(key,field.valueAsNumber)) { field.value = profile[key]; return; }
      profile[key] = field.valueAsNumber;
      try { localStorage.setItem(storageKey,JSON.stringify(profile)); } catch {}
    });
  }
  mount.prepend(settings);
  if (game === 'doom') {
    settings.lastElementChild.append(' Los cambios de DOOM se aplican al cargar la campaña.');
    return () => {};
  }

  const arena = mount.querySelector('.aim-arena, .duck-pond, canvas');
  if (!arena) return () => {};
  const capture = doc.createElement('button'), hint = doc.createElement('span');
  capture.type = 'button'; capture.className = 'secondary'; capture.textContent = 'Usar mira de práctica';
  hint.setAttribute('role','status');
  const bar = doc.createElement('div'); bar.className = 'mouse-actions'; bar.append(capture,hint); settings.after(bar);
  if (!arena.requestPointerLock) {
    capture.disabled = true; hint.textContent = 'La captura del ratón no está disponible en este entorno.';
    return () => {};
  }
  const cursor = doc.createElement('span');
  cursor.className = 'practice-sight'; cursor.hidden = true; cursor.setAttribute('aria-hidden','true');
  mount.classList.add('practice-sight-host'); mount.append(cursor);
  const controller = new doc.defaultView.AbortController();
  const listen = (target,type,callback,options={}) => target.addEventListener(type,callback,{...options,signal:controller.signal});
  let point, closed = false;
  const locked = () => doc.pointerLockElement === arena;
  function releaseIfHidden() {
    if (locked() && (arena.hidden || doc.hidden)) doc.exitPointerLock();
  }
  const visibility = new doc.defaultView.MutationObserver(releaseIfHidden);
  visibility.observe(arena,{attributes:true,attributeFilter:['hidden']});
  listen(doc,'visibilitychange',releaseIfHidden);
  function paint(rect) {
    const host = mount.getBoundingClientRect();
    cursor.style.left = (rect.left-host.left+point.x+mount.scrollLeft)+'px';
    cursor.style.top = (rect.top-host.top+point.y+mount.scrollTop)+'px';
  }
  listen(capture,'click',async () => {
    if (arena.hidden || !arena.getClientRects().length) { hint.textContent='Empieza el juego y luego activa la mira.'; return; }
    try {
      try { await arena.requestPointerLock({unadjustedMovement:true}); }
      catch (error) {
        if (closed || error.name!=='NotSupportedError') throw error;
        await arena.requestPointerLock();
      }
      if (closed && locked()) doc.exitPointerLock();
    } catch { if (!closed) hint.textContent='El sistema no permitió capturar el ratón. Puedes seguir con el cursor normal.'; }
  });
  listen(doc,'pointerlockerror',()=>{hint.textContent='No se pudo capturar el ratón. Puedes volver a intentarlo.';});
  listen(doc,'pointerlockchange',()=>{
    cursor.hidden=!locked();
    if (locked()) {
      const rect=arena.getBoundingClientRect();
      point={x:rect.width/2,y:rect.height/2};
      sights.set(arena,point); paint(rect); hint.textContent='Esc para soltar el ratón.';
    } else { sights.delete(arena); point=null; hint.textContent=''; }
  });
  listen(arena,'pointermove',event=>{
    if (!point || !locked()) return;
    const rect=arena.getBoundingClientRect(), scale=mouseScale(profile);
    point.x=Math.max(0,Math.min(rect.width-1,point.x+event.movementX*scale));
    point.y=Math.max(0,Math.min(rect.height-1,point.y+event.movementY*scale));
    paint(rect);
  },{capture:true});
  listen(arena,'click',event=>{
    if (!point || !locked() || !event.isTrusted || event.detail===0 || game==='duck-nes') return;
    event.stopImmediatePropagation(); event.preventDefault();
    const rect=arena.getBoundingClientRect();
    const hit=doc.elementFromPoint(rect.left+point.x,rect.top+point.y)?.closest('button');
    (hit && arena.contains(hit) ? hit : arena).click();
    if (arena.hidden && locked()) doc.exitPointerLock();
  },{capture:true});
  return () => {
    closed=true; visibility.disconnect(); controller.abort(); sights.delete(arena);
    if (locked()) doc.exitPointerLock();
    mount.classList.remove('practice-sight-host');
  };
}
