import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as S from './sprites';
import {
  TILE_CH,
  TILE_LN,
  MAP_W,
  MAP_H,
  GROUND_W,
  GROUND_H,
  genLandLayers,
  OCEAN_BASE,
  OCEAN_SHALLOW,
  oceanCaustics,
  OCEAN_CFG,
  SHORE_FRAMES,
  SHORE_CFG,
  isWater,
  STRUCT_ENTS,
  wildSpawns,
  PLAYER_SPAWN,
  PLAYER_T,
  PLAYER_SCALE,
  footprint,
  collisionBox,
  entityBlocksTile,
  tileBoxesOverlap,
  near,
  nearestIsland,
  visualTerrainColorAt,
  spriteTiles,
  PALM_SCALE,
  GARDEN_BED_SCALE,
} from './world';
import type { Ent, ItemType, EntityKind } from './world';
import {
  getFunFact,
  getPrice,
  getShopStock,
  getMitchyLine,
  CATEGORIES,
  universalToken,
  TOKENS_PER_DAY,
} from './llm';
import type { Category, ShopItem, OwnedItem } from './llm';
import type { TextureModifier } from './craft';
import { isCosmetic, type ItemFunction } from './craft/functions';
import {
  GARDEN_HOME,
  gardenAt,
  gardenBlocks,
  inGarden,
  createCrop,
  cropStatus,
  advanceStage,
  slotSprite,
  tileDist,
  NO_EFFECT,
  EMPTY_SLOT,
  PLANTABLE_BASE,
} from './farm';
import type { PlantedCrop, Doors, DoorId, SlotEffect, GardenPlot } from './farm';
import {
  defaultTimeConfig,
  worldTime,
  hourSeedOf,
  growthWindowOf,
  formatWorldTime,
  isNightOf,
  daySeedOf,
  HOUR_MS,
} from './time';
import type { TimeConfig } from './time';
import { loadSave, writeSave, parseSave, downloadSaveFile, deleteSave } from './save';
import type { SaveState } from './save';
import { describeInteraction, runInteraction } from './interact';
import type { InteractRef, InteractCtx, InteractActions } from './interact';
import { applyOutfit, recolorGarment, DEFAULT_SHORTS_HEX, DEFAULT_SHIRT_HEX, HOUSE_GARMENT_REGIONS } from './outfit';
import type { Outfit } from './outfit';
import { SunIcon, MoonIcon, CoinIcon, SaveIcon } from './icons';
// The three orbit-menu icons are glyph-art SVGs (a grid of coloured <text>
// cells, same shape as the game's own assets/svg exports), not line-art like
// icons.tsx's set — so they're asset imports rather than inline components.
import gearIcon from './assets/gear.svg';
import inventoryIcon from './assets/inventory.svg';
import handSlotIcon from './assets/hand_slot.svg';
import { ColoredSprite } from './ColoredSprite';
import { useLayoutTool } from './devLayout';
import { useWorldAssetTool } from './devWorldAssets';
import { useSceneMarkerTool } from './devSceneMarkers';
import { useIntroNarrationTool } from './devIntroNarration';
import { MARKER_REGISTRY, getMarkerPosition } from './sceneMarkers';
import { DevAssetPanel } from './DevAssetPanel';
import DialogueBox from './DialogueBox';
import type { DialogueLine } from './DialogueBox';
import NameEntryPanel from './NameEntryPanel';
import Letterbox from './Letterbox';
import IntroA, { type IntroAHandle } from './IntroA';
import GameMap from './GameMap';
import type { MapCharacterEntry } from './GameMap';
import {
  MARKER_PLAYER_START,
  MARKER_MITCHY_START,
  MARKER_MITCHY_EXIT,
  BLACK_SCREEN_MS,
  EYE_OPEN_MS,
  MITCHY_JUMP_MS,
  POST_EXIT_DELAY_MS,
  LETTERBOX_TRANSITION_MS,
  MITCHY_ENTRANCE_SPEED,
  MITCHY_EXIT_SPEED,
  MITCHY_JUMP_HEIGHT_EM,
  MITCHY_ENTRANCE_OFFSET,
  UNKNOWN_SPEAKER,
  WAKE_LINE,
  MITCHY_INTRO_LINES,
  MITCHY_POST_NAME_LINES,
  TUTORIAL_CHOICES,
  CHOICE_EXPLORE_LINES,
  DEPARTURE_LINES,
  MITCHY_NAME,
  MAP_KEY,
  MAP_HINT_VISIBLE_MS,
  DEFAULT_PLAYER_NAME,
  substitutePlayerName,
} from './introPartB';
import { screenToTile } from './coords';
import { ownedToPlaced, placedToOwned, placedToEnt, placementFits } from './placement';
import type { PlacedItem } from './placement';
import { palmFrame, bundleLandingX, SHAKE_FRAMES, SHAKE_FRAME_MS, SHAKE_MS } from './palmAnim';
import { pondFrame, POND_FRAME_MS } from './pondAnim';
import CraftModal from './CraftModal';

const INTRO_TEXT =
  "Hey, are u the new villager here? I'm Mitchy and own this shop. in this world u can go around and collect materials and if u give them back to me ill pay u fair.";

const TALK_LINES = [
  'purrr... nice weather today, huh?',
  'shake the date palm. trust me.',
  'i buy almost anything. ALMOST.',
  'being a shopkeeper cat is honest work.',
  'flowers sell well this season.',
];

// Mitchy's tip the first time you pick Talk.
const TOKEN_LINE =
  'did u already try buying craft tokens with ur hard-earned money? i got a few options. If u want come around!';

// Playable characters. More can be added later; the profile circle in the
// header always renders the face of the currently selected character.
// `face`/`faceColors` are the head portion of the sprite (hat down to the
// chin) — the shirt/overalls rows below aren't part of a face portrait.
type Character = {
  id: string;
  name: string;
  sprite: string[];
  colors: string[];
  palette: Record<string, string>;
  face: string[];
  faceColors: string[];
  shirtMask?: string[];
  shortsMask?: string[];
};
const CHARACTERS: Character[] = [
  {
    id: 'villager',
    name: 'Villager',
    sprite: S.PLAYER,
    colors: S.PLAYER_COLORS,
    palette: S.PLAYER_PALETTE,
    shirtMask: S.PLAYER_SHIRT_MASK,
    shortsMask: S.PLAYER_SHORTS_MASK,
    // The HUD circle only ever shows the vertically-CENTRED ~17 rows of
    // whatever's passed here (.hud-avatar pre is 6px/row, the circle is
    // 104px — see styles.css). Checked against a rendered PNG of the
    // straw-hat-v4 reference: there's no separate "face" region to crop to —
    // the wide brim IS most of the portrait, with only a sliver of visible
    // skin below it before a dotted blouse collar starts (~row 29 of 38).
    // Passing the FULL sprite centres the visible window on that brim/skin
    // boundary (~row 19), which reads as hat-plus-a-hint-of-face without
    // dipping into the dotted collar below.
    face: S.PLAYER,
    faceColors: S.PLAYER_COLORS,
  },
];

const ITEM_INFO: Record<ItemType, { name: string; desc: string }> = {
  flower: { name: 'Wildflower', desc: 'A messy bunch of meadow blooms.' },
  stone: { name: 'Stone', desc: 'A small, satisfyingly smooth rock.' },
  date: { name: 'Dates', desc: 'A sticky-sweet bunch, freshly shaken off a palm.' },
  cactus: { name: 'Cactus', desc: 'A prickly little desert survivor.' },
  fern: { name: 'Fern', desc: 'A feathery frond from the deep jungle.' },
  iceflower: { name: 'Ice Flower', desc: 'A frost-hardened bloom from the tundra.' },
};

const ITEM_SPRITES: Record<ItemType, string[]> = {
  flower: S.FLOWER,
  stone: S.STONE,
  date: S.DATE_FRUIT,
  cactus: S.CACTUS,
  fern: S.FERN,
  iceflower: S.ICEFLOWER,
};

const ITEM_TYPES: ItemType[] = ['flower', 'stone', 'date', 'cactus', 'fern', 'iceflower'];

// The translated modifiers, in words. The model's own narrative already sits
// in funcDesc; this is the honest mechanical readout underneath it, so a
// player can tell a real effect from flavour text.
const BEHAVIOR_WORDS: Record<string, string> = {
  water_area: 'waters nearby crops',
  harvest_area: 'harvests nearby ripe crops',
  grant_coins: 'earns a few coins',
};

function describeEffect(fn: ItemFunction): string {
  const m = fn.modifiers;
  const bits: string[] = [];
  if (m.growMsModifier < 0) bits.push(`crops grow ${Math.round(-m.growMsModifier * 100)}% faster`);
  if (m.growMsModifier > 0) bits.push(`crops grow ${Math.round(m.growMsModifier * 100)}% slower`);
  if (m.waterRetentionMult > 1) bits.push(`stay watered ${m.waterRetentionMult.toFixed(1)}x longer`);
  if (m.yieldBonus > 0) bits.push(`+${m.yieldBonus} per harvest`);
  if (fn.behavior) bits.push(BEHAVIOR_WORDS[fn.behavior.action] ?? 'acts on its own');
  const range = m.radiusTiles === 0 ? 'the bed it sits on' : `${m.radiusTiles} tiles around it`;
  return bits.length > 0 ? `${bits.join(', ')} — within ${range}.` : 'purely decorative.';
}

const emptyInv = (): Record<ItemType, number> =>
  Object.fromEntries(ITEM_TYPES.map((t) => [t, 0])) as Record<ItemType, number>;

// collect()'s inventory key for a given entity kind — identity for every
// gatherable whose EntityKind already IS its ItemType, except flowerplus:
// that kind stays distinct from the plain ItemType 'flower' because its
// entity needs its own CSS (.ent.flowerplus, the block-glyph perCell fix —
// see sprites.ts) and its own decorative sprite/placement in world.ts, but
// it collects into the SAME 'flower' inventory slot/sell price as any other
// wildflower rather than needing a whole second catalog entry for one more
// bloom shape.
const COLLECT_AS: Partial<Record<EntityKind, ItemType>> = { flowerplus: 'flower' };

// The player-rig's stacking order is fixed, not row-sorted like every other
// entity (see the ColoredSprite map's `zIndex: footprint(e).row` and the
// bridge's own `+ 1000` bump) — the player should never be tucked BEHIND a
// tree, building or bridge it's standing in front of just because that
// entity's footprint row happens to be numerically later. Comfortably above
// the bridge's own max (`row + 1000`, and MAP_H tops out well under 1000
// rows anyway), so nothing in the world can ever out-rank it.
const PLAYER_Z_INDEX = 100000;

// Held-key movement: one tile step per interval while a direction is held.
// Walking is deliberately unhurried; holding Shift dashes at the fast pace.
const WALK_MS = 170;
const DASH_MS = 100;
// How long you need to hold a direction into a placed item before it slides.
const PUSH_HOLD_MS = 1000;
// ---- caps on placed-item behaviors (see the trigger effect below) --------
// The world clock ticks once a second; nothing an item does may run at that
// rate. One fire per item per cooldown, and coins are capped for the whole
// day across every item — 40/day can fund two of the three daily tokens, so
// a coin-granting gadget is a bonus, never a replacement for farming.
const ITEM_COOLDOWN_MS = 30_000;
const COINS_PER_GRANT = 2;
const DAILY_COIN_CAP = 40;

// How long the Ctrl+S "Saving…" indicator stays up (and movement/interact
// stay locked). writeSave() itself is a synchronous localStorage.setItem —
// effectively instant — so this is purely cosmetic: long enough to read as
// "a thing happened," short enough not to feel like lag. The CSS animation
// duration (styles.css, .hud-tc) is matched to this exact value.
const SAVE_INDICATOR_MS = 550;
// How much earlier than a full WALK_MS/DASH_MS the very first left/right step
// off idle fires, so it lands safely before that direction's walk-frame timer
// flips off frame 1 (see freshStartDirRef in the component below) instead of
// racing it. Comfortably under either interval without shortening the pause
// enough to feel snappier.
const FRESH_START_FRAME_MARGIN_MS = 30;
// step cadence + transition are multiplied by this while gliding along a
// collider, so wall-hugging is noticeably gentler than open-field movement
const GLIDE_SLOW = 1.75;
// Physical shape of one character cell in this font (established tuning the
// generated assets: a line is ~1.667x the width of a character). A tile is
// TILE_CH chars wide but TILE_LN lines tall, so a vertical-only step and a
// diagonal step cover MORE true pixels than a horizontal one — without this,
// they'd finish in the exact same fixed duration and so visibly move at a
// different true speed (diagonals fastest, vertical slowest). speedScale()
// below normalizes every direction to the horizontal case's true px/sec.
const CELL_ASPECT = 14 / 8.4;
function speedScale(dx: number, dy: number): number {
  if (!dx && !dy) return 1;
  const dist = Math.hypot(dx * TILE_CH, dy * TILE_LN * CELL_ASPECT);
  return dist / TILE_CH;
}
const DIRS: Record<string, [number, number]> = {
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
};

// One entry per held-key walk direction — see walkDir/walkAnim in Game().
const WALK_CYCLES = {
  up: { frames: S.WALK_UP_FRAMES, palette: S.WALK_UP_PALETTE, padTop: S.WALK_UP_PAD_TOP },
  down: { frames: S.WALK_DOWN_FRAMES, palette: S.WALK_DOWN_PALETTE, padTop: S.WALK_DOWN_PAD_TOP },
  left: { frames: S.WALK_LEFT_FRAMES, palette: S.WALK_LEFT_PALETTE, padTop: S.WALK_LEFT_PAD_TOP },
  right: { frames: S.WALK_RIGHT_FRAMES, palette: S.WALK_RIGHT_PALETTE, padTop: S.WALK_RIGHT_PAD_TOP },
} as const;

// Per-direction multiplier on the walk-FRAME interval only (see the effect
// below) — purely cosmetic leg cadence, independent of how fast the character
// actually crosses tiles (that's still WALK_MS/DASH_MS everywhere). <1 cycles
// the frames faster than the tile-step pace; 1 keeps them in lockstep. Down's
// 4-frame bake (see WALK_DOWN's comment in sprites.ts) reads a little
// sluggish at the normal cadence, so it's nudged up; the others are untouched.
const WALK_FRAME_SPEED: Record<'up' | 'down' | 'left' | 'right', number> = {
  up: 1,
  down: 1,
  left: 1,
  right: 1,
};

const STORAGE_SLOTS = 5;

// ---------------------------------------------------------------------------
// HUD geometry. Proportions taken from the design sketch and kept in ONE place
// (CSS reads the sizes back out as custom properties), so the whole planetary
// menu rescales from these four numbers:
//   sketch: avatar 145, button 70 (0.48x), orbit radius ~228 (3.17x avatar-r),
//           buttons at -81 / -36 / +14 degrees.
// ---------------------------------------------------------------------------
const HUD_AVATAR = 104; // avatar diameter (px)
const HUD_BTN = 50; //     orbit button diameter (px)
const ORBIT_R = 165; //    orbit radius, avatar centre -> button centre (px)
const ORBIT_ANGLES = [-80, -36, 14]; // degrees, 0 = right, negative = up

const rad = (deg: number) => (deg * Math.PI) / 180;
const ORBIT_POS = ORBIT_ANGLES.map((a) => ({
  x: Math.cos(rad(a)) * ORBIT_R,
  y: Math.sin(rad(a)) * ORBIT_R,
}));

// Arc connectors between consecutive buttons. Each segment is pulled in by the
// angular half-width of a button (plus a little air) so the dashes stop at the
// rims instead of running underneath them.
const ORBIT_BOX = 2 * (ORBIT_R + HUD_BTN); // svg is centred on the avatar
const ORBIT_C = ORBIT_BOX / 2;
const ORBIT_VIEWBOX = `0 0 ${ORBIT_BOX} ${ORBIT_BOX}`;
const ARC_GAP = (Math.asin((HUD_BTN / 2 + 7) / ORBIT_R) * 180) / Math.PI;
const ORBIT_ARCS = ORBIT_ANGLES.slice(0, -1).map((a, i) => {
  const from = a + ARC_GAP;
  const to = ORBIT_ANGLES[i + 1] - ARC_GAP;
  const p = (deg: number) =>
    `${ORBIT_C + Math.cos(rad(deg)) * ORBIT_R} ${ORBIT_C + Math.sin(rad(deg)) * ORBIT_R}`;
  return `M ${p(from)} A ${ORBIT_R} ${ORBIT_R} 0 0 1 ${p(to)}`;
});


// Reference camera viewport in world units (ch / lines) — the "design view".
// It is fitted to the screen with a COVER rule: scaled up until it covers the
// whole viewport, cropping whatever overflows on the longer axis. So every
// player sees the same amount of world (never more), the game always runs
// edge-to-edge, and no black letterbox bars are ever drawn.
const VIEW_W = 112;
const VIEW_H = 40;
const MAX_ZOOM = 1;
// Zoom is MULTIPLICATIVE (z *= e^(-delta*k)) rather than a fixed +/- step, so
// each notch changes the view by the same PERCENTAGE at any zoom level — that
// is what makes it feel even instead of accelerating as you zoom out. The
// raw wheel delta is used (not Math.sign), so a trackpad's small deltas give
// fine control and a mouse notch a bigger jump, naturally.
const ZOOM_SENSITIVITY = 0.0018; // ~17% per 100px notch
const ZOOM_MS = 110; // tween length for the camera transform
// One frame of the shop cat's slow blink. Deliberately slow — the whole read of
// a cat's slow blink is that it is unhurried; drop this much below ~700ms and
// it stops looking affectionate and starts looking like a twitch.
const CAT_BLINK_MS = 1000;
// Each wheel notch pulls the world point under the cursor this far toward the
// screen CENTRE, so a few notches bring whatever you pointed at to the middle
// (1 = jump straight there, 0 = ignore the mouse entirely).
const ZOOM_RECENTRE = 0.45;
const RECENTRE_MS = 280; // glide back to the player (Space / double-tap)

// Follow a focus point, clamped to the map edges. When the viewport is LARGER
// than the map on an axis (possible on very wide/short screens), there's
// nothing to scroll — centre the map on that axis instead of letting the
// clamp go negative and shove it against one side.
const clampCam = (focus: number, view: number, ground: number) =>
  view >= ground ? (ground - view) / 2 : Math.min(Math.max(focus - view / 2, 0), ground - view);

type StorEntry = { where: 'store' | 'inv'; item: ItemType };

// Selectable items in the storage modal: chest items first, then inventory.
function storageList(
  storage: Record<ItemType, number>,
  inv: Record<ItemType, number>,
): StorEntry[] {
  return [
    ...ITEM_TYPES.filter((t) => storage[t] > 0).map((item) => ({ where: 'store' as const, item })),
    ...ITEM_TYPES.filter((t) => inv[t] > 0).map((item) => ({ where: 'inv' as const, item })),
  ];
}

type Offer = {
  item: ItemType;
  price: number | null;
  sel: number;
  declined: boolean;
};

type Modal =
  // equipPick: opened from the hand slot's "Equip" — non-equippable slots are
  // greyed out and a click equips instead of opening details.
  | { t: 'inventory'; equipPick?: boolean }
  | { t: 'settings' }
  | { t: 'detail'; item: ItemType }
  | { t: 'detailOwned'; ownedId: string; sel: number }
  | { t: 'dialog'; sel: number }
  | {
      t: 'shop';
      tab: 'sell' | 'buy';
      cat: Category;
      offer: Offer | null;
      pick: ItemType | null;
      confirm: ShopItem | null;
      csel: number;
      poor: boolean;
      limited?: boolean; // tried to buy a token after today's 3 are gone
    }
  // carry the whole token object (not just its id) so the modal survives the
  // token being consumed into an item during the success→folded flow
  | { t: 'craft'; token: OwnedItem; confirmClose?: boolean }
  | { t: 'houseMenu'; sel: number }
  | { t: 'storage'; slot: number; sel: number; menuOpen: boolean }
  | { t: 'crop'; slot: number }
  // Universal click-to-interact confirm (see interact.ts) — replaces the old
  // proximity `[F]` dispatch for every collectible/palm/cat/shop/house/
  // laundry/crop/garden-door interaction.
  | { t: 'interact'; ref: InteractRef; sel: number }
  | null;

const FRESH_SHOP: Modal = {
  t: 'shop',
  tab: 'sell',
  cat: 'plant',
  offer: null,
  pick: null,
  confirm: null,
  csel: 0,
  poor: false,
};

type Bubble = { text: string; width: number } | null;

export default function App() {
  const [started, setStarted] = useState(false);
  return started ? <Game /> : <Landing onStart={() => setStarted(true)} />;
}

function Landing({ onStart }: { onStart: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Computed once at mount — Landing only ever shows before Game exists, so
  // there's no live game state to react to here, just whatever's already in
  // localStorage from a previous session.
  const [hasSave] = useState(() => loadSave() !== null);
  // New Game is destructive (deletes the persistent save), so it's gated
  // behind an explicit confirmation rather than firing on the first click.
  const [confirmNewGame, setConfirmNewGame] = useState(false);

  function handleUploadFile(file: File) {
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseSave(String(reader.result));
      if (!parsed) {
        setError('Not a valid save file.');
        return;
      }
      writeSave(parsed);
      onStart();
    };
    reader.onerror = () => setError('Could not read that file.');
    reader.readAsText(file);
  }

  function handleExport() {
    const s = loadSave();
    if (s) downloadSaveFile(s);
  }

  // Deletes ONLY the gameplay save (see save.ts's deleteSave — never
  // localStorage.clear(), so Scene Markings/devWorldAssets/dev layout and
  // every other piece of developer/editor persistence survive untouched),
  // then starts a genuinely fresh runtime game. Nothing writes a new save
  // to localStorage here — the new game stays unsaved until the player
  // explicitly uses Settings -> Save Game, so Intro Part B (gated on
  // SaveState.introDone) correctly runs again.
  function handleStartNewGame() {
    deleteSave();
    setConfirmNewGame(false);
    onStart();
  }

  return (
    <div className="landing">
      <pre className="title">{S.TITLE.join('\n')}</pre>
      <div className="subtitle">a tiny monochrome bay</div>
      {hasSave ? (
        <div className="landing-primary-row">
          <button className="start" onClick={onStart}>
            [ CONTINUE ]
          </button>
          <button className="landing-save-btn" onClick={() => setConfirmNewGame(true)}>
            New Game
          </button>
        </div>
      ) : (
        <button className="start" onClick={onStart}>
          [ START ]
        </button>
      )}
      <div className="landing-save-row">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="landing-file-input"
          onChange={(e) => e.target.files?.[0] && handleUploadFile(e.target.files[0])}
        />
        <button className="landing-save-btn" onClick={() => fileRef.current?.click()}>
          Upload Save
        </button>
        <button className="landing-save-btn" onClick={handleExport} disabled={!hasSave}>
          Export Save
        </button>
      </div>
      {error && <div className="landing-save-error">{error}</div>}

      {confirmNewGame && (
        <div className="overlay" onClick={() => setConfirmNewGame(false)}>
          <div className="panel detail-panel" onClick={(e) => e.stopPropagation()}>
            <div className="panel-title">Start a new game?</div>
            <p className="detail-desc">
              Your current saved game will be deleted and you will start again from the beginning.
            </p>
            <div className="landing-confirm-row">
              <button className="btn btn-secondary" onClick={() => setConfirmNewGame(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleStartNewGame}>
                Start New Game
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Synchronous marker lookup for Intro Part B — sceneMarkers.json is a static
// import, so all three positions (or the fact that one's missing) are known
// before the very first render, letting Game()'s initial state (player
// position, `cinematic`, `blackout`) start correct immediately instead of
// flashing one frame of normal gameplay before a mount effect catches up.
function readIntroBMarkers(): {
  playerStart: { x: number; y: number };
  mitchyStart: { x: number; y: number };
  mitchyExit: { x: number; y: number };
} | null {
  const ps = getMarkerPosition(MARKER_PLAYER_START);
  const ms = getMarkerPosition(MARKER_MITCHY_START);
  const me = getMarkerPosition(MARKER_MITCHY_EXIT);
  if (!ps.found || !ms.found || !me.found) return null;
  return {
    playerStart: { x: ps.x!, y: ps.y! },
    mitchyStart: { x: ms.x!, y: ms.y! },
    mitchyExit: { x: me.x!, y: me.y! },
  };
}

function Game() {
  // load once; all initial state comes from the save blob when present
  const [saved] = useState<SaveState | null>(loadSave);
  // The unified intro (18 stages: laptop/MYLL prologue -> wake up on the
  // island -> meet Mitchy) auto-triggers for a brand-new save, per spec: no
  // reload, no separate start button, no manual action anywhere in the
  // middle of it — it's ONE continuous sequence from stage 1 to stage 18.
  // "Part A"/"Part B" were only ever names used during development for two
  // sections that got built separately before being unified here; there is
  // only one trigger decision point now. (During earlier debugging this was
  // temporarily forced off — an unrelated ?introB=1 URL-param experiment and
  // a stray second dev server process were both making it hard to tell real
  // bugs from environment noise. Both are resolved now; this is back to the
  // spec'd always-on behavior.)
  const INTRO_AUTO_TRIGGER = true;
  // Whether the intro should run THIS mount: only when auto-trigger is on
  // (see above), and only for either a brand-new save (no save at all yet)
  // or an EXISTING save that was interrupted mid-intro (introDone explicitly
  // false — a reload landed between the intro starting and finishing). An
  // already-completed save (introDone undefined/true) never re-runs it.
  // Getting the saved-vs-pending check wrong previously meant: any save at
  // all forced `introBMarkersAtMount` to null regardless of introDone, so a
  // reload mid-cinematic rendered one frame of full normal gameplay
  // (Mitchy at his static STRUCT_ENTS spot near the house, no blackout)
  // before the mount effect below caught up and restarted the cinematic —
  // exactly the "flash of the wrong scene, then black again" glitch. This
  // logic is kept intact (just gated off) so re-enabling later is a
  // one-line change, not a rewrite.
  const introPending = INTRO_AUTO_TRIGGER && (saved ? saved.introDone === false : true);
  // Computed once, synchronously, at mount — every marker present, given
  // the above. Read again (fresh) inside the mount effect below, since a
  // DEV replay re-triggers it later in the session when this initial value
  // is long stale.
  const [introBMarkersAtMount] = useState(() => (introPending ? readIntroBMarkers() : null));
  // Stage 1-14 (the old HTML-prototype "laptop/MYLL prologue" stages) run
  // BEFORE stage 15's wake-up cinematic — see the <IntroA/> render below and
  // the runIntro-triggering effect further down, which is gated on this
  // being false so the wake-up cinematic never starts underneath the early
  // stages. Starts true exactly when the whole intro is pending; flips to
  // false once IntroA calls its onComplete.
  const [introAActive, setIntroAActive] = useState(introPending);
  const introARef = useRef<IntroAHandle>(null);
  const timeCfgRef = useRef<TimeConfig>(
    saved
      ? { anchor: saved.anchor, anchorReal: saved.anchorReal, timeScale: saved.timeScale }
      : defaultTimeConfig(),
  );

  const [player, setPlayer] = useState(() => {
    // The intro is about to run (fresh save OR resuming mid-intro after an
    // interrupted reload, see introPending above) — start at PLAYER START,
    // not wherever the save/spawn would otherwise put them, so the player
    // never visibly "jumps" there once stage 15's cinematic begins.
    if (introBMarkersAtMount) return introBMarkersAtMount.playerStart;
    if (saved) {
      return {
        x: Math.min(Math.max(0, saved.player.x), MAP_W - PLAYER_T.wT),
        y: Math.min(Math.max(0, saved.player.y), MAP_H - PLAYER_T.hT),
      };
    }
    // No save, and a marker's missing: the cinematic is skipped entirely,
    // fall back to the ordinary spawn.
    return PLAYER_SPAWN;
  });
  const playerRef = useRef(player);
  playerRef.current = player;
  // The CURRENT in-flight step's visual interpolation window — updated by
  // tryMove on every successful step (see below), read every rAF tick by
  // applyWalkTransform to compute a continuously-interpolated position
  // instead of relying on a CSS transition to smooth the discrete jump.
  // Zero-duration at start: with fromX===toX===spawn, progress is 1
  // immediately, so the very first render is just the settled spawn point.
  const stepAnimRef = useRef({
    fromX: player.x,
    fromY: player.y,
    toX: player.x,
    toY: player.y,
    t0: 0,
    durMs: 0,
  });
  // true while gliding ALONG a collider (a sideways slide, not a free move) —
  // slows the step cadence + the glide transition so wall-hugging feels gentler
  const [sliding, setSliding] = useState(false);
  const slidingRef = useRef(sliding);
  slidingRef.current = sliding;
  // The ACTUAL last step's displacement (not the raw key input — resolveMove
  // can turn a diagonal press into a single-axis slide), so glideDur below can
  // scale to the true distance this specific step covers. See CELL_ASPECT.
  const [lastDelta, setLastDelta] = useState<[number, number]>([1, 0]);
  const [money, setMoney] = useState(() => saved?.money ?? 0);
  const [inv, setInv] = useState<Record<ItemType, number>>(() => ({
    ...emptyInv(),
    ...(saved?.inv ?? {}),
  }));
  const [storages, setStorages] = useState<Record<ItemType, number>[]>(() =>
    Array.from({ length: STORAGE_SLOTS }, (_, i) => ({
      ...emptyInv(),
      ...(saved?.storages?.[i] ?? {}),
    })),
  );
  const [bag, setBag] = useState<OwnedItem[]>(() => saved?.bag ?? []);
  const [equipped, setEquipped] = useState<OwnedItem | null>(() =>
    saved?.equippedId ? (saved.bag.find((o) => o.ownedId === saved.equippedId) ?? null) : null,
  );
  const [removed, setRemoved] = useState<Set<string>>(() => new Set(saved?.removedIds ?? []));
  const [shaken, setShaken] = useState<Set<string>>(() => new Set(saved?.shaken ?? []));
  const [dynamicEnts, setDynamicEnts] = useState<Ent[]>([]);
  const [crops, setCrops] = useState<PlantedCrop[]>(() => saved?.plantedCrops ?? []);
  // Pre-gate saves carried {top, bottom}; save.ts's migrate() folds those into
  // the single {gate} this expects, so nothing legacy-shaped reaches here.
  const [doors, setDoors] = useState<Doors>(() => saved?.doors ?? { gate: false });
  // Player outfit colour override — set by interacting with a laundry-line
  // garment (see interact.ts/outfit.ts). Empty object = default colours (the
  // sprite's own baked palette, untouched).
  const [outfit, setOutfit] = useState<Outfit>(() => saved?.outfit ?? {});
  // What's currently hanging on each clothesline hotspot, keyed by hotspot
  // id — the other half of the wardrobe swap (wearFromLine below). Absent
  // entry = still whatever it was baked with (HOTSPOT_INFO's bakedHex).
  const [lineColors, setLineColors] = useState<Record<string, string>>(
    () => saved?.lineColors ?? {},
  );
  // Recovery hatch: `resetOutfit()` in the browser console puts the player
  // and the clothesline back to their baked defaults. Goes through React
  // state (not a raw localStorage edit) so it can't lose a race against the
  // debounced autosave writing the OLD (still-customised) state back over a
  // manual edit, and takes effect immediately — no reload needed. Not
  // DEV-gated: this is a genuine player-facing recovery tool, not a dev aid.
  useEffect(() => {
    (window as unknown as { resetOutfit: () => void }).resetOutfit = () => {
      setOutfit({});
      setLineColors({});
      console.info('[resetOutfit] outfit and clothesline reset to defaults.');
    };
    return () => {
      delete (window as unknown as { resetOutfit?: () => void }).resetOutfit;
    };
  }, []);
  // ---- daily allowances (see time.ts daySeedOf) ----
  // Stored with the day they belong to; a stale day just reads as zero, so
  // nothing has to actively reset them — same idiom as removedIds/shaken.
  const [tokenBuys, setTokenBuys] = useState<{ day: number; n: number }>(
    () => saved?.tokenBuys ?? { day: 0, n: 0 },
  );
  const [coinGrants, setCoinGrants] = useState<{ day: number; total: number }>(
    () => saved?.coinGrants ?? { day: 0, total: 0 },
  );
  // ---- free-form world placement (see placement.ts) ----
  const [placedItems, setPlacedItems] = useState<PlacedItem[]>(() => saved?.placed ?? []);
  const [placing, setPlacing] = useState<{
    owned: OwnedItem;
    x: number;
    y: number;
    rotation: 0 | 1 | 2 | 3;
  } | null>(null);
  const placingRef = useRef(placing);
  placingRef.current = placing;
  // ---- manual save (Ctrl+S): top-center indicator + brief input lock ----
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(saving);
  savingRef.current = saving;
  const savingTimeoutRef = useRef<number | null>(null);
  const [pushCharge, setPushCharge] = useState<{ id: string; frac: number } | null>(null);
  const pushRef = useRef<{ id: string; dx: number; dy: number; startedAt: number } | null>(null);
  const [pickupMenuId, setPickupMenuId] = useState<string | null>(null);
  const pickupMenuIdRef = useRef(pickupMenuId);
  pickupMenuIdRef.current = pickupMenuId;
  const [modal, setModal] = useState<Modal>(null);
  const [bubble, setBubble] = useState<Bubble>(null);
  const [shaking, setShaking] = useState<string | null>(null);
  const [nothingId, setNothingId] = useState<string | null>(null);
  const [nothingText, setNothingText] = useState('oh nothing...');
  const [zoom, setZoom] = useState(MAX_ZOOM);
  // camera offset from the player-centred position, set by zoom-to-cursor.
  // Deliberately NOT limited to keeping the player on screen — you can zoom
  // off to look anywhere on the map; Space (or double-tap) brings it back.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [camTween, setCamTween] = useState<'zoom' | 'recentre' | null>(null);
  const camTweenRef = useRef(camTween);
  camTweenRef.current = camTween;
  // planetary menu around the player avatar (bottom-left HUD)
  const [orbitOpen, setOrbitOpen] = useState(false);
  const [handMenu, setHandMenu] = useState(false); // equip/unequip popup

  // ---- stages 15-18: the "wake up, meet Mitchy" in-world cinematic ----
  // See src/introPartB.ts for every tunable and src/DialogueBox.tsx/
  // NameEntryPanel.tsx/Letterbox.tsx/GameMap.tsx for the pieces it drives.
  // `introDone` mirrors SaveState.introDone: undefined on a PRE-EXISTING
  // save reads as already-done (never retroactively forced); a brand-new
  // save, or one resuming mid-intro (introBMarkersAtMount truthy either
  // way — see introPending above), starts false until the FULL intro
  // (stages 1-18) completes. This is the ONLY place other than
  // finishIntro()'s natural completion / Skip Intro's late-stage path that
  // ever flips it — see the runIntro() function below.
  const [introDone, setIntroDone] = useState<boolean>(() => {
    if (introBMarkersAtMount) return false;
    if (saved) return saved.introDone ?? true;
    return true; // no save, and a marker's missing: skip, never soft-lock
  });
  // Non-null while the cinematic owns the world — gates held-key movement
  // (holdStart), the walk rAF loop, world click/hover interaction
  // (canInteract) and the map (M can't open early just because Mitchy's
  // dialogue mentions it). Starts already 'introB' (not null-then-flipped-
  // by-an-effect) when Part B is about to run, so there's no frame of
  // normal, ungated gameplay before the mount effect below catches up.
  const [cinematic, setCinematic] = useState<'introB' | null>(() =>
    introBMarkersAtMount ? 'introB' : null,
  );
  const cinematicRef = useRef(cinematic);
  cinematicRef.current = cinematic;
  const [blackout, setBlackout] = useState(() => !!introBMarkersAtMount); // full-screen black cover
  const [letterboxVisible, setLetterboxVisible] = useState(false);
  const [letterboxOpen, setLetterboxOpen] = useState(false); // bars sliding away (the very end only)
  const [dialogue, setDialogue] = useState<DialogueLine | null>(null);
  // Test-mode only. Read once, synchronously, at mount from a plain window
  // global. Historically set by intro-shots-1-2-3.html's now-retired iframe
  // harness before that file's iframe embedded and auto-started the real
  // game (see that file's own superseded-notice comment) — the unified
  // intro controller has no iframe boundary any more, so nothing sets this
  // for a normal player/browser visit; it stays false there and every
  // dialogue/name panel stays normally clickable. Still settable manually
  // (e.g. from an automated test) right before calling the DEV-only
  // `__replayIntro()` console function.
  const [autoAdvanceMode, setAutoAdvanceMode] = useState(
    () => !!(window as unknown as { __introBAuto?: boolean }).__introBAuto,
  );
  const dialogueAdvanceRef = useRef<(() => void) | null>(null);
  const dialogueChoiceRef = useRef<((i: number) => void) | null>(null);
  const [nameEntryOpen, setNameEntryOpen] = useState(false);
  const nameEntryResolveRef = useRef<((name: string) => void) | null>(null);
  const [playerName, setPlayerName] = useState<string>(() => saved?.playerName ?? DEFAULT_PLAYER_NAME);
  // Mitchy's live world position (tile units, same grid as player.x/y and
  // every scene marker). null = render him at his STRUCT_ENTS static spot
  // (x:35,y:33) — the ordinary, pre-Part-B-and-unaffected-by-it case for
  // every returning player. Set once Part B computes his off-camera
  // entrance start, and kept up to date by tweenMitchyTo() through the rest
  // of the cinematic and (via SaveState.mitchyPos) forever after.
  const [mitchyPos, setMitchyPos] = useState<{ x: number; y: number } | null>(() =>
    // Resuming Part B mid-cinematic (introBMarkersAtMount truthy): ignore
    // any stale saved.mitchyPos from the interrupted run (a half-finished
    // tween position, meaningless to resume from) — null renders him at
    // his ordinary STRUCT_ENTS spot for the one frame before the mount
    // effect below (hidden behind the synchronous `blackout` cover either
    // way) computes a fresh off-camera entrance start.
    introBMarkersAtMount ? null : (saved?.mitchyPos ?? null),
  );
  const mitchyPosRef = useRef(mitchyPos);
  mitchyPosRef.current = mitchyPos;
  const [mitchyHopEm, setMitchyHopEm] = useState(0); // live jump/hop translateY offset
  const [mapOpen, setMapOpen] = useState(false);
  const mapOpenRef = useRef(mapOpen);
  mapOpenRef.current = mapOpen;
  const [mapHint, setMapHint] = useState(false); // brief "M — Map" toast after control is restored

  // snap the camera back to the player (Space / double-tap)
  const recentre = useCallback(() => {
    setPan((p) => (p.x === 0 && p.y === 0 ? p : { x: 0, y: 0 }));
    setCamTween('recentre');
    window.setTimeout(() => setCamTween(null), RECENTRE_MS + 40);
  }, []);
  const [charIdx] = useState(0); // future: character select screen
  const [petPos, setPetPos] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [wt, setWt] = useState(() => worldTime(timeCfgRef.current));
  const [stock, setStock] = useState<Record<Category, ShopItem[]> | null>(null);
  const talkTimer = useRef<number | undefined>(undefined);
  const nothingTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const talkedRef = useRef(false);
  const talkSeq = useRef(0); // guards async Mitchy lines against a newer talk
  const craftBusyRef = useRef(false); // true while a craft generation is in flight
  const craftDoneRef = useRef(false); // true once the craft is finished (token spent) → exit is free

  const character = CHARACTERS[charIdx];
  const equippedRef = useRef(equipped);
  equippedRef.current = equipped;

  // Today's remaining allowances. Reading through daySeedOf is what makes a
  // stored counter from a previous day self-invalidate.
  const today = daySeedOf(wt);
  const tokensLeftToday = TOKENS_PER_DAY - (tokenBuys.day === today ? tokenBuys.n : 0);
  const coinsGrantedToday = coinGrants.day === today ? coinGrants.total : 0;

  // ---- the world clock (worldTime) ticks once per second ----
  useEffect(() => {
    const iv = window.setInterval(() => setWt(worldTime(timeCfgRef.current)), 1000);
    return () => window.clearInterval(iv);
  }, []);

  // ---- palm shake animation --------------------------------------------------
  // null = static (the baked sprite). Otherwise the frame index being drawn;
  // palmFrame() is pure in that number, so this one integer IS the whole
  // animation state — no physics to keep in sync.
  const [shakeFrame, setShakeFrame] = useState<number | null>(null);
  useEffect(() => {
    if (shakeFrame === null || shakeFrame >= SHAKE_FRAMES) return;
    const t = window.setTimeout(() => setShakeFrame((f) => (f === null ? null : f + 1)), SHAKE_FRAME_MS);
    return () => window.clearTimeout(t);
  }, [shakeFrame]);

  // ---- the shop cat's happy slow-blink ---------------------------------------
  // Fires when a sale closes. -1 = resting; otherwise the index into
  // S.CAT_HAPPY_BLINK we're currently showing. The effect walks one frame per
  // CAT_BLINK_MS and parks itself back at -1 when the sequence runs out, so a
  // second sale mid-blink just restarts it cleanly.
  const [blinkFrame, setBlinkFrame] = useState(-1);
  useEffect(() => {
    if (blinkFrame < 0) return;
    if (blinkFrame >= S.CAT_HAPPY_BLINK.length) {
      setBlinkFrame(-1);
      return;
    }
    const t = window.setTimeout(() => setBlinkFrame((f) => f + 1), CAT_BLINK_MS);
    return () => window.clearTimeout(t);
  }, [blinkFrame]);
  // Bounds-checked at the READ site, not just trusted from the effect above:
  // that effect corrects an out-of-range blinkFrame back to -1, but it's a
  // plain useEffect, which runs AFTER React has already painted whatever
  // render triggered it — so the render with blinkFrame at CAT_HAPPY_BLINK's
  // own length (one past its last valid index) genuinely reaches the screen
  // before the correction does. Indexing an array one past its end doesn't
  // throw (JS just returns undefined) — it's catWithFace() doing `face.length`
  // on that undefined that did, crashing the whole tree with no error
  // boundary to catch it. Every sale advances blinkFrame through exactly this
  // transition, which is what made it read as "crashes whenever you sell
  // something."
  const catFace = S.catWithFace(
    blinkFrame >= 0 && blinkFrame < S.CAT_HAPPY_BLINK.length
      ? S.CAT_HAPPY_BLINK[blinkFrame]
      : S.CAT_FACE_REST,
  );

  // ---- dev-only clock scrubber (open the browser console) --------------------
  //   time.hour(19)  → freeze the clock at 19:00 to preview that tint
  //   time.speed(1440) → run a fast cycle (24h in ~1 min); pass a big number
  //   time.real()    → back to real local time
  // Stripped from production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const setCfg = (cfg: TimeConfig) => {
      timeCfgRef.current = cfg;
      setWt(worldTime(cfg));
    };
    (window as unknown as { time: unknown }).time = {
      hour(h: number, m = 0) {
        const d = new Date();
        d.setHours(h, m, 0, 0);
        setCfg({ anchor: d.getTime(), anchorReal: Date.now(), timeScale: 0 }); // frozen
        console.info(`[time] frozen at ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      },
      speed(scale = 720) {
        setCfg({ anchor: worldTime(timeCfgRef.current), anchorReal: Date.now(), timeScale: scale });
        console.info(`[time] running ${scale}x (a full day every ${(1440 / scale).toFixed(1)} min)`);
      },
      real() {
        setCfg(defaultTimeConfig());
        console.info('[time] back to real local time');
      },
    };
    return () => {
      delete (window as unknown as { time?: unknown }).time;
    };
  }, []);

  // These are all read by listeners AT EVENT TIME rather than at render, so
  // they're declared up here — ahead of the layout tool and the world below,
  // both of which need them — and refreshed further down each render.
  const fieldRef = useRef<HTMLDivElement>(null);
  // Imperative escape hatch for the two elements that need to move EVERY
  // rendered frame while walking (see the rAF loop's applyWalkTransform,
  // below player/camTween state) rather than only on React state changes —
  // see that function's own comment for why.
  const worldRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef(modal);
  modalRef.current = modal;
  // Everything the wheel and drag handlers need, so they can bind once without
  // ever capturing stale values. camX/camY are the CLAMPED view origin: the
  // wheel handler derives its own pre-zoom copy, but the layout tool needs the
  // current one to turn a screen pixel back into a map tile.
  const camRef = useRef({
    zoom: 1,
    minZoom: 0,
    pcx: 0,
    pcy: 0,
    panX: 0,
    panY: 0,
    camX: 0,
    camY: 0,
    dims: { scale: 1, charW: 8.4, lineH: 14, viewW: VIEW_W, viewH: VIEW_H, w: 940, h: 560 },
  });

  // dev-only: alt+drag structures into place, then layout.dump() for the source
  // to paste back into STRUCT_ENTS. Inert in a production build.
  const { place, scale: devScale, dragId, cursor } = useLayoutTool({ fieldRef, camRef, modalRef });

  // The garden travels as ONE thing. Its fence art, its collider, its gate and
  // its six planting beds all resolve against whichever corner the bed entity
  // currently sits on, so dragging it with the layout tool moves the whole plot
  // instead of sliding the picture off its own collider. `place` is empty
  // outside the dev tool, so this is GARDEN_HOME in a normal session.
  const gardenX = place['garden-bed']?.x ?? GARDEN_HOME.x;
  const gardenY = place['garden-bed']?.y ?? GARDEN_HOME.y;
  const plot: GardenPlot = useMemo(() => gardenAt(gardenX, gardenY), [gardenX, gardenY]);
  const plotRef = useRef(plot);
  plotRef.current = plot;

  // ---- derived world: structures + windowed wild spawns − exceptions ----
  const growthWindow = growthWindowOf(wt);
  // The ground's grass is masked against the wild flora, which moves each
  // growth window — so the layers are rebuilt when the window turns over
  // (every 6 in-game hours), not every render.
  const landLayers = useMemo(() => genLandLayers(growthWindow), [growthWindow]);
  const ents = useMemo(
    () => [
      // `place`/`devScale` are empty except while the dev layout tool is being
      // used, where they shadow world.ts until the values are pasted back.
      // Filtered by `removed` too now: STRUCT_ENTS is otherwise permanent
      // (buildings, the palm, decorations), but a collectable placed there
      // (the flowerplus decorations) needs to actually disappear once picked
      // — see collect() below. Nothing else in STRUCT_ENTS is ever collected,
      // so this is a no-op for everything else.
      // 'gardenbed' is skipped: it sits in STRUCT_ENTS only so the dev layout
      // tool can hit-test and drag it, and the garden block further down draws
      // it itself (the picture it shows depends on the gate).
      ...STRUCT_ENTS.filter((e) => !removed.has(e.id) && e.kind !== 'gardenbed').map((e) => {
        const s = devScale[e.kind];
        // The chair/laundry hotspots and the two stair-flank blockers aren't
        // draggable themselves — they're positioned relative to the house by
        // the anchor formula in world.ts, using its OWN world.ts coordinates.
        // If only 'house' gets an alt-drag override, these would stay behind
        // at their old spot while the house moves out from under them. Rather
        // than requiring every one of them to be dragged individually, carry
        // the house's own move (if any) over onto every 'house-*' id that
        // doesn't already have its own explicit override.
        let p = place[e.id];
        if (!p && e.id.startsWith('house-') && place['house']) {
          const houseBase = STRUCT_ENTS.find((h) => h.id === 'house');
          if (houseBase) {
            p = {
              x: e.x + (place['house'].x - houseBase.x),
              y: e.y + (place['house'].y - houseBase.y),
            };
          }
        }
        // Mitchy's live position (Intro Part B's entrance/exit tweens, then
        // his post-cinematic resting spot) overrides his STRUCT_ENTS static
        // x:35,y:33 the same way a dev-layout drag would — see mitchyPos's
        // own comment above for why null means "leave him where he was".
        if (e.id === 'cat' && mitchyPos) p = { ...(p ?? {}), x: mitchyPos.x, y: mitchyPos.y };
        return p || s !== undefined ? { ...e, ...p, ...(s !== undefined ? { scale: s } : {}) } : e;
      }),
      // wild spawns skip the garden footprint so nothing sprouts inside the
      // fence — measured against where the bed actually is, so a dragged plot
      // doesn't end up with flora growing through it
      ...wildSpawns(growthWindow, plot.rect).filter(
        (e) => !removed.has(e.id) && !inGarden(e.x, e.y, plot),
      ),
      ...dynamicEnts.filter((e) => !removed.has(e.id)),
      // player-placed decorations — permanent, NOT subject to the growth-window
      // reset dynamicEnts gets (see the useEffect below); this is what makes
      // blocked() treat them as solid "for free," with no changes inside it.
      ...placedItems.map(placedToEnt),
    ],
    [growthWindow, removed, dynamicEnts, place, devScale, placedItems, plot, mitchyPos],
  );

  // House-sprite recolor for the wardrobe swap (interact.ts's 'outfit' act +
  // wearFromLine above): whatever's currently hanging on the line gets
  // painted onto the house's OWN baked sprite, not just the player's. Chained
  // like applyOutfit does for shorts-then-shirt, one recolorGarment call per
  // clothesline slot that's been swapped away from its baked default.
  // Memoized on `lineColors` alone (the house's own STRUCT_ENTS sprite/colors
  // /palette are static) so this only recomputes on an actual swap, not
  // every render.
  const houseBaseEnt = useMemo(() => STRUCT_ENTS.find((e) => e.id === 'house'), []);
  const houseRecolored = useMemo(() => {
    if (!houseBaseEnt?.colors || !houseBaseEnt.palette || Object.keys(lineColors).length === 0) return null;
    let colors = houseBaseEnt.colors;
    let palette = houseBaseEnt.palette;
    for (const [hotspotId, hex] of Object.entries(lineColors)) {
      const region = HOUSE_GARMENT_REGIONS[hotspotId];
      if (!region) continue;
      ({ colors, palette } = recolorGarment(houseBaseEnt.sprite, colors, palette, region, hex));
    }
    return { colors, palette };
  }, [houseBaseEnt, lineColors]);

  const worldAssetTool = useWorldAssetTool({ fieldRef, camRef, ents, plot });
  // the wheel handler below binds once (empty dep array, same convention as
  // the zoom effect it shares an event with) so it reads this ref rather than
  // closing over a stale `worldAssetTool` from mount time.
  const worldAssetToolRef = useRef(worldAssetTool);
  worldAssetToolRef.current = worldAssetTool;

  // dev-only: Scene Markings ("E" panel's second tab) — place/reposition the
  // named world positions later cinematics read by stable id. Alt+drag
  // reposition only listens while the editor panel is actually open (see
  // devSceneMarkers.ts's `active`), same as every other editor-only gesture.
  const sceneMarkerTool = useSceneMarkerTool({ fieldRef, camRef, modalRef, active: worldAssetTool.panelOpen });

  // dev-only: INTRO narration/timing editor ("E" panel's third tab) — see
  // src/devIntroNarration.ts/DevIntroTab.tsx. Self-contained (no fieldRef/
  // camRef dependency, unlike the two tools above), since it edits plain
  // data + previews via its own <IntroA/>/<IntroNarration/> instances.
  const introNarrationTool = useIntroNarrationTool();

  // when the growth window rolls over: loose apples despawn, stale
  // exceptions (from old windows) are pruned so the save doesn't grow forever
  useEffect(() => {
    setDynamicEnts([]);
    setRemoved((s) => new Set([...s].filter((id) => id.includes(`-${growthWindow}-`))));
    setShaken((s) => new Set([...s].filter((k) => k.endsWith(`@${growthWindow}`))));
  }, [growthWindow]);

  // ---- save snapshot builder ----
  // No automatic/background writes to localStorage any more — the save
  // system now has exactly three player-facing actions (Start Screen ->
  // Continue, Settings -> Save Game, Ctrl+S) and NONE of them fire on
  // their own. snapRef stays the single source of truth for "what does
  // the current runtime state look like as a SaveState", built fresh on
  // every read so it's never stale by the time an explicit save happens.
  const snapRef = useRef<() => SaveState>(() => null as never);
  snapRef.current = () => ({
    version: 1,
    ...timeCfgRef.current,
    player: { x: player.x, y: player.y },
    inv,
    money,
    storages,
    bag,
    equippedId: equipped?.ownedId ?? null,
    removedIds: [...removed],
    shaken: [...shaken],
    plantedCrops: crops,
    doors,
    placed: placedItems,
    tokenBuys,
    coinGrants,
    outfit,
    lineColors,
    playerName,
    introDone,
    mitchyPos: mitchyPos ?? undefined,
  });

  // Shared by both explicit save actions below — just the "Saving…" HUD
  // indicator's on/auto-off timing, factored out so neither action
  // duplicates the timeout bookkeeping.
  function flashSavingIndicator() {
    setSaving(true);
    if (savingTimeoutRef.current !== null) window.clearTimeout(savingTimeoutRef.current);
    savingTimeoutRef.current = window.setTimeout(() => {
      setSaving(false);
      savingTimeoutRef.current = null;
    }, SAVE_INDICATOR_MS);
  }
  useEffect(() => {
    return () => {
      if (savingTimeoutRef.current !== null) window.clearTimeout(savingTimeoutRef.current);
    };
  }, []);

  // ---- Settings -> Save Game ----
  // The ONLY action that writes the persistent gameplay SaveState to
  // localStorage. Does not touch developer/editor persistence (Scene
  // Markings, devWorldAssets overrides, dev layout), which live under
  // their own separate keys/files entirely.
  function saveGameToStorage() {
    if (savingRef.current) return;
    writeSave(snapRef.current());
    flashSavingIndicator();
  }

  // ---- Ctrl+S: download-only backup ----
  // Deliberately does NOT call writeSave — per the save-system spec, this
  // is a local .json download only (Safari's ITP wipes localStorage after
  // 7 days of no interaction on a site; this file is the player's own
  // recovery path, re-imported via the start screen's Upload Save), never
  // a browser-storage write. !shiftKey in the keydown handler below leaves
  // Ctrl+Shift+S ("Save As") to the browser.
  function downloadBackup() {
    if (savingRef.current) return; // ignore a second Ctrl+S while already showing
    downloadSaveFile(snapRef.current());
    if (import.meta.env.DEV) worldAssetTool.flushDrafts();
    flashSavingIndicator();
  }

  // a restored pet needs a position to walk from
  useEffect(() => {
    if (equipped?.equip?.mode === 'pet' && !petPos) {
      setPetPos({ x: Math.max(0, player.x - 2), y: player.y });
    }
  }, [equipped]); // eslint-disable-line react-hooks/exhaustive-deps

  // the shop restocks once every worldTime hour
  const hourSeed = hourSeedOf(wt);
  useEffect(() => {
    let alive = true;
    setStock(null);
    Promise.all(CATEGORIES.map((c) => getShopStock(c, hourSeed))).then((lists) => {
      if (!alive) return;
      const s = {} as Record<Category, ShopItem[]>;
      CATEGORIES.forEach((c, i) => (s[c] = lists[i]));
      setStock(s);
    });
    return () => {
      alive = false;
    };
  }, [hourSeed]);

  function showToast(text: string) {
    window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }

  // read from `ents`, not STRUCT_ENTS, so Mitchy's talk range and speech bubble
  // follow him when the dev layout tool drags him somewhere new
  const catDef = ents.find((e) => e.id === 'cat')!;

  // Interaction gate on top of the static `interactable` flag on each Ent:
  // - Different island than the player: never interactable. Islands aren't
  //   walkable to today (isWater blocks movement between them — see
  //   world.ts), but nothing stopped a zoomed-out/panned camera from
  //   clicking a distant entity on another island anyway, since the click
  //   handler itself never checked distance or reachability at all.
  // - Mitchy and the buildings (house/shop, plus 'hotspot' — the invisible
  //   hit-boxes for the chair/door/clothesline are literally part of the
  //   house's own picture) go further: CLOSE range only, same distance
  //   Mitchy's own greet-bubble already uses below, so you can't open the
  //   shop or talk to the cat from across the map just because it's on
  //   screen.
  const CLOSE_RANGE_KINDS = new Set<EntityKind>(['cat', 'house', 'shop', 'hotspot']);
  const CLOSE_RANGE_TILES = 4;
  function canInteract(e: Ent): boolean {
    if (cinematic || mapOpen) return false;
    if (!e.interactable) return false;
    if (nearestIsland(player.x, player.y).idx !== nearestIsland(e.x, e.y).idx) return false;
    if (CLOSE_RANGE_KINDS.has(e.kind) && near(e, player) > CLOSE_RANGE_TILES) return false;
    return true;
  }

  // ---- viewport sizing: fill the screen edge-to-edge, on any aspect ----
  // The old version scaled a FIXED 112ch x 40em field with min(availW/w,
  // availH/h) — a "contain" fit, so any screen whose aspect didn't match the
  // field's ~1.68 got black pillar/letterbox bars. Instead we COVER: scale the
  // design view up until it covers the box (max instead of min), then size the
  // field to the FULL available box — the overflow is simply cropped, so the
  // screen is always filled and nobody sees extra world.
  const stageRef = useRef<HTMLDivElement>(null);
  // w/h are the field's UNSCALED px size; viewW/viewH are the same box in
  // world units (ch / em) and drive the camera clamp + zoom-out limit.
  const [dims, setDims] = useState({
    w: 940,
    h: 560,
    scale: 1,
    viewW: VIEW_W,
    viewH: VIEW_H,
    charW: 8.4, // measured px size of one character cell — the wheel handler
    lineH: 14, //  needs it to turn a cursor pixel into a world coordinate
  });
  useLayoutEffect(() => {
    const compute = () => {
      const el = fieldRef.current;
      const stage = stageRef.current;
      if (!el || !stage) return;
      // measure one character cell in the field's own font (1ch x 1em)
      const probe = document.createElement('div');
      probe.style.cssText =
        'position:absolute;visibility:hidden;top:0;left:0;width:100ch;height:100em;line-height:1;';
      el.appendChild(probe);
      const charW = probe.offsetWidth / 100;
      const lineH = probe.offsetHeight / 100;
      el.removeChild(probe);
      if (!charW || !lineH) return;

      // the stage is laid out below the fixed header / above the controls, so
      // its own box is the true free space (no window.innerHeight guessing)
      const availW = stage.clientWidth;
      const availH = stage.clientHeight;
      if (!availW || !availH) return;

      // COVER: scale up until the design view covers the box on BOTH axes
      // (max, not min) — the excess on the longer axis gets cropped...
      const scale = Math.max(availW / (VIEW_W * charW), availH / (VIEW_H * lineH));
      // ...then let the field occupy the entire box: after transform: scale()
      // an unscaled w of availW/scale renders exactly availW px wide.
      const w = availW / scale;
      const h = availH / scale;
      setDims({ w, h, scale, viewW: w / charW, viewH: h / lineH, charW, lineH });
    };
    compute();
    window.addEventListener('resize', compute);
    // catches header/control height changes and mobile URL-bar show/hide,
    // which a window 'resize' event alone can miss
    const ro = new ResizeObserver(compute);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => {
      window.removeEventListener('resize', compute);
      ro.disconnect();
    };
  }, []);

  // zoom-out floor: never past the whole map (depends on the measured view)
  const minZoom = Math.min(1, Math.max(dims.viewW / GROUND_W, dims.viewH / GROUND_H));

  // ---- movement & collision ----
  // Would the player's tile box at (nx, ny) collide with anything?
  // excludeId: skip one entity's collision entirely — used by the push-to-move
  // mechanic to ask "is anything ELSE blocking this tile" without the item
  // being pushed counting as its own obstacle.
  function blocked(nx: number, ny: number, excludeId?: string): boolean {
    if (nx < 0 || ny < 0 || nx + PLAYER_T.wT > MAP_W || ny + PLAYER_T.hT > MAP_H) return true;
    // any entity's SOLID box (buildings are solid throughout; the palm only at
    // its trunk and hanging dates, so you can walk through its crown — see
    // collisionBox/entityBlocksTile and Ent.solidMask in world.ts)
    const pbox = { x0: nx, y0: ny, x1: nx + PLAYER_T.wT - 1, y1: ny + PLAYER_T.hT - 1 };
    // The player's FEET only — the bottom-most row of their footprint. Used
    // for the house's own collision (see the 'house' branch below): its deck
    // is something you stand ON, so only where your feet actually land
    // matters, not whether the rest of your (taller) sprite visually
    // overlaps the wall above it — that's normal, expected depth, the same
    // way your character always visually overlaps whatever's behind it.
    // Testing the whole body there is what used to shove the player back off
    // the deck as soon as their head reached the wall.
    const feetY = ny + PLAYER_T.hT - 1;
    for (const e of entsRef.current) {
      if (e.id === excludeId) continue;
      // 'hotspot': an invisible interaction zone painted over another sprite
      // (the clothesline garments, the front door) — never an obstacle. Skip
      // it entirely rather than give it a blank solidMask, which would also
      // defeat hover/click hit-testing (that reuses entityBlocksTile against
      // the hotspot's REAL sprite shape).
      if (e.kind === 'hotspot') continue;
      // collisionBox() is only the RECTANGLE — the same full-sprite box for
      // every kind, no per-kind exceptions. It's a cheap broad-phase reject;
      // the narrowing below is what actually decides solidity, from whatever
      // glyph (if any) is really drawn at each overlapping tile.
      const cbox = collisionBox(e);
      if (!tileBoxesOverlap(pbox, cbox)) continue;
      // 'house' and 'cliff': feet-only, one row tall, full player width — see
      // the comment on feetY above. The cliff is here for exactly the same
      // reason as the house's deck: its grass crown is a surface you stand ON,
      // so what decides whether a step is legal is where the feet land, not
      // whether the rest of the (taller) player sprite overlaps the rock face
      // drawn below them. Testing the whole body would stop you a body-height
      // short of the brink instead of at it.
      const tbox =
        e.kind === 'house' || e.kind === 'cliff'
          ? { x0: pbox.x0, x1: pbox.x1, y0: feetY, y1: feetY }
          : pbox;
      const ox0 = Math.max(tbox.x0, cbox.x0), ox1 = Math.min(tbox.x1, cbox.x1);
      const oy0 = Math.max(tbox.y0, cbox.y0), oy1 = Math.min(tbox.y1, cbox.y1);
      for (let ty = oy0; ty <= oy1; ty++) {
        for (let tx = ox0; tx <= ox1; tx++) {
          if (entityBlocksTile(e, tx, ty)) return true;
        }
      }
    }
    // the garden fence blocks movement except through open doors
    if (gardenBlocks(nx, ny, PLAYER_T.wT, PLAYER_T.hT, doorsRef.current, plotRef.current)) return true;
    // ocean blocks movement unless riding something that floats (a boat)
    const floating = equippedRef.current?.equip?.mode === 'vehicle' && !!equippedRef.current.equip.float;
    if (!floating) {
      for (let ty = ny; ty < ny + PLAYER_T.hT; ty++) {
        for (let tx = nx; tx < nx + PLAYER_T.wT; tx++) {
          if (isWater(tx, ty)) return true;
        }
      }
    }
    return false;
  }

  // Is a placed item the (sole) thing blocking the player's next step in this
  // direction, and would sliding it one further tile actually be legal? Used
  // by the push-to-move charge-up in the movement rAF loop below. Excluding
  // the candidate item from blocked() and checking that this UNBLOCKS the
  // tile is what tells a placed item apart from "the real obstacle is a
  // building/tree/water" — excluding an unrelated entity never changes the
  // outcome in that case.
  function findPushTarget(p: { x: number; y: number }, dx: number, dy: number) {
    const nx = p.x + dx;
    const ny = p.y + dy;
    if (!blocked(nx, ny)) return null; // nothing in the way at all
    for (const item of placedItems) {
      if (blocked(nx, ny, item.id)) continue; // excluding this item didn't unblock — not the blocker
      const toX = item.x + dx;
      const toY = item.y + dy;
      if (!placementFits({ ...item, x: toX, y: toY }, entsRef.current, item.id, plotRef.current)) return null;
      return { item, toX, toY };
    }
    return null;
  }

  // Perpendicular steps to take until a (dx,dy) move stops being blocked, when
  // stepping in perpendicular direction (ox,oy). Infinity if that side is a
  // wall the whole way (or can't be stepped into at all). This is "how far to
  // the near edge of the obstacle" — smaller = the player is closer to it.
  const SLIDE_SCAN = 24; // tiles; covers any building/tree, capped so a long wall doesn't scan forever
  function edgeDist(
    p: { x: number; y: number },
    dx: number,
    dy: number,
    ox: number,
    oy: number,
  ): number {
    for (let k = 1; k <= SLIDE_SCAN; k++) {
      const sx = p.x + ox * k;
      const sy = p.y + oy * k;
      if (blocked(sx, sy)) return Infinity; // solid all the way along this side
      if (!blocked(sx + dx, sy + dy)) return k; // the forward move opens up here
    }
    return SLIDE_SCAN + 1; // steppable but the edge is beyond the scan
  }

  // Where the player ends up for a requested move — gliding ALONG obstacles
  // rather than stopping. `glide` is true when it slid sideways off a collider
  // (vs. moving freely), which the caller uses to slow the pace.
  //   full move → take it
  //   diagonal blocked → slide on whichever axis is free
  //   cardinal blocked → glide sideways toward the NEARER edge of the object
  //     (the side the player is closer to), so you roll off it and keep moving
  function resolveMove(p: { x: number; y: number }, dx: number, dy: number) {
    if (!blocked(p.x + dx, p.y + dy)) return { x: p.x + dx, y: p.y + dy, glide: false };
    if (dx && dy) {
      if (!blocked(p.x + dx, p.y)) return { x: p.x + dx, y: p.y, glide: true };
      if (!blocked(p.x, p.y + dy)) return { x: p.x, y: p.y + dy, glide: true };
      return { x: p.x, y: p.y, glide: false };
    }
    // the two ways to slide "sideways" relative to the pushed direction
    const perps: [number, number][] = dx
      ? [
          [0, -1],
          [0, 1],
        ]
      : [
          [-1, 0],
          [1, 0],
        ];
    const [a, b] = perps;
    const da = edgeDist(p, dx, dy, a[0], a[1]);
    const db = edgeDist(p, dx, dy, b[0], b[1]);
    // glide toward whichever edge is nearer; on a tie, the first steppable side
    const pick = da < db ? a : db < da ? b : !blocked(p.x + a[0], p.y + a[1]) ? a : b;
    if (blocked(p.x + pick[0], p.y + pick[1])) return { x: p.x, y: p.y, glide: false }; // boxed in
    return { x: p.x + pick[0], y: p.y + pick[1], glide: true };
  }

  // Returns whether the player's position actually changed — a bump into a
  // wall/entity is a no-op, and callers use this to avoid resetting the step
  // timer on a move that didn't happen (see lastStepRef below).
  function tryMove(dx: number, dy: number): boolean {
    const p = playerRef.current;
    const n = resolveMove(p, dx, dy);
    const moved = n.x !== p.x || n.y !== p.y;
    if (moved) {
      // Arm this step's visual interpolation window BEFORE setPlayer: the
      // rAF loop applies it imperatively (see applyWalkTransform) in this
      // same tick, synchronously — it doesn't wait for React's own re-render
      // of the discrete position, which is what let the two drift apart
      // (see that function's comment for the full story).
      const eq = equippedRef.current;
      const mult = eq?.equip?.mode === 'vehicle' ? (eq.equip.speedMult ?? 1) : 1;
      const stepMs =
        (dashRef.current ? DASH_MS : WALK_MS) *
        mult *
        (n.glide ? GLIDE_SLOW : 1) *
        speedScale(n.x - p.x, n.y - p.y);
      stepAnimRef.current = {
        fromX: p.x,
        fromY: p.y,
        toX: n.x,
        toY: n.y,
        t0: performance.now(),
        // Same +25ms the old CSS glideDur used, for the same reason: stay
        // slightly "in flight" past the nominal cadence so a slow tick
        // doesn't read as an early finish-and-pause.
        durMs: stepMs + 25,
      };
      setPlayer({ x: n.x, y: n.y });
      if (slidingRef.current !== n.glide) setSliding(n.glide);
      slidingRef.current = n.glide;
      // The RESULTING displacement, not the raw (dx,dy) input — a diagonal
      // press that got turned into a sideways slide only moved one axis.
      setLastDelta([n.x - p.x, n.y - p.y]);
    }
    return moved;
  }

  const entsRef = useRef(ents);
  entsRef.current = ents;
  const doorsRef = useRef(doors);
  doorsRef.current = doors;

  // ---- held-key movement loop ----
  // Keys currently held (wasd). Movement is driven by a fixed-interval loop
  // instead of OS key auto-repeat, so holding a key glides smoothly.
  const heldRef = useRef<Set<string>>(new Set());
  const lastStepRef = useRef(0);
  const [dash, setDash] = useState(false);
  const dashRef = useRef(dash);
  dashRef.current = dash;

  function heldDelta(): [number, number] {
    const h = heldRef.current;
    let dx = 0;
    let dy = 0;
    if (h.has('a')) dx--;
    if (h.has('d')) dx++;
    if (h.has('w')) dy--;
    if (h.has('s')) dy++;
    return [dx, dy];
  }

  // ---- walk animation: which of the four cycles (if any) is playing -------
  // All four of W/A/S/D have a walk cycle (see WALK_*_FRAMES in sprites.ts).
  // Driven straight off the held-key set, not off whether a step actually
  // landed, so bumping a wall while holding a direction still animates
  // (you're visibly trying to walk into it, not idle). On a diagonal (e.g.
  // W+D), vertical wins — up/down read as a full front/back turn, so they
  // take priority over the side-profile left/right cycle.
  type WalkDir = 'up' | 'down' | 'left' | 'right' | null;
  const [walkDir, setWalkDir] = useState<WalkDir>(null);
  const walkDirRef = useRef<WalkDir>(null);
  const [walkFrame, setWalkFrame] = useState(0);
  // Set by holdStart, read by the rAF loop below: which direction (left/right
  // only) is waiting on its very first, frame-gated step off idle. See the
  // loop's threshold calc for why only left/right need this.
  const freshStartDirRef = useRef<WalkDir>(null);

  function syncWalkDir() {
    const [dx, dy] = heldDelta();
    const dir: WalkDir = dy < 0 ? 'up' : dy > 0 ? 'down' : dx < 0 ? 'left' : dx > 0 ? 'right' : null;
    if (walkDirRef.current !== dir) {
      // Any direction change invalidates whatever first step was pending —
      // holdStart re-arms it fresh right after this call when appropriate.
      freshStartDirRef.current = null;
      walkDirRef.current = dir;
      setWalkDir(dir);
      // Start at frame 1, not 0: an earlier WALK_DOWN reference had a
      // flat-footed CONTACT pose at frame 0 — visually identical to the
      // static portrait — so a fresh press showed a frame indistinguishable
      // from idle for one full interval tick before the first visible lift,
      // reading as sliding into place rather than stepping off immediately.
      // The current WALK_DOWN no longer has that problem (see its comment in
      // sprites.ts — every frame now has a leg raised), but starting one
      // frame in remains a harmless, cheap guard against any direction whose
      // frame 0 happens to be a similarly neutral pose.
      setWalkFrame(1);
    }
  }

  function holdStart(k: string) {
    if (modalRef.current || placingRef.current || savingRef.current || cinematicRef.current || mapOpenRef.current)
      return;
    const h = heldRef.current;
    if (h.has(k)) return;
    h.add(k);
    const [dx, dy] = heldDelta();
    // Starting fresh from a standstill (no walk cycle already playing): don't
    // take the usual instant step. The walk animation still starts at once
    // (syncWalkDir below sets frame 1 synchronously), but the character's
    // TILE stays put until that first frame has actually had its turn to
    // play — arming lastStepRef here just lets the normal rAF loop's
    // WALK_MS/DASH_MS throttle (below) take the first step on its regular
    // cadence (the leg cadence itself may run faster or slower per direction
    // — see WALK_FRAME_SPEED — but the tile-step pace this waits on doesn't).
    // Without this, the old "step immediately on press" snappiness made the
    // character glide a full tile while still showing the very first
    // lifted-leg frame, instead
    // of the lift visibly leading the step. Redirecting or continuing to
    // move while ALREADY walking (walkDirRef.current set) keeps the old
    // instant step — this delay is only for the initial press off idle.
    const startingFromIdle = walkDirRef.current === null;
    if (dx || dy) {
      if (startingFromIdle) {
        lastStepRef.current = performance.now();
      } else if (tryMove(dx, dy)) {
        // Only stamp the timer on an actual step — bumping a wall on the
        // opening press shouldn't cost the first tick's worth of held-move delay.
        lastStepRef.current = performance.now();
      }
    }
    syncWalkDir();
    // left/right's walk-FRAME interval runs at the SAME cadence as the
    // tile-step gate below (WALK_FRAME_SPEED is 1 for them, unlike up/down's
    // fast 0.2 flutter — see that constant's comment), so the deferred first
    // step and the frame-advance timer are racing for the same ~170ms mark.
    // Depending on scheduling jitter that lets the step land on frame 1 (the
    // lift — correct) or frame 2 (already mid-stride) inconsistently between
    // presses. Arming this tells the rAF loop to use a shorter, frame-safe
    // threshold for JUST this one step, so it reliably fires while frame 1 is
    // still the one showing.
    if (startingFromIdle && (walkDirRef.current === 'left' || walkDirRef.current === 'right')) {
      freshStartDirRef.current = walkDirRef.current;
    }
  }

  function holdEnd(k: string) {
    heldRef.current.delete(k);
    syncWalkDir();
  }

  // Continuously-interpolated position for .world/.player-rig, replacing the
  // CSS transition previously used to smooth a step's discrete jump. That
  // transition retargeted every ~170ms (however long a step takes) and works
  // fine as a MODEL, but in practice a step's React state commit doesn't
  // necessarily land in the SAME paint as the rAF tick that triggered it —
  // stepAnimRef/playerRef are updated synchronously in tryMove, but React's
  // own re-render (which is what actually pushes the new transform+
  // transition to the DOM today) happens on its own schedule. If a later
  // paint gets delayed for any reason (a slow ocean redraw, GC, anything),
  // the CSS transition can finish EARLY relative to when its target value
  // visually lands, leaving the camera holding dead still for a stretch
  // before the next step's value catches up all at once. Measured directly
  // (sampling the rendered transform every rAF tick while holding a
  // direction): up to ~70% of frames showing zero movement, even well clear
  // of any wall. Recomputing the position from elapsed real time every
  // single frame — instead of asking the browser to interpolate between two
  // React-driven style commits — removes that failure mode entirely: there's
  // nothing to retarget, just "where should this be right now," written
  // straight to the DOM via ref, bypassing React's render for these two
  // elements while walking.
  //
  // Skipped during a camTween (zoom/recentre): those already run their own
  // from/to + duration + easing through the normal React-driven transition,
  // and the rig and camera must stay on that SAME curve (see
  // worldTransition's comment) — this only ever drives the plain walking
  // glide, never fights the tween for ownership of the transform.
  function applyWalkTransform(now: number) {
    if (camTweenRef.current) return;
    const anim = stepAnimRef.current;
    const progress = anim.durMs > 0 ? Math.min(1, (now - anim.t0) / anim.durMs) : 1;
    const visX = anim.fromX + (anim.toX - anim.fromX) * progress;
    const visY = anim.fromY + (anim.toY - anim.fromY) * progress;
    const c = camRef.current;
    const pcxVis = (visX + PLAYER_T.wT / 2) * TILE_CH;
    const pcyVis = (visY + PLAYER_T.hT / 2) * TILE_LN;
    const camXVis = clampCam(pcxVis + c.panX, c.dims.viewW / c.zoom, GROUND_W);
    const camYVis = clampCam(pcyVis + c.panY, c.dims.viewH / c.zoom, GROUND_H);
    if (worldRef.current) {
      worldRef.current.style.transition = 'none';
      worldRef.current.style.transform =
        `translate3d(${-camXVis * c.zoom}ch, ${-camYVis * c.zoom}em, 0) scale(${c.zoom})`;
    }
    if (rigRef.current) {
      rigRef.current.style.transition = 'none';
      rigRef.current.style.transform = `translate3d(${visX * TILE_CH}ch, ${visY * TILE_LN}em, 0)`;
    }
  }

  useEffect(() => {
    let raf = requestAnimationFrame(function tick() {
      raf = requestAnimationFrame(tick);
      applyWalkTransform(performance.now());
      if (
        modalRef.current ||
        placingRef.current ||
        savingRef.current ||
        cinematicRef.current ||
        mapOpenRef.current ||
        heldRef.current.size === 0
      ) {
        if (slidingRef.current) {
          slidingRef.current = false;
          setSliding(false);
        }
        return;
      }
      const now = performance.now();
      // Push-to-move: read every frame (not throttled by WALK_MS/DASH_MS
      // below) so the charge-up wiggle/bar feels smooth at 60fps even though
      // actual player STEPS stay on their usual cadence.
      {
        const [pdx, pdy] = heldDelta();
        const cardinalOnly = (pdx || pdy) && !(pdx && pdy); // no diagonal pushing
        const target = cardinalOnly ? findPushTarget(playerRef.current, pdx, pdy) : null;
        const pr = pushRef.current;
        if (target) {
          if (pr && pr.id === target.item.id && pr.dx === pdx && pr.dy === pdy) {
            const elapsed = now - pr.startedAt;
            if (elapsed >= PUSH_HOLD_MS) {
              const { id, toX, toY } = { id: target.item.id, toX: target.toX, toY: target.toY };
              setPlacedItems((ps) => ps.map((p) => (p.id === id ? { ...p, x: toX, y: toY } : p)));
              pushRef.current = null;
              setPushCharge(null);
            } else {
              setPushCharge({ id: target.item.id, frac: elapsed / PUSH_HOLD_MS });
            }
          } else {
            pushRef.current = { id: target.item.id, dx: pdx, dy: pdy, startedAt: now };
            setPushCharge({ id: target.item.id, frac: 0 });
          }
        } else if (pr) {
          pushRef.current = null;
          setPushCharge(null);
        }
      }
      const eq = equippedRef.current;
      const mult = eq?.equip?.mode === 'vehicle' ? (eq.equip.speedMult ?? 1) : 1;
      const slow = slidingRef.current ? GLIDE_SLOW : 1;
      const baseThreshold = (dashRef.current ? DASH_MS : WALK_MS) * mult * slow;
      // The one deferred first step off idle, left/right only: land a beat
      // BEFORE the walk-frame timer would flip away from frame 1, not at the
      // same instant (see freshStartDirRef's comment above / holdStart).
      const threshold = freshStartDirRef.current
        ? baseThreshold - FRESH_START_FRAME_MARGIN_MS
        : baseThreshold;
      if (now - lastStepRef.current < threshold) return;
      const [dx, dy] = heldDelta();
      if (!dx && !dy) return;
      // Blocked bumps must NOT reset the timer — otherwise walking into
      // something and immediately redirecting eats up to one full interval
      // of dead time before the new direction is even tried.
      if (tryMove(dx, dy)) {
        lastStepRef.current = now;
        freshStartDirRef.current = null;
      }
    });
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'shift') setDash(false);
      else holdEnd(k);
    };
    const clear = () => {
      heldRef.current.clear();
      setDash(false);
      slidingRef.current = false;
      setSliding(false);
      syncWalkDir();
    };
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Advances the walk cycle while a direction is playing — a fixed interval
  // rather than tied to actual tile steps, so it keeps animating smoothly
  // even mid-slide or bumped against a wall. Matches the current move cadence
  // (dash speeds it up) so the legs don't look out of sync with the glide,
  // then applies WALK_FRAME_SPEED on top for any direction whose bake wants
  // its own cadence — this only changes how fast the LEGS cycle, not how
  // fast the character actually crosses tiles (still WALK_MS/DASH_MS, see the
  // rAF loop above).
  useEffect(() => {
    if (!walkDir) return;
    const ms = (dash ? DASH_MS : WALK_MS) * WALK_FRAME_SPEED[walkDir];
    const n = WALK_CYCLES[walkDir].frames.length;
    const iv = window.setInterval(() => setWalkFrame((f) => (f + 1) % n), ms);
    return () => window.clearInterval(iv);
  }, [walkDir, dash]);

  // greet the player the first time they come near Mitchy, and dismiss any
  // bubble when the player walks away again
  const introShownRef = useRef(false);
  useEffect(() => {
    // Intro Part B's own dialogue box owns Mitchy's introduction on a
    // brand-new session — this proximity greeting is for every OTHER time
    // the player walks up to him (including right after Part B finishes).
    if (cinematic === 'introB') return;
    const d = near(catDef, player);
    if (!introShownRef.current && d <= 4) {
      introShownRef.current = true;
      setBubble({ text: INTRO_TEXT, width: 44 });
    } else if (bubble && d > 4) {
      setBubble(null);
    }
  }, [player, cinematic]); // eslint-disable-line react-hooks/exhaustive-deps

  // =========================================================================
  // Stages 15-18 (wake up -> meet Mitchy) — orchestration. A single linear
  // async function drives the whole cinematic (black screen -> wake line ->
  // eyes open + Mitchy runs in -> hop -> intro dialogue -> name entry ->
  // post-name dialogue -> tutorial choice -> departure -> Mitchy runs off,
  // silently teleported to MITCHY EXIT once off-camera -> letterbox opens ->
  // control restored -> map hint). Each dialogue/name-entry beat awaits a
  // promise that the corresponding UI component resolves via the ref
  // callbacks below, so the sequence reads top-to-bottom instead of being
  // spread across a phase enum + reducer.
  //
  // `skipCinematicRef`: set true by the DEV-only Skip Intro control (see
  // below) when it's used during stage 15 onward. Every await point in
  // runIntro() checks it and resolves immediately with a sensible default
  // (a sleep resolves at once, a tween snaps straight to its target, a
  // dialogue/choice/name wait resolves without waiting for a real UI event)
  // — so setting the flag and nudging whichever single promise is currently
  // pending (see skipCinematicToEnd()) fast-forwards the SAME function
  // through its own real completion path (mitchyPos -> MITCHY EXIT,
  // letterbox opens, setCinematic(null), finishIntro()) rather than
  // duplicating that logic in a separate "finalize" function.
  const skipCinematicRef = useRef(false);

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (skipCinematicRef.current) {
        resolve();
        return;
      }
      window.setTimeout(resolve, ms);
    });
  }

  function waitForDialogueAdvance(): Promise<void> {
    return new Promise((resolve) => {
      if (skipCinematicRef.current) {
        resolve();
        return;
      }
      dialogueAdvanceRef.current = () => {
        dialogueAdvanceRef.current = null;
        resolve();
      };
    });
  }

  function waitForDialogueChoice(): Promise<number> {
    return new Promise((resolve) => {
      if (skipCinematicRef.current) {
        resolve(1); // "I think I'm good!" — same default runIntro() itself falls back to
        return;
      }
      dialogueChoiceRef.current = (i) => {
        dialogueChoiceRef.current = null;
        resolve(i);
      };
    });
  }

  function waitForName(): Promise<string> {
    return new Promise((resolve) => {
      if (skipCinematicRef.current) {
        resolve(playerName || DEFAULT_PLAYER_NAME);
        return;
      }
      setNameEntryOpen(true);
      nameEntryResolveRef.current = (name) => {
        nameEntryResolveRef.current = null;
        setNameEntryOpen(false);
        resolve(name);
      };
    });
  }

  // Generic reusable NPC tween — no pathing/animation framework, just a
  // rAF loop advancing linearly toward `target` at `speed` world-tile-
  // units/sec, writing into both the ref (read every frame by off-camera
  // detection) and React state (so the ents map — and, once open, the map
  // overlay — render Mitchy's live position; see mitchyPos's own comment).
  // `stopWhen` lets the exit run stop the INSTANT Mitchy clears the visible
  // camera bounds, rather than requiring him to travel all the way to
  // MITCHY EXIT on screen (see runIntro's exit leg).
  function tweenMitchyTo(
    target: { x: number; y: number },
    speed: number,
    opts?: { stopWhen?: () => boolean },
  ): Promise<void> {
    return new Promise((resolve) => {
      if (skipCinematicRef.current) {
        mitchyPosRef.current = target;
        setMitchyPos(target);
        resolve();
        return;
      }
      const start = mitchyPosRef.current ?? target;
      const dx = target.x - start.x;
      const dy = target.y - start.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.001) {
        mitchyPosRef.current = target;
        setMitchyPos(target);
        resolve();
        return;
      }
      const ux = dx / dist;
      const uy = dy / dist;
      const t0 = performance.now();
      const tick = () => {
        if (skipCinematicRef.current) {
          mitchyPosRef.current = target;
          setMitchyPos(target);
          resolve();
          return;
        }
        const elapsedSec = (performance.now() - t0) / 1000;
        const travelled = Math.min(dist, speed * elapsedSec);
        const next = { x: start.x + ux * travelled, y: start.y + uy * travelled };
        mitchyPosRef.current = next;
        setMitchyPos(next);
        if (opts?.stopWhen?.() || travelled >= dist) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  // The jump/hop: one small tween of a translateY offset (see the cat's
  // render style above), not a new animation system. Simple sine arc so it
  // eases in and out instead of moving at a constant rate.
  function mitchyHop(): Promise<void> {
    return new Promise((resolve) => {
      if (skipCinematicRef.current) {
        setMitchyHopEm(0);
        resolve();
        return;
      }
      const t0 = performance.now();
      const tick = () => {
        const p = Math.min(1, (performance.now() - t0) / MITCHY_JUMP_MS);
        setMitchyHopEm(Math.sin(Math.PI * p) * MITCHY_JUMP_HEIGHT_EM);
        if (p < 1) {
          requestAnimationFrame(tick);
        } else {
          setMitchyHopEm(0);
          resolve();
        }
      };
      requestAnimationFrame(tick);
    });
  }

  // Off-camera test straight from the spec: x < camX || x > camX+viewW ||
  // y < camY || y > camY+viewH, using camRef's own live snapshot (the
  // player is stationary at PLAYER START throughout Part B, so the camera
  // itself never moves during this check).
  function isMitchyOffCamera(pos: { x: number; y: number }): boolean {
    const c = camRef.current;
    const px = pos.x * TILE_CH;
    const py = pos.y * TILE_LN;
    const viewWCh = c.dims.viewW / c.zoom;
    const viewHEm = c.dims.viewH / c.zoom;
    return px < c.camX || px > c.camX + viewWCh || py < c.camY || py > c.camY + viewHEm;
  }

  // finishIntro() is the ONE place (other than the missing-marker skip
  // below, which never soft-locks) that sets `introDone = true` — reached
  // only once the full in-world sequence (Mitchy dialogue -> orientation ->
  // departure -> off-camera reposition -> letterbox close) has genuinely
  // finished, whether that happened naturally or via a late-stage Skip
  // Intro fast-forward through the same runIntro() function. Runtime state
  // only — it never calls writeSave/any persistence function; the save
  // stays exclusively a Settings -> Save Game action.
  function finishIntro() {
    setIntroDone(true);
  }

  async function runIntro(markers: {
    playerStart: { x: number; y: number };
    mitchyStart: { x: number; y: number };
    mitchyExit: { x: number; y: number };
  }) {
    setCinematic('introB');
    setBlackout(true);
    setLetterboxVisible(false);
    setLetterboxOpen(false);
    setMapHint(false);

    // Mitchy's temporary off-camera entrance start: derived from the
    // camera's bounds at cinematic start (never a new manually-placed
    // marker) plus MITCHY_ENTRANCE_OFFSET, at MITCHY START's own y. The
    // player is already sitting at PLAYER START (see the player-state
    // initializer above), so camRef's current snapshot is exactly the
    // cinematic's camera. mitchyStart.x (30) sits well left of the camera's
    // right edge, so running him in from further right toward it reads as
    // "arriving", and later exiting further right still toward MITCHY EXIT
    // (66) continues in the same direction — see the module comment.
    const c = camRef.current;
    const viewWTiles = c.dims.viewW / c.zoom / TILE_CH;
    const entranceStart = {
      x: c.camX / TILE_CH + viewWTiles + MITCHY_ENTRANCE_OFFSET,
      y: markers.mitchyStart.y,
    };
    mitchyPosRef.current = entranceStart;
    setMitchyPos(entranceStart);

    setDialogue({ speaker: UNKNOWN_SPEAKER, text: WAKE_LINE });
    await sleep(BLACK_SCREEN_MS);

    // Eyes open: letterbox bars appear, the black cover starts fading (CSS
    // transition, EYE_OPEN_MS — see the .cinematic-blackout style), and
    // Mitchy is already mid-run toward MITCHY START by the time the world
    // is visible again.
    setLetterboxVisible(true);
    setBlackout(false);
    setDialogue(null);
    const entrancePromise = tweenMitchyTo(markers.mitchyStart, MITCHY_ENTRANCE_SPEED);
    await sleep(EYE_OPEN_MS);
    await entrancePromise;
    await mitchyHop();

    for (const line of MITCHY_INTRO_LINES) {
      setDialogue({ speaker: line.speaker, text: line.text });
      await waitForDialogueAdvance();
    }
    setDialogue(null);

    const rawName = await waitForName();
    const name = rawName.trim() || DEFAULT_PLAYER_NAME;
    setPlayerName(name);

    let choiceIdx = 1; // default to "I think I'm good!" if somehow skipped
    for (let i = 0; i < MITCHY_POST_NAME_LINES.length; i++) {
      const line = MITCHY_POST_NAME_LINES[i];
      const isLast = i === MITCHY_POST_NAME_LINES.length - 1;
      setDialogue({
        speaker: line.speaker,
        text: substitutePlayerName(line.text, name),
        choices: isLast ? TUTORIAL_CHOICES : undefined,
      });
      if (isLast) choiceIdx = await waitForDialogueChoice();
      else await waitForDialogueAdvance();
    }

    if (choiceIdx === 0) {
      for (const line of CHOICE_EXPLORE_LINES) {
        setDialogue({ speaker: line.speaker, text: line.text });
        await waitForDialogueAdvance();
      }
    }
    for (const line of DEPARTURE_LINES) {
      setDialogue({ speaker: line.speaker, text: line.text });
      await waitForDialogueAdvance();
    }
    setDialogue(null);

    // Mitchy runs toward MITCHY EXIT, but the run only needs to carry him
    // clear of the visible camera — once it does, stop immediately and
    // silently snap him to the EXACT exit position (he's off-camera, so the
    // jump is never seen), rather than making him actually travel the full
    // world distance on screen.
    await tweenMitchyTo(markers.mitchyExit, MITCHY_EXIT_SPEED, {
      stopWhen: () => isMitchyOffCamera(mitchyPosRef.current!),
    });
    mitchyPosRef.current = markers.mitchyExit;
    setMitchyPos(markers.mitchyExit); // persistent position + map marker now match MITCHY EXIT

    await sleep(POST_EXIT_DELAY_MS);
    setLetterboxOpen(true);
    await sleep(LETTERBOX_TRANSITION_MS);
    setLetterboxVisible(false);
    setCinematic(null); // movement/interaction/map restored as this lands
    finishIntro();

    setMapHint(true);
    window.setTimeout(() => setMapHint(false), MAP_HINT_VISIBLE_MS);
  }

  // Kicks off once IntroA (stages 1-14) has finished AND we're still "not
  // done" — on mount for a brand-new save (once introAActive flips false,
  // see the IntroA render below), and again whenever the DEV-only replay
  // console function resets introDone back to false. Scene markers are read
  // synchronously (sceneMarkers.json is a static import), so there's no
  // loading state to gate on. Gating on `introAActive` here is what makes
  // stage 15 wait for stage 14 to actually finish instead of auto-starting
  // underneath it — the one thing the old two-system split got wrong.
  useEffect(() => {
    if (introDone || introAActive) return;
    const ps = getMarkerPosition(MARKER_PLAYER_START);
    const ms = getMarkerPosition(MARKER_MITCHY_START);
    const me = getMarkerPosition(MARKER_MITCHY_EXIT);
    if (!ps.found || !ms.found || !me.found) {
      if (import.meta.env.DEV) {
        const missing = [
          !ps.found && MARKER_PLAYER_START,
          !ms.found && MARKER_MITCHY_START,
          !me.found && MARKER_MITCHY_EXIT,
        ].filter(Boolean);
        console.error(
          '[intro] missing scene marker(s), skipping the cinematic (never fabricating a fallback position):',
          missing,
        );
      }
      finishIntro(); // skip straight to normal gameplay, not a soft-lock
      return;
    }
    runIntro({
      playerStart: { x: ps.x!, y: ps.y! },
      mitchyStart: { x: ms.x!, y: ms.y! },
      mitchyExit: { x: me.x!, y: me.y! },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [introDone, introAActive]);

  // DEV-only Skip Intro — see the render below for the actual button.
  // Stages 1-14 (IntroA): tell it to clean up its own timers and jump
  // straight to stage 15 via its onComplete callback; introDone is NOT
  // touched, exactly like natural completion of stage 14 wouldn't touch it
  // either. Stage 15 onward: flips skipCinematicRef so every await inside
  // the in-flight runIntro() resolves immediately (see sleep/
  // waitForDialogueAdvance/waitForDialogueChoice/waitForName/tweenMitchyTo
  // above), then nudges whichever single promise is CURRENTLY pending
  // (already-registered ref callbacks don't retroactively notice the flag
  // flip on their own) so the fast-forward actually starts — the rest of
  // runIntro() then runs its own normal completion path, just instantly,
  // ending in finishIntro() exactly like a natural finish.
  function skipIntro() {
    if (introAActive) {
      introARef.current?.skip();
      return;
    }
    if (introDone) return;
    skipCinematicRef.current = true;
    dialogueAdvanceRef.current?.();
    dialogueChoiceRef.current?.(1);
    nameEntryResolveRef.current?.(playerName || DEFAULT_PLAYER_NAME);
  }

  // Dev-only manual retrigger — a console function instead of an
  // on-screen button. The button used to sit visibly in the corner during
  // ordinary gameplay and turned out to be too easy to click by accident
  // (mistaken for part of the game), which is exactly what kept making the
  // intro "start itself" for real players testing normal gameplay. A
  // console-only function needs a deliberate devtools action, never an
  // accidental click. Usage: open devtools, run `__replayIntro()`. Replays
  // only stages 15-18 (the in-world Mitchy sequence) — matching what the
  // old `__replayIntroB()` did — since stages 1-14 have no in-world state
  // to rewind and are already fully covered by DEV Skip Intro / just
  // reloading with a cleared save.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { __replayIntro?: () => void }).__replayIntro = () => {
      const markers = readIntroBMarkers();
      if (!markers) {
        console.error('[intro] __replayIntro(): a scene marker is missing, see MARKER_* in introPartB.ts');
        return;
      }
      setModal(null);
      setMapOpen(false);
      setDialogue(null);
      setNameEntryOpen(false);
      setMitchyPos(null);
      introShownRef.current = false;
      setPlayer(markers.playerStart);
      skipCinematicRef.current = false;
      setIntroAActive(false); // stages 1-14 aren't part of a manual replay
      // Optional automated-testing hook (not set by any normal gameplay
      // session): a caller may set window.__introBAuto = true just before
      // calling this, to make DialogueBox/NameEntryPanel auto-advance on a
      // timer instead of waiting for real clicks.
      setAutoAdvanceMode(!!(window as unknown as { __introBAuto?: boolean }).__introBAuto);
      setIntroDone(false);
    };
    return () => {
      delete (window as unknown as { __replayIntro?: () => void }).__replayIntro;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- click-to-pickup popup on a placed item ----
  const pickupPopupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickupMenuId) return;
    const onDown = (ev: PointerEvent) => {
      if (pickupPopupRef.current && ev.target instanceof Node && pickupPopupRef.current.contains(ev.target)) {
        return;
      }
      setPickupMenuId(null);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [pickupMenuId]);
  // walking away auto-dismisses it too — the same "don't let a misclick while
  // walking cause an accident" reasoning that motivated requiring a click (not
  // an instant pickup) in the first place.
  useEffect(() => {
    if (pickupMenuId) setPickupMenuId(null);
  }, [player]); // eslint-disable-line react-hooks/exhaustive-deps

  // the pet trails one step behind the player
  const prevPlayerRef = useRef(player);
  useEffect(() => {
    if (equipped?.equip?.mode === 'pet' && prevPlayerRef.current !== player) {
      setPetPos(prevPlayerRef.current);
    }
    prevPlayerRef.current = player;
  }, [player, equipped]);

  // ---- zoom (mouse wheel): smooth, and anchored under the cursor ----
  // (camRef, the handler's snapshot, is declared with the other event-time refs
  // near the top — the layout tool needs it before this point.)
  const zoomTimer = useRef(0);
  // the world point a zoom gesture is aiming at, latched on the first notch
  const gestureRef = useRef({ wx: 0, wy: 0, cx: -1e9, cy: -1e9, until: 0 });
  // last touch, for the double-tap-to-recentre detector
  const tapRef = useRef({ at: 0, x: 0, y: 0 });

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (modalRef.current) return; // let modals scroll normally
      // Dev-only: Alt+scroll while a world-asset ghost is active adjusts its
      // scale live instead of zooming the camera — the fastest way to judge
      // a size is to watch it change in place, same reasoning as
      // devLayout.ts's layout.scale() console command, just live and
      // per-instance instead of console-only and per-kind.
      if (import.meta.env.DEV && e.altKey && worldAssetToolRef.current.ghost) {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
        worldAssetToolRef.current.adjustGhostScale(-e.deltaY * unit * 0.001);
        return;
      }
      e.preventDefault();
      const el = fieldRef.current;
      const c = camRef.current;
      if (!el) return;

      // normalise the delta across devices: 0 = px, 1 = lines, 2 = pages
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      const z1 = c.zoom;
      const z2 = Math.min(
        MAX_ZOOM,
        Math.max(c.minZoom, z1 * Math.exp(-e.deltaY * unit * ZOOM_SENSITIVITY)),
      );
      if (Math.abs(z2 - z1) < 1e-6) return;

      // cursor position inside the field, in the field's own unscaled units
      // (ch across / em down) — getBoundingClientRect is post-transform, so
      // divide the pixel offset back down by the fit scale first.
      const r = el.getBoundingClientRect();
      const fx = (e.clientX - r.left) / c.dims.scale / c.dims.charW;
      const fy = (e.clientY - r.top) / c.dims.scale / c.dims.lineH;

      const viewW1 = c.dims.viewW / z1;
      const viewH1 = c.dims.viewH / z1;
      const camX1 = clampCam(c.pcx + c.panX, viewW1, GROUND_W);
      const camY1 = clampCam(c.pcy + c.panY, viewH1, GROUND_H);

      // LATCH the world point under the cursor when a zoom gesture STARTS, and
      // keep aiming at that same point for the rest of the gesture. Re-reading
      // it every notch would drift forever: once the target reaches the middle,
      // a stationary (still off-centre) cursor is over a NEW point, and the
      // camera would set off chasing that one, and so on.
      const g = gestureRef.current;
      const now = e.timeStamp || performance.now();
      const mouseMoved = Math.abs(e.clientX - g.cx) > 8 || Math.abs(e.clientY - g.cy) > 8;
      if (now > g.until || mouseMoved) {
        g.wx = camX1 + fx / z1;
        g.wy = camY1 + fy / z1;
      }
      g.cx = e.clientX;
      g.cy = e.clientY;
      g.until = now + 250; // continuous scrolling counts as one gesture

      // Pull that latched point toward the screen CENTRE a bit per notch, so a
      // few notches land it in the middle; once it IS centred the term goes to
      // zero and it settles. (camX + view/2 is the world point actually at the
      // centre now — from the CLAMPED camera, so map edges don't skew the aim.)
      const centreX = camX1 + viewW1 / 2;
      const centreY = camY1 + viewH1 / 2;
      const panX = centreX + (g.wx - centreX) * ZOOM_RECENTRE - c.pcx;
      const panY = centreY + (g.wy - centreY) * ZOOM_RECENTRE - c.pcy;
      // Only bound the FOCUS to the map itself (no "keep the player framed"
      // limit) — the camera is free to leave the player behind. This also
      // stops the offset winding up to absurd values at the map edges.
      const lim = (v: number, pc: number, ground: number) =>
        Math.min(Math.max(v, -pc), ground - pc);

      setZoom(z2);
      setPan({ x: lim(panX, c.pcx, GROUND_W), y: lim(panY, c.pcy, GROUND_H) });

      // use the zoom tween until it settles
      setCamTween('zoom');
      window.clearTimeout(zoomTimer.current);
      zoomTimer.current = window.setTimeout(() => setCamTween(null), ZOOM_MS + 40);
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('wheel', onWheel);
      window.clearTimeout(zoomTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ghost cursor: while placing, track the mouse and snap to the tile under
  // it. Dedupe to actual tile changes (not every pixel of motion), same
  // convention devLayout.ts's own drag tracking uses.
  useEffect(() => {
    if (!placing) return;
    const onMove = (ev: PointerEvent) => {
      const t = screenToTile(ev.clientX, ev.clientY, fieldRef.current, camRef.current);
      if (!t) return;
      setPlacing((s) => (s && (s.x !== t.x || s.y !== t.y) ? { ...s, x: t.x, y: t.y } : s));
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [placing !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // a resize can raise the floor above the current zoom — pull it back in
  useEffect(() => {
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(minZoom, z)));
  }, [minZoom]);

  // ---- hover/click interaction (see interact.ts) ----
  // Replaces the old proximity-gated fTarget/gTarget/cropSlot + PRIO: hover
  // shows a name from anywhere on screen, click asks yes/no — range no
  // longer matters for triggering, only for whether the object is on screen
  // to click at all.
  const [hovered, setHovered] = useState<InteractRef | null>(null);

  // is the ghost's current spot a legal placement? drives both the tint and
  // whether Enter is allowed to commit.
  const placingValid = useMemo(
    () =>
      placing
        ? placementFits(
            { x: placing.x, y: placing.y, sprite: placing.owned.sprite, scale: placing.owned.scale, rotation: placing.rotation },
            ents,
            undefined,
            plot,
          )
        : false,
    [placing, ents, plot],
  );
  const placingValidRef = useRef(placingValid);
  placingValidRef.current = placingValid;

  // ---- placed-item effects on the crop beds -------------------------------
  // Each crafted item placed near the garden contributes its (already clamped)
  // modifiers to every slot inside its radius. Distance is measured from the
  // item's FOOTPRINT, not its origin tile, so a big sprite doesn't read as
  // further away than it looks.
  //
  // The final clamp is per-SLOT and deliberately applied after aggregation:
  // stacking ten -0.5 items would otherwise multiply out to ~0.001x grow time.
  // Capping the total is what makes "place more stuff" stop paying off.
  const slotEffects = useMemo<SlotEffect[]>(() => {
    const acc = plot.slots.map(() => ({ growMult: 1, toleranceMult: 1, yieldBonus: 0 }));
    for (const p of placedItems) {
      if (!p.fn) continue;
      const m = p.fn.modifiers;
      const { wT, hT } = spriteTiles(p.sprite, p.scale, p.rotation);
      for (let i = 0; i < plot.slots.length; i++) {
        if (tileDist(p.x, p.y, wT, hT, plot.slots[i].x, plot.slots[i].y) > m.radiusTiles) continue;
        acc[i].growMult *= 1 + m.growMsModifier;
        acc[i].toleranceMult *= m.waterRetentionMult;
        acc[i].yieldBonus += m.yieldBonus;
      }
    }
    return acc.map((e) => ({
      growMult: Math.min(2, Math.max(0.25, e.growMult)), // at most 4x faster / 2x slower
      toleranceMult: Math.min(8, Math.max(1, e.toleranceMult)),
      yieldBonus: Math.min(5, e.yieldBonus),
    }));
  }, [placedItems, plot]);

  const fxFor = (slot: number): SlotEffect => slotEffects[slot] ?? NO_EFFECT;

  // Which crop beds a placed item's radius covers.
  function slotsInRange(p: PlacedItem): number[] {
    if (!p.fn) return [];
    const { wT, hT } = spriteTiles(p.sprite, p.scale, p.rotation);
    const out: number[] = [];
    for (let i = 0; i < plot.slots.length; i++) {
      const s = plot.slots[i];
      if (tileDist(p.x, p.y, wT, hT, s.x, s.y) <= p.fn.modifiers.radiusTiles) out.push(i);
    }
    return out;
  }

  // grow / wilt crops on every world-clock tick
  useEffect(() => {
    setCrops((cs) => {
      let changed = false;
      const next = cs.map((c) => {
        const st = advanceStage(c, wt, fxFor(c.slot));
        if (st !== c.stage) {
          changed = true;
          return { ...c, stage: st };
        }
        return c;
      });
      return changed ? next : cs;
    });
    // slotEffects is a dep so placing/removing an item re-evaluates stages
    // immediately rather than waiting out the rest of the second.
  }, [wt, slotEffects]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- placed-item behaviors (trigger → action) ---------------------------
  // Every cap here exists to stop an item becoming an exploit. The world clock
  // ticks once a SECOND, so an ungated on_tick + grant_coins would mint money
  // forever; ungated auto-harvest would play the game for you.
  //
  //   · one fire per item per ITEM_COOLDOWN_MS, whatever the trigger
  //   · granted coins are capped per DAY across every item, not per item
  //   · harvest_area is pinned to on_crop_mature at parse time
  //     (craft/functions.ts), so its pace is bounded by real grow times
  //
  // Cooldowns live in a ref and are deliberately NOT persisted — losing a
  // 30-second timer across a reload is harmless. The daily coin total IS
  // persisted, because that's the one a reload could otherwise farm.
  const itemCooldownRef = useRef<Map<string, number>>(new Map());
  const prevStageRef = useRef<Map<string, string>>(new Map());
  const prevThirstyRef = useRef<Map<string, boolean>>(new Map());
  const prevDayRef = useRef(today);

  useEffect(() => {
    const dayChanged = prevDayRef.current !== today;
    prevDayRef.current = today;

    // Edge detection: a trigger fires on the TRANSITION, not while the
    // condition merely holds, or it would re-fire every single tick.
    const becameReady = new Set<number>();
    const becameThirsty = new Set<number>();
    for (const c of crops) {
      const prevStage = prevStageRef.current.get(c.id);
      if (prevStage !== undefined && prevStage !== 'ready' && c.stage === 'ready') {
        becameReady.add(c.slot);
      }
      prevStageRef.current.set(c.id, c.stage);

      const thirsty = c.stage === 'growing' && cropStatus(c, wt, fxFor(c.slot)).thirsty;
      const prevThirsty = prevThirstyRef.current.get(c.id);
      if (prevThirsty === false && thirsty) becameThirsty.add(c.slot);
      prevThirstyRef.current.set(c.id, thirsty);
    }
    // drop bookkeeping for crops that no longer exist
    const live = new Set(crops.map((c) => c.id));
    for (const id of [...prevStageRef.current.keys()]) if (!live.has(id)) prevStageRef.current.delete(id);
    for (const id of [...prevThirstyRef.current.keys()]) if (!live.has(id)) prevThirstyRef.current.delete(id);

    const toWater = new Set<string>();
    const toHarvest: number[] = [];
    let coinsToGrant = 0;
    let coinBudget = Math.max(0, DAILY_COIN_CAP - coinsGrantedToday);

    for (const p of placedItems) {
      const b = p.fn?.behavior;
      if (!b) continue;
      const last = itemCooldownRef.current.get(p.id) ?? -Infinity;
      if (wt - last < ITEM_COOLDOWN_MS) continue;

      const slots = slotsInRange(p);
      const fired =
        b.trigger === 'on_tick'
          ? true
          : b.trigger === 'on_day_change'
            ? dayChanged
            : b.trigger === 'on_crop_mature'
              ? slots.some((s) => becameReady.has(s))
              : slots.some((s) => becameThirsty.has(s)); // on_crop_thirsty
      if (!fired) continue;

      if (b.action === 'water_area') {
        const targets = crops.filter((c) => c.stage === 'growing' && slots.includes(c.slot));
        if (targets.length === 0) continue; // nothing to do — don't burn the cooldown
        for (const c of targets) toWater.add(c.id);
      } else if (b.action === 'harvest_area') {
        const ready = crops.filter((c) => c.stage === 'ready' && slots.includes(c.slot));
        if (ready.length === 0) continue;
        toHarvest.push(...ready.map((c) => c.slot));
      } else {
        // grant_coins — the only action that creates value from nothing
        if (coinBudget <= 0) continue;
        const pay = Math.min(COINS_PER_GRANT, coinBudget);
        coinsToGrant += pay;
        coinBudget -= pay;
      }
      itemCooldownRef.current.set(p.id, wt);
    }

    if (toWater.size > 0) soakCrops(toWater);
    if (toHarvest.length > 0) {
      // reapCrop, not harvestCrop — no per-crop toast, no modal close
      for (const slot of toHarvest) reapCrop(slot);
      showToast(`your gadgets harvested ${toHarvest.length} plant${toHarvest.length > 1 ? 's' : ''}.`);
    }
    if (coinsToGrant > 0) {
      setMoney((mo) => mo + coinsToGrant);
      setCoinGrants((g) =>
        g.day === today ? { day: today, total: g.total + coinsToGrant } : { day: today, total: coinsToGrant },
      );
    }
  }, [wt]); // eslint-disable-line react-hooks/exhaustive-deps

  function collect(e: Ent) {
    // wild spawns are derived, so collecting = recording an exception
    setRemoved((s) => new Set(s).add(e.id));
    const item = COLLECT_AS[e.kind] ?? (e.kind as ItemType);
    setInv((v) => ({ ...v, [item]: v[item] + 1 }));
  }

  function showNothing(id: string, text = 'oh nothing...', ms = 1600) {
    window.clearTimeout(nothingTimer.current);
    setNothingId(id);
    setNothingText(text);
    nothingTimer.current = window.setTimeout(() => setNothingId(null), ms);
  }

  // Where the shaken bundles come to rest. MUST match where palmFrame()
  // (palmAnim.ts) actually leaves them at the end of the fall — the bundles
  // hang from their normal attach points, but drift sideways as they fall
  // (two left, one right, clear of the trunk — see DRIFT_X_FRAC and
  // bundleLandingX() in palmAnim.ts) and settle EXACTLY on bundleLandingX(),
  // no residual sway. Using that same function here means the ground item
  // appears exactly where the fall just left it, not somewhere else.
  //
  // No `fallFrom` — the shake animation already showed them fall and land, so a
  // second CSS drop would replay it.
  function dropDates(tree: Ent) {
    const palmT = spriteTiles(S.PALM, PALM_SCALE);
    const bunchT = spriteTiles(S.DATE_FRUIT, PALM_SCALE);
    const dy = Math.max(0, palmT.hT - bunchT.hT);
    const maxX = Math.max(0, palmT.wT - bunchT.wT);
    const count = Math.random() < 0.5 ? 2 : 3;
    const dates: Ent[] = S.PALM_ANIM.bundles.slice(0, count).map((_, i) => {
      const landX = bundleLandingX(S.PALM_ANIM, i);
      const tileX = Math.round((landX * PALM_SCALE) / TILE_CH - bunchT.wT / 2);
      return {
        id: `date-${Date.now()}-${i}`,
        kind: 'date',
        x: tree.x + Math.max(0, Math.min(maxX, tileX)),
        y: tree.y + dy,
        sprite: S.DATE_FRUIT,
        interactable: true,
        // drawn at the palm's scale, so a bunch on the ground is exactly the size
        // it was when it landed
        scale: PALM_SCALE,
        palette: S.DATE_PALETTE,
        colors: S.DATE_COLORS,
      };
    });
    setDynamicEnts((es) => [...es, ...dates]);
  }

  function shakeTree(tree: Ent) {
    if (shaking) return;
    setShaking(tree.id);
    // A palm runs the generator's own fall animation — fronds sway, leaf tips
    // flicker, and the date bundles drop — but only the FIRST shake each
    // growth window, while there are still dates to drop. A palm already
    // picked clean this window has nothing left to fall, so it gets the same
    // short CSS wobble every other tree uses, plus a message explaining why.
    const isPalm = tree.kind === 'palm';
    // palms regrow their dates each growth window
    const shakeKey = `${tree.id}@${growthWindow}`;
    const hasDates = isPalm && !shaken.has(shakeKey);
    if (hasDates) setShakeFrame(0);
    window.setTimeout(
      () => {
        setShaking(null);
        setShakeFrame(null); // back to the static baked sprite
        if (hasDates) {
          setShaken((s) => new Set(s).add(shakeKey));
          dropDates(tree);
        } else if (isPalm) {
          showNothing(tree.id, 'I already picked them up. They have to grow again.', 2400);
        } else {
          showNothing(tree.id);
        }
      },
      hasDates ? SHAKE_MS : 620,
    );
  }

  // Shared by the keyboard [F] handler and TouchControls' on-screen F button:
  // "yes" while an interact confirm is open, otherwise just dismiss a
  // speech bubble — see the keydown handler below for why there's no
  // "nearest target" case any more.
  function pressF() {
    if (cinematic || mapOpen) return;
    if (modal && modal.t === 'interact') {
      const oi = optInfo(modal);
      if (oi) oi.go(0);
      return;
    }
    if (bubble) setBubble(null);
  }

  // Read-only context + the "yes" action bag for interact.ts's
  // describeInteraction/runInteraction — built fresh each render (cheap
  // object literals over values already computed this render, not worth
  // memoizing) and used by the hover tooltip, the confirm modal's question
  // text, and the confirm modal's Yes handler.
  const interactCtx: InteractCtx = { ents, crops, wt, fxFor, doors, lineColors };
  const interactActions: InteractActions = {
    collect,
    shakeTree,
    openDialog: () => setModal({ t: 'dialog', sel: 0 }),
    // the shop building skips Mitchy's dialog and opens the shop directly
    openShop: () => setModal(FRESH_SHOP),
    openHouseMenu: () => setModal({ t: 'houseMenu', sel: 0 }),
    openCropPanel: (slot) => setModal({ t: 'crop', slot }),
    toggleDoor,
    say: showToast,
    // Two-way swap: wear `hangingHex`, and whatever was worn for that region
    // takes its place on the line at `hotspotId` (see interact.ts).
    wearFromLine: (hotspotId, region, hangingHex) => {
      setOutfit((o) => {
        const wornHex =
          region === 'shorts' ? (o.shortsColor ?? DEFAULT_SHORTS_HEX) : (o.shirtColor ?? DEFAULT_SHIRT_HEX);
        setLineColors((lc) => ({ ...lc, [hotspotId]: wornHex }));
        return region === 'shorts' ? { ...o, shortsColor: hangingHex } : { ...o, shirtColor: hangingHex };
      });
    },
  };

  // ---- house storage actions ----
  function storeItem(slot: number, item: ItemType) {
    if (inv[item] <= 0) return;
    setInv((v) => ({ ...v, [item]: v[item] - 1 }));
    setStorages((ss) => ss.map((s, i) => (i === slot ? { ...s, [item]: s[item] + 1 } : s)));
  }

  function takeItem(slot: number, item: ItemType) {
    if (storages[slot][item] <= 0) return;
    setStorages((ss) => ss.map((s, i) => (i === slot ? { ...s, [item]: s[item] - 1 } : s)));
    setInv((v) => ({ ...v, [item]: v[item] + 1 }));
  }

  function storageAct(slot: number, entry: StorEntry) {
    if (entry.where === 'inv') storeItem(slot, entry.item);
    else takeItem(slot, entry.item);
    setModal((m) => (m && m.t === 'storage' ? { ...m, menuOpen: false } : m));
  }

  function showTalk() {
    window.clearTimeout(talkTimer.current);
    // Mitchy plugs the craft tokens the first time (fixed line), then chats —
    // her chatter is Haiku-generated, shown after a snappy static placeholder.
    const first = !talkedRef.current;
    talkedRef.current = true;
    if (first) {
      setBubble({ text: TOKEN_LINE, width: 30 });
      talkTimer.current = window.setTimeout(() => setBubble(null), 7000);
      return;
    }
    setBubble({ text: TALK_LINES[Math.floor(Math.random() * TALK_LINES.length)], width: 24 });
    talkTimer.current = window.setTimeout(() => setBubble(null), 6000);
    const turn = ++talkSeq.current;
    getMitchyLine('a casual idle')
      .then((line) => {
        if (talkSeq.current === turn && line) setBubble({ text: line, width: 24 });
      })
      .catch(() => {});
  }

  function toggleInventory() {
    if (savingRef.current || cinematic || mapOpen) return;
    setModal((m) => (m === null ? { t: 'inventory' } : m.t === 'inventory' ? null : m));
  }

  // ---- dialog / shop actions ----
  function confirmDialog(sel: number) {
    if (sel === 1) {
      setModal(FRESH_SHOP);
    } else {
      setModal(null);
      showTalk();
    }
  }

  // ---- buy / craft / equip ----
  function buyConfirm() {
    const m = modal;
    if (!m || m.t !== 'shop' || !m.confirm) return;
    const it = m.confirm;
    if (it.kind === 'token' && tokensLeftToday <= 0) {
      setModal({ ...m, limited: true });
      return;
    }
    if (money < it.price) {
      setModal({ ...m, poor: true });
      return;
    }
    const owned: OwnedItem = { ...it, ownedId: `own-${Date.now()}` };
    setMoney((mo) => mo - it.price);
    setBag((b) => [...b, owned]);
    if (it.kind === 'token') {
      const day = daySeedOf(wt);
      setTokenBuys((t) => (t.day === day ? { day, n: t.n + 1 } : { day, n: 1 }));
      // a bought token immediately asks what to craft
      setModal({ t: 'craft', token: owned });
    } else {
      setModal({ ...m, confirm: null, poor: false, limited: false });
    }
  }

  function equipOwned(owned: OwnedItem) {
    if (!owned.equip) return;
    if (owned.equip.mode === 'pet') {
      setPetPos({ x: Math.max(0, player.x - 2), y: player.y });
    }
    setEquipped(owned);
    setModal(null);
    if (owned.equip.mode === 'vehicle' && owned.equip.float) {
      showToast('you can sail onto the water now!');
    }
  }

  function unequip() {
    setEquipped(null);
    setPetPos(null);
  }

  // A successful craft consumes the token and yields the new item. Does NOT
  // close the modal — the workshop stays open on its folded/"done" screen, and
  // the player closes it themselves. (equip here mirrors equipOwned WITHOUT the
  // setModal(null), so the modal survives.)
  function consumeCraft(tokenId: string, item: ShopItem, equip: boolean) {
    const owned: OwnedItem = { ...item, ownedId: `own-${Date.now()}` };
    setBag((b) => [...b.filter((x) => x.ownedId !== tokenId), owned]);
    if (equip && owned.equip) {
      if (owned.equip.mode === 'pet') setPetPos({ x: Math.max(0, player.x - 2), y: player.y });
      setEquipped(owned);
      if (owned.equip.mode === 'vehicle' && owned.equip.float) showToast('you can sail onto the water now!');
    }
  }

  function startOffer(item: ItemType) {
    setModal((m) =>
      m && m.t === 'shop'
        ? { ...m, offer: { item, price: null, sel: 0, declined: false }, pick: null }
        : m,
    );
    getPrice(item).then((p) => {
      setModal((m) =>
        m && m.t === 'shop' && m.offer && m.offer.item === item && m.offer.price === null
          ? { ...m, offer: { ...m.offer, price: p } }
          : m,
      );
    });
  }

  function confirmOffer(sel: number) {
    setModal((m) => {
      if (!m || m.t !== 'shop' || !m.offer) return m;
      const o = m.offer;
      if (o.declined || o.price === null) return { ...m, offer: null };
      if (sel === 0) {
        setInv((v) => ({ ...v, [o.item]: Math.max(0, v[o.item] - 1) }));
        setMoney((mo) => mo + (o.price as number));
        setBlinkFrame(0); // Mitchy slow-blinks at you — a happy cat's thank-you
        return { ...m, offer: null };
      }
      return { ...m, offer: { ...o, declined: true } };
    });
  }

  function escClose() {
    setModal((m) => {
      if (!m) return m;
      if (m.t === 'detail' || m.t === 'detailOwned') return { t: 'inventory' };
      if (m.t === 'shop' && m.confirm) return { ...m, confirm: null, poor: false };
      if (m.t === 'shop' && (m.offer || m.pick)) return { ...m, offer: null, pick: null };
      if (m.t === 'storage') {
        return m.menuOpen ? { ...m, menuOpen: false } : { t: 'houseMenu', sel: m.slot };
      }
      if (m.t === 'craft') {
        if (m.confirmClose) return { ...m, confirmClose: false }; // Esc on the confirm = keep crafting
        if (craftDoneRef.current) return null; // finished → exit is free
        return { ...m, confirmClose: true }; // otherwise confirm (token safe in inventory)
      }
      return null;
    });
  }

  function xClose() {
    setModal((m) => {
      if (!m) return m;
      if (m.t === 'detail' || m.t === 'detailOwned') return { t: 'inventory' };
      if (m.t === 'craft') {
        if (craftDoneRef.current) return null;
        return { ...m, confirmClose: true };
      }
      return null;
    });
  }

  // ---- unified option-window logic ----
  // Every modal that shows a selectable option list describes itself here, so
  // arrow-key/enter handling (and future option windows) stay consistent.
  function optInfo(
    m: Exclude<Modal, null>,
  ): { sel: number; n: number; upd: (sel: number) => Modal; go: (sel: number) => void } | null {
    if (m.t === 'dialog') {
      return { sel: m.sel, n: 2, upd: (s) => ({ ...m, sel: s }), go: confirmDialog };
    }
    if (m.t === 'houseMenu') {
      return {
        sel: m.sel,
        n: STORAGE_SLOTS,
        upd: (s) => ({ ...m, sel: s }),
        go: (s) => setModal({ t: 'storage', slot: s, sel: 0, menuOpen: false }),
      };
    }
    if (m.t === 'shop' && m.confirm) {
      return {
        sel: m.csel,
        n: 2,
        upd: (s) => ({ ...m, csel: s }),
        go: (s) => (s === 0 ? buyConfirm() : setModal({ ...m, confirm: null, poor: false })),
      };
    }
    if (m.t === 'shop' && m.offer) {
      const o = m.offer;
      return {
        sel: o.sel,
        n: 2,
        upd: (s) => ({ ...m, offer: { ...o, sel: s } }),
        go: confirmOffer,
      };
    }
    if (m.t === 'detailOwned') {
      const owned = bag.find((o) => o.ownedId === m.ownedId);
      if (!owned) return null;
      const { labels, pick } = ownedOptList(owned);
      if (labels.length === 0) return null;
      return {
        sel: m.sel,
        n: labels.length,
        upd: (s) => ({ ...m, sel: s }),
        go: (s) => pick(s),
      };
    }
    if (m.t === 'interact') {
      return {
        sel: m.sel,
        n: 2, // 0 = Yes, 1 = No
        upd: (s) => ({ ...m, sel: s }),
        // Close FIRST, then act: several interactions (the house's storage
        // menu, the shop, Mitchy's dialog) open a modal of their own, and
        // closing afterwards would immediately wipe it out again — both
        // setModal calls land in the same React batch, so the last one wins.
        go: (s) => {
          setModal(null);
          if (s === 0) runInteraction(m.ref, interactCtx, interactActions);
        },
      };
    }
    return null;
  }

  function ownedAction(owned: OwnedItem) {
    if (owned.kind === 'token') {
      setModal({ t: 'craft', token: owned });
    } else if (equipped?.ownedId === owned.ownedId) {
      unequip();
      setModal({ t: 'inventory' });
    } else {
      equipOwned(owned);
    }
  }

  // Options for an owned item's detail panel (shared by keyboard + click).
  function ownedOptList(owned: OwnedItem): { labels: string[]; pick: (i: number) => void } {
    const isEquipped = equipped?.ownedId === owned.ownedId;
    const canPlant = owned.kind !== 'token' && (owned.category === 'plant' || owned.category === 'food');
    // Any owned item can be placed in the world, except tokens (same
    // exclusion "Plant in garden" already uses — a token isn't a real object).
    const canPlace = owned.kind !== 'token';
    const labels: string[] = [];
    if (owned.kind === 'token') labels.push('Use token');
    else if (owned.equip) labels.push(isEquipped ? 'Unequip' : 'Equip');
    if (canPlant) labels.push('Plant in garden');
    if (canPlace) labels.push('Place in world');
    return {
      labels,
      pick: (i) => {
        const label = labels[i];
        if (label === 'Plant in garden') return plantOwned(owned);
        if (label === 'Place in world') return startPlacement(owned);
        return ownedAction(owned);
      },
    };
  }

  // ---- farming ----
  function freeSlot(): number {
    for (let i = 0; i < plot.slots.length; i++) if (!crops.some((c) => c.slot === i)) return i;
    return -1;
  }

  function plantBase(it: ItemType) {
    if (inv[it] <= 0) return;
    const slot = freeSlot();
    if (slot < 0) {
      setModal(null);
      showToast('the garden bed is full!');
      return;
    }
    setInv((v) => ({ ...v, [it]: v[it] - 1 }));
    setCrops((cs) => [
      ...cs,
      createCrop(slot, ITEM_INFO[it].name, ITEM_SPRITES[it], 'plant', { kind: 'base', it }, wt),
    ]);
    setModal(null);
    showToast(`planted a ${ITEM_INFO[it].name.toLowerCase()}!`);
  }

  function plantOwned(o: OwnedItem) {
    const slot = freeSlot();
    if (slot < 0) {
      setModal(null);
      showToast('the garden bed is full!');
      return;
    }
    setBag((b) => b.filter((x) => x.ownedId !== o.ownedId));
    if (equipped?.ownedId === o.ownedId) unequip();
    setCrops((cs) => [...cs, createCrop(slot, o.name, o.sprite, o.category, { kind: 'owned', item: o }, wt)]);
    setModal(null);
    showToast(`planted ${o.name}!`);
  }

  // ---- free-form world placement (ghost cursor, mouse-driven) ----
  function startPlacement(o: OwnedItem) {
    setModal(null);
    // seed at the player's own tile so a valid-looking ghost exists before
    // the first mousemove ever fires
    setPlacing({ owned: o, x: player.x, y: player.y, rotation: 0 });
  }

  function cancelPlacement() {
    setPlacing(null);
  }

  function rotatePlacement() {
    setPlacing((s) => (s ? { ...s, rotation: (((s.rotation + 1) % 4) as 0 | 1 | 2 | 3) } : s));
  }

  function commitPlacement() {
    const p = placingRef.current;
    if (!p) return;
    const placed = ownedToPlaced(p.owned, p.x, p.y, p.rotation, `placed-${Date.now()}-${Math.floor(Math.random() * 1000)}`);
    setPlacedItems((ps) => [...ps, placed]);
    setBag((b) => b.filter((x) => x.ownedId !== p.owned.ownedId));
    if (equipped?.ownedId === p.owned.ownedId) unequip();
    setPlacing(null);
    showToast(`placed ${p.owned.name}!`);
  }

  function pickupPlaced(id: string) {
    const p = placedItems.find((x) => x.id === id);
    if (!p) return;
    setPlacedItems((ps) => ps.filter((x) => x.id !== id));
    setBag((b) => [...b, placedToOwned(p, `own-${Date.now()}-${Math.floor(Math.random() * 1000)}`)]);
    setPickupMenuId(null);
    showToast(`returned ${p.name} to inventory`);
  }

  function toggleDoor(d: DoorId) {
    setDoors((ds) => ({ ...ds, [d]: !ds[d] }));
  }

  // The watering itself, with no tool check — shared by the player's can and
  // by a placed item's water_area action (which has no equipment to check).
  function soakCrops(ids: Set<string>) {
    setCrops((cs) => cs.map((c) => (ids.has(c.id) ? { ...c, lastWateredAt: wt } : c)));
  }

  // Water crops (all growing ones, or just the given slot). Needs the can.
  function waterCrops(slot?: number) {
    if (equipped?.tool !== 'water') {
      showToast('equip your watering can first!');
      return;
    }
    const targets = crops.filter(
      (c) => c.stage === 'growing' && (slot === undefined || c.slot === slot),
    );
    if (targets.length === 0) {
      showToast('nothing to water right now.');
      return;
    }
    soakCrops(new Set(targets.map((c) => c.id)));
    showToast(`splash! watered ${targets.length} plant${targets.length > 1 ? 's' : ''}.`);
  }

  // The harvest itself, with no UI side effects — shared by the player's own
  // harvest and by a placed item's harvest_area action, which fires for
  // several beds at once and must not stack a toast (or close a modal) per
  // crop. Returns what it yielded so the caller can word its own message.
  function reapCrop(slot: number): string | null {
    const c = crops.find((x) => x.slot === slot);
    if (!c || c.stage !== 'ready') return null;
    // Extra crops from any placed item covering this bed (already clamped).
    const bonus = fxFor(slot).yieldBonus;
    setCrops((cs) => cs.filter((x) => x.slot !== slot));
    if (c.harvest.kind === 'base') {
      const it = c.harvest.it;
      const n = 2 + bonus;
      setInv((v) => ({ ...v, [it]: v[it] + n }));
      return `${n} ${ITEM_INFO[it].name.toLowerCase()}`;
    }
    const item = c.harvest.item;
    const n = 1 + bonus;
    // suffixed — Date.now() alone repeats when several land in one ms
    const copies = Array.from({ length: n }, (_, i) => ({
      ...item,
      ownedId: `own-${Date.now()}-${i}-${Math.floor(Math.random() * 1000)}`,
    }));
    setBag((b) => [...b, ...copies]);
    return n > 1 ? `${n}x ${item.name}` : item.name;
  }

  function harvestCrop(slot: number) {
    const yielded = reapCrop(slot);
    if (!yielded) return;
    showToast(`harvested ${yielded}!`);
    setModal(null);
  }

  function clearCrop(slot: number) {
    setCrops((cs) => cs.filter((x) => x.slot !== slot));
    setModal(null);
    showToast('cleared the withered plant.');
  }

  // ---- keyboard ----
  const handlerRef = useRef<(e: KeyboardEvent) => void>(() => {});
  handlerRef.current = (ev: KeyboardEvent) => {
    const k = ev.key.toLowerCase();
    // Ctrl+S: download-only backup — a true global shortcut, checked before
    // every other mode so it always works regardless of what else is going
    // on (same precedence reasoning as the ghost-mode check right below
    // it). !shiftKey leaves Ctrl+Shift+S ("Save As") to the browser.
    if ((ev.ctrlKey || ev.metaKey) && !ev.shiftKey && k === 's') {
      ev.preventDefault(); // stop the browser's native "Save Page" dialog
      if (!ev.repeat) downloadBackup();
      return;
    }
    // Full input lock while the save indicator is showing — the write/
    // download itself already completed synchronously inside
    // downloadBackup()/saveGameToStorage() above; this is purely honoring
    // "can't move nor interact" for the indicator's cosmetic duration.
    if (savingRef.current) return;
    // Intro Part B owns every key while it's running — including M, so
    // Mitchy's dialogue mentioning it only teaches the control, it doesn't
    // unlock it early. The cinematic's own dialogue box/name entry have
    // their own separate keydown listeners for advancing/choosing/typing.
    if (cinematicRef.current) return;
    // The map blocks world interaction while open, but M (and Esc) still
    // close it.
    if (mapOpenRef.current) {
      if (k === MAP_KEY || k === 'escape') {
        ev.preventDefault();
        setMapOpen(false);
      }
      return;
    }
    // Placement mode is deliberately NOT a Modal — the world stays visible
    // and interactive-looking behind the ghost — so it's checked first, ahead
    // of the modal branch below, and swallows every other key while active
    // (mouse-driven, not WASD).
    // Dev-only world-asset ghost — same f/enter/escape convention as the
    // player's own placement mode above, checked first so the two modes can
    // never fight over the same keys (they're not expected to run at once,
    // but this keeps the precedence unambiguous either way).
    if (import.meta.env.DEV && worldAssetTool.ghost) {
      if (k === 'escape') { worldAssetTool.cancelGhost(); return; }
      if (k === 'f') { worldAssetTool.rotateGhost(); return; }
      if (k === 'enter') { worldAssetTool.commitGhost(); return; }
      return;
    }
    if (placingRef.current) {
      if (k === 'escape') { cancelPlacement(); return; }
      if (k === 'f') { rotatePlacement(); return; }
      if (k === 'enter') { if (placingValidRef.current) commitPlacement(); return; }
      return;
    }
    if (pickupMenuIdRef.current && k === 'escape') {
      setPickupMenuId(null);
      return;
    }
    if (modal) {
      if (k === 'escape') {
        ev.preventDefault();
        escClose();
        return;
      }
      if (modal.t === 'storage') {
        const list = storageList(storages[modal.slot], inv);
        const n = list.length;
        const sel = Math.min(modal.sel, Math.max(0, n - 1));
        if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
          ev.preventDefault();
          if (n > 0) {
            const step = ev.key === 'ArrowDown' ? 1 : n - 1;
            setModal({ ...modal, sel: (sel + step) % n, menuOpen: false });
          }
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          if (n === 0) return;
          if (!modal.menuOpen) setModal({ ...modal, sel, menuOpen: true });
          else storageAct(modal.slot, list[sel]);
        }
        return;
      }
      const oi = optInfo(modal);
      if (oi) {
        if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
          ev.preventDefault();
          const step = ev.key === 'ArrowDown' ? 1 : oi.n - 1;
          setModal(oi.upd((oi.sel + step) % oi.n));
        } else if (ev.key === 'Enter') {
          ev.preventDefault();
          oi.go(oi.sel);
        } else if (modal.t === 'interact' && k === 'f') {
          // [F] always means "yes" here, regardless of which option is
          // currently highlighted — not "confirm the highlighted one".
          ev.preventDefault();
          pressF();
        }
      } else if (
        (modal.t === 'inventory' || modal.t === 'detail' || modal.t === 'detailOwned') &&
        k === 'i'
      ) {
        setModal(null);
      }
      return;
    }
    if (DIRS[k]) {
      if (!ev.repeat) holdStart(k);
    } else if (k === 'shift') setDash(true);
    else if (k === 'f') pressF();
    else if (k === 'i') setModal({ t: 'inventory' });
    else if (k === MAP_KEY) {
      if (!ev.repeat && !modal) setMapOpen(true);
    } else if (k === ' ') {
      ev.preventDefault(); // don't let the page scroll
      if (!ev.repeat) recentre(); // snap the camera back to the player
    }
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => handlerRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ---- world-layer bubble/popup positions ----
  let bubbleEl = null;
  if (bubble) {
    const str = S.makeBubble(bubble.text, bubble.width);
    const lines = str.split('\n');
    const w = Math.max(...lines.map((l) => l.length));
    const left = Math.max(0, Math.min(catDef.x * TILE_CH - 3, GROUND_W - w));
    const top = Math.max(0, catDef.y * TILE_LN - lines.length);
    bubbleEl = (
      <pre className="bubble" style={{ left: `${left}ch`, top: `${top}em` }}>
        {str}
      </pre>
    );
  }

  const nothingEnt = nothingId ? ents.find((e) => e.id === nothingId) : null;

  // ---- camera: follows the player, clamped to the map edges ----
  const viewW = dims.viewW / zoom; // world chars visible (measured, not fixed)
  const viewH = dims.viewH / zoom; // world lines visible
  const pcx = (player.x + PLAYER_T.wT / 2) * TILE_CH;
  const pcy = (player.y + PLAYER_T.hT / 2) * TILE_LN;
  // The camera follows the player, plus whatever pan the zoom introduced. The
  // pan is free (the player may be off screen); only the map edges clamp it.
  const panX = pan.x;
  const panY = pan.y;
  const camX = clampCam(pcx + panX, viewW, GROUND_W);
  const camY = clampCam(pcy + panY, viewH, GROUND_H);
  // keep the wheel handler's snapshot current (read at event time, not render)
  camRef.current = { zoom, minZoom, pcx, pcy, panX, panY, camX, camY, dims };
  const speedMult = equipped?.equip?.mode === 'vehicle' ? (equipped.equip.speedMult ?? 1) : 1;
  // step cadence in seconds; slowed while gliding along a collider so the
  // transition matches the (also-slowed) step rate and stays continuous.
  // Scaled by the LAST step's actual direction so a vertical or diagonal step
  // takes proportionally longer, covering more true pixels in the same time
  // as a horizontal one — see speedScale/CELL_ASPECT above.
  const stepDur =
    (((dash ? DASH_MS : WALK_MS) * speedMult) / 1000) *
    (sliding ? GLIDE_SLOW : 1) *
    speedScale(lastDelta[0], lastDelta[1]);
  // The glide runs slightly LONGER than the step cadence so the tween is still
  // in flight when the next step lands — otherwise the sprite finishes early
  // and pauses for the frame-quantised gap before the next step, a stutter
  // that's worst while sprinting (shortest cadence). +25ms clears a ~16ms
  // frame of jitter with margin. Rig and camera share it to stay in lockstep.
  const glideDur = stepDur + 0.025;
  // Shared by the camera AND the player-rig. While a camTween override is
  // running (zoom/recentre), the rig must use the SAME duration+easing —
  // otherwise moving during that ~150-320ms window makes the rig glide on
  // glideDur/linear while the camera re-centers on a different curve, a
  // visible desync between the two that reads as the player lagging behind
  // (or ahead of) the camera. Outside a tween, both fall back to glideDur.
  const worldTransition =
    camTween === 'zoom'
      ? `transform ${ZOOM_MS}ms ease-out`
      : camTween === 'recentre'
        ? `transform ${RECENTRE_MS}ms ease-in-out`
        : `transform ${glideDur}s linear`;

  // The current walk-cycle frame, if any (see walkDir/walkFrame above) —
  // swapped in for the static portrait while W/A/S/D is held, with its own
  // palette. It's a different reference pass from PLAYER's own straw-hat art
  // (see the WALK CYCLES comment in sprites.ts) with a different character
  // grid, so it's rescaled below to match PLAYER's on-screen height rather
  // than reusing PLAYER_SCALE as-is — otherwise the character would visibly
  // grow or shrink the instant you start/stop walking.
  const cycle = walkDir ? WALK_CYCLES[walkDir] : null;
  const walkAnim = cycle
    ? { frame: cycle.frames[walkFrame], palette: cycle.palette, padTop: cycle.padTop }
    : null;
  const baseSprite = walkAnim ? walkAnim.frame.sprite : character.sprite;
  const baseColors = walkAnim ? walkAnim.frame.colors : character.colors;
  const basePalette = walkAnim ? walkAnim.palette : character.palette;
  // Which cells are the shirt/shorts for whatever's currently on screen —
  // baked directly into each walk frame / the static portrait (see
  // sprites.ts's WalkFrame and PLAYER_SHIRT_MASK/PLAYER_SHORTS_MASK), not
  // looked up from a hand-maintained table.
  const baseShirtMask = walkAnim ? walkAnim.frame.shirtMask : character.shirtMask;
  const baseShortsMask = walkAnim ? walkAnim.frame.shortsMask : character.shortsMask;
  // Outfit recolor (see outfit.ts) — a no-op passthrough (same objects back)
  // when nothing's been picked yet, so this costs nothing for most players.
  const recolored = useMemo(
    () => applyOutfit(baseSprite, baseColors, basePalette, baseShirtMask, baseShortsMask, outfit),
    [baseSprite, baseColors, basePalette, baseShirtMask, baseShortsMask, outfit],
  );
  const displaySprite = recolored.sprite;
  const displayColors = recolored.colors;
  const displayPalette = recolored.palette;
  // The HUD avatar (bottom-left) always shows the STATIC portrait, even
  // while walking (it's not animated), so it needs its own recolor rather
  // than reusing `recolored` above — that one follows whichever walk frame
  // is currently on screen. Same outfit, same masks, just always applied to
  // character.face/faceColors instead of baseSprite/baseColors.
  const avatarRecolored = useMemo(
    () =>
      applyOutfit(
        character.face,
        character.faceColors,
        character.palette,
        character.shirtMask,
        character.shortsMask,
        outfit,
      ),
    [character.face, character.faceColors, character.palette, character.shirtMask, character.shortsMask, outfit],
  );

  // The player sprite is drawn at PLAYER_SCALE (world.ts), same trick as the
  // palm/house/bridge: keep the full sampled character grid and shrink it
  // with CSS `scale`, pivoting on the bottom-centre (see .player-sprite in
  // styles.css) so the player's FEET stay planted at its tile position
  // instead of the render's top-left corner. offX/offY are what keep the
  // shrunk sprite's visual top-left lined up with that pivot math — same
  // formula the generic Ent renderer uses for every other scaled entity.
  //
  // The height-match ratio below is over CONTENT rows only (displaySprite's
  // length minus its padTop) — a walk frame's array can be taller than what
  // it actually draws, padded with blank rows to give a limb room to
  // translate upward (see WALK_DOWN_PAD_TOP's comment in sprites.ts).
  // Dividing by the full padded length would size the character as if it
  // were that much taller than it really is and shrink it below the static
  // portrait the instant you start walking.
  const contentRows = displaySprite.length - (walkAnim?.padTop ?? 0);
  const playerK = walkAnim ? (PLAYER_SCALE * character.sprite.length) / contentRows : PLAYER_SCALE;
  const playerW = Math.max(...displaySprite.map((l) => l.length));
  const playerOffX = ((1 - playerK) * playerW) / 2;
  // Anchor math uses the FULL padded height, not contentRows — the padding
  // is real empty rows at the top of the rendered box, and scale() shrinks
  // the whole box uniformly, so the bottom-anchor offset must match what's
  // actually on screen or the feet drift off their tile.
  const playerOffY = (1 - playerK) * displaySprite.length;

  // Attachment sockets, in the SPRITE's own unscaled char grid — roughly the
  // right shoulder/hand, where the overalls meet the shirt. Proportional to
  // the sprite's own size (not a fixed magic number) so they track future
  // art changes, but this is still an approximation for a 44x22 portrait,
  // not a precise joint the way the old 8x6 sprite's rows were. Pinned to the
  // STATIC portrait's own grid (not displaySprite) so an equipped item's
  // socket doesn't jump around as the walk cycle swaps in differently-sized
  // frames.
  const idleW = Math.max(...character.sprite.map((l) => l.length));
  const HAND_X = Math.round(idleW * 0.73);
  const HAND_Y = Math.round(character.sprite.length * 0.82);

  // The three planetary buttons, in orbit order (top -> right). Order matches
  // ORBIT_ANGLES / ORBIT_POS. `keep` = don't collapse the orbit on click
  // (the hand slot opens its own popup right next to itself).
  // `tint` fills the button's circle (no outline — see .hud-orbit-btn), one
  // colour per slot so each reads at a glance the way the design sketch does.
  // Hue follows the sketch; LIGHTNESS is set against each icon's own art,
  // which has its colours baked in: the gear is light (median luminance ~196)
  // so it needs a deep disc, the bag is dark (~106) so it needs a pale one,
  // and the hand is near-white (~238) and sits on the sketch's orange as-is.
  // Matching the sketch's lightness instead made the gear and bag vanish.
  const ORBIT_ITEMS = [
    {
      id: 'settings',
      label: 'SETTINGS',
      tint: '#6b6b94',
      node: <img className="hud-orbit-icon" src={gearIcon} alt="" />,
      keep: false,
      run: () => setModal({ t: 'settings' }),
    },
    {
      id: 'inventory',
      label: 'INVENTORY',
      tint: '#e0a9b0',
      node: <img className="hud-orbit-icon" src={inventoryIcon} alt="" />,
      keep: false,
      run: () => setModal({ t: 'inventory' }),
    },
    {
      id: 'hand',
      label: 'HAND SLOT',
      tint: '#e2894a',
      // shows the equipped item itself; falls back to the hand icon when empty
      node: equipped ? (
        <ColoredSprite
          sprite={equipped.sprite}
          colors={equipped.colors}
          palette={equipped.palette}
          color={equipped.color}
          texture={equipped.textureModifier}
        />
      ) : (
        <img className="hud-orbit-icon" src={handSlotIcon} alt="" />
      ),
      keep: true,
      run: () => setHandMenu((v) => !v),
    },
  ];

  // Avatar art: the FACE crop, not the full body — at 44x22 the full sampled
  // player sprite is far too big to fit a 104px circle at any legible font
  // size, the way the old 7x3 sprite comfortably could. Every row padded to
  // the same width so the <pre> box is exactly the sprite's grid (no
  // max-content slack to drift inside of).
  const avatarCols = Math.max(...character.face.map((l) => l.length));
  const avatarSprite = character.face.map((l) => l.padEnd(avatarCols, ' '));

  const timeStr = formatWorldTime(wt);
  const secsToRefresh = Math.ceil((HOUR_MS - (wt % HOUR_MS)) / 1000);
  const refreshStr = `${String(Math.floor(secsToRefresh / 60)).padStart(2, '0')}:${String(
    secsToRefresh % 60,
  ).padStart(2, '0')}`;

  // ---- GameMap's character registry (player + Mitchy today) ----
  // A future NPC is added here — id, display name, a live-position getter,
  // a head representation (sprite/colors/palette or a plain `color` for a
  // mono sprite like Mitchy's) and nothing else needs to change in
  // GameMap.tsx itself.
  const mapCharacters: MapCharacterEntry[] = useMemo(
    () => [
      {
        id: 'player',
        name: playerName,
        getPos: () => playerRef.current,
        sprite: avatarSprite,
        colors: avatarRecolored.colors,
        palette: avatarRecolored.palette,
        ringColor: 'var(--ui-accent)',
      },
      {
        id: 'cat',
        name: MITCHY_NAME,
        // `catDef` (from `ents`) already reflects mitchyPos — see the ents
        // useMemo's 'cat' override above — so this is always his true
        // current position, cinematic or not.
        getPos: () => catDef,
        sprite: S.CAT,
        color: '#e9dcc1', // matches .ent.cat / .portrait.cat — Mitchy has no colour grid
        ringColor: 'var(--ui-petal-core)',
      },
    ],
    [playerName, avatarSprite, avatarRecolored, catDef],
  );

  return (
    <div className="app">
      {/* HUD overlay — floats above the world; only its controls take clicks */}
      <div
        className="hud"
        style={{ '--hud-avatar': `${HUD_AVATAR}px`, '--hud-btn': `${HUD_BTN}px` } as React.CSSProperties}
      >
        <div className="hud-tl">
          <div className={'hud-clock' + (isNightOf(wt) ? ' night' : '')}>
            {isNightOf(wt) ? (
              <MoonIcon className="hud-clock-icon" />
            ) : (
              <SunIcon className="hud-clock-icon" />
            )}
            <span className="hud-clock-time">{timeStr}</span>
          </div>
        </div>

        {saving && (
          <div className="hud-tc">
            <SaveIcon className="hud-tc-icon" />
            <span className="hud-tc-label">Saving…</span>
          </div>
        )}

        <div className="hud-bl">
          <div className="hud-avatar-wrap">
            <button
              className="hud-avatar"
              title={character.name}
              aria-expanded={orbitOpen}
              aria-label="player menu"
              onClick={() => {
                setOrbitOpen((o) => !o);
                setHandMenu(false);
              }}
            >
              {/* The face crop fills (and slightly overflows) the circle —
                  .hud-avatar clips it with overflow:hidden. Rows are padded
                  to one width and the box is pinned to an exact `ch` count:
                  with ragged rows the <pre> is sized by max-content, and any
                  slack in that box makes flex centre the BOX while the ink
                  sits off to one side. */}
              <ColoredSprite
                style={{ width: `${avatarCols}ch` }}
                sprite={avatarSprite}
                colors={avatarRecolored.colors}
                palette={avatarRecolored.palette}
              />
            </button>

            <div className={'hud-orbit' + (orbitOpen ? ' open' : '')} aria-hidden={!orbitOpen}>
              {/* dashed connectors, trimmed so they stop at the button rims */}
              <svg
                className="hud-orbit-arcs"
                viewBox={ORBIT_VIEWBOX}
                width={ORBIT_BOX}
                height={ORBIT_BOX}
                style={{ left: -ORBIT_C, top: -ORBIT_C }}
              >
                {ORBIT_ARCS.map((d, i) => (
                  <path key={i} d={d} />
                ))}
              </svg>

              {ORBIT_ITEMS.map((it, i) => (
                <div
                  key={it.id}
                  className="hud-orbit-item"
                  style={
                    {
                      '--tx': `${ORBIT_POS[i].x}px`,
                      '--ty': `${ORBIT_POS[i].y}px`,
                      '--btn-tint': it.tint,
                      transitionDelay: `${i * 45}ms`,
                    } as React.CSSProperties
                  }
                >
                  <button
                    className="hud-orbit-btn"
                    aria-label={it.label}
                    tabIndex={orbitOpen ? 0 : -1}
                    onClick={() => {
                      if (!it.keep) {
                        setOrbitOpen(false);
                        setHandMenu(false);
                      }
                      it.run();
                    }}
                  >
                    {it.node}
                  </button>
                  <span className="hud-orbit-label">{it.label}</span>

                  {/* equip/unequip popup — a flex sibling, so it sits directly
                      to the right of the hand slot at the icon's height */}
                  {it.id === 'hand' && handMenu && (
                    <div className="hud-hand-menu">
                      {/* already holding something -> nothing to equip */}
                      <button
                        disabled={!!equipped}
                        onClick={() => {
                          setHandMenu(false);
                          setOrbitOpen(false);
                          setModal({ t: 'inventory', equipPick: true });
                        }}
                      >
                        Equip
                      </button>
                      {/* hand empty -> nothing to take off */}
                      <button
                        disabled={!equipped}
                        onClick={() => {
                          unequip();
                          setHandMenu(false);
                        }}
                      >
                        Unequip
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="hud-coins" title="money">
            <CoinIcon className="hud-coin-icon" />
            <span className="hud-coin-amount">: {money}</span>
          </div>
        </div>

        {modal &&
          modal.t !== 'craft' &&
          modal.t !== 'inventory' &&
          modal.t !== 'detail' &&
          modal.t !== 'detailOwned' && (
            <button className="hud-x" onClick={xClose} aria-label="close">
              &#215;
            </button>
          )}
      </div>

      <div
        className="stage"
        ref={stageRef}
        // double-tap anywhere on the world = recentre on the player (mobile
        // equivalent of Space). Tracked manually rather than via dblclick,
        // which is unreliable on touch.
        onPointerUp={(e) => {
          if (e.pointerType === 'mouse') return; // mouse uses Space
          const now = e.timeStamp || performance.now();
          const t = tapRef.current;
          const near = Math.abs(e.clientX - t.x) < 40 && Math.abs(e.clientY - t.y) < 40;
          if (now - t.at < 320 && near) {
            recentre();
            t.at = 0; // consume, so a third tap starts fresh
          } else {
            t.at = now;
            t.x = e.clientX;
            t.y = e.clientY;
          }
        }}
      >
        {/* dev-only tile readout — so you can read a position straight off the
            screen instead of inferring it. Stripped from production builds.
            Tied to the SAME "editor open" gate as the tile-grid/asset panel —
            devLayout.ts's own cursor tracking has no activity gate of its own
            (it updates on every pointer move over the field regardless of
            whether alt+drag is in use), so without this it showed constantly,
            not just while actually editing. */}
        {import.meta.env.DEV && worldAssetTool.panelOpen && cursor && (
          <div className="layout-readout">
            {dragId ? `${dragId} → ` : ''}
            {cursor.x}, {cursor.y}
          </div>
        )}
        {import.meta.env.DEV && (
          <DevAssetPanel tool={worldAssetTool} markerTool={sceneMarkerTool} introTool={introNarrationTool} />
        )}
        <div
          className="scale-box"
          style={{ width: dims.w * dims.scale, height: dims.h * dims.scale }}
        >
          <div style={{ transform: `scale(${dims.scale})`, transformOrigin: '0 0' }}>
            <div
              className="field"
              ref={fieldRef}
              style={{ width: dims.w, height: dims.h }}
              onDragOver={
                import.meta.env.DEV
                  ? (e) => {
                      // required for onDrop to ever fire at all — browsers
                      // reject a drop by default unless dragover explicitly
                      // allows it
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'copy';
                    }
                  : undefined
              }
              onDrop={
                import.meta.env.DEV
                  ? (e) => {
                      e.preventDefault();
                      const data = e.dataTransfer.getData('text/plain');
                      if (!data) return;
                      const t = screenToTile(e.clientX, e.clientY, fieldRef.current, camRef.current);
                      if (!t) return;
                      // Scene marker chips are dragged with a distinct payload
                      // prefix (see DevAssetPanel.tsx's SceneMarkingsPanel) so
                      // this one drop target can route to either placement
                      // system without them colliding on a bare slug string.
                      if (data.startsWith('scene-marker:')) {
                        sceneMarkerTool.dropMarker(data.slice('scene-marker:'.length), t.x, t.y);
                      } else {
                        worldAssetTool.startGhost(data, t.x, t.y);
                      }
                    }
                  : undefined
              }
            >
              {/* Dark backdrop — same as the starting page (#0a0a0a, in CSS).
                  The world is ASCII signs on this dark canvas; only the signs
                  themselves switch colour with the day/night palette. */}
              <div className="sky-bg" />
              <div
                className="world"
                ref={worldRef}
                style={{
                  width: `${GROUND_W}ch`,
                  height: `${GROUND_H}em`,
                  // The camera is ONE composited transform — pan included —
                  // instead of animating left/top. Animating left/top re-ran
                  // layout across the whole 320x200-char world every frame and
                  // put glyphs on fractional baselines: that was the up/down
                  // shake. translate3d keeps it on the GPU.
                  // The translate is the PRE-MULTIPLIED product (-cam*zoom),
                  // not translate(-cam) scale(zoom): interpolating the product
                  // stays affine in zoom, so the tween can't bow sideways.
                  transform: `translate3d(${-camX * zoom}ch, ${-camY * zoom}em, 0) scale(${zoom})`,
                  transition: worldTransition, // matches the rig, keeps lockstep
                }}
              >
              <CoastBackgroundLayer />
              <OceanLayer camX={camX} camY={camY} viewW={viewW} viewH={viewH} />
              {landLayers.map((l) => (
                <pre key={l.region} className={'ground region-' + l.region}>
                  {l.text}
                </pre>
              ))}
              <ShoreLayer />


              {/* garden: the baked bed (picket fence + soil), then a sprite per
                  slot. The gate is part of that one picture, so opening it
                  swaps in the variant with the opening cleared rather than
                  redrawing a fence. Same offset/scale maths as the entity map
                  below: .garden-bed scales about its bottom-centre, so the
                  offsets put the scaled top-left back on the plot's corner —
                  wherever the layout tool has dragged that corner to. */}
              {!(import.meta.env.DEV && worldAssetTool.removedStructIds.has('garden-bed')) &&
                (() => {
                const open = doors.gate;
                const bed = open ? S.GARDEN_BED : S.GARDEN_BED_SHUT;
                const bedColors = open ? S.GARDEN_BED_COLORS : S.GARDEN_BED_SHUT_COLORS;
                const k = GARDEN_BED_SCALE;
                const cw = Math.max(...bed.map((l) => l.length));
                const offX = ((1 - k) * cw) / 2;
                const offY = (1 - k) * bed.length;
                return (
                  <ColoredSprite
                    className="garden-bed"
                    style={{
                      left: `${plot.rect.x0 * TILE_CH - offX}ch`,
                      top: `${plot.rect.y0 * TILE_LN - offY}em`,
                      // the plot's TOP row, not its bottom: crop slots sit at
                      // `slot.y + 1`, so anything higher here would paint the
                      // bed over the plants growing in it
                      zIndex: plot.rect.y0,
                      scale: `${k}`,
                    }}
                    sprite={bed}
                    colors={bedColors}
                    palette={S.GARDEN_BED_PALETTE}
                    // same density-ramp glyphs as the house (†·¤‡¬§Ø…), several
                    // of which the font renders double-width — pin one per cell
                    perCell
                    // same per-cell occlusion as the house — see .garden-bed's
                    // own CSS comment for why the old rectangular
                    // background: var(--sky-bg) is no longer needed
                    solidCells
                  />
                );
              })()}
              {/* Invisible hit-area over the gate — the bed above is one baked
                  sprite with no DOM node of its own for the gate, so hover and
                  click need their own small overlay. */}
              <div
                className="door-hitbox"
                style={{
                  left: `${plot.door.c0 * TILE_CH}ch`,
                  top: `${plot.rect.y1 * TILE_LN}em`,
                  width: `${(plot.door.c1 - plot.door.c0 + 1) * TILE_CH}ch`,
                  height: `${TILE_LN}em`,
                  zIndex: plot.rect.y1 + 1,
                }}
                onMouseEnter={() => setHovered({ kind: 'door', door: 'gate' })}
                onMouseLeave={() => setHovered((h) => (h?.kind === 'door' ? null : h))}
                onClick={() => setModal({ t: 'interact', ref: { kind: 'door', door: 'gate' }, sel: 1 })}
              />
              {plot.slots.map((s, i) => {
                const c = crops.find((cr) => cr.slot === i);
                const spr = c ? slotSprite(c, wt, fxFor(i)) : EMPTY_SLOT;
                const thirsty = c && c.stage === 'growing' && cropStatus(c, wt, fxFor(i)).thirsty;
                return (
                  <pre
                    key={`slot-${i}`}
                    className={
                      'crop-slot' + (c ? ' ' + c.stage : ' empty') + (thirsty ? ' thirsty' : '')
                    }
                    style={{
                      left: `${s.x * TILE_CH}ch`,
                      top: `${s.y * TILE_LN}em`,
                      zIndex: s.y + 1,
                    }}
                    onMouseEnter={c ? () => setHovered({ kind: 'crop', slot: i }) : undefined}
                    onMouseLeave={
                      c
                        ? () => setHovered((h) => (h?.kind === 'crop' && h.slot === i ? null : h))
                        : undefined
                    }
                    onClick={
                      c ? () => setModal({ t: 'interact', ref: { kind: 'crop', slot: i }, sel: 1 }) : undefined
                    }
                  >
                    {spr.join('\n')}
                  </pre>
                );
              })}
              {crops.map((c) => {
                const st = cropStatus(c, wt, fxFor(c.slot));
                const badge =
                  c.stage === 'ready'
                    ? 'ready!'
                    : c.stage === 'failed'
                      ? 'x'
                      : st.thirsty
                        ? 'water!'
                        : '';
                if (!badge) return null;
                const s = plot.slots[c.slot];
                return (
                  <div
                    key={`badge-${c.id}`}
                    className={'crop-badge ' + c.stage + (st.thirsty ? ' thirsty' : '')}
                    style={{
                      left: `${s.x * TILE_CH}ch`,
                      top: `${Math.max(0, s.y * TILE_LN - 1)}em`,
                      zIndex: 450,
                    }}
                  >
                    {badge}
                  </div>
                );
              })}

              {/* The pond animates continuously, so it renders through its own
                  component — that keeps its redraw from re-rendering every
                  other entity. It still lives in STRUCT_ENTS, so collision,
                  spawn exclusion and layout checks all see it. */}
              {ents
                .filter((e) => e.kind === 'pond' && !(import.meta.env.DEV && worldAssetTool.removedStructIds.has(e.id)))
                .map((e) => (
                  <PondLayer key={e.id} ent={e} />
                ))}

              {ents.map((e) => {
                if (e.kind === 'pond' || e.kind === 'placed') return null; // drawn below, own component
                // Dev-only preview hide from the world-assets panel's "already
                // in world" list (devWorldAssets.ts's removedStructIds) — a
                // rendering skip, not a real removal; see toggleStructRemoved's
                // own comment for why collision/hover elsewhere still see it.
                if (import.meta.env.DEV && worldAssetTool.removedStructIds.has(e.id)) return null;
                // A scaled sprite (the palm) keeps its full character grid and
                // is only DRAWN smaller. It shrinks about its bottom-centre —
                // the same origin .shaking rotates about, so a shaken palm
                // can't jump — which means its visible box no longer starts at
                // the element's own left/top. Shift both back by the shrinkage
                // so (x,y) stays the top-left of what you actually SEE, which
                // is what every footprint and collision test assumes.
                //
                // `scale` is the standalone CSS property, not transform:
                // scale(). Individual transform properties compose with
                // `transform`, so the shake and fall animations still work.
                const k = e.scale ?? 1;
                const cw = Math.max(...e.sprite.map((l) => l.length));
                const offX = ((1 - k) * cw) / 2;
                const offY = (1 - k) * e.sprite.length;
                // A shaking palm draws a live frame instead of its baked one.
                // Same grid size either way, so nothing about its footprint,
                // offset or z-order changes mid-animation.
                const anim =
                  e.kind === 'palm' && shaking === e.id && shakeFrame !== null
                    ? palmFrame(S.PALM_ANIM, shakeFrame)
                    : null;
                // a palm already shaken this growth window stands bare until
                // its dates regrow, so the animation's ending state persists
                const bare =
                  !anim && e.kind === 'palm' && shaken.has(`${e.id}@${growthWindow}`);
                return (
                  <ColoredSprite
                    key={e.id}
                    className={
                      'ent ' +
                      e.kind +
                      // the palm's motion IS the animation; the CSS wobble on
                      // top of it would just fight the sway
                      (shaking === e.id && !anim ? ' shaking' : '') +
                      (e.fallFrom ? ' falling' : '')
                    }
                    style={{
                      left: `${e.x * TILE_CH - offX}ch`,
                      top: `${e.y * TILE_LN - offY}em`,
                      // A bridge is meant to read as sitting OVER whatever
                      // water/pond it straddles regardless of its own
                      // (typically short) footprint row, so it's forced to a
                      // flat +1000 bump above the normal depth sort rather
                      // than competing on row alone.
                      //
                      // z-index only accepts integers — footprint(e).row is
                      // fractional for anything sub-tile-aligned (the house
                      // sits at x 27.85), so every branch here must round or
                      // the browser silently drops the whole property (falls
                      // back to `auto`, which then loses to any sibling that
                      // DOES have an integer z-index).
                      //
                      // `grasshalm` (ambient ground decoration — the "signs on
                      // the ground") is clamped to a small POSITIVE floor
                      // rather than pushed negative: `.ground` has no z-index
                      // of its own (computed `auto`, i.e. stacking level 0), so
                      // a negative value would sink it BELOW the grass/sand
                      // layer — invisible, not just "behind everything". 1
                      // stays under every other ent (all positive footprint
                      // rows) while still beating ground's level 0.
                      //
                      // 'hotspot' is forced in front so its invisible hit-box
                      // still wins the click over the house picture it covers.
                      zIndex:
                        e.kind === 'bridge'
                          ? Math.round(footprint(e).row) + 1000
                          : // The cliff is LANDSCAPE, not an object standing in
                            // it: everything on the bluff — the cottage above,
                            // any decor on the grass crown, the player — has to
                            // draw over it, so it takes the lowest level that
                            // still beats `.ground` (level 0) rather than its
                            // own footprint row. By row it would be the
                            // FURTHEST-forward thing in the village (its base is
                            // ~9 tiles below the house's) and would paint right
                            // over the building it's supposed to be underneath.
                            e.kind === 'cliff'
                            ? 1
                            : e.kind === 'grasshalm'
                              ? // 2, not 1: ground tufts still lose to every
                                // real entity (all positive footprint rows) but
                                // must beat the cliff, which they sit on top of.
                                Math.max(2, Math.round(footprint(e).row) - 500)
                              : e.kind === 'hotspot'
                                ? Math.round(footprint(e).row) + 500
                                : Math.round(footprint(e).row),
                      ...(k !== 1 ? { scale: `${k}` } : {}),
                      ...(e.fallFrom
                        ? ({ '--fall-from': `${-e.fallFrom}em` } as React.CSSProperties)
                        : {}),
                      // Intro Part B's arrival hop — a plain translateY tween
                      // (see mitchyHop() below), not a new animation
                      // framework. Only ever non-zero for 'cat' (Mitchy).
                      ...(e.id === 'cat' && mitchyHopEm
                        ? { transform: `translateY(${-mitchyHopEm}em)` }
                        : {}),
                    }}
                    sprite={anim ? anim.sprite : bare ? S.PALM_BARE : e.sprite}
                    colors={
                      anim
                        ? anim.colors
                        : bare
                          ? S.PALM_BARE_COLORS
                          : e.kind === 'house' && houseRecolored
                            ? houseRecolored.colors
                            : e.colors
                    }
                    palette={e.kind === 'house' && houseRecolored ? houseRecolored.palette : e.palette}
                    // the flower's '█' petals are ambiguous-width — pin each
                    // to one cell, same fix as the waterfall tile's glyphs.
                    // The house and the cliff use the same density-ramp glyphs
                    // (†·¤‡¬§Ø etc.) baked straight from their reference SVGs —
                    // same fix, same reason.
                    perCell={
                      e.kind === 'flowerplus' || e.kind === 'house' || e.kind === 'cliff'
                    }
                    // Per-cell opaque backgrounds (same mechanism as the
                    // player — see ColoredSprite's solidCells) instead of the
                    // old rectangular `.ent.house { background: var(--sky-bg) }`
                    // occlusion: every drawn cell gets a background derived
                    // from its own colour, so the entity reads as solid along
                    // its actual silhouette rather than inside a box, and
                    // correctly occludes whatever VisualTerrain band it's
                    // standing on instead of only matching one hardcoded
                    // ground colour. Bridge never had a rectangular
                    // background to begin with — this just stops terrain
                    // showing through its own glyph gaps, same principle.
                    solidCells={e.kind === 'house' || e.kind === 'bridge'}
                    onMouseEnter={
                      canInteract(e) ? () => setHovered({ kind: 'entity', id: e.id }) : undefined
                    }
                    onMouseLeave={
                      canInteract(e)
                        ? () =>
                            setHovered((h) => (h?.kind === 'entity' && h.id === e.id ? null : h))
                        : undefined
                    }
                    onClick={
                      canInteract(e)
                        ? () => setModal({ t: 'interact', ref: { kind: 'entity', id: e.id }, sel: 1 })
                        : undefined
                    }
                  />
                );
              })}

              {placedItems.map((p) => (
                <PlacedItemView
                  key={p.id}
                  x={p.x}
                  y={p.y}
                  sprite={p.sprite}
                  scale={p.scale}
                  rotation={p.rotation}
                  palette={p.palette}
                  colors={p.colors}
                  texture={p.textureModifier}
                  chargeFrac={pushCharge?.id === p.id ? pushCharge.frac : null}
                  onClick={(e) => {
                    if (placing) return;
                    e.stopPropagation();
                    setPickupMenuId(p.id);
                  }}
                />
              ))}

              {import.meta.env.DEV &&
                worldAssetTool.drafts.map((d) => {
                  const sd = worldAssetTool.sprites[d.slug];
                  if (!sd) return null;
                  return (
                    <PlacedItemView
                      key={d.id}
                      x={d.x}
                      y={d.y}
                      sprite={sd.sprite}
                      colors={sd.colors}
                      palette={sd.palette}
                      scale={d.scale}
                      rotation={d.rotation}
                    />
                  );
                })}

              {placing && (
                <PlacedItemView
                  x={placing.x}
                  y={placing.y}
                  sprite={placing.owned.sprite}
                  scale={placing.owned.scale}
                  rotation={placing.rotation}
                  ghost={placingValid ? 'valid' : 'invalid'}
                />
              )}

              {import.meta.env.DEV &&
                worldAssetTool.ghost &&
                worldAssetTool.sprites[worldAssetTool.ghost.slug] && (
                  <PlacedItemView
                    x={worldAssetTool.ghost.x}
                    y={worldAssetTool.ghost.y}
                    sprite={worldAssetTool.sprites[worldAssetTool.ghost.slug].sprite}
                    scale={worldAssetTool.ghost.scale}
                    rotation={worldAssetTool.ghost.rotation}
                    ghost={
                      worldAssetTool.ghost.legality === 'ok'
                        ? 'valid'
                        : worldAssetTool.ghost.legality === 'warn'
                          ? 'warn'
                          : 'invalid'
                    }
                  />
                )}

              {/* Tile-grid overlay for the "E" world editor — only while the
                  panel is open, per the same "nothing shows before E" rule
                  as the panel itself. A single child of .world, sized to the
                  exact same play area, so it inherits the SAME camera pan/
                  zoom transform every entity already gets — no separate
                  coordinate math to keep in sync, it just can't drift. */}
              {import.meta.env.DEV && worldAssetTool.panelOpen && (
                <div
                  className="dev-tile-grid"
                  style={{ width: `${GROUND_W}ch`, height: `${GROUND_H}em` }}
                />
              )}

              {/* Scene marker overlay — editor-only (gated on panelOpen, same
                  as the tile grid above), never a game entity: no collision,
                  never interactable, never rendered outside DEV. A child of
                  .world so it inherits the same camera pan/zoom transform as
                  every entity/the grid above, no separate coordinate math. */}
              {import.meta.env.DEV &&
                worldAssetTool.panelOpen &&
                MARKER_REGISTRY.flatMap((c) => c.groups.flatMap((g) => g.markers)).map((m) => {
                  const p = sceneMarkerTool.positions[m.id];
                  if (!p) return null;
                  return (
                    <div
                      key={m.id}
                      className="dev-marker-dot"
                      style={{ left: `${p.x * TILE_CH}ch`, top: `${p.y * TILE_LN}em` }}
                    >
                      <span className="dev-marker-dot-circle" />
                      <span className="dev-marker-dot-label">[ {m.label} ]</span>
                    </div>
                  );
                })}

              {pickupMenuId &&
                (() => {
                  const p = placedItems.find((x) => x.id === pickupMenuId);
                  if (!p) return null;
                  const { wT, hT } = spriteTiles(p.sprite, p.scale, p.rotation);
                  return (
                    <div
                      style={{
                        position: 'absolute',
                        left: `${(p.x + wT / 2) * TILE_CH}ch`,
                        top: `${(p.y + hT) * TILE_LN}em`,
                      }}
                    >
                      <div className="pick" ref={pickupPopupRef} onClick={(ev) => ev.stopPropagation()}>
                        <div className="pick-name">{p.name}</div>
                        <OptList
                          opts={['Return to Inventory']}
                          sel={0}
                          onSel={() => {}}
                          onPick={() => pickupPlaced(p.id)}
                        />
                      </div>
                    </div>
                  );
                })()}

              {equipped?.equip?.mode === 'pet' && petPos && (
                <ColoredSprite
                  className="ent pet"
                  style={{
                    left: `${petPos.x * TILE_CH}ch`,
                    top: `${petPos.y * TILE_LN}em`,
                    zIndex: petPos.y + 1,
                    // glideDur (not raw stepDur) so the pet gets the same
                    // jitter margin as the rig/camera; the 1.2x keeps its
                    // deliberate trailing-follow lag, now direction-corrected
                    // too since glideDur already folds in speedScale().
                    transitionDuration: `${glideDur * 1.2}s`,
                  }}
                  sprite={equipped.sprite}
                  colors={equipped.colors}
                  palette={equipped.palette}
                  texture={equipped.textureModifier}
                />
              )}

              {/* Player rig: the ONLY element positioned in world space. The
                  player sprite and any attached gear/held items are children
                  with fixed offsets in the rig's own grid, so they can never
                  desync from the player or from each other. Only the rig moves;
                  visual sizing is done with transform, never font-size. */}
              <div
                className="player-rig"
                ref={rigRef}
                style={{
                  // composited transform (not left/top) so the player glides in
                  // lockstep with the camera instead of janking behind it —
                  // same fix as the .world camera. ch/em translate is proven
                  // here (the camera uses it too).
                  transform: `translate3d(${player.x * TILE_CH}ch, ${player.y * TILE_LN}em, 0)`,
                  zIndex: PLAYER_Z_INDEX,
                  transition: worldTransition,
                }}
              >
                <ColoredSprite
                  className="player-sprite"
                  style={{
                    left: `${-playerOffX}ch`,
                    top: `${-playerOffY}em`,
                    scale: `${playerK}`,
                  }}
                  sprite={displaySprite}
                  colors={displayColors}
                  palette={displayPalette}
                  // Occupied cells get an opaque per-cell background (see
                  // ColoredSprite's solidCells) so terrain/ground texture can
                  // never show through the character — only genuine gaps stay
                  // transparent. eyeRow is only set for the idle/static
                  // portrait (character.face's own row 14, verified against
                  // docs/character-sprite-parts's eye colour predicate) —
                  // the walk-cycle frames have different crop/padding per
                  // direction that hasn't been verified against the same row
                  // number, so they get solid cells but not the eye override.
                  solidCells
                  eyeRow={walkAnim ? undefined : 14}
                />

                {equipped?.equip?.mode === 'vehicle' && (
                  <ColoredSprite
                    className="rig-gear"
                    style={{ left: '-1ch', top: '2em' }}
                    sprite={equipped.sprite}
                    colors={equipped.colors}
                    palette={equipped.palette}
                    color={equipped.color}
                    texture={equipped.textureModifier}
                  />
                )}

                {equipped?.equip?.mode === 'hold' && (
                  <ColoredSprite
                    className="rig-held"
                    style={{
                      left: `${-playerOffX + HAND_X * playerK}ch`,
                      top: `${-playerOffY + HAND_Y * playerK}em`,
                      transform: `scale(${0.7 * playerK * (equipped.scale ?? 1)})`,
                    }}
                    sprite={equipped.sprite}
                    colors={equipped.colors}
                    palette={equipped.palette}
                    color={equipped.color}
                    texture={equipped.textureModifier}
                  />
                )}
              </div>

              {toast && (
                <div
                  className="saypop"
                  style={{
                    left: `${player.x * TILE_CH}ch`,
                    top: `${Math.max(0, player.y * TILE_LN - 1.8)}em`,
                    zIndex: 700,
                  }}
                >
                  {toast}
                </div>
              )}

              {!modal &&
                hovered &&
                (() => {
                  const copy = describeInteraction(hovered, interactCtx);
                  if (!copy) return null;
                  const pos =
                    hovered.kind === 'entity'
                      ? ents.find((e) => e.id === hovered.id)
                      : hovered.kind === 'crop'
                        ? plot.slots[hovered.slot]
                        : { x: plot.door.c0, y: plot.rect.y1 }; // the one gate, in the near rail
                  if (!pos) return null;
                  return (
                    <div
                      className="fpop"
                      style={{
                        left: `${pos.x * TILE_CH + 1}ch`,
                        top: `${Math.max(0, pos.y * TILE_LN - 1.6)}em`,
                      }}
                    >
                      {copy.name}
                    </div>
                  );
                })()}

              {nothingEnt && (
                <div
                  className="saypop"
                  style={{
                    left: `${nothingEnt.x * TILE_CH + 1}ch`,
                    top: `${Math.max(0, nothingEnt.y * TILE_LN - 1.8)}em`,
                  }}
                >
                  {nothingText}
                </div>
              )}

              {bubbleEl}
              </div>
            </div>
          </div>
        </div>
      </div>

      {!modal && !cinematic && (
        <div className="kbd-hint">
          [WASD] move &#183; [Shift] dash &#183; [F] interact &#183; [I] inventory &#183; [M] map
        </div>
      )}

      {!cinematic && <TouchControls onHold={holdStart} onRelease={holdEnd} onF={pressF} onI={toggleInventory} />}

      {/* ---- unified intro overlay stack ----
          Stages 1-14 (IntroA) render on top of everything else, including
          stage 15's own cinematic-blackout below — that div starts already
          fully opaque (blackout=true from mount), so the instant IntroA
          unmounts (right as its final 3s black hold ends and it calls
          onComplete -> setIntroAActive(false)) there is no visible seam:
          black hands off to black, one frame apart, same as the retired
          prototype's own reveal-while-already-black handoff. */}
      {introAActive && <IntroA ref={introARef} onComplete={() => setIntroAActive(false)} />}
      {/* Mounted for the cinematic's whole run (not just while `blackout` is
          true) so the opacity:1->0 transition below actually gets to play
          instead of the div vanishing the instant blackout flips false. */}
      {cinematic === 'introB' && (
        <div
          className="cinematic-blackout"
          style={{ transition: `opacity ${EYE_OPEN_MS}ms ease`, opacity: blackout ? 1 : 0 }}
        />
      )}
      {/* Letterbox bars are stage-15+ only (the in-world wake-up/Mitchy
          cinematic) — Stage A's prologue (IntroA) has its own bottom-center
          narration box instead (IntroNarration.tsx) and no letterbox at
          all, so its full-bleed 16:9 art never gets pillarboxed/cropped by
          bars sized for a different purpose. */}
      <Letterbox visible={letterboxVisible} open={letterboxOpen} />
      {import.meta.env.DEV && !introDone && (
        <button
          type="button"
          onClick={skipIntro}
          style={{
            position: 'fixed',
            right: 10,
            bottom: 10,
            // Topmost of the whole intro stack — above IntroA (10000),
            // Letterbox (10001) and .introb-dialogue-wrap (10005, both
            // styles.css/Letterbox.tsx) — it must stay clickable through
            // every stage, never covered by the letterbox bars it now also
            // renders during.
            zIndex: 10010,
            font: '11px ui-monospace, monospace',
            color: '#e4e6f0',
            background: '#2a2a38',
            border: '1px solid #3d3d4d',
            borderRadius: 4,
            padding: '5px 10px',
            cursor: 'pointer',
            opacity: 0.85,
          }}
        >
          Skip Intro
        </button>
      )}
      {dialogue && (
        <DialogueBox
          line={dialogue}
          onAdvance={() => dialogueAdvanceRef.current?.()}
          onChoice={(i) => dialogueChoiceRef.current?.(i)}
          locked={autoAdvanceMode}
        />
      )}
      {nameEntryOpen && (
        <NameEntryPanel onSubmit={(n) => nameEntryResolveRef.current?.(n)} locked={autoAdvanceMode} />
      )}
      {mapHint && (
        <div className="map-hint-toast" style={{ '--map-hint-ms': `${MAP_HINT_VISIBLE_MS}ms` } as React.CSSProperties}>
          <div className="map-hint-toast-inner">
            <span className="key-hl">M</span> — Map
          </div>
        </div>
      )}

      {/* ---- the M map overlay ---- */}
      <GameMap open={mapOpen} onClose={() => setMapOpen(false)} characters={mapCharacters} />

      {modal && (
        <div
          className="overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) escClose();
          }}
        >
          {/* Inventory — grid on the left, a detail sidebar on the right for
              whichever item is selected (base item via 'detail', an owned/bag
              item via 'detailOwned'), matching the reference layout: one
              panel, not a click-through to a second screen. equipPick mode
              (opened from the HUD hand slot) skips the sidebar entirely —
              there's nothing to inspect, a click just equips. */}
          {(modal.t === 'inventory' || modal.t === 'detail' || modal.t === 'detailOwned') &&
            (() => {
              const equipPick = modal.t === 'inventory' && !!modal.equipPick;
              const selectedKey =
                modal.t === 'detail' ? modal.item : modal.t === 'detailOwned' ? modal.ownedId : null;
              const owned = modal.t === 'detailOwned' ? bag.find((o) => o.ownedId === modal.ownedId) : null;
              return (
                <div className="panel">
                  <button className="panel-close" onClick={() => setModal(null)} aria-label="close">
                    &#215;
                  </button>
                  <div className="panel-title">{equipPick ? 'Equip What?' : 'Inventory'}</div>
                  <div className="inv-body">
                    <InvGrid
                      inv={inv}
                      onItem={(it) => setModal({ t: 'detail', item: it })}
                      selected={selectedKey}
                      bag={bag}
                      equippedId={equipped?.ownedId ?? null}
                      onBagItem={(o) => setModal({ t: 'detailOwned', ownedId: o.ownedId, sel: 0 })}
                      equipPick={equipPick}
                      onEquipPick={(o) => equipOwned(o)}
                    />
                    {!equipPick && (
                      <div className="inv-detail-side">
                        {modal.t === 'detail' ? (
                          <DetailSide
                            item={modal.item}
                            qty={inv[modal.item]}
                            onPlant={
                              PLANTABLE_BASE.includes(modal.item) && inv[modal.item] > 0
                                ? () => plantBase(modal.item)
                                : undefined
                            }
                          />
                        ) : modal.t === 'detailOwned' && owned ? (
                          (() => {
                            const { labels, pick } = ownedOptList(owned);
                            return <DetailOwnedSide owned={owned} labels={labels} onPick={pick} />;
                          })()
                        ) : (
                          <div className="inv-detail-empty">click an item for details</div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="hint">
                    {equipPick
                      ? 'pick something to hold · greyed items can’t be equipped · [Esc] cancel'
                      : 'click an item for details · [Esc] to close'}
                  </div>
                </div>
              );
            })()}

          {modal.t === 'settings' && (
            <div className="panel">
              <div className="panel-title">Settings</div>
              <button
                className="btn btn-primary settings-save-btn"
                onClick={saveGameToStorage}
                disabled={saving}
              >
                Save Game
              </button>
              <div className="hint">writes your progress to this browser &#183; [Esc] to close</div>
            </div>
          )}

          {modal.t === 'dialog' && (
            <div className="panel dialog-panel">
              <pre className="portrait small cat">{S.CAT.join('\n')}</pre>
              <div className="dialog-name">Mitchy</div>
              <OptList
                opts={['Talk', 'Open Shop']}
                sel={modal.sel}
                onSel={(i) => setModal({ t: 'dialog', sel: i })}
                onPick={confirmDialog}
              />
              <div className="hint">[&#8593;/&#8595;] select &#183; [Enter] confirm &#183; [Esc] close</div>
            </div>
          )}

          {modal.t === 'houseMenu' && (
            <div className="panel dialog-panel">
              <div className="dialog-name">Home Storage</div>
              <OptList
                opts={storages.map((s, i) => {
                  const n = ITEM_TYPES.reduce((sum, t) => sum + s[t], 0);
                  return `Storage ${i + 1}${n ? ` (${n} items)` : ' (empty)'}`;
                })}
                sel={modal.sel}
                onSel={(i) => setModal({ t: 'houseMenu', sel: i })}
                onPick={(i) => setModal({ t: 'storage', slot: i, sel: 0, menuOpen: false })}
              />
              <div className="hint">[&#8593;/&#8595;] select &#183; [Enter] open &#183; [Esc] close</div>
            </div>
          )}

          {modal.t === 'storage' && (
            <StoragePanel
              slot={modal.slot}
              storage={storages[modal.slot]}
              inv={inv}
              sel={modal.sel}
              menuOpen={modal.menuOpen}
              onSelect={(i, open) =>
                setModal((m) => (m && m.t === 'storage' ? { ...m, sel: i, menuOpen: open } : m))
              }
              onCloseMenu={() =>
                setModal((m) => (m && m.t === 'storage' ? { ...m, menuOpen: false } : m))
              }
              onAct={(entry) => storageAct(modal.slot, entry)}
            />
          )}

          {modal.t === 'shop' && !modal.confirm && (
            <div
              className="panel shop-panel"
              onClick={() => setModal((m) => (m && m.t === 'shop' ? { ...m, pick: null } : m))}
            >
              <div className="shop-tabs">
                {(['sell', 'buy'] as const).map((tb) => (
                  <button
                    key={tb}
                    className={'shop-tab' + (modal.tab === tb ? ' active' : '')}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setModal({ ...modal, tab: tb, offer: null, pick: null });
                    }}
                  >
                    {tb === 'sell' ? 'Sell' : 'Buy'}
                  </button>
                ))}
              </div>
              <div className="shop-hdr">
                <span className="shop-hdr-title">Shop</span>
                <span className="shop-hdr-timer" title="restocks hourly">
                  &#9719; {refreshStr}
                </span>
                <span className="shop-hdr-money">&#164; {money}</span>
                <button className="shop-x" onClick={() => setModal(null)} aria-label="close shop">
                  &#215;
                </button>
              </div>
              {modal.tab === 'buy' && (
                <>
                  {/* One universal token, outside the category tabs — it used
                      to be a per-category token prepended to every tab's
                      stock, which with a single token would render six times. */}
                  {(() => {
                    const tok = universalToken(hourSeed);
                    const out = tokensLeftToday <= 0;
                    return (
                      <div
                        className={'token-offer' + (out ? ' spent' : '')}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          // A toast, not the modal's `limited` flag: that flag
                          // only renders inside the confirm panel, which never
                          // opens on this path — so setting it would refuse the
                          // click silently.
                          if (out) {
                            showToast(`that's all ${TOKENS_PER_DAY} tokens for today. come back tomorrow!`);
                            return;
                          }
                          setModal({ ...modal, confirm: tok, csel: 0, poor: false, limited: false });
                        }}
                      >
                        <pre className="mini">{tok.sprite.join('\n')}</pre>
                        <div className="token-offer-text">
                          <span className="token-tag">TOKEN</span>
                          <span className="token-offer-name">{tok.name}</span>
                          <span className="token-offer-sub">
                            craft anything · &#164; {tok.price}
                          </span>
                        </div>
                        <span className="token-offer-left">
                          {out ? 'none left today' : `${tokensLeftToday} left today`}
                        </span>
                      </div>
                    );
                  })()}
                  <div className="cat-row">
                    {CATEGORIES.map((c) => (
                      <button
                        key={c}
                        className={'cat-tag' + (modal.cat === c ? ' active' : '')}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setModal({ ...modal, cat: c });
                        }}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  {stock ? (
                    <div className="buy-grid">
                      {stock[modal.cat].map((it) => (
                        <div
                          key={it.id}
                          className="slot filled buy-slot"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setModal({ ...modal, confirm: it, csel: 0, poor: false });
                          }}
                        >
                          {it.kind === 'token' && <span className="token-tag">TOKEN</span>}
                          <pre className="mini">{it.sprite.join('\n')}</pre>
                          <span className="buy-name">{it.name}</span>
                          <span className="price-tri" />
                          <span className="price">
                            &#164;{it.price}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="shop-hint">restocking...</div>
                  )}
                  <div className="hint">click an item or token to buy it</div>
                </>
              )}
              {modal.tab === 'sell' && (
              <div className="shop-top">
                <pre className="portrait cat">{catFace.join('\n')}</pre>
                {modal.offer ? (
                  <div className="offer">
                    <pre className="offer-bubble">
                      {S.makeBubble(
                        modal.offer.price === null
                          ? '...'
                          : modal.offer.declined
                            ? 'thats a bummer...maybe next time.'
                            : `that's cool i can give u ${modal.offer.price} for it? Sounds like a deal?`,
                        24,
                      )}
                    </pre>
                    {modal.offer.price !== null && !modal.offer.declined && (
                      <OptList
                        opts={['Sell', "Don't sell"]}
                        sel={modal.offer.sel}
                        onSel={(i) =>
                          setModal((m) =>
                            m && m.t === 'shop' && m.offer
                              ? { ...m, offer: { ...m.offer, sel: i } }
                              : m,
                          )
                        }
                        onPick={confirmOffer}
                      />
                    )}
                  </div>
                ) : (
                  <div className="shop-hint">
                    &quot;whatcha got?&quot;
                    <br />
                    <span>click an item below to sell it</span>
                  </div>
                )}
              </div>
              )}
              {modal.tab === 'sell' && (
                <InvGrid
                  inv={inv}
                  pick={modal.pick}
                  onItem={(it) =>
                    setModal((m) => (m && m.t === 'shop' ? { ...m, pick: it, offer: null } : m))
                  }
                  onSell={startOffer}
                />
              )}
            </div>
          )}

          {modal.t === 'shop' && modal.confirm && (
            <div className="panel detail-panel">
              <div className="panel-title">{modal.confirm.name}</div>
              <pre className="detail-sprite">{modal.confirm.sprite.join('\n')}</pre>
              <p className="detail-desc">{modal.confirm.desc}</p>
              <p className="detail-fact">* {modal.confirm.funcDesc}</p>
              <div className="confirm-price">
                price: &#164; {modal.confirm.price} &#183; u have &#164; {money}
              </div>
              {modal.poor && <div className="poor">not enough coins...</div>}
              {modal.limited && (
                <div className="poor">that's all {TOKENS_PER_DAY} tokens for today. come back tomorrow!</div>
              )}
              <OptList
                opts={['Buy', 'Cancel']}
                sel={modal.csel}
                onSel={(i) => setModal({ ...modal, csel: i })}
                onPick={(i) =>
                  i === 0 ? buyConfirm() : setModal({ ...modal, confirm: null, poor: false })
                }
              />
              <div className="hint">[&#8593;/&#8595;] select &#183; [Enter] confirm &#183; [Esc] back</div>
            </div>
          )}

          {modal.t === 'interact' &&
            (() => {
              const copy = describeInteraction(modal.ref, interactCtx);
              if (!copy) return null;
              return (
                <div className="panel detail-panel">
                  <div className="panel-title">{copy.name}</div>
                  <p className="detail-desc">{copy.question}</p>
                  <OptList
                    opts={['Yes', 'No']}
                    sel={modal.sel}
                    onSel={(i) => setModal({ ...modal, sel: i })}
                    onPick={(i) => {
                      // close before acting — see the 'interact' case in
                      // optInfo() for why the order matters
                      setModal(null);
                      if (i === 0) runInteraction(modal.ref, interactCtx, interactActions);
                    }}
                  />
                  <div className="hint">[F] yes &#183; [Esc] no &#183; click to choose</div>
                </div>
              );
            })()}

          {modal.t === 'craft' && (
            <CraftModal
              key={modal.token.ownedId}
              token={modal.token}
              playerFace={character.face}
              playerFaceColors={character.faceColors}
              playerPalette={character.palette}
              onConsume={(equip, item) => consumeCraft(modal.token.ownedId, item, equip)}
              onClose={() => setModal(null)}
              confirmClose={!!modal.confirmClose}
              onConfirmChange={(v) =>
                setModal((m) => (m && m.t === 'craft' ? { ...m, confirmClose: v } : m))
              }
              onBusyChange={(b) => {
                craftBusyRef.current = b;
              }}
              onDoneChange={(d) => {
                craftDoneRef.current = d;
              }}
            />
          )}

          {modal.t === 'crop' &&
            (() => {
              const c = crops.find((x) => x.slot === modal.slot);
              if (!c) return null;
              const st = cropStatus(c, wt, fxFor(c.slot));
              const mins = (ms: number) => Math.max(0, Math.ceil(ms / 60000));
              return (
                <div className="panel detail-panel">
                  <div className="panel-title">{c.name}</div>
                  <pre className="detail-sprite">{slotSprite(c, wt, fxFor(c.slot)).join('\n')}</pre>
                  <p className="detail-fact">* {c.care.hint}</p>
                  <div className="crop-status">
                    {c.stage === 'ready' ? (
                      <span className="ok">Fully grown — ready to harvest!</span>
                    ) : c.stage === 'failed' ? (
                      <span className="bad">It withered from thirst. Clear the slot to replant.</span>
                    ) : (
                      <>
                        <div>growth: {Math.round(st.progress * 100)}% &#183; matures in ~{mins(st.msToMature)} min</div>
                        <div className={st.thirsty ? 'bad' : 'ok'}>
                          {st.thirsty
                            ? `thirsty! water within ~${mins(st.msToFail)} min or it wilts`
                            : `watered &#183; next water in ~${mins(st.msToDue)} min`}
                        </div>
                      </>
                    )}
                  </div>
                  <OptList
                    opts={
                      c.stage === 'ready'
                        ? ['Harvest', 'Back']
                        : c.stage === 'failed'
                          ? ['Clear slot', 'Back']
                          : ['Water', 'Back']
                    }
                    sel={0}
                    onSel={() => {}}
                    onPick={(i) => {
                      if (i === 1) {
                        setModal(null);
                        return;
                      }
                      if (c.stage === 'ready') harvestCrop(c.slot);
                      else if (c.stage === 'failed') clearCrop(c.slot);
                      else waterCrops(c.slot);
                    }}
                  />
                  <div className="hint">[Esc] close &#183; walk up to each plant to tend it</div>
                </div>
              );
            })()}
        </div>
      )}
    </div>
  );
}

// Unified option list: every option window (dialogs, offers, storage picks)
// renders through this so look and behavior stay consistent.
function OptList({
  opts,
  sel,
  onSel,
  onPick,
}: {
  opts: string[];
  sel: number;
  onSel: (i: number) => void;
  onPick: (i: number) => void;
}) {
  return (
    <div className="opts">
      {opts.map((o, i) => (
        <div
          key={o}
          className={'opt' + (sel === i ? ' sel' : '')}
          onClick={(ev) => {
            ev.stopPropagation();
            onPick(i);
          }}
          onMouseEnter={() => onSel(i)}
        >
          {(sel === i ? '> ' : '  ') + o}
        </div>
      ))}
    </div>
  );
}

type InvSlot = { t: 'base'; it: ItemType } | { t: 'own'; o: OwnedItem };

function InvGrid({
  inv,
  onItem,
  pick,
  selected,
  onSell,
  bag,
  equippedId,
  onBagItem,
  equipPick,
  onEquipPick,
}: {
  inv: Record<ItemType, number>;
  onItem: (it: ItemType) => void;
  pick?: ItemType | null;
  // Which slot the inventory's detail sidebar is currently showing (an
  // ItemType string for a base item, an ownedId for a bag item) — purely a
  // highlight, independent of `pick` (the shop's separate "Sell" popup).
  selected?: string | null;
  onSell?: (it: ItemType) => void;
  bag?: OwnedItem[];
  equippedId?: string | null;
  onBagItem?: (o: OwnedItem) => void;
  // "choose something to hold" mode, opened from the HUD hand slot
  equipPick?: boolean;
  onEquipPick?: (o: OwnedItem) => void;
}) {
  // Only owned things with an equip mode can go in the hand — raw materials
  // and craft tokens can't, so in equipPick mode they're greyed and inert.
  const canEquip = (s: InvSlot) => s.t === 'own' && s.o.kind !== 'token' && !!s.o.equip;
  const isSelected = (s: InvSlot) =>
    !!selected && ((s.t === 'base' && s.it === selected) || (s.t === 'own' && s.o.ownedId === selected));
  const entries: InvSlot[] = [
    ...ITEM_TYPES.filter((t) => inv[t] > 0).map((it) => ({ t: 'base' as const, it })),
    ...(bag ?? []).map((o) => ({ t: 'own' as const, o })),
  ];
  const nSlots = Math.max(16, Math.ceil(entries.length / 8) * 8);
  const slots: (InvSlot | null)[] = Array.from({ length: nSlots }, (_, i) => entries[i] ?? null);
  return (
    <div className="inv-grid">
      {slots.map((s, i) => (
        <div
          key={i}
          className={
            'slot' +
            (s ? ' filled' : '') +
            (s && equipPick && !canEquip(s) ? ' disabled' : '') +
            (s && isSelected(s) ? ' sel' : '')
          }
          onClick={
            s && !(equipPick && !canEquip(s))
              ? (ev) => {
                  ev.stopPropagation();
                  if (equipPick) {
                    if (s.t === 'own') onEquipPick?.(s.o);
                  } else if (s.t === 'base') onItem(s.it);
                  else onBagItem?.(s.o);
                }
              : undefined
          }
        >
          {s && s.t === 'base' && (
            <>
              <pre className="mini">{ITEM_SPRITES[s.it].join('\n')}</pre>
              <span className="count">x{inv[s.it]}</span>
              {pick === s.it && onSell && (
                <div className="pick" onClick={(ev) => ev.stopPropagation()}>
                  <OptList opts={['Sell']} sel={0} onSel={() => {}} onPick={() => onSell(s.it)} />
                </div>
              )}
            </>
          )}
          {s && s.t === 'own' && (
            <>
              <ColoredSprite
                className="mini"
                sprite={s.o.sprite}
                colors={s.o.colors}
                palette={s.o.palette}
                color={s.o.color}
                texture={s.o.textureModifier}
              />
              {s.o.kind === 'token' && <span className="token-tag">TOKEN</span>}
              {equippedId === s.o.ownedId && <span className="equipped-tag">EQ</span>}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// The inventory's right-hand sidebar for a selected BASE item (flower,
// stone, date, ...) — see the merged 'inventory'/'detail'/'detailOwned'
// render above. Its own component (not inlined there) because the fun-fact
// fetch needs its own effect keyed on `item`.
function DetailSide({
  item,
  qty,
  onPlant,
}: {
  item: ItemType;
  qty: number;
  onPlant?: () => void;
}) {
  const [fact, setFact] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setFact(null);
    getFunFact(item).then((f) => {
      if (alive) setFact(f);
    });
    return () => {
      alive = false;
    };
  }, [item]);
  return (
    <>
      <div className="inv-detail-icon">
        <pre className="detail-sprite">{ITEM_SPRITES[item].join('\n')}</pre>
      </div>
      <div className="inv-detail-name">{ITEM_INFO[item].name}</div>
      <p className="inv-detail-desc">{ITEM_INFO[item].desc}</p>
      <p className="inv-detail-fact">* fun fact: {fact ?? '...'}</p>
      <div className="inv-detail-qty">
        <span>Quantity</span>
        <b>{qty}</b>
      </div>
      {onPlant && (
        <div className="inv-detail-actions">
          <button className="btn btn-primary" onClick={onPlant}>
            Plant in garden
          </button>
        </div>
      )}
    </>
  );
}

// Same sidebar, for a selected OWNED item (bag: tools, gear, craft tokens) —
// these are unique instances, not stackable counts, so there's no Quantity
// row; the action buttons are whatever ownedOptList() says applies (Equip /
// Unequip / Use token / Plant in garden), the first one styled as primary.
function DetailOwnedSide({
  owned,
  labels,
  onPick,
}: {
  owned: OwnedItem;
  labels: string[];
  onPick: (i: number) => void;
}) {
  return (
    <>
      <div className="inv-detail-icon">
        <ColoredSprite
          className="detail-sprite"
          sprite={owned.sprite}
          colors={owned.colors}
          palette={owned.palette}
          color={owned.color}
          texture={owned.textureModifier}
        />
      </div>
      <div className="inv-detail-name">{owned.name}</div>
      <p className="inv-detail-desc">{owned.desc}</p>
      <p className="inv-detail-fact">* {owned.funcDesc}</p>
      {/* A crafted item's translated effect only applies once it's PLACED in
          the world near the beds — without saying so, an item that reads as
          magical does nothing in the bag and looks broken. */}
      {owned.fn && !isCosmetic(owned.fn) && (
        <div className="inv-detail-effect">
          <span className="inv-detail-effect-head">effect</span>
          <span>{describeEffect(owned.fn)}</span>
          <span className="inv-detail-effect-hint">place it near your crops to use it</span>
        </div>
      )}
      {/* Prompt-memory tags — crafted items only. A lightweight tooltip: the
          player can always see what they typed (the "prompt: ..." tag, added
          verbatim in code — see craftDescribe in llm.ts) alongside a few
          inferred traits, without digging through a history log. */}
      {owned.tags && owned.tags.length > 0 && (
        <div className="inv-detail-tags">
          {owned.tags.map((t) => (
            <span key={t} className="tag-chip">
              {t}
            </span>
          ))}
        </div>
      )}
      {labels.length > 0 && (
        <div className="inv-detail-actions">
          {labels.map((label, i) => (
            <button
              key={label}
              className={'btn ' + (i === 0 ? 'btn-primary' : 'btn-secondary')}
              onClick={() => onPick(i)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// Storage modal: the chest's contents on top, the player's inventory below.
// Items can be moved by keyboard (arrows + enter), by clicking (option
// popup), or by dragging an inventory item onto the chest grid.
function StoragePanel({
  slot,
  storage,
  inv,
  sel,
  menuOpen,
  onSelect,
  onCloseMenu,
  onAct,
}: {
  slot: number;
  storage: Record<ItemType, number>;
  inv: Record<ItemType, number>;
  sel: number;
  menuOpen: boolean;
  onSelect: (i: number, open: boolean) => void;
  onCloseMenu: () => void;
  onAct: (entry: StorEntry) => void;
}) {
  const list = storageList(storage, inv);
  const effSel = Math.min(sel, Math.max(0, list.length - 1));
  const storeItems = list.filter((e) => e.where === 'store');
  const invItems = list.filter((e) => e.where === 'inv');

  const [drag, setDrag] = useState<{
    item: ItemType;
    sx: number;
    sy: number;
    x: number;
    y: number;
    active: boolean;
  } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const storeGridRef = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      setDrag((d) => {
        if (!d) return d;
        const active = d.active || Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 8;
        return { ...d, x: e.clientX, y: e.clientY, active };
      });
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d || !d.active) return;
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 150);
      const r = storeGridRef.current?.getBoundingClientRect();
      if (
        r &&
        e.clientX >= r.left &&
        e.clientX <= r.right &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      ) {
        onAct({ where: 'inv', item: d.item });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [drag !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  function renderGrid(
    where: 'store' | 'inv',
    counts: Record<ItemType, number>,
    slots: number,
    offset: number,
    items: StorEntry[],
  ) {
    return (
      <div
        className={'inv-grid' + (where === 'store' && drag?.active ? ' drop' : '')}
        ref={where === 'store' ? storeGridRef : undefined}
      >
        {Array.from({ length: slots }, (_, i) => {
          const entry = items[i];
          const gi = offset + i;
          const isSel = entry && list.length > 0 && gi === effSel;
          return (
            <div
              key={i}
              className={'slot' + (entry ? ' filled' : '') + (isSel ? ' sel' : '')}
              onPointerDown={
                entry && where === 'inv'
                  ? (ev) => setDrag({ item: entry.item, sx: ev.clientX, sy: ev.clientY, x: ev.clientX, y: ev.clientY, active: false })
                  : undefined
              }
              onClick={
                entry
                  ? (ev) => {
                      ev.stopPropagation();
                      if (suppressClick.current) {
                        suppressClick.current = false;
                        return;
                      }
                      onSelect(gi, true);
                    }
                  : undefined
              }
            >
              {entry && (
                <>
                  <pre className="mini">{ITEM_SPRITES[entry.item].join('\n')}</pre>
                  <span className="count">x{counts[entry.item]}</span>
                  {isSel && <span className="sel-arrow">&#9656;</span>}
                  {isSel && menuOpen && (
                    <div className="pick" onClick={(ev) => ev.stopPropagation()}>
                      <OptList
                        opts={[where === 'inv' ? 'Store' : 'Put back to inventory']}
                        sel={0}
                        onSel={() => {}}
                        onPick={() => onAct(entry)}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="panel storage-panel" onClick={onCloseMenu}>
      <div className="panel-title">Storage {slot + 1}</div>
      <div className="sec-label">storage</div>
      {renderGrid('store', storage, 8, 0, storeItems)}
      <div className="sec-label">your inventory</div>
      {renderGrid('inv', inv, 16, storeItems.length, invItems)}
      {drag?.active && (
        <pre className="drag-ghost" style={{ left: drag.x, top: drag.y }}>
          {ITEM_SPRITES[drag.item].join('\n')}
        </pre>
      )}
      <div className="hint">
        [&#8593;/&#8595;] select &#183; [Enter] options &#183; drag items into storage &#183; [Esc]
        back
      </div>
    </div>
  );
}

// The open ocean: a STATIC base lattice with caustic light drifting over it.
//
// `t` only ever counts up — it is never wrapped or passed through a sine — so
// the water always moves forward. There is no frame list to cycle: each tick
// builds the caustic layers for the current offset. The base lattice has no
// drift term, so it is rendered once and never rebuilt.
//
// Self-contained, so the animation re-renders only this layer and not the whole
// game. prefers-reduced-motion leaves it on frame 0.
//
// camX/camY/viewW/viewH are the CURRENT camera rect (ground chars/lines, same
// units as GROUND_W/GROUND_H — see clampCam in the parent), read fresh every
// render but only USED every OCEAN_CFG.driftMs tick (via boundsRef, not a
// useMemo dependency) — otherwise recomputing on every pixel of camera motion
// would defeat the whole point of throttling this to an interval. Restricting
// oceanCaustics to roughly what's on screen is what keeps its cost flat as
// the map grows — see that function's own comment for the measured cost
// without this (worse than its own redraw interval on the current map size).
// A REAL background per visual-terrain band (world.ts's
// visualTerrainColorAt/VISUAL_TERRAIN_BG), painted underneath every other
// ground/ocean layer — not just another glyph `color:`, an actual filled
// canvas, so the band shows through wherever the sparse ASCII texture above
// it doesn't cover.
//
// Painted at CHARACTER resolution (GROUND_W x GROUND_H, one canvas pixel per
// character cell) using visualTerrainColorAt's CONTINUOUS nd->colour blend
// (same VISUAL_TERRAIN_BG stop colours as before, just interpolated between
// them instead of stepped) — a flat step-per-band fill visually dominated
// the coastline transition no matter how much glyph texture sat on top of
// it, because the whole ring shared just two or three solid colours. A
// smooth per-character gradient, closer to how a real reference photo/SVG
// transect reads, gives the transition its own colour movement independent
// of the glyph layers, instead of competing with them. Built via ImageData
// (one bulk pixel-buffer write + a single putImageData) rather than a
// fillRect-per-pixel loop — cheap enough to still be a one-time paint on
// mount, same as OCEAN_BASE/SHORE_FRAMES. `image-rendering` is left at the
// browser default (not `pixelated`) so the CSS upscale to GROUND_W ch x
// GROUND_H em blends the samples smoothly instead of keeping them blocky.
function CoastBackgroundLayer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(GROUND_W, GROUND_H);
    const data = img.data;
    for (let y = 0; y < GROUND_H; y++) {
      const fy = y / TILE_LN;
      let rowOff = y * GROUND_W * 4;
      for (let x = 0; x < GROUND_W; x++) {
        const fx = x / TILE_CH;
        const [r, g, b] = visualTerrainColorAt(fx, fy);
        data[rowOff] = r;
        data[rowOff + 1] = g;
        data[rowOff + 2] = b;
        data[rowOff + 3] = 255;
        rowOff += 4;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, []);
  return (
    <canvas
      ref={canvasRef}
      width={GROUND_W}
      height={GROUND_H}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: `${GROUND_W}ch`,
        height: `${GROUND_H}em`,
      }}
    />
  );
}

function OceanLayer({
  camX,
  camY,
  viewW,
  viewH,
}: {
  camX: number;
  camY: number;
  viewW: number;
  viewH: number;
}) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const iv = window.setInterval(() => setT((v) => v + 1), OCEAN_CFG.driftMs);
    return () => window.clearInterval(iv);
  }, []);
  // Margin beyond the strictly-visible rect: the camera can drift between two
  // ~90ms caustic recomputes (walking, zooming, panning), and without slack
  // the shimmer would visibly "pop in" at the edge the instant it scrolls into
  // view instead of already being there. 0.15 (15% of the viewport on each
  // side) comfortably covers a walking step or two — measured ~25ms for a
  // typical window at that margin, vs ~90ms unbounded (see oceanCaustics'
  // comment) and ~40ms at a 0.5 margin, which was generous enough to erase
  // most of the win. Widen it only if panning/zooming visibly outruns it.
  const CAUSTIC_MARGIN = 0.15;
  const boundsRef = useRef({ x0: 0, y0: 0, x1: 0, y1: 0 });
  boundsRef.current = {
    x0: camX - viewW * CAUSTIC_MARGIN,
    y0: camY - viewH * CAUSTIC_MARGIN,
    x1: camX + viewW * (1 + CAUSTIC_MARGIN),
    y1: camY + viewH * (1 + CAUSTIC_MARGIN),
  };
  const tones = useMemo(() => oceanCaustics(t, boundsRef.current), [t]);
  return (
    <>
      <pre className="ocean ocean-base">{OCEAN_BASE.base}</pre>
      <pre className="ocean ocean-base-lit">{OCEAN_BASE.lit}</pre>
      <pre className="ocean ocean-shallow">{OCEAN_SHALLOW}</pre>
      {tones.map((s, i) => (
        <pre key={i} className={`ocean ocean-c${i}`}>
          {s}
        </pre>
      ))}
    </>
  );
}

// A player-placed decoration/furniture item — real (in `placedItems`) or a
// ghost preview while placement mode is active. Same scale-shrink offset
// every other entity uses, PLUS a rotation-aware shift: the DOM sprite text
// itself stays unrotated (rotating individual glyphs would make them
// unreadable), and is spun purely via a CSS `transform: rotate()` around the
// element's own centre — so the UNrotated layout box has to be pre-shifted
// such that its POST-rotation top-left still lands on (x,y), the same
// top-left every collision/z-order check assumes. This offset is a tile-unit
// approximation of a rotation happening in non-square pixel space (TILE_CH
// chars ≠ TILE_LN lines) — verified against the rendered game, see the
// rotation callout in the placement feature's plan.
function PlacedItemView({
  x,
  y,
  sprite,
  scale,
  rotation,
  palette,
  colors,
  texture,
  ghost,
  chargeFrac,
  onClick,
}: {
  x: number;
  y: number;
  sprite: string[];
  scale?: number;
  rotation: 0 | 1 | 2 | 3;
  palette?: Record<string, string>;
  colors?: string[];
  texture?: TextureModifier;
  ghost?: 'valid' | 'invalid' | 'warn';
  chargeFrac?: number | null;
  onClick?: (e: React.MouseEvent) => void;
}) {
  const k = scale ?? 1;
  const cw = Math.max(...sprite.map((l) => l.length));
  const offX = ((1 - k) * cw) / 2;
  const offY = (1 - k) * sprite.length;
  // The CSS transform rotates the element around ITS OWN centre (which is
  // fixed by its unrotated width/height). At 0°/180° a rectangle maps back
  // onto the SAME bounding box (no shift needed at all — 180° is point
  // symmetry about the centre). Only at 90°/270° does the visible box swap
  // to hT-wide × wT-tall, still centred on that same point, which is what
  // this offset corrects for. Gating by rotation parity (not just reusing
  // the unrotated box unconditionally) is the fix — applying it at 0°/180°
  // too silently mis-shifted every non-square-footprint sprite there.
  const { wT: uwT, hT: uhT } = spriteTiles(sprite, scale, 0); // unrotated tile box
  const odd = rotation % 2 === 1;
  const rotOffX = odd ? ((uhT - uwT) * TILE_CH) / 2 : 0;
  const rotOffY = odd ? ((uwT - uhT) * TILE_LN) / 2 : 0;
  const { wT, hT } = spriteTiles(sprite, scale, rotation); // on-screen (rotated) tile box
  return (
    <>
      <ColoredSprite
        className={'ent placed' + (ghost ? ` ghost ${ghost}` : '') + (chargeFrac != null ? ' pushing' : '')}
        style={{
          left: `${x * TILE_CH - offX + rotOffX}ch`,
          top: `${y * TILE_LN - offY + rotOffY}em`,
          zIndex: y + hT,
          ...(k !== 1 ? { scale: `${k}` } : {}),
          ...({ '--place-rot': `${rotation * 90}deg` } as React.CSSProperties),
        }}
        sprite={sprite}
        colors={ghost ? undefined : colors}
        palette={ghost ? undefined : palette}
        // ghost stays a plain valid/invalid tint — a shiny/neon/metallic
        // effect would fight the red/green readability the ghost exists for.
        texture={ghost ? undefined : texture}
        onClick={onClick}
      />
      {chargeFrac != null && (
        <div
          className="push-bar"
          style={{ left: `${x * TILE_CH}ch`, top: `${(y + hT) * TILE_LN}em`, width: `${wT * TILE_CH}ch` }}
        >
          <div className="push-bar-fill" style={{ width: `${Math.round(chargeFrac * 100)}%` }} />
        </div>
      )}
    </>
  );
}

// Its own component with its own redraw interval, so a continuously-animating
// pond doesn't re-render every other entity on the map.
function PondLayer({ ent }: { ent: Ent }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const iv = window.setInterval(() => setT((v) => v + 1), POND_FRAME_MS);
    return () => window.clearInterval(iv);
  }, []);
  const frame = useMemo(
    () => pondFrame(S.POND, S.POND_COLORS, S.POND_ANIM, t),
    [t],
  );
  const k = ent.scale ?? 1;
  const cw = Math.max(...ent.sprite.map((l) => l.length));
  return (
    <ColoredSprite
      className="ent pond"
      style={{
        left: `${ent.x * TILE_CH - ((1 - k) * cw) / 2}ch`,
        top: `${ent.y * TILE_LN - (1 - k) * ent.sprite.length}em`,
        zIndex: footprint(ent).row,
        ...(k !== 1 ? { scale: `${k}` } : {}),
      }}
      sprite={frame.sprite}
      colors={frame.colors}
      palette={ent.palette}
      perCell
      // same per-cell occlusion as the house/garden-bed — shore/reed and
      // water-dot cells all get an opaque background derived from their own
      // (possibly animated) colour, so ground/terrain can't show through
      solidCells
    />
  );
}

// The shoreline — now ONLY the white foam crest. The surge's other two layers
// (the glowing sheet that climbed the sand, and the dark wet-sand glaze it left
// behind) are no longer drawn: the ocean's own drift carries the water, and the
// foam is the one part of the old wave behaviour kept. Its frames still run on
// their own slower loop, independent of the ocean drift.
function ShoreLayer() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const iv = window.setInterval(() => setPhase((p) => (p + 1) % SHORE_FRAMES.length), SHORE_CFG.surgeMs);
    return () => window.clearInterval(iv);
  }, []);
  const f = SHORE_FRAMES[phase];
  return (
    <>
      {/* the trailing band first, so the bright crest paints over it */}
      <pre className="ocean shore-foam2">{f.foam2}</pre>
      <pre className="ocean shore-foam">{f.foam}</pre>
    </>
  );
}

function TouchControls({
  onHold,
  onRelease,
  onF,
  onI,
}: {
  onHold: (k: string) => void;
  onRelease: (k: string) => void;
  onF: () => void;
  onI: () => void;
}) {
  const dir = (k: string) => ({
    onPointerDown: () => onHold(k),
    onPointerUp: () => onRelease(k),
    onPointerLeave: () => onRelease(k),
    onPointerCancel: () => onRelease(k),
  });
  return (
    <div className="touch" onContextMenu={(e) => e.preventDefault()}>
      <div className="dpad">
        <button className="tb up" {...dir('w')}>
          &#9650;
        </button>
        <button className="tb left" {...dir('a')}>
          &#9664;
        </button>
        <button className="tb down" {...dir('s')}>
          &#9660;
        </button>
        <button className="tb right" {...dir('d')}>
          &#9654;
        </button>
      </div>
      <div className="abtns">
        <button className="tb big" onPointerDown={onF}>
          F
        </button>
        <button className="tb big" onPointerDown={onI}>
          I
        </button>
      </div>
    </div>
  );
}
