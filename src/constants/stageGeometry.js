// Per-stage geometry in Melee world coordinates (centered at X=0, stage surface Y≈0)

export const STAGE_GEOMETRY = {
  // Fountain of Dreams
  2: {
    id: 2,
    name: 'Fountain of Dreams',
    ground: { xMin: -63.3475, xMax: 63.3475, y: 0 },
    ledgeGrab: 66.2554,
    blastzone: { left: -198.75, right: 198.75, top: 202.5, bottom: -146.25 },
  },
  // Pokémon Stadium
  3: {
    id: 3,
    name: 'Pokémon Stadium',
    ground: { xMin: -87.75, xMax: 87.75, y: 0 },
    ledgeGrab: 90.6579,
    blastzone: { left: -230, right: 230, top: 180, bottom: -111 },
  },
  // Yoshi's Story
  8: {
    id: 8,
    name: "Yoshi's Story",
    ground: { xMin: -56, xMax: 56, y: 0 },
    ledgeGrab: 58.9078,
    blastzone: { left: -175.7, right: 173.6, top: 168, bottom: -91 },
  },
  // Dream Land N64
  28: {
    id: 28,
    name: 'Dream Land N64',
    ground: { xMin: -77.2713, xMax: 77.2713, y: 0 },
    ledgeGrab: 80.1792,
    blastzone: { left: -255, right: 255, top: 250, bottom: -123 },
  },
  // Battlefield
  31: {
    id: 31,
    name: 'Battlefield',
    ground: { xMin: -68.4, xMax: 68.4, y: 0 },
    ledgeGrab: 71.3079,
    blastzone: { left: -224, right: 224, top: 200, bottom: -108.8 },
  },
  // Final Destination
  32: {
    id: 32,
    name: 'Final Destination',
    ground: { xMin: -85.5657, xMax: 85.5657, y: 0 },
    ledgeGrab: 88.4735,
    blastzone: { left: -246, right: 246, top: 188, bottom: -140 },
  },
};

export function getStageGeometry(stageId) {
  return STAGE_GEOMETRY[stageId] || null;
}

export function getStageName(stageId) {
  return STAGE_GEOMETRY[stageId]?.name ?? `Stage ${stageId}`;
}
