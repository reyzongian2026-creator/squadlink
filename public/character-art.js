import {normalizeAvatar, evolutionForLevel} from './character-model.js';

// Offline studio renders retain the clothing, eyes and skin texture at every size.
// Skin and coat layers contain only the matching material, in its original lighting.
const skins = [
  ['#ffddbd','#eeb989','#cd9269','#ad704e','#885238','#5e372b'],
  ['#c6f6ee','#a1e1da','#83c4c5','#64a7ad','#508791','#3c687b'],
  ['#e8f2ad','#c7de91','#abc88b','#84ae92','#638f87','#487577'],
  ['#eff2e9','#d9d5c8','#b8c5ca','#a3a9b8','#7c899d','#586476'],
];
const jackets = ['#b8e760','#76d6e4','#b599ed','#ed8b70','#668fe1','#e5b26d'];
const energy = {
  spark: ['#a8f099','#e6ffd5'],
  gold: ['#ffb547','#fff0aa'],
  plasma: ['#ff7a64','#ffe7a8'],
  blue: ['#269cff','#a0f5ff'],
  violet: ['#aa72ff','#f0d4ff'],
  prism: ['#79eaff','#ffe6ab'],
};

// Eye centre, mouth centre, width across the temples and side of the portrait crop.
// Coordinates are in the 320 × 510 full-body artboard before any silhouette change.
const faces = [
  [[162,54,162,72,46,128],[159,49,159,66,47,124],[160,53,160,71,45,126]],
  [[160,52,160,69,45,128],[166,66,167,83,45,158],[160,48,160,65,45,123]],
  [[160,65,160,84,47,155],[162,67,162,85,46,158],[161,69,161,88,47,162]],
  [[161,73,161,104,145,202],[161,73,161,100,143,203],[161,71,161,97,148,202]],
];
let nextId = 0;

function gradient(id, colors) {
  const stops = colors.map((color, i) =>
    '<stop offset="'+i/(colors.length-1)+'" stop-color="'+color+'"/>');
  return '<linearGradient id="'+id+'" x2=".78" y2="1">'+stops.join('')+'</linearGradient>';
}

function material(id, hex) {
  // Map the material's luminance to a colour ramp. Deep folds stay in shadow
  // and highlights tend toward white instead of turning into solid paint.
  const ramps = ['R','G','B'].map((channel,i) => {
    const value = parseInt(hex.slice(1+i*2,3+i*2),16) / 255;
    const ramp = [.025, .37*value, .79*value, .17+.83*value, .86+.14*value];
    return '<feFunc'+channel+' type="table" tableValues="'+ramp.map(n=>n.toFixed(3)).join(' ')+'"/>';
  }).join('');
  return '<filter id="'+id+'" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">'
    + '<feColorMatrix type="saturate" values="0"/><feComponentTransfer>'+ramps+'</feComponentTransfer></filter>';
}

function materialImage(prefix, file, width, height, filter) {
  return '<image href="/'+prefix+'-'+file+'.webp" width="'+width+'" height="'+height+'"'
    + (filter ? ' filter="url(#'+filter+')" opacity=".94"' : '') + '/>';
}

// Baked 8 × 32 displacement maps. Red shifts each side of the body in or out;
// green stays neutral. Both maps leave the face and feet untouched. Bitmap
// sources also avoid recursive SVG-image filters in native image renderers.
const shapeMaps = [null,
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAgCAIAAACgkq6HAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAy0lEQVQoz9XSTU8CMRDG8V+7A7KgiVfO+EH5vBCNRggC++JhU7Mb8ObFSfOknX/maSfTtN1u3Yvsl/hnIBJ9OYw3kabZH82ZNDXp6Yhmmk0kMvHG7N6KV5asyCxYsGI5gJaKRWFPPBNramoqWo50nIgNfXnJlTPvQx8vHDjeaGzYsefMlQ/27MhtsRr3UZEPnLjQkZlT80h8cuJawIyahjgU0JMK6MnDnW0BFTMeiC8uNMUqmA+DOtPcVKQBdHQjMGhcpsOoqP76+3wDQNFJoKzQa0IAAAAASUVORK5CYII=',
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAgCAIAAACgkq6HAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA1UlEQVQoz83Sy27CMBCF4S/GSUBi010lXpbH7QoWpSUXElhYtowK+44sy5rfZ26a5ng8emXBG/ufIHas+dyrdzzwy/XPHQ+cODNx44czJ+InmPjO4MQXYUvLhoY7CzNDAh0xgxtTAv0rxUg4c2FgYcOWPR8FjKwE+gIuXJkzaNmxJwQCTc5Rmg/JVVvCoXyvvSthZGbhTsOGlp5wzVNKINKxIwxMz4qOba1I5RZFHBifQ/WpqvI9gSIKqaS12oFUWEygTi7FnHJTJVTCcamGUY/g7V49ANhnYhrAuC25AAAAAElFTkSuQmCC',
];

function silhouette(id, build) {
  return '<filter id="'+id+'" filterUnits="userSpaceOnUse" x="0" y="0" width="320" height="510" color-interpolation-filters="sRGB">'
    + '<feImage href="'+shapeMaps[build]+'" width="320" height="510" preserveAspectRatio="none" result="map"/>'
    + '<feDisplacementMap in="SourceGraphic" in2="map" scale="78" xChannelSelector="R" yChannelSelector="G"/></filter>';
}

const gearShapes = [
  '',
  // Rounded cushions, double headband and brushed metal hinges; origin at eyes.
  '<path d="M-46 8 C-53-61 48-68 49 6" fill="none" stroke="#263445" stroke-width="7.5"/>'
    + '<path d="M-46-1 C-46-57 42-62 48-2" fill="none" stroke="#a3bdcb" stroke-width="2.1"/>'
    + '<g fill="url(#METAL)" stroke="#243341" stroke-width="1.6">'
    + '<rect x="-53" y="-11" width="12" height="28" rx="5" transform="rotate(-5 -47 3)"/>'
    + '<rect x="41" y="-11" width="12" height="28" rx="5" transform="rotate(5 47 3)"/></g>'
    + '<path d="M-49-4v13m98-13v13" fill="none" stroke="#81eee2" stroke-width="2.5" stroke-linecap="round"/>',
  // Curved crown, fitted band and a peaked brim with a visible underside.
  '<path d="M-43-18 Q-43-53-9-55 Q27-63 38-29 L39-20 Q-2-13-43-18Z" fill="url(#GEAR)" stroke="#273647" stroke-width="1.4"/>'
    + '<path d="M-23-19 Q-24-43-8-54 M12-23 Q12-43 2-54" fill="none" stroke="#9adad4" stroke-opacity=".39" stroke-width="1.3"/>'
    + '<path d="M-44-23 Q-3-33 37-26 L40-20 Q-5-13-43-17Z" fill="#2b4055"/>'
    + '<path d="M-32-19 Q-3-28 35-25 Q50-23 57-16 Q41-11 21-14 Q-4-18-32-14Z" fill="url(#METAL)" stroke="#283746" stroke-width="1.3"/>'
    + '<path d="M-6-55 q3-4 7 0" fill="none" stroke="#425565" stroke-width="3" stroke-linecap="round"/>',
  // Unobstructed upper and lower edge, allowing the actual eyes to show through.
  '<path d="M-48-6 L-34-9 Q0-14 38-9 L48-6 46 1 37 1 Q33 12 15 13 Q6 13 1 7 Q-3 6-8 10 Q-19 16-34 9 Q-39 7-40 1L-47 0Z" fill="url(#GLASS)" stroke="#243c50" stroke-width="1.6"/>'
    + '<path d="M-41-6 Q0-15 41-6" stroke="#c9ffff" stroke-width="2.2" fill="none"/>'
    + '<path d="M-30-4l8-2-8 10-7 0zm12-2l4-1-7 8-3 0z" fill="#dffbff" opacity=".53"/>',
];
const beardShapes = [
  '',
  '<path d="M0-7 C-7-11-11-5-18-4 Q-25-2-26-8 Q-30 2-23 4 Q-14 8-2 0 L0-2 3 1 Q14 8 23 3 Q28 0 26-7 Q24-2 18-4 C12-5 8-11 0-7Z"/>',
  '<path d="M-32-18 Q-28-7-23-5 L-13-6 Q-7-9 0-6 Q8-10 15-6 L24-5 Q29-10 32-18 Q33-3 26 7 Q19 18 4 23 L0 25-6 22 Q-22 17-29 6 Q-34-6-32-18Z M-14 0 Q0-6 14 0 Q3 8-8 5Z" fill-rule="evenodd"/>',
  '<path d="M-12 4 Q-5 7 0 4 Q6 7 12 4 Q13 16 1 25 Q-10 19-12 4Z M-14-5 Q-5-11 0-7 Q5-11 14-5 Q8-6 1-3 Q-7-6-14-5Z"/>',
];

function accessories(look, art, mini, id) {
  const [x,y,mouthX,mouthY,width,crop] = art;
  const eyeX = mini ? 64 : x, eyeY = mini ? 50 : y;
  const scale = mini ? 128 / crop : 1;
  const mouth = [eyeX+(mouthX-x)*scale, eyeY+(mouthY-y)*scale];
  const gear = gearShapes[look.headgear].replaceAll('METAL',id+'metal')
    .replaceAll('GEAR',id+'fabric').replaceAll('GLASS',id+'glass');
  const hair = beardShapes[look.facialHair];
  const size = (width * scale / 100).toFixed(3);
  return (hair ? '<g transform="translate('+mouth.join(' ')+') scale('+size+')" fill="url(#'+id+'hair)">'+hair+'</g>' : '')
    + (gear ? '<g transform="translate('+eyeX+' '+eyeY+') scale('+size+')">'+gear+'</g>' : '');
}

function gearMaterials(id, look) {
  let defs = '';
  if (look.headgear === 1 || look.headgear === 2)
    defs += gradient(id+'metal',['#e7f0f3','#80a5af','#4d6578','#283c50']);
  if (look.headgear === 2)
    defs += gradient(id+'fabric',['#a4c4c2','#5b797e','#3a5360','#283947']);
  if (look.headgear === 3)
    defs += '<linearGradient id="'+id+'glass" x2=".45" y2="1"><stop stop-color="#69ded7" stop-opacity=".86"/>'
      + '<stop offset=".55" stop-color="#438db0" stop-opacity=".63"/><stop offset="1" stop-color="#343f72" stop-opacity=".85"/></linearGradient>';
  if (look.facialHair) defs += gradient(id+'hair',['#644a3f','#422e2c','#2c2326','#211e24']);
  return defs;
}

function atmosphere(stage, mini, id) {
  const [color, light] = energy[stage];
  const field = '<radialGradient id="'+id+'glow"><stop stop-color="'+color+'" stop-opacity=".37"/>'
    + '<stop offset=".6" stop-color="'+color+'" stop-opacity=".16"/><stop offset="1" stop-color="'+color+'" stop-opacity="0"/></radialGradient>';
  if (mini) return {defs:field, back:'<ellipse cx="62" cy="74" rx="78" ry="78" fill="url(#'+id+'glow)"/>', front:''};
  const rank = Object.keys(energy).indexOf(stage);
  const back = '<ellipse cx="157" cy="262" rx="157" ry="238" fill="url(#'+id+'glow)"/>'
    + (rank ? '<path d="M91 472 C16 470 23 416 75 356 C145 286 293 235 284 149 C281 107 244 61 216 48 C268 68 304 121 299 162 C287 243 172 303 100 365 C46 412 29 457 91 472Z" fill="'+color+'" opacity=".39"/>' : '')
    + (rank > 1 ? '<path d="M39 377 C-2 295 70 238 161 190 C255 139 286 99 249 61 C303 97 265 153 176 202 C83 254 14 294 39 377Z" fill="'+light+'" opacity=".62"/>' : '');
  const front = '<g fill="'+light+'"><ellipse cx="46" cy="359" rx="2" ry="3"/>'
    + '<circle cx="257" cy="105" r="2.3"/><circle cx="286" cy="251" r="1.5"/><circle cx="65" cy="179" r="1.5"/></g>'
    + (rank > 0 ? '<path d="M45 412 C18 457 74 485 163 470 Q208 463 246 436 C212 469 160 481 113 481 C55 482 17 461 45 412Z" fill="'+color+'" opacity=".66"/>' : '')
    + (stage === 'prism' ? '<g fill="none" stroke-linecap="round"><path d="M28 393 Q6 350 29 308 M232 84 Q270 53 260 36" stroke="#ffa8db" stroke-width="3"/>'
      + '<path d="M270 379 Q302 344 297 307 M57 131 Q38 148 39 168" stroke="#ffe9a8" stroke-width="2"/></g>' : '');
  return {defs:field,back,front};
}

function renderAvatar(input, level, mini) {
  const look = normalizeAvatar(input);
  const file = look.species+'-'+look.gender;
  const id = 'sqa'+(++nextId)+'-'; // SVG paint servers share one ID space across the document.
  const width = mini ? 128 : 320, height = mini ? 128 : 510;
  const stage = evolutionForLevel(level).aura;
  const aura = energy[stage] ? atmosphere(stage, mini, id) : {defs:'',back:'',front:''};
  const skin = material(id+'skin',skins[look.species][look.skin]);
  const outfit = material(id+'coat',jackets[look.outfit]);
  const shape = !mini && look.build ? silhouette(id+'build',look.build) : '';
  const image = materialImage(mini ? 'face' : 'avatar',file,width,height)
    + materialImage(mini ? 'face-skin' : 'skin',file,width,height,id+'skin')
    + materialImage(mini ? 'face-coat' : 'coat',file,width,height,id+'coat');
  return '<svg aria-hidden="true" focusable="false" viewBox="0 0 '+width+' '+height+'" width="'+width+'" height="'+height+'" xmlns="http://www.w3.org/2000/svg">'
    + '<defs>'+skin+outfit+shape+aura.defs+gearMaterials(id,look)+'</defs>'+aura.back
    + (shape ? '<g filter="url(#'+id+'build)">'+image+'</g>' : image)
    + accessories(look,faces[look.species][look.gender],mini,id)+aura.front+'</svg>';
}

// Preserve the editor's public export for older desktop integrations.
export function voxelAvatar(avatar, level = 1) { return renderAvatar(avatar,level,false); }
export function portraitAvatar(avatar, level = 1) { return renderAvatar(avatar,level,true); }
