// Avatar asset registry — connects config keys → layer components/options.
// NOTE: keep the deterministic default here in sync with the backend's
// `defaultAvatarConfig` so a config-less student renders identically
// everywhere (server returns the same shape the component would derive).
import KingBase from './base/King';
import QueenBase from './base/Queen';
import KnightBase from './base/Knight';
import BishopBase from './base/Bishop';
import RookBase from './base/Rook';
import PawnBase from './base/Pawn';

import HappyFace from './faces/Happy';
import LaughFace from './faces/Laugh';
import WinkFace from './faces/Wink';
import SurprisedFace from './faces/Surprised';
import SleepyFace from './faces/Sleepy';
import DeterminedFace from './faces/Determined';
import CoolFace from './faces/Cool';
import ShyFace from './faces/Shy';

import NoneAccessory from './accessories/None';
import PartyHatAccessory from './accessories/PartyHat';
import HeadphonesAccessory from './accessories/Headphones';
import BandanaAccessory from './accessories/Bandana';
import ScarfAccessory from './accessories/Scarf';
import HaloAccessory from './accessories/Halo';
import PropellerAccessory from './accessories/Propeller';
import CrownAccessory from './accessories/Crown';

export const PIECE_OPTIONS = [
  { value: 'king', label: 'King', icon: '♔', Comp: KingBase },
  { value: 'queen', label: 'Queen', icon: '♕', Comp: QueenBase },
  { value: 'knight', label: 'Knight', icon: '♘', Comp: KnightBase },
  { value: 'bishop', label: 'Bishop', icon: '♗', Comp: BishopBase },
  { value: 'rook', label: 'Rook', icon: '♖', Comp: RookBase },
  { value: 'pawn', label: 'Pawn', icon: '♙', Comp: PawnBase },
];

export const FACE_OPTIONS = [
  { value: 'happy', label: 'Smile', Comp: HappyFace },
  { value: 'laugh', label: 'Laugh', Comp: LaughFace },
  { value: 'wink', label: 'Wink', Comp: WinkFace },
  { value: 'surprised', label: 'Whoa!', Comp: SurprisedFace },
  { value: 'sleepy', label: 'Sleepy', Comp: SleepyFace },
  { value: 'determined', label: 'Focus', Comp: DeterminedFace },
  { value: 'cool', label: 'Shades', Comp: CoolFace },
  { value: 'shy', label: 'Blush', Comp: ShyFace },
];

export const ACCESSORY_OPTIONS = [
  { value: 'none', label: 'None', Comp: NoneAccessory },
  { value: 'partyHat', label: 'Party hat', Comp: PartyHatAccessory },
  { value: 'headphones', label: 'Headphones', Comp: HeadphonesAccessory },
  { value: 'bandana', label: 'Bandana', Comp: BandanaAccessory },
  { value: 'scarf', label: 'Scarf', Comp: ScarfAccessory },
  { value: 'halo', label: 'Halo', Comp: HaloAccessory },
  { value: 'propeller', label: 'Propeller', Comp: PropellerAccessory },
  { value: 'crown', label: 'Crown', Comp: CrownAccessory },
];

export const BODY_COLORS = [
  { value: '#e74c3c', label: 'Red', text: '#ffffff' },
  { value: '#f1c40f', label: 'Gold', text: '#3d2c1e' },
  { value: '#60a5fa', label: 'Green', text: '#3d2c1e' },
  { value: '#4a90d9', label: 'Blue', text: '#ffffff' },
  { value: '#9b59b6', label: 'Purple', text: '#ffffff' },
  { value: '#e91e63', label: 'Pink', text: '#ffffff' },
  { value: '#ff8c42', label: 'Orange', text: '#3d2c1e' },
  { value: '#1abc9c', label: 'Teal', text: '#3d2c1e' },
  { value: '#2b2b2b', label: 'Black', text: '#ffffff' },
  { value: '#f2f0e6', label: 'White', text: '#3d2c1e' },
];

export const BACKGROUND_OPTIONS = [
  { value: '#ffd966', label: 'Sunny' },
  { value: '#b6e3f4', label: 'Sky' },
  { value: '#d0f4de', label: 'Mint' },
  { value: '#fde2e4', label: 'Blush' },
  { value: '#e8d5f5', label: 'Lilac' },
  { value: '#fff3b0', label: 'Cream' },
  { value: 'gradient-sunset', label: 'Sunset' },
  { value: 'gradient-ocean', label: 'Ocean' },
];

export const PIECE_MAP = Object.fromEntries(PIECE_OPTIONS.map((o) => [o.value, o]));
export const FACE_MAP = Object.fromEntries(FACE_OPTIONS.map((o) => [o.value, o]));
export const ACCESSORY_MAP = Object.fromEntries(ACCESSORY_OPTIONS.map((o) => [o.value, o]));
export const BACKGROUND_MAP = Object.fromEntries(BACKGROUND_OPTIONS.map((o) => [o.value, o]));
export const BODY_COLOR_MAP = Object.fromEntries(BODY_COLORS.map((o) => [o.value, o]));

const PIECES = PIECE_OPTIONS.map((o) => o.value);
const FACES = FACE_OPTIONS.map((o) => o.value);
const ACCESSORIES = ACCESSORY_OPTIONS.map((o) => o.value);
const BACKGROUNDS = BACKGROUND_OPTIONS.map((o) => o.value);
const COLORS = BODY_COLORS.map((o) => o.value);

/** Small deterministic hash so a given seed always maps to the same config. */
function hashSeed(seed) {
  let h = 0;
  for (let i = 0; i < String(seed || 'student').length; i++) {
    h = (h * 31 + String(seed || 'student').charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export const DEFAULT_PIECES = PIECES;
export const DEFAULT_FACES = FACES;
export const DEFAULT_ACCESSORIES = ACCESSORIES;
export const DEFAULT_BACKGROUNDS = BACKGROUNDS;
export const DEFAULT_COLORS = COLORS;

/** Deterministic default so the same student always gets the same starter look. */
export function defaultChessConfig(seed) {
  const h = hashSeed(seed);
  const step = (n) => Math.floor(h / (1 << n)) % 100000;
  return {
    basePiece: PIECES[step(0) % PIECES.length],
    bodyColor: COLORS[step(3) % COLORS.length],
    face: FACES[step(5) % FACES.length],
    accessory: ACCESSORIES[step(7) % ACCESSORIES.length],
    background: BACKGROUNDS[step(9) % BACKGROUNDS.length],
  };
}

export function randomChessConfig() {
  const i = (arr) => arr[Math.floor(Math.random() * arr.length)];
  return {
    basePiece: i(PIECES),
    bodyColor: i(COLORS),
    face: i(FACES),
    accessory: i(ACCESSORIES),
    background: i(BACKGROUNDS),
  };
}

/** Shared defaults used when a config field is missing entirely. */
export const DEFAULT_CONFIG = defaultChessConfig('student');