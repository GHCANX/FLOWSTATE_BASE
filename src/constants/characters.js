export const CHARACTER_NAMES = {
  0: 'Captain Falcon',
  1: 'Donkey Kong',
  2: 'Fox',
  3: 'Mr. Game & Watch',
  4: 'Kirby',
  5: 'Bowser',
  6: 'Link',
  7: 'Luigi',
  8: 'Mario',
  9: 'Marth',
  10: 'Mewtwo',
  11: 'Ness',
  12: 'Peach',
  13: 'Pikachu',
  14: 'Ice Climbers',
  15: 'Jigglypuff',
  16: 'Samus',
  17: 'Yoshi',
  18: 'Zelda',
  19: 'Sheik',
  20: 'Falco',
  21: 'Young Link',
  22: 'Dr. Mario',
  23: 'Roy',
  24: 'Pichu',
  25: 'Ganondorf',
};

const CHARACTER_ALIASES = {
  falcon: 0,
  cf: 0,
  dk: 1,
  donkeykong: 1,
  fox: 2,
  gnw: 3,
  gw: 3,
  gameandwatch: 3,
  kirby: 4,
  bowser: 5,
  link: 6,
  luigi: 7,
  mario: 8,
  marth: 9,
  mewtwo: 10,
  ness: 11,
  peach: 12,
  pika: 13,
  pikachu: 13,
  ic: 14,
  ics: 14,
  iceclimbers: 14,
  puff: 15,
  jiggs: 15,
  jigglypuff: 15,
  samus: 16,
  yoshi: 17,
  zelda: 18,
  sheik: 19,
  falco: 20,
  yl: 21,
  younglink: 21,
  doc: 22,
  drmario: 22,
  roy: 23,
  pichu: 24,
  ganon: 25,
  ganondorf: 25,
};

export function getCharacterName(id) {
  return CHARACTER_NAMES[id] ?? `Unknown (${id})`;
}

export function resolveCharacterId(input) {
  if (typeof input === 'number') {
    return input;
  }
  const clean = String(input).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!isNaN(parseInt(clean, 10)) && clean === input) {
    return parseInt(clean, 10);
  }
  if (clean in CHARACTER_ALIASES) {
    return CHARACTER_ALIASES[clean];
  }
  for (const [id, name] of Object.entries(CHARACTER_NAMES)) {
    if (name.toLowerCase().replace(/[^a-z0-9]/g, '') === clean) {
      return parseInt(id, 10);
    }
  }
  return null;
}
