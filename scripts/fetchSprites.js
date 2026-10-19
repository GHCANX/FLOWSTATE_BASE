#!/usr/bin/env node
/**
 * Melee Move Sprite Downloader and Cache Manager.
 * Downloads authentic frame data GIFs from FightCore (i.fightcore.gg)
 * into FlowState's local sprite library (src/ui/assets/sprites/).
 *
 * Usage:
 *   node scripts/fetchSprites.js --char fox --move shine
 *   node scripts/fetchSprites.js --char marth --all
 *   node scripts/fetchSprites.js --update-manifest
 */

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SPRITES_DIR = path.resolve(__dirname, '../src/ui/assets/sprites');
const MANIFEST_PATH = path.join(SPRITES_DIR, 'manifest.json');

export const CHARACTER_SLUGS = {
  captainfalcon: 'captainfalcon',
  captain_falcon: 'captainfalcon',
  falcon: 'captainfalcon',
  donkeykong: 'donkeykong',
  dk: 'donkeykong',
  fox: 'fox',
  mrgameandwatch: 'mrgame%26watch',
  gameandwatch: 'mrgame%26watch',
  gnw: 'mrgame%26watch',
  kirby: 'kirby',
  bowser: 'bowser',
  link: 'link',
  luigi: 'luigi',
  mario: 'mario',
  marth: 'marth',
  mewtwo: 'mewtwo',
  ness: 'ness',
  peach: 'peach',
  pikachu: 'pikachu',
  iceclimbers: 'iceclimbers',
  ics: 'iceclimbers',
  jigglypuff: 'jigglypuff',
  puff: 'jigglypuff',
  samus: 'samus',
  yoshi: 'yoshi',
  zelda: 'zelda',
  sheik: 'sheik',
  falco: 'falco',
  younglink: 'younglink',
  yl: 'younglink',
  drmario: 'drmario',
  doc: 'drmario',
  roy: 'roy',
  pichu: 'pichu',
  ganondorf: 'ganondorf',
  ganon: 'ganondorf',
};

export const MOVE_ALIASES = {
  shine: 'downb',
  reflector: 'downb',
  laser: 'neutralb',
  blaster: 'neutralb',
  knee: 'fair',
  stomp: 'dair',
  rest: 'downb',
  turnip: 'downb',
  needles: 'neutralb',
  charge_shot: 'neutralb',
  missile: 'sideb',
  falcon_punch: 'neutralb',
  raptor_boost: 'sideb',
  fire_fox: 'upb',
  fire_bird: 'upb',
  dolphin_slash: 'upb',
};

export const COMMON_MOVES = [
  'jab1', 'jab2', 'dashattack',
  'ftilt', 'utilt', 'dtilt',
  'fsmash', 'usmash', 'dsmash',
  'nair', 'fair', 'bair', 'uair', 'dair',
  'neutralb', 'sideb', 'upb', 'downb'
];

/**
 * Download a sprite GIF from FightCore CDN
 * @param {string} char
 * @param {string} move
 * @returns {Promise<string>} local file path
 */
export function fetchSprite(char, move) {
  const charKey = char.toLowerCase().replace(/[^a-z0-9_&%]/g, '');
  const fcSlug = CHARACTER_SLUGS[charKey] || charKey;
  const canonicalMove = MOVE_ALIASES[move.toLowerCase()] || move.toLowerCase();

  const charDir = path.join(SPRITES_DIR, charKey);
  fs.mkdirSync(charDir, { recursive: true });
  const localFile = path.join(charDir, `${move}.gif`);

  // If already exists, return immediate path
  if (fs.existsSync(localFile) && fs.statSync(localFile).size > 1000) {
    return Promise.resolve(localFile);
  }

  const url = `https://i.fightcore.gg/beta/${fcSlug}/${canonicalMove}.gif`;

  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) {
        return reject(new Error(`FightCore returned HTTP ${res.statusCode} for ${url}`));
      }
      const stream = fs.createWriteStream(localFile);
      res.pipe(stream);
      stream.on('finish', () => {
        stream.close();
        updateManifestEntry(charKey, move, canonicalMove, url);
        resolve(localFile);
      });
      stream.on('error', reject);
    }).on('error', reject);
  });
}

function updateManifestEntry(char, alias, canonicalMove, remoteUrl) {
  let manifest = { characters: {} };
  if (fs.existsSync(MANIFEST_PATH)) {
    try {
      manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
    } catch {
      // keep fallback
    }
  }
  if (!manifest.characters) manifest.characters = {};
  if (!manifest.characters[char]) manifest.characters[char] = { moves: {} };
  manifest.characters[char].moves[alias] = {
    name: alias.toUpperCase(),
    move: canonicalMove,
    url: `/assets/sprites/${char}/${alias}.gif`,
    remoteUrl,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

// Standalone CLI runner
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const charIdx = args.indexOf('--char');
  const moveIdx = args.indexOf('--move');
  const targetChar = charIdx !== -1 ? args[charIdx + 1] : 'fox';
  const targetMove = moveIdx !== -1 ? args[moveIdx + 1] : 'shine';

  console.log(`⚡ Fetching sprite: ${targetChar} ${targetMove}...`);
  fetchSprite(targetChar, targetMove)
    .then(f => console.log(`✔ Downloaded to: ${f}`))
    .catch(err => console.error(`✖ Failed: ${err.message}`));
}
