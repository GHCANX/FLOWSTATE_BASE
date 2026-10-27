export const CHARACTER_MAP = {
  0: { alias: 'falcon', name: 'Captain Falcon', initials: 'CF', colors: ['Default', 'Black', 'Red', 'White', 'Green', 'Blue'] },
  1: { alias: 'dk', name: 'Donkey Kong', initials: 'DK', colors: ['Default', 'Black', 'Red', 'Blue', 'Green'] },
  2: { alias: 'fox', name: 'Fox', initials: 'FX', colors: ['Default', 'Red', 'Blue', 'Green'] },
  3: { alias: 'gnw', name: 'Mr. Game & Watch', initials: 'GW', colors: ['Default', 'Red', 'Blue', 'Green'] },
  4: { alias: 'kirby', name: 'Kirby', initials: 'KB', colors: ['Default', 'Yellow', 'Blue', 'Red', 'Green', 'White'] },
  5: { alias: 'bowser', name: 'Bowser', initials: 'BW', colors: ['Default', 'Red', 'Blue', 'Black'] },
  6: { alias: 'link', name: 'Link', initials: 'LK', colors: ['Default', 'Red', 'Blue', 'Black', 'White'] },
  7: { alias: 'luigi', name: 'Luigi', initials: 'LG', colors: ['Default', 'White', 'Blue', 'Red'] },
  8: { alias: 'mario', name: 'Mario', initials: 'MR', colors: ['Default', 'Yellow', 'Black', 'Blue', 'Green'] },
  9: { alias: 'marth', name: 'Marth', initials: 'MA', colors: ['Default', 'Red', 'Green', 'Black', 'White'] },
  10: { alias: 'mewtwo', name: 'Mewtwo', initials: 'M2', colors: ['Default', 'Red', 'Blue', 'Green'] },
  11: { alias: 'ness', name: 'Ness', initials: 'NS', colors: ['Default', 'Yellow', 'Blue', 'Green'] },
  12: { alias: 'peach', name: 'Peach', initials: 'PC', colors: ['Default', 'Daisy', 'White', 'Blue', 'Green'] },
  13: { alias: 'pikachu', name: 'Pikachu', initials: 'PI', colors: ['Default', 'Red', 'Party_Hat', 'Cowboy_Hat'] },
  14: { alias: 'ics', name: 'Ice Climbers', initials: 'IC', colors: ['Default', 'Green', 'Orange', 'Red'] },
  15: { alias: 'puff', name: 'Jigglypuff', initials: 'PU', colors: ['Default', 'Red', 'Blue', 'Headband', 'Crown'] },
  16: { alias: 'samus', name: 'Samus', initials: 'SA', colors: ['Default', 'Pink', 'Black', 'Green', 'Purple'] },
  17: { alias: 'yoshi', name: 'Yoshi', initials: 'YS', colors: ['Default', 'Red', 'Blue', 'Yellow', 'Pink', 'Cyan'] },
  18: { alias: 'zelda', name: 'Zelda', initials: 'ZL', colors: ['Default', 'Red', 'Blue', 'Green', 'White'] },
  19: { alias: 'sheik', name: 'Sheik', initials: 'SK', colors: ['Default', 'Red', 'Blue', 'Green', 'White'] },
  20: { alias: 'falco', name: 'Falco', initials: 'FA', colors: ['Default', 'Red', 'Blue', 'Green'] },
  21: { alias: 'yl', name: 'Young Link', initials: 'YL', colors: ['Default', 'Red', 'Blue', 'White', 'Black'] },
  22: { alias: 'doc', name: 'Dr. Mario', initials: 'DC', colors: ['Default', 'Red', 'Blue', 'Green', 'Black'] },
  23: { alias: 'roy', name: 'Roy', initials: 'RY', colors: ['Default', 'Red', 'Blue', 'Green', 'Yellow'] },
  24: { alias: 'pichu', name: 'Pichu', initials: 'PCH', colors: ['Default', 'Red', 'Blue', 'Green'] },
  25: { alias: 'ganon', name: 'Ganondorf', initials: 'GN', colors: ['Default', 'Red', 'Blue', 'Green', 'Purple'] },
};

export const STAGE_ASSET_MAP = {
  2: { name: 'Fountain of Dreams', file: 'fountain.jpg', legal: true },
  3: { name: 'Pokémon Stadium', file: 'stadium.jpg', legal: true },
  8: { name: "Yoshi's Story", file: 'yoshis.jpg', legal: true },
  28: { name: 'Dream Land N64', file: 'dreamland.jpg', legal: true },
  31: { name: 'Battlefield', file: 'battlefield.jpg', legal: true },
  32: { name: 'Final Destination', file: 'finaldestination.jpg', legal: true },
};

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function ansiToHtml(text) {
  let html = escapeHtml(text);

  const ansiMap = [
    { regex: /\x1b\[0m/g, replacement: '</span>' },
    { regex: /\x1b\[1m/g, replacement: '<span class="t-bold">' },
    { regex: /\x1b\[2m/g, replacement: '<span class="t-dim">' },
    { regex: /\x1b\[31m/g, replacement: '<span class="t-red">' },
    { regex: /\x1b\[32m/g, replacement: '<span class="t-green">' },
    { regex: /\x1b\[33m/g, replacement: '<span class="t-yellow">' },
    { regex: /\x1b\[34m/g, replacement: '<span class="t-blue">' },
    { regex: /\x1b\[35m/g, replacement: '<span class="t-magenta">' },
    { regex: /\x1b\[36m/g, replacement: '<span class="t-cyan">' },
    { regex: /\x1b\[90m/g, replacement: '<span class="t-dim">' },
    { regex: /\x1b\[[0-9;]*[a-zA-Z]/g, replacement: '' },
  ];

  for (const { regex, replacement } of ansiMap) {
    html = html.replace(regex, replacement);
  }

  return html;
}

export function getCharacterPortraitUrl(characterId, costumeIndex = 0) {
  const char = CHARACTER_MAP[characterId];
  if (!char) return '/assets/character-icons/fox/Default.png';
  const colors = char.colors || ['Default'];
  let colorName = colors[costumeIndex] || colors[0] || 'Default';
  colorName = colorName.replace(/ /g, '_');
  return `/assets/character-icons/${char.alias}/${colorName}.png`;
}

export function getCharacterInitials(characterId) {
  return CHARACTER_MAP[characterId]?.initials || 'P';
}

export function getStageDetails(stageId, rawName = '') {
  if (STAGE_ASSET_MAP[stageId]) {
    return STAGE_ASSET_MAP[stageId];
  }
  return {
    name: rawName || 'Unknown Stage',
    file: 'nonlegal.jpg',
    legal: false,
  };
}
