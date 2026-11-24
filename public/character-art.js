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

// Landmarks measured in the 128px portrait. The same coordinates are mapped back
// to each body crop so the ear cushions, brim and glass fit both sizes.
// [left/right ear, ear centre Y, crown Y, cap half-width, cap top/brim Y,
//  visor half-width/height]. Antennae and fins are outside the head measurements.
const gearFits = [
  [[31,96,55,5,33,5,38,29,8],[31,97,55,7,33,5,39,29,8],[32,96,55,4,33,4,38,28,8]],
  [[40,87,54,8,26,11,38,24,7],[40,84,54,13,23,13,40,21,7],[39,89,54,10,26,10,39,24,7]],
  [[44,84,52,27,24,15,39,21,8],[45,82,51,26,22,15,39,20,8],[45,82,52,28,22,16,40,20,8]],
  [[11,117,54,8,49,7,34,52,13],[11,114,54,8,46,6,34,49,15],[7,118,55,9,48,6,35,52,15]],
];

// Bare scalps sit below the original hair volume. Fit the headband against the
// actual crown, and shorten the cap to meet the shaved temples.
const bareHeadFits = [
  [[36,89,19,28,12],[36,90,18,29,11],[36,89,19,28,12]],
  [[42,85,19,24,13],[44,81,27,20,19],[41,87,19,25,13]],
];

function portraitTransform(art, mini) {
  const [x,y,,,,crop] = art;
  return mini ? '' : 'translate('+x+' '+y+') scale('+crop/128+') translate(-64 -50)';
}

function headphones(look, fit, id) {
  let [left,right,ear,crown] = fit;
  if (look.species < 2 && look.hairStyle === 1) {
    [left,right,crown] = bareHeadFits[look.species][look.gender];
  }
  const radius = (right-left)/2, centre = (right+left)/2;
  // Position the padded cups separately so their proportions remain intact even
  // on heads with a tall crown or low ears.
  const band = '<g transform="translate('+centre+' '+ear+') scale('+radius/50+' '+(ear-crown)/50+')">'
    + '<path d="M-50 1 C-54-65 50-70 50 1" fill="none" stroke="#182631" stroke-width="6.2"/>'
    + '<path d="M-50-2 C-52-66 49-66 50-3" fill="none" stroke="url(#'+id+'metal)" stroke-width="3.4"/>'
    + '<path d="M-34-38 C-17-53 12-55 32-40" fill="none" stroke="#263842" stroke-width="5.3" stroke-linecap="round"/>'
    + '<path d="M-31-41 C-14-51 12-53 29-42" fill="none" stroke="#aac1c7" stroke-opacity=".7" stroke-width="1.1" stroke-linecap="round"/></g>';
  function cup(x, mirror) {
    const size = look.species === 3 ? .85 : radius/42;
    return '<g transform="translate('+x+' '+ear+') scale('+mirror*size+' '+size+') rotate(-7)">'
      + '<path d="M-4-13 Q1-16 5-10 L6 8 Q4 14-1 14 L-5 12 Q-9 6-8-3Z" fill="#1b2630" stroke="#121b26" stroke-width="1.2"/>'
      + '<path d="M-6-10 Q-3-14 1-12 L2 10 Q0 13-4 12 Q-8 8-8-2Z" fill="url(#'+id+'metal)"/>'
      + '<path d="M-5-6 Q-4-9-2-9 L-1 8 Q-3 10-5 7Z" fill="#354852"/>'
      + '<path d="M-4-4v8" stroke="'+jackets[look.outfit]+'" stroke-width="1.8" stroke-linecap="round"/>'
      + '<path d="M-3-13v-4q0-2 2-3" fill="none" stroke="#748995" stroke-width="2"/></g>';
  }
  return band+cup(left,1)+cup(right,-1);
}

function cap(look, fit, id) {
  let [left,right,,,radius,top,brim] = fit;
  if (look.species < 2 && look.hairStyle === 1)
    [left,right,,radius,top] = bareHeadFits[look.species][look.gender];
  const centre = (left+right)/2;
  return '<g transform="translate('+centre+' '+brim+') scale('+radius/48+' '+(brim-top)/50+')">'
    + '<path d="M-48 4 C-49-22-35-44-9-49 Q8-55 27-43 Q46-30 48-3 L46 4 Q6-5-46 7Z" fill="url(#'+id+'fabric)" stroke="#1e2f3a" stroke-width="1.5"/>'
    + '<path d="M-47 2 Q-47-30-21-44 Q-31-33-30-5Z" fill="#172d3a" opacity=".4"/>'
    + '<path d="M-29-3 Q-29-29-9-47 M26-6 Q25-32 1-48" fill="none" stroke="#273e4b" stroke-width="1.9"/>'
    + '<path d="M-30-5 Q-31-28-13-44 M24-8 Q23-30 5-45" fill="none" stroke="#9cb6b3" stroke-opacity=".6" stroke-width=".85" stroke-dasharray="1.8 1.2"/>'
    + '<path d="M-8-26 l6-4 5 2 -10 7 -4-2z" fill="#b8cec6" stroke="#425b64" stroke-width=".7"/>'
    + '<path d="M-46 1 Q-9-12 40-4 L46 1 Q-4-5-45 7Z" fill="#253b47"/>'
    + '<path d="M-40 4 Q-19-7 14-7 Q43-7 61 4 Q60 11 34 12 Q20 9 5 5 Q-21 0-40 6Z" fill="#1c303b" stroke="#1a2c36" stroke-width="1.2"/>'
    + '<path d="M-40 3 Q-18-8 14-8 Q42-8 60 3 Q54 8 37 8 Q22 7 8 3 Q-17-2-40 5Z" fill="url(#'+id+'bill)"/>'
    + '<path d="M-29 1 Q0-8 24-4 Q44-3 54 2" fill="none" stroke="#93acaf" stroke-opacity=".63" stroke-width="1" stroke-dasharray="2 1.7"/>'
    + '<ellipse cx="-5" cy="-49" rx="4.5" ry="2.3" fill="#516b75"/></g>';
}

function visor(look, fit, id) {
  const radius = fit[7], height = fit[8];
  // The broad robot display takes a single curved shield; organic faces use
  // separate lenses with a raised bridge that clears the nose.
  if (look.species === 3) {
    return '<g transform="translate(64 50) scale('+radius/50+' '+height/14+')">'
      + '<path d="M-51-6 Q-45-14-2-14 Q37-16 51-8 L49 7 Q47 14 33 14 Q12 13 4 10 Q0 9-5 11 Q-20 16-38 13 Q-49 12-50 6Z" fill="url(#'+id+'glass)" stroke="#3c6374" stroke-width="1.7"/>'
      + '<path d="M-46-8 Q-20-16 9-13 Q33-13 46-9 M-37-6l7-2" fill="none" stroke="#cbedea" stroke-opacity=".8" stroke-width="1.2"/>'
      + '<path d="M-53-4v9m105-10v9" stroke="url(#'+id+'metal)" stroke-width="3.7" stroke-linecap="round"/></g>';
  }
  const lens = '<path d="M-47-5 Q-35-13-8-9 L-4-6 Q-5 3-11 9 Q-19 15-34 11 Q-45 9-46 2Z" fill="url(#'+id+'glass)" stroke="#344f60" stroke-width="2.1"/>';
  return '<g transform="translate(64 50) scale('+radius/50+' '+height/12+')">'
    + '<path d="M-52-4l7 1M45-3l7-1" stroke="#293d48" stroke-width="4.2" stroke-linecap="round"/>'
    + lens+'<g transform="scale(-1 1)">'+lens+'</g>'
    + '<path d="M-6-5 Q0-9 6-5" fill="none" stroke="#3b5464" stroke-width="3"/>'
    + '<path d="M-43-6 Q-30-12-12-9 M11-9 Q31-13 43-6" fill="none" stroke="#d3ebe7" stroke-width="1.1"/>'
    + '<path d="M-37-3l9-3-7 9m49-7l7-2" fill="none" stroke="#d2fff9" stroke-opacity=".65" stroke-width="1.4"/></g>';
}

const beardShapes = [
  '',
  '<path d="M0-7 C-7-11-11-5-18-4 Q-25-2-26-8 Q-30 2-23 4 Q-14 8-2 0 L0-2 3 1 Q14 8 23 3 Q28 0 26-7 Q24-2 18-4 C12-5 8-11 0-7Z"/>',
  '<path d="M-32-18 Q-28-7-23-5 L-13-6 Q-7-9 0-6 Q8-10 15-6 L24-5 Q29-10 32-18 Q33-3 26 7 Q19 18 4 23 L0 25-6 22 Q-22 17-29 6 Q-34-6-32-18Z M-14 0 Q0-6 14 0 Q3 8-8 5Z" fill-rule="evenodd"/>',
  '<path d="M-12 4 Q-5 7 0 4 Q6 7 12 4 Q13 16 1 25 Q-10 19-12 4Z M-14-5 Q-5-11 0-7 Q5-11 14-5 Q8-6 1-3 Q-7-6-14-5Z"/>',
];

function accessories(look, art, mini, id) {
  const [x,y,mouthX,mouthY,width,crop] = art;
  const scale = 128/crop;
  const mouth = [64+(mouthX-x)*scale,50+(mouthY-y)*scale];
  const size = (width*scale/100).toFixed(3);
  const facialHair = beardShapes[look.facialHair];
  const beard = facialHair ? '<g transform="translate('+mouth.join(' ')+') scale('+size+')" fill="url(#'+id+'beard)">'+facialHair+'</g>' : '';
  const fit = gearFits[look.species][look.gender];
  let gear = '';
  if (look.headgear === 1) gear = headphones(look, fit, id);
  if (look.headgear === 2) gear = cap(look, fit, id);
  if (look.headgear === 3) gear = visor(look, fit, id);
  return beard || gear ? '<g transform="'+portraitTransform(art,mini)+'">'+beard+gear+'</g>' : '';
}

function gearMaterials(id, look) {
  let defs = '';
  if (look.headgear === 1 || (look.headgear === 3 && look.species === 3))
    defs += gradient(id+'metal',['#e4e8df','#93a7aa','#5b7380','#2e4150']);
  if (look.headgear === 2) {
    defs += '<radialGradient id="'+id+'fabric" cx=".32" cy=".22" r=".9"><stop stop-color="#829b9c"/><stop offset=".4" stop-color="#576f79"/><stop offset=".8" stop-color="#344c59"/><stop offset="1" stop-color="#263c49"/></radialGradient>';
    defs += gradient(id+'bill',['#82999f','#617b83','#3f5a67','#304553']);
  }
  if (look.headgear === 3)
    defs += '<linearGradient id="'+id+'glass" x2=".23" y2="1"><stop stop-color="#7cd5cf" stop-opacity=".53"/>'
      + '<stop offset=".46" stop-color="#468394" stop-opacity=".23"/><stop offset="1" stop-color="#303e62" stop-opacity=".5"/></linearGradient>';
  if (look.facialHair) defs += gradient(id+'beard',['#644a3f','#422e2c','#2c2326','#211e24']);
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

// Each ramp is calibrated for the darker original hair texture. Root shadows,
// reflected light and individual strand highlights remain distinct.
const hairRamps = [
  null,
  ['#050609','#14171c','#383b43','#676c72','#96979b'],
  ['#150c0c','#4b2e25','#8e6349','#c39e78','#e9d4a9'],
  ['#30201c','#937444','#cdb478','#f1dfae','#fff7de'],
  ['#240c13','#6b2326','#ba4e40','#df8972','#f7c5a5'],
  ['#070e1c','#22466e','#487cb5','#80b1cf','#cee8ed'],
  ['#180b20','#503165','#956ca7','#c29bce','#f1d9eb'],
  ['#242430','#828390','#babac0','#e9e5df','#fffaf1'],
];

function hairMaterial(id, tone) {
  const stops = hairRamps[tone];
  const channels = ['R','G','B'].map((channel,index) => {
    const offset = 1+index*2;
    const values = stops.map(color=>(parseInt(color.slice(offset,offset+2),16)/255).toFixed(3));
    return '<feFunc'+channel+' type="table" tableValues="'+values.join(' ')+'"/>';
  }).join('');
  return '<filter id="'+id+'" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">'
    + '<feColorMatrix type="saturate" values="0"/><feComponentTransfer>'
    + '<feFuncR type="gamma" exponent=".72"/><feFuncG type="gamma" exponent=".72"/><feFuncB type="gamma" exponent=".72"/></feComponentTransfer>'
    + '<feComponentTransfer>'+channels+'</feComponentTransfer></filter>';
}

function costume(look, art, mini, id) {
  const width = mini ? 128 : 320, height = mini ? 128 : 510;
  const prefix = mini ? 'face-' : '', file = look.species+'-'+look.gender;
  const hasHair = look.species < 2 && look.hairStyle !== 1;
  const capCoversHair = hasHair && look.headgear === 2;
  const bald = look.species < 2 && (!hasHair || capCoversHair);
  const base = bald ? prefix+'bald' : mini ? 'face' : 'avatar';
  const region = prefix+(bald ? 'bald-' : '');
  let defs = material(id+'skin',skins[look.species][look.skin]) + material(id+'coat',jackets[look.outfit]);
  let image = materialImage(base,file,width,height)
    + materialImage(region+'skin',file,width,height,id+'skin')
    + materialImage(region+'coat',file,width,height,id+'coat');
  if (hasHair && (look.hairColor || capCoversHair)) {
    const color = look.hairColor ? id+'hairColor' : '';
    if (color) defs += hairMaterial(color,look.hairColor);
    let hair = materialImage(prefix+'hair',file,width,height,color);
    if (capCoversHair) {
      const fit = gearFits[look.species][look.gender];
      const left = Math.round((fit[0]+fit[1])/2-fit[4]), right = left+fit[4]*2, brim = fit[6];
      // Only expose hair below the brim. The sloped sides retain hanging locks
      // and braids without letting an old bun protrude at the sides of the cap.
      const cut = 'M-500 360 L'+(left-15)+' '+(brim+24)+' Q'+(left-4)+' '+(brim+10)+' '+left+' '+(brim+2)
        + ' Q64 '+(brim-8)+' '+right+' '+(brim+2)+' Q'+(right+4)+' '+(brim+10)+' '+(right+15)+' '+(brim+24)
        + ' L650 360 V850 H-500Z';
      defs += '<clipPath id="'+id+'underBrim"><path transform="'+portraitTransform(art,mini)+'" d="'+cut+'"/></clipPath>';
      hair = '<g clip-path="url(#'+id+'underBrim)">'+hair+'</g>';
    }
    image += hair;
  }
  return {defs,image};
}

function renderAvatar(input, level, mini) {
  const look = normalizeAvatar(input);
  const art = faces[look.species][look.gender];
  const id = 'sqa'+(++nextId)+'-'; // SVG paint servers share one ID space across the document.
  const width = mini ? 128 : 320, height = mini ? 128 : 510;
  const stage = evolutionForLevel(level).aura;
  const aura = energy[stage] ? atmosphere(stage, mini, id) : {defs:'',back:'',front:''};
  const {defs,image} = costume(look,art,mini,id);
  const shape = !mini && look.build ? silhouette(id+'build',look.build) : '';
  return '<svg aria-hidden="true" focusable="false" viewBox="0 0 '+width+' '+height+'" width="'+width+'" height="'+height+'" xmlns="http://www.w3.org/2000/svg">'
    + '<defs>'+defs+shape+aura.defs+gearMaterials(id,look)+'</defs>'+aura.back
    + (shape ? '<g filter="url(#'+id+'build)">'+image+'</g>' : image)
    + accessories(look,art,mini,id)+aura.front+'</svg>';
}

// Preserve the editor's public export for older desktop integrations.
export function voxelAvatar(avatar, level = 1) { return renderAvatar(avatar,level,false); }
export function portraitAvatar(avatar, level = 1) { return renderAvatar(avatar,level,true); }
