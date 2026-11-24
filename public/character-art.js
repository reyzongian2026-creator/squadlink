import {normalizeAvatar, evolutionForLevel} from './character-model.js';

// Original pixel sprites. Each letter is a palette index, and dots are transparent.
const heads = [
  [
    '......kkkkkkk.......',
    '....kkhhhhhthkk.....',
    '..kkhhhhhtthhhhk....',
    '..khhhtttthhhhhhkk..',
    '.khhhhhtthhhkhhhhkk.',
    '.khhhhthhhkkskhhhhk.',
    '.khhhhkkkksasskhhhk.',
    '..khhkssaasssssksk..',
    '..ksssaasssssssssck.',
    '.kcskksssssakksscck.',
    '.kcswqksssaswqksckk.',
    '..kcsssssaasssssck..',
    '...kcssssccssssck...',
    '...kcssssssssssck...',
    '....kcssssccssck....',
    '.....kccsssscck.....',
    '......kkcccckk......',
    '........kkkk........',
  ],
  [
    '........kkk.........',
    '......kktttk........',
    '.....khtthtk........',
    '....khhtthhhkk......',
    '...khhtthhhhhhkk....',
    'k..kchhhsahhhhck..kk',
    'kckkcsssaasssckkkack',
    '.ksksassssassssksck.',
    '.kccsssakqksssscck..',
    '..kcsakkkkkkkssck...',
    '...kswwqkskwqwssk...',
    '...ksssssssasssk....',
    '...kcssssaasssck....',
    '....kcssccsssck.....',
    '....kcsssssssck.....',
    '.....kcaaaaack......',
    '......kkccckk.......',
    '........kkk.........',
  ],
  [
    '....kkk......kkk....',
    '...kassk....kssak...',
    '...kcssskkkksssck...',
    '....kcsssaasssck....',
    '...kkssaaaasssskk...',
    '..kssaaaassssssssk..',
    '.kcsaassssaaassssck.',
    '.kcsssskqksssssssck.',
    '.kckkkssasssskkksck.',
    '.kkwwwkssssskwwwkck.',
    '.kkwqwwkssskwwqwkck.',
    '..kkqqqkssskqqqkkk..',
    '...kckkssasskkck....',
    '....kcsssasssck.....',
    '.....kcssccsck......',
    '......kcsssck.......',
    '.......kccck........',
    '........kkk.........',
  ],
  [
    '.....kqk............',
    '......pk...kkkk.....',
    '......pkkkkpppk.....',
    '....kkpaaaapppkk....',
    '...kapaaaaapppppk...',
    '...kaappkkkkpppck...',
    '..kasspkqqqkssppck..',
    '.kcckppkkkkppppccck.',
    '.kppkkkkkkkkkkkkppk.',
    '.kppkqqwwwwwwqqkppk.',
    '.kcpkqqqqqqqqookpck.',
    '.kcckkkkkkkkkkkkcck.',
    '..kkpsssppppppckkk..',
    '...kpppkpskpskck....',
    '....kppkkkkkkck.....',
    '.....kppaaaacck.....',
    '......kkcccckk......',
    '........kkkk........',
  ],
];


// Each half is drawn from the temple to the center of the face. Mirroring keeps
// eyes, cheek plates and jawlines aligned with every visor and beard.
function symmetricHead(rows) {
  return rows.map(row => row + [...row].reverse().join(''));
}

const feminineHeads = [
  symmetricHead([
    '......kkkk', '....kkhhtt', '...khhttth', '..khhhttkh',
    '.khhhhtkss', '.khhhtksas', '.khtkkssas', '.khksssass',
    'khhkckksss', 'khtkswkqks', 'khhkssqwss', 'khhkcaassa',
    '.khhkcasss', '.khtkcssss', '.khhkcsscc', '.khtkkcsss',
    '.khhk.kkcc', '..kkk...kk',
  ]),
  symmetricHead([
    '....k....k', '...kqk..kh', '...kqkkkht', '...kthhttt',
    'k..khhhtaa', 'kk..khtssq', 'kqkkkcasaq', '.kqsscsass',
    '..kcckksas', '...kswwqks', '...ksaqwss', '...kqasssa',
    '...kcssass', '...kqcsssc', '....kcsssa', '....kqkcss',
    '....kqkkcc', '.....k..kk',
  ]),
  symmetricHead([
    '...kk.....', '..kqsk....', '..ksakk.kk', '...ksskkss',
    '.kkkcssaaa', 'kqscsaaass', '.kcsaaasss', '..ksskkkss',
    '.kckkwwwks', '.kcwwqqwks', '..kcwqqkss', '...kckkssa',
    '..kqkcaaas', '...kkcssss', '....kcsssc', '.....kcsss',
    '......kcca', '.......kkk',
  ]),
  symmetricHead([
    '....kqk...', '....kpk.kk', '...kppkkpa', '..kppaaaas',
    '.kppaksssp', '.kpakssapa', 'kppkqkkppk', 'kppkqqkppk',
    'kpakppkkpp', 'kpkkkwwqkk', '.kpkqqqqkp', '.kpkkkkkps',
    '.kpakasskp', '..kpaksspa', '..kqpkpskp', '..kqk.kpap',
    '...k...kpa', '........kk',
  ]),
];

const unidentifiedHeads = [
  symmetricHead([
    '.......kkk', '.....kkttt', '....khttth', '...khtttht',
    '..khtthkht', '..khhkkshk', '.khkkssass', '.kccssassa',
    '.ksckkkass', 'kcsckwqkss', 'kcssawqssa', '.kcsacsssa',
    '..kssaacss', '..kcsssscc', '...kcsssss', '....kcsaac',
    '.....kkccc', '.......kkk',
  ]),
  symmetricHead([
    '.........k', 'k......kkq', 'kqk...kqtq', '.kqkkkhhth',
    '..ktqssssq', '..kcsssaqa', '.kkcaaaqqq', 'kqcsaakkkk',
    '.kcsskwwww', '..ksakqqqq', '.kkqsskkkk', 'kqkccssass',
    '.kkssaqcss', '..kcssssca', '...kcsskkp', '....kcssss',
    '.....kkccc', '.......kkk',
  ]),
  symmetricHead([
    '........kk', '......kkqq', '.....kssqq', '...kkcsass',
    '..kcssaaaq', '.kcssasaqq', 'kcssaakkkk', 'kcssskwqqw',
    'kcsasskqqq', 'kcssasskkk', '.kcassssas', '.kqcssqssa',
    '..kqcssass', '...kcsqqss', '....kcsskk', '.....kcsss',
    '......kccc', '.......kkk',
  ]),
  symmetricHead([
    '.......kkk', '......kpqa', '......kppa', '...kkkkppk',
    '..kappaaak', '.kpapskkka', 'kppapkqqqk', 'kspapkqwqk',
    'kppapkqqqk', 'kppappkkkp', 'kpsppppasp', '.kppkakppk',
    '.kpakpkssq', '..kppkkppk', '..kpsppakp', '...kpppkpk',
    '....kkkkpp', '........kk',
  ]),
];
const headsByIdentity = [heads, feminineHeads, unidentifiedHeads];

const torsos = [
  [
    '...kkkkkkkkkk...',
    '.kkIIJJppJJIIkk.',
    'kIJIJJJppJJJJIJk',
    'kIIJJjJppJjJJJIk',
    '.kjJjjJppJjwJJk.',
    '..kJjJjppJjJJk..',
    '..kJjJjppJjjJk..',
    '..kJjjJppJjjJk..',
    '..kJJjjppjjJJk..',
    '..kppppIIppppk..',
    '...kkkkkkkkkk...',
  ],
  [
    '....kkkkkkkk....',
    '..kkIJJppJJIkk..',
    '.kIIJJJppJJJIIk.',
    '.kIJjjJppJjwJjk.',
    '..kJJjJppJjJJk..',
    '...kjjjppjjjk...',
    '...kJjjppjjJk...',
    '..kJJjJppJjJJk..',
    '.kIJjjjppjjjJIk.',
    '.kpppppIIpppppk.',
    '..kkkkkkkkkkkk..',
  ],
  [
    '..kkkkkkkkkkkk..',
    'kkIIJJJppJJJIIkk',
    'kIIJJJJppJJJJJIk',
    'kIJjJjJppJjwJjJk',
    'kJJjJjJppJjJJJJk',
    'kJjjjjJppJjjjjJk',
    'kJJjjjJppJjjjJJk',
    '.kJJjjJppJjjJJk.',
    '.kJJjjjppjjjJJk.',
    '.kpppppIIpppppk.',
    '..kkkkkkkkkkkk..',
  ],
];

const arm = ['..kkk..','.kIIJk.','kIIJJjk','kJJjjjk','.kpppk.','.kpppk.','kIpppk.','kJjjjk.','.kassk.','.kssck.','..kkk..'];
const leg = ['.kkkkk.','kpppppk','kpppppk','kpppcpk','kpcpcpk','kpcccpk','kIIjcpk','.kjcck.','.kpppk.','kpppppk','kIIJjpk','kkkkkkk'];
const skinSets = [
  ['#f9ceaf','#e5b588','#cb956e','#b97954','#935e43','#694432'],
  ['#c5ece8','#a9e0dc','#8fcecd','#73b7bd','#6397a5','#537d91'],
  ['#e5f1af','#c3df91','#a6ca91','#89bba0','#78a5a1','#6f8f95'],
  ['#e7e6e2','#d8d5ce','#b9c5c8','#a9adb5','#939caa','#828899'],
];
const jackets = ['#c4fa69','#7ee0ee','#b192fd','#ff8e70','#658df8','#efc162'];
const energy = {
  spark:['#b9fa95','#dcffc2'], gold:['#ffb842','#fff48c'], plasma:['#ff785c','#ffe6a5'],
  blue:['#15adff','#8ffaff'], violet:['#ad72fd','#eee0ff'], prism:['#90edff','#fff3e4'],
};
const ink = '#222233';

function tint(hex, factor) {
  return '#' + [1,3,5].map(i => Math.min(255, Math.round(parseInt(hex.slice(i,i+2),16)*factor)).toString(16).padStart(2,'0')).join('');
}

// Group neighboring pixels of the same ink into one SVG path per color and layer.
function sprite(rows, x, y, palette, flip = false) {
  const paths = new Map();
  rows.forEach((row, line) => {
    for (let end, start = 0; start < row.length; start = end) {
      end = start + 1;
      while (end < row.length && row[end] === row[start]) end++;
      const fill = palette[row[start]];
      if (!fill) continue;
      const run = end - start;
      const left = x + (flip ? row.length - end : start);
      const d = 'M' + left + ' ' + (y+line) + 'h' + run + 'v1h-' + run + 'z';
      paths.set(fill, (paths.get(fill) || '') + d);
    }
  });
  return [...paths].map(([fill,d]) => '<path fill="'+fill+'" d="'+d+'"/>').join('');
}

const accessories = [
  [],
  ['...kkkkkkkkkkkkkk...','..kppppppppppppppk..','.kkpkk........kkpkk.','.kpk............kpk.','.kpk............kpk.','kIIpk..........kpIIk','kIJpk..........kpJIk','kJJpk..........kpJJk','kJJpk..........kpJJk','.kkk............kkk.'],
  ['.....kkkkkkkkk......','...kkIIIJJJJJJkk....','..kIJJJJJJJJJJjjk...','.kIJJJJjJJJJJjjjjk..','.kkkkkkkkkkkkkkkkkk.','..kIIJJJJJJJJjjjjjjk','...kkkkkkkkkkkkkkkkk'],
  ['.kkkkkkkkkkkkkkkkkk.','kppqwwwwqqqqqqqqoppk','kppqqwwqqqqqqqqoopkk','.kkkkkkkkkkkkkkkkkk.'],
];
const beards = [
  [],
  ['..hh..hh..','.hhthhthh.','hhh.hh.hhh'],
  ['hh......hh','hhthhhthhh','.hhhhhhhh.','..hhtthh..','...hhhh...'],
  ['..hh..hh..','....hh....','...hhhh...','....th....'],
];

function aura(stage) {
  const tones = energy[stage];
  if (!tones) return '';
  const rank = Object.keys(energy).indexOf(stage);
  const [color, light] = tones;
  const flame = 'M13 59L9 52l2 1-4-12 5 4-2-15 4 4 2-17 4 9 3-17 4 9 7-15 3 15 6-10 1 17 4-5 2 12 4-3-1 13 5-3-5 14-3 6z';
  const corona = rank >= 1 ? '<path fill="'+color+'" opacity=".22" d="'+flame+'"/><path fill="none" stroke="'+color+'" stroke-width="1" opacity=".83" d="M16 58l-4-7 3 1-4-13 4 4-1-9m3-6 2-8 2 5m5-9 2-5 1 4m11 9 3-7 1 11m4 7 1-5 1 11 4-3-2 11 3-2-6 12"/>' : '';
  const rays = rank >= 2 ? '<path fill="'+light+'" d="M14 23l-4 10 4-3-2 7 6-12-4 3zm36 13 4-8-1 6 3-1-5 10 1-7zM23 15l2-6 2-2-2 6z"/>' : '';
  const prism = stage === 'prism' ? '<path fill="#ffa5d9" d="M9 40l4 6-2-8 3 4 1 9zM46 15l4-5-2 7z"/><path fill="#ffe5a2" d="M49 57l5-9-1 6 4-2-5 7zM21 17l3-9 2 3-2 7z"/>' : '';
  return corona + rays + prism + '<path fill="'+light+'" d="M12 49h2v2h-2zM49 24h2v3h-2zM19 34h1v2h-1zM43 15h1v2h-1zM46 52h1v2h-1z"/>';
}

export function voxelAvatar(avatar, level = 1) {
  const {species,gender,build,skin,outfit,headgear,facialHair} = normalizeAvatar(avatar);
  const stage = evolutionForLevel(level).aura;
  const colors = energy[stage];
  const complexion = skinSets[species][skin], jacket = jackets[outfit];
  const charged = colors && stage !== 'spark';
  const hair = charged ? tint(colors[0],.73) : '#463649';
  const palette = {
    k:ink,s:complexion,c:tint(complexion,.74),a:tint(complexion,1.14),
    I:tint(jacket,1.17),J:jacket,j:tint(jacket,.66),p:'#4b5065',w:'#f3ffff',
    q:colors?.[1] || '#7ef4ea',o:colors?.[0] || '#32a5ba',h:hair,t:charged ? colors[1] : '#835966',
  };
  const flatShadow = '<path fill="#0a0910" opacity=".52" d="M17 62h30v1h5v2h-5v1H17v-1h-5v-2h5z"/>';
  const reach = [0,-1,1][build];
  const helmetY = headgear === 3 ? 29 : 20;
  const framing = charged ? '0 0 64 70' : '5 12 54 59';
  const trousers = {...palette,p:'#565c70',c:'#414456'};
  const underSuit = '<path fill="#343345" d="M22 39h20v2H22zM26 46h12v5H26z"/>';
  return '<svg aria-hidden="true" viewBox="' + framing + '" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">'
    + flatShadow + aura(stage) + underSuit
    + sprite(leg,25,49,trousers) + sprite(leg,33,49,trousers,true)
    + sprite(arm,19-reach,38,palette) + sprite(arm,38+reach,38,palette,true)
    + sprite(torsos[build],24,38,palette) + sprite(headsByIdentity[gender][species],22,21,palette)
    + sprite(accessories[headgear],22,helmetY,palette)
    + sprite(beards[facialHair],27,34,{h:'#382a3b',t:'#775259'})
    + '</svg>';
}
