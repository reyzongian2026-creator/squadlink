// Shared by the character editor, ranking and authoritative progress service.
export const MAX_LEVEL = 50;
const XP_PER_LEVEL = 100;

export const avatarOptions = {
  skin: ['Porcelana', 'Trigo', 'Canela', 'Cobre', 'Cacao', 'Ébano'],
  outfit: ['Lima', 'Glaciar', 'Orquídea', 'Coral', 'Cobalto', 'Ámbar'],
  headgear: ['Al natural', 'Audífonos', 'Gorra', 'Visor'],
  gender: ['Hombre', 'Mujer', 'Sin identificar'],
  species: ['Humano', 'Humanoide', 'Alienígena', 'Robot'],
  build: ['Recta', 'Curvilínea', 'Robusta'],
  facialHair: ['Ninguno', 'Bigote', 'Barba', 'Perilla'],
  hairStyle: ['Con cabello', 'Sin cabello'],
  hairColor: ['Color original', 'Negro', 'Castaño', 'Rubio', 'Rojo', 'Azul', 'Violeta', 'Blanco'],
};

export const defaultAvatar = Object.freeze({
  skin: 0, outfit: 0, headgear: 0, gender: 2, species: 0, build: 0, facialHair: 0, hairStyle: 0, hairColor: 0,
});

export function validAvatarOption(field, value) {
  return Object.hasOwn(avatarOptions, field) && Number.isInteger(value)
    && value >= 0 && value < avatarOptions[field].length;
}

export function normalizeAvatar(avatar) {
  const result = {...defaultAvatar};
  for (const key of Object.keys(result)) {
    if (validAvatarOption(key, avatar?.[key])) result[key] = avatar[key];
  }
  return result;
}

export const evolutions = [
  {level:1, name:'Origen', aura:'none'},
  {level:5, name:'Despertar', aura:'spark'},
  {level:10, name:'Fulgor dorado', aura:'gold'},
  {level:20, name:'Pulso de plasma', aura:'plasma'},
  {level:30, name:'Ascensión azul', aura:'blue'},
  {level:40, name:'Corona violeta', aura:'violet'},
  {level:50, name:'Forma prisma', aura:'prism'},
];

export function evolutionForLevel(level) {
  return evolutions.findLast(stage => level >= stage.level) ?? evolutions[0];
}

export function progressForXp(xp) {
  const total = Number.isSafeInteger(xp) && xp > 0 ? xp : 0;
  const level = Math.min(MAX_LEVEL, 1 + Math.floor(total / XP_PER_LEVEL));
  const atMax = level === MAX_LEVEL;
  return {
    level,
    levelXp: atMax ? XP_PER_LEVEL : total % XP_PER_LEVEL,
    nextLevelXp: atMax ? 0 : XP_PER_LEVEL,
    evolution: evolutionForLevel(level),
    nextEvolution: evolutions.find(stage => stage.level > level) ?? null,
  };
}
