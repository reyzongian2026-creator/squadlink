// The same rules format the leaderboard and validate scores at the API boundary.
export const arcadeBoards = {
  reflex: {name:'Reflejos', order:'min', rule:'Menor tiempo', unit:'ms', min:80, max:3000},
  sequence: {name:'Memoria', rule:'Más rondas seguidas', unit:'rondas', max:12},
  flick: {name:'Cambio de blanco', order:'min', rule:'Menor tiempo para acertar 12 blancos', unit:'ms', max:86_400_000},
  precision: {name:'Precisión', rule:'Más aciertos en 16 intentos', unit:'aciertos', max:16},
  ducks: {name:'Mata patos', rule:'Más patos en una ronda de 10', unit:'patos', max:10},
  ducknes: {name:'Duck Hunt · Puntos', rule:'Mayor puntuación del cartucho', unit:'puntos', max:999_999},
  ducknesround: {name:'Duck Hunt · Ronda', rule:'Ronda más alta alcanzada', unit:'ronda', min:2, max:99},
  mario3: {name:'Super Mario Bros. 3 · Puntos', rule:'Mayor puntuación del cartucho', unit:'puntos', min:10, max:9_999_990, step:10},
  mario3world: {name:'Super Mario Bros. 3 · Mundo', rule:'Mundo más alto alcanzado', unit:'mundo', min:2, max:8},
  doom: {name:'DOOM · Freedoom', rule:'Más mapas distintos completados en una sesión', unit:'mapas', max:36},
  merge: {name:'2048', rule:'Mayor puntuación en una partida', unit:'puntos', max:1_000_000, step:4},
  three: {name:'Tres en raya', order:'min', rule:'Victoria más rápida contra la computadora', unit:'ms', max:86_400_000},
};
export const reportedGames = Object.keys(arcadeBoards).filter(id => id !== 'reflex' && id !== 'sequence');

export function validRecord(game, value) {
  if (!Object.hasOwn(arcadeBoards,game) || !Number.isSafeInteger(value)) return false;
  const {min=1, max, step=1} = arcadeBoards[game];
  return value >= min && value <= max && value % step === 0;
}
export function improvesRecord(game, value, prior) {
  if (!prior) return true;
  return arcadeBoards[game].order === 'min' ? value < prior : value > prior;
}
export function formatRecord(game, value) {
  const {unit} = arcadeBoards[game];
  if (unit === 'mundo' || unit === 'ronda') return (unit === 'mundo' ? 'Mundo ' : 'Ronda ') + value;
  if (unit === 'ms' && value >= 1000 && game !== 'reflex') {
    const min = Math.floor(value/60000), seconds = (value % 60000)/1000;
    return min ? min + ' min ' + seconds.toLocaleString('es-PE',{maximumFractionDigits:3}) + ' s'
      : seconds.toLocaleString('es-PE',{maximumFractionDigits:3}) + ' s';
  }
  const label = value === 1 && unit.endsWith('s') && unit !== 'ms' ? unit.slice(0,-1) : unit;
  return value.toLocaleString('es-PE') + ' ' + label;
}
