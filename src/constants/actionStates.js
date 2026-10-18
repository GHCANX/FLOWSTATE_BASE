// Action state constants and groupings

export const ACTION_STATES = {
  // Movement & Idle
  WAIT: 0x0E,
  DASH: 0x14,
  TURN: 0x12,
  RUN: 0x15,
  KNEE_BEND: 0x18, // Jumpsquat
  JUMP_F: 0x19,
  JUMP_B: 0x1A,
  FALL: 0x1D,
  FALL_F: 0x1E,
  FALL_B: 0x1F,
  FALL_SPECIAL: 0x23,
  LANDING_FALL_SPECIAL: 0x29, // Wavedash/waveland landing
  PASS: 0x27, // Platform drop
  TEETER: 0xF5,

  // Attack Landings (Aerial landing lag)
  AERIAL_LANDING_START: 0x46,
  AERIAL_LANDING_END: 0x4A,

  // Shield
  GUARD_ON: 0xB2,
  GUARD: 0xB3,
  GUARD_OFF: 0xB4,
  GUARD_SET_OFF: 0xB5,
  GUARD_REFLECT: 0xB6,

  // Defense / Dodges
  ROLL_F: 0xE9,
  ROLL_B: 0xEA,
  SPOT_DODGE: 0xEB,
  AIR_DODGE: 0xEC,

  // Crouch
  SQUAT: 0x0A,
  SQUAT_WAIT: 0x0B,

  // Damage / Hitstun
  DAMAGE_START: 0x4B,
  DAMAGE_END: 0x61,
  DAMAGE_FALL: 0x26, // Tumble

  // Grabs & Throws
  GRAB: 0xD4,
  DASH_GRAB: 0xD6,
  THROW_F: 0xDB,
  THROW_B: 0xDC,
  THROW_HI: 0xDD,
  THROW_LW: 0xDE,

  // Techs
  TECH_MISS_UP: 0xB7,
  TECH_MISS_DOWN: 0xBF,
  TECH_NEUTRAL: 0xC7,
  TECH_F: 0xC8,
  TECH_B: 0xC9,
  WALL_TECH: 0xCA,
  WALL_TECH_JUMP: 0xCB,
  MISSED_WALL_TECH: 0xF7,

  // Ledge
  CLIFF_CATCH: 0xFC,
  CLIFF_WAIT: 0xFD,
  CLIFF_CLIMB_SLOW: 0xFE,
  CLIFF_CLIMB_QUICK: 0xFF,
  CLIFF_ATTACK_SLOW: 0x100,
  CLIFF_ATTACK_QUICK: 0x101,
  CLIFF_ESCAPE_SLOW: 0x102,
  CLIFF_ESCAPE_QUICK: 0x103,
  CLIFF_JUMP_SLOW: 0x104,
  CLIFF_JUMP_QUICK: 0x105,

  // Attacks
  ATTACK_USMASH: 0x3F,
  ATTACK_FSMASH_START: 0x3A,
  ATTACK_FSMASH_END: 0x3E,
  ATTACK_DSMASH: 0x40,
  ATTACK_DASH: 0x32,

  // Spacie Specials
  SHINE_START: 360,
  SHINE_END: 368,
};

export function isDamage(state) {
  return (state >= ACTION_STATES.DAMAGE_START && state <= ACTION_STATES.DAMAGE_END) || state === ACTION_STATES.DAMAGE_FALL;
}

export function isShield(state) {
  return state >= ACTION_STATES.GUARD_ON && state <= ACTION_STATES.GUARD_REFLECT;
}

export function isAerialLanding(state) {
  return state >= ACTION_STATES.AERIAL_LANDING_START && state <= ACTION_STATES.AERIAL_LANDING_END;
}

export function isLedge(state) {
  return state >= ACTION_STATES.CLIFF_CATCH && state <= ACTION_STATES.CLIFF_JUMP_QUICK;
}

export function isTech(state) {
  return state >= ACTION_STATES.TECH_NEUTRAL && state <= ACTION_STATES.WALL_TECH_JUMP;
}

export function isShine(state) {
  return state >= ACTION_STATES.SHINE_START && state <= ACTION_STATES.SHINE_END;
}
