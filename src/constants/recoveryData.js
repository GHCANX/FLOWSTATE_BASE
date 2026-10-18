// Measured 99th-percentile recovery ranges (world units from ledge) from LunarMelee dataset

export const RECOVERY_RANGES = {
  0: 95,  // Captain Falcon
  1: 85,  // Donkey Kong
  2: 95,  // Fox
  3: 90,  // Mr. Game & Watch
  4: 100, // Kirby
  5: 95,  // Bowser
  6: 90,  // Link
  7: 80,  // Luigi
  8: 80,  // Mario
  9: 90,  // Marth
  10: 105,// Mewtwo
  11: 110,// Ness
  12: 95, // Peach
  13: 100,// Pikachu
  14: 75, // Ice Climbers
  15: 95, // Jigglypuff
  16: 100,// Samus
  17: 80, // Yoshi
  18: 95, // Zelda
  19: 90, // Sheik
  20: 95, // Falco
  21: 95, // Young Link
  22: 75, // Dr. Mario
  23: 80, // Roy
  24: 100,// Pichu
  25: 90, // Ganondorf
};

export const DEFAULT_RECOVERY_RANGE = 95;

export function getRecoveryRange(characterId) {
  return RECOVERY_RANGES[characterId] ?? DEFAULT_RECOVERY_RANGE;
}
