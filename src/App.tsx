import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as S from './sprites';
import {
  TILE_CH,
  TILE_LN,
  MAP_W,
  MAP_H,
  GROUND_W,
  GROUND_H,
  LAND_LAYERS,
  OCEAN_FRAMES,
  OCEAN_CFG,
  SHORE_FRAMES,
  SHORE_CFG,
  isWater,
  STRUCT_ENTS,
  wildSpawns,
  PLAYER_SPAWN,
  PLAYER_T,
  footprint,
  collisionBox,
  tileBoxesOverlap,
  near,
} from './world';
import type { Ent, ItemType } from './world';
import { getFunFact, getPrice, getShopStock, craftItem, getMitchyLine, mitchyChat, CATEGORIES } from './llm';
import type { Category, ShopItem, OwnedItem } from './llm';
import {
  GARDEN,
  SLOTS,
  gardenFence,
  gardenBlocks,
  gardenTarget,
  nearestCropSlot,
  inGarden,
  createCrop,
  cropStatus,
  advanceStage,
  slotSprite,
  EMPTY_SLOT,
  PLANTABLE_BASE,
} from './farm';
import type { PlantedCrop, Doors, DoorId } from './farm';
import {
  defaultTimeConfig,
  worldTime,
  hourSeedOf,
  growthWindowOf,
  formatWorldTime,
  dayPhaseOf,
  isNightOf,
  HOUR_MS,
} from './time';
import type { TimeConfig } from './time';
import { loadSave, writeSave } from './save';
import type { SaveState } from './save';
import { SunIcon, MoonIcon, GearIcon, BagIcon, HandIcon, CoinIcon } from './icons';

const INTRO_TEXT =
  "Hey, are u the new villager here? I'm Mitchy and own this shop. in this world u can go around and collect materials and if u give them back to me ill pay u fair.";

const TALK_LINES = [
  'purrr... nice weather today, huh?',
  'shake the apple tree. trust me.',
  'i buy almost anything. ALMOST.',
  'being a shopkeeper cat is honest work.',
  'flowers sell well this season.',
];

// Mitchy's tip the first time you pick Talk.
const TOKEN_LINE =
  'did u already try buying craft tokens with ur hard-earned money? i got a few options. If u want come around!';

// Playable characters. More can be added later; the profile circle in the
// header always renders the face of the currently selected character.
// `face` is the head portion of the sprite (hair down to the neck).
type Character = { id: string; name: string; sprite: string[]; face: string[] };
const CHARACTERS: Character[] = [
  { id: 'villager', name: 'Villager', sprite: S.PLAYER, face: S.PLAYER.slice(0, 2) },
];

const ITEM_INFO: Record<ItemType, { name: string; desc: string }> = {
  flower: { name: 'Wildflower', desc: 'A messy bunch of meadow blooms.' },
  stone: { name: 'Stone', desc: 'A small, satisfyingly smooth rock.' },
  apple: { name: 'Apple', desc: 'Crisp, sweet, freshly shaken off a tree.' },
  cactus: { name: 'Cactus', desc: 'A prickly little desert survivor.' },
  fern: { name: 'Fern', desc: 'A feathery frond from the deep jungle.' },
  iceflower: { name: 'Ice Flower', desc: 'A frost-hardened bloom from the tundra.' },
};

const ITEM_SPRITES: Record<ItemType, string[]> = {
  flower: S.FLOWER,
  stone: S.STONE,
  apple: S.APPLE,
  cactus: S.CACTUS,
  fern: S.FERN,
  iceflower: S.ICEFLOWER,
};

const ITEM_TYPES: ItemType[] = ['flower', 'stone', 'apple', 'cactus', 'fern', 'iceflower'];

const emptyInv = (): Record<ItemType, number> =>
  Object.fromEntries(ITEM_TYPES.map((t) => [t, 0])) as Record<ItemType, number>;

// Which entity F acts on first when several are in range.
const PRIO: Record<string, number> = {
  apple: 0,
  flower: 1,
  stone: 1,
  cactus: 1,
  fern: 1,
  iceflower: 1,
  appleTree: 2,
  emptyTree: 2,
  cat: 3,
  shop: 3,
  house: 3,
};

// Held-key movement: one tile step per interval while a direction is held.
// Walking is deliberately unhurried; holding Shift dashes at the fast pace.
const WALK_MS = 170;
const DASH_MS = 100;
const DIRS: Record<string, [number, number]> = {
  w: [0, -1],
  s: [0, 1],
  a: [-1, 0],
  d: [1, 0],
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
    }
  | { t: 'craft'; ownedId: string; confirmClose?: boolean }
  | { t: 'houseMenu'; sel: number }
  | { t: 'storage'; slot: number; sel: number; menuOpen: boolean }
  | { t: 'crop'; slot: number }
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
  return (
    <div className="landing">
      <pre className="title">{S.TITLE.join('\n')}</pre>
      <div className="subtitle">a tiny monochrome bay</div>
      <button className="start" onClick={onStart}>
        [ START ]
      </button>
    </div>
  );
}

function Game() {
  // load once; all initial state comes from the save blob when present
  const [saved] = useState<SaveState | null>(loadSave);
  const timeCfgRef = useRef<TimeConfig>(
    saved
      ? { anchor: saved.anchor, anchorReal: saved.anchorReal, timeScale: saved.timeScale }
      : defaultTimeConfig(),
  );

  const [player, setPlayer] = useState(() =>
    saved
      ? {
          x: Math.min(Math.max(0, saved.player.x), MAP_W - PLAYER_T.wT),
          y: Math.min(Math.max(0, saved.player.y), MAP_H - PLAYER_T.hT),
        }
      : PLAYER_SPAWN,
  );
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
  const [doors, setDoors] = useState<Doors>(() => saved?.doors ?? { top: false, bottom: false });
  const [modal, setModal] = useState<Modal>(null);
  const [bubble, setBubble] = useState<Bubble>(null);
  const [shaking, setShaking] = useState<string | null>(null);
  const [nothingId, setNothingId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(MAX_ZOOM);
  // camera offset from the player-centred position, set by zoom-to-cursor.
  // Deliberately NOT limited to keeping the player on screen — you can zoom
  // off to look anywhere on the map; Space (or double-tap) brings it back.
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [camTween, setCamTween] = useState<'zoom' | 'recentre' | null>(null);
  // planetary menu around the player avatar (bottom-left HUD)
  const [orbitOpen, setOrbitOpen] = useState(false);
  const [handMenu, setHandMenu] = useState(false); // equip/unequip popup

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

  const character = CHARACTERS[charIdx];
  const equippedRef = useRef(equipped);
  equippedRef.current = equipped;

  // ---- the world clock (worldTime) ticks once per second ----
  useEffect(() => {
    const iv = window.setInterval(() => setWt(worldTime(timeCfgRef.current)), 1000);
    return () => window.clearInterval(iv);
  }, []);

  // ---- derived world: structures + windowed wild spawns − exceptions ----
  const growthWindow = growthWindowOf(wt);
  const ents = useMemo(
    () => [
      ...STRUCT_ENTS,
      // wild spawns skip the garden footprint so nothing sprouts inside the fence
      ...wildSpawns(growthWindow).filter((e) => !removed.has(e.id) && !inGarden(e.x, e.y)),
      ...dynamicEnts.filter((e) => !removed.has(e.id)),
    ],
    [growthWindow, removed, dynamicEnts],
  );

  // when the growth window rolls over: loose apples despawn, stale
  // exceptions (from old windows) are pruned so the save doesn't grow forever
  useEffect(() => {
    setDynamicEnts([]);
    setRemoved((s) => new Set([...s].filter((id) => id.includes(`-${growthWindow}-`))));
    setShaken((s) => new Set([...s].filter((k) => k.endsWith(`@${growthWindow}`))));
  }, [growthWindow]);

  // ---- autosave: one debounced blob, flushed when the tab hides ----
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
  });
  useEffect(() => {
    const t = window.setTimeout(() => writeSave(snapRef.current()), 2000);
    return () => window.clearTimeout(t);
  }, [player, inv, money, storages, bag, equipped, removed, shaken, crops, doors]);
  useEffect(() => {
    const flush = () => writeSave(snapRef.current());
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('beforeunload', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

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

  const catDef = STRUCT_ENTS.find((e) => e.id === 'cat')!;

  // ---- viewport sizing: fill the screen edge-to-edge, on any aspect ----
  // The old version scaled a FIXED 112ch x 40em field with min(availW/w,
  // availH/h) — a "contain" fit, so any screen whose aspect didn't match the
  // field's ~1.68 got black pillar/letterbox bars. Instead we COVER: scale the
  // design view up until it covers the box (max instead of min), then size the
  // field to the FULL available box — the overflow is simply cropped, so the
  // screen is always filled and nobody sees extra world.
  const fieldRef = useRef<HTMLDivElement>(null);
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
  function tryMove(dx: number, dy: number) {
    setPlayer((p) => {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx + PLAYER_T.wT > MAP_W || ny + PLAYER_T.hT > MAP_H) {
        return p;
      }
      // block if the player's tile box would overlap any entity's SOLID box
      // (buildings are solid throughout; trees only at the trunk base, so you
      // still pass behind the canopy — see collisionBox)
      const pbox = { x0: nx, y0: ny, x1: nx + PLAYER_T.wT - 1, y1: ny + PLAYER_T.hT - 1 };
      for (const e of entsRef.current) {
        if (tileBoxesOverlap(pbox, collisionBox(e))) return p;
      }
      // the garden fence blocks movement except through open doors
      if (gardenBlocks(nx, ny, PLAYER_T.wT, PLAYER_T.hT, doorsRef.current)) return p;
      // ocean blocks movement unless riding something that floats (a boat)
      const floating = equippedRef.current?.equip?.mode === 'vehicle' && !!equippedRef.current.equip.float;
      if (!floating) {
        for (let ty = ny; ty < ny + PLAYER_T.hT; ty++) {
          for (let tx = nx; tx < nx + PLAYER_T.wT; tx++) {
            if (isWater(tx, ty)) return p;
          }
        }
      }
      return { x: nx, y: ny };
    });
  }

  const entsRef = useRef(ents);
  entsRef.current = ents;
  const doorsRef = useRef(doors);
  doorsRef.current = doors;
  const modalRef = useRef(modal);
  modalRef.current = modal;

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

  function holdStart(k: string) {
    if (modalRef.current) return;
    const h = heldRef.current;
    if (h.has(k)) return;
    h.add(k);
    // step immediately on press so controls feel snappy
    const [dx, dy] = heldDelta();
    if (dx || dy) {
      tryMove(dx, dy);
      lastStepRef.current = performance.now();
    }
  }

  function holdEnd(k: string) {
    heldRef.current.delete(k);
  }

  useEffect(() => {
    let raf = requestAnimationFrame(function tick() {
      raf = requestAnimationFrame(tick);
      if (modalRef.current || heldRef.current.size === 0) return;
      const now = performance.now();
      const eq = equippedRef.current;
      const mult = eq?.equip?.mode === 'vehicle' ? (eq.equip.speedMult ?? 1) : 1;
      if (now - lastStepRef.current < (dashRef.current ? DASH_MS : WALK_MS) * mult) return;
      const [dx, dy] = heldDelta();
      if (!dx && !dy) return;
      tryMove(dx, dy);
      lastStepRef.current = now;
    });
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'shift') setDash(false);
      else holdEnd(k);
    };
    const clear = () => {
      heldRef.current.clear();
      setDash(false);
    };
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // greet the player the first time they come near Mitchy, and dismiss any
  // bubble when the player walks away again
  const introShownRef = useRef(false);
  useEffect(() => {
    const d = near(catDef, player);
    if (!introShownRef.current && d <= 4) {
      introShownRef.current = true;
      setBubble({ text: INTRO_TEXT, width: 44 });
    } else if (bubble && d > 4) {
      setBubble(null);
    }
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
  // Everything the handler needs, refreshed every render, so the listener can
  // be bound once without ever capturing stale values.
  const camRef = useRef({
    zoom: 1,
    minZoom: 0,
    pcx: 0,
    pcy: 0,
    panX: 0,
    panY: 0,
    dims,
  });
  const zoomTimer = useRef(0);
  // the world point a zoom gesture is aiming at, latched on the first notch
  const gestureRef = useRef({ wx: 0, wy: 0, cx: -1e9, cy: -1e9, until: 0 });
  // last touch, for the double-tap-to-recentre detector
  const tapRef = useRef({ at: 0, x: 0, y: 0 });

  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (modalRef.current) return; // let modals scroll normally
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

  // a resize can raise the floor above the current zoom — pull it back in
  useEffect(() => {
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(minZoom, z)));
  }, [minZoom]);

  // ---- interaction target ([F] popup) ----
  const fTarget = useMemo(() => {
    let best: { e: Ent; score: number } | null = null;
    for (const e of ents) {
      if (!e.interactable) continue;
      const d = near(e, player);
      if (d > 1) continue;
      const score = d * 10 + (PRIO[e.kind] ?? 9);
      if (!best || score < best.score) best = { e, score };
    }
    return best ? best.e : null;
  }, [ents, player]);

  // garden door the player is next to (or null)
  const gTarget = useMemo(
    () => gardenTarget(player.x, player.y, PLAYER_T.wT, PLAYER_T.hT),
    [player],
  );

  // the planted crop the player is standing next to — each plant is its own
  // interactable, watered/inspected individually
  const cropSlot = useMemo(
    () => nearestCropSlot(player.x, player.y, PLAYER_T.wT, PLAYER_T.hT, crops.map((c) => c.slot)),
    [player, crops],
  );

  // grow / wilt crops on every world-clock tick
  useEffect(() => {
    setCrops((cs) => {
      let changed = false;
      const next = cs.map((c) => {
        const st = advanceStage(c, wt);
        if (st !== c.stage) {
          changed = true;
          return { ...c, stage: st };
        }
        return c;
      });
      return changed ? next : cs;
    });
  }, [wt]);

  function collect(e: Ent) {
    // wild spawns are derived, so collecting = recording an exception
    setRemoved((s) => new Set(s).add(e.id));
    setInv((v) => ({ ...v, [e.kind]: v[e.kind as ItemType] + 1 }));
  }

  function showNothing(id: string) {
    window.clearTimeout(nothingTimer.current);
    setNothingId(id);
    nothingTimer.current = window.setTimeout(() => setNothingId(null), 1600);
  }

  function dropApples(tree: Ent) {
    const spots = [
      { dx: -3, dy: 1, fall: 5 },
      { dx: 3, dy: 1, fall: 5 },
      { dx: 4, dy: 3, fall: 8 },
    ];
    const count = Math.random() < 0.5 ? 2 : 3;
    const apples: Ent[] = spots.slice(0, count).map((s, i) => ({
      id: `apple-${Date.now()}-${i}`,
      kind: 'apple',
      x: tree.x + s.dx,
      y: tree.y + s.dy,
      sprite: S.APPLE,
      interactable: true,
      fallFrom: s.fall,
    }));
    setDynamicEnts((es) => [...es, ...apples]);
  }

  function shakeTree(tree: Ent) {
    if (shaking) return;
    setShaking(tree.id);
    // apple trees regrow their apples each growth window
    const shakeKey = `${tree.id}@${growthWindow}`;
    window.setTimeout(() => {
      setShaking(null);
      if (tree.kind === 'appleTree' && !shaken.has(shakeKey)) {
        setShaken((s) => new Set(s).add(shakeKey));
        dropApples(tree);
      } else {
        showNothing(tree.id);
      }
    }, 620);
  }

  function doF() {
    if (bubble) {
      setBubble(null);
      return;
    }
    // a planted crop right next to you opens its own care/water panel
    if (cropSlot >= 0) {
      setModal({ t: 'crop', slot: cropSlot });
      return;
    }
    // otherwise a garden door toggles open/closed
    if (gTarget) {
      toggleDoor(gTarget.door);
      return;
    }
    const t = fTarget;
    if (!t) return;
    switch (t.kind) {
      case 'flower':
      case 'stone':
      case 'apple':
      case 'cactus':
      case 'fern':
      case 'iceflower':
        collect(t);
        break;
      case 'appleTree':
      case 'emptyTree':
        shakeTree(t);
        break;
      case 'cat':
        setModal({ t: 'dialog', sel: 0 });
        break;
      case 'shop':
        // the shop building skips Mitchy's dialog and opens the shop directly
        setModal(FRESH_SHOP);
        break;
      case 'house':
        setModal({ t: 'houseMenu', sel: 0 });
        break;
    }
  }

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
    if (money < it.price) {
      setModal({ ...m, poor: true });
      return;
    }
    const owned: OwnedItem = { ...it, ownedId: `own-${Date.now()}` };
    setMoney((mo) => mo - it.price);
    setBag((b) => [...b, owned]);
    if (it.kind === 'token') {
      // a bought token immediately asks what to craft
      setModal({ t: 'craft', ownedId: owned.ownedId });
    } else {
      setModal({ ...m, confirm: null, poor: false });
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

  // A successful craft consumes the token and yields the new item.
  function craftFinish(tokenId: string, item: ShopItem, equip: boolean) {
    const owned: OwnedItem = { ...item, ownedId: `own-${Date.now()}` };
    setBag((b) => [...b.filter((x) => x.ownedId !== tokenId), owned]);
    if (equip && owned.equip) {
      equipOwned(owned);
    } else {
      setModal(null);
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
        // a generation is running: don't let Esc/outside-click silently kill it
        if (m.confirmClose) return { ...m, confirmClose: false }; // Esc on the confirm = keep waiting
        if (craftBusyRef.current) return { ...m, confirmClose: true };
      }
      return null;
    });
  }

  function xClose() {
    setModal((m) => {
      if (!m) return m;
      if (m.t === 'detail' || m.t === 'detailOwned') return { t: 'inventory' };
      if (m.t === 'craft' && craftBusyRef.current) return { ...m, confirmClose: true };
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
    return null;
  }

  function ownedAction(owned: OwnedItem) {
    if (owned.kind === 'token') {
      setModal({ t: 'craft', ownedId: owned.ownedId });
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
    const labels: string[] = [];
    if (owned.kind === 'token') labels.push('Use token');
    else if (owned.equip) labels.push(isEquipped ? 'Unequip' : 'Equip');
    if (canPlant) labels.push('Plant in garden');
    return {
      labels,
      pick: (i) => (labels[i] === 'Plant in garden' ? plantOwned(owned) : ownedAction(owned)),
    };
  }

  // ---- farming ----
  function freeSlot(): number {
    for (let i = 0; i < SLOTS.length; i++) if (!crops.some((c) => c.slot === i)) return i;
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

  function toggleDoor(d: DoorId) {
    setDoors((ds) => ({ ...ds, [d]: !ds[d] }));
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
    const ids = new Set(targets.map((c) => c.id));
    setCrops((cs) => cs.map((c) => (ids.has(c.id) ? { ...c, lastWateredAt: wt } : c)));
    showToast(`splash! watered ${targets.length} plant${targets.length > 1 ? 's' : ''}.`);
  }

  function harvestCrop(slot: number) {
    const c = crops.find((x) => x.slot === slot);
    if (!c || c.stage !== 'ready') return;
    setCrops((cs) => cs.filter((x) => x.slot !== slot));
    if (c.harvest.kind === 'base') {
      const it = c.harvest.it;
      setInv((v) => ({ ...v, [it]: v[it] + 2 }));
      showToast(`harvested 2 ${ITEM_INFO[it].name.toLowerCase()}!`);
    } else {
      const item = c.harvest.item;
      setBag((b) => [...b, { ...item, ownedId: `own-${Date.now()}` }]);
      showToast(`harvested ${item.name}!`);
    }
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
        }
      } else if (modal.t === 'inventory' && k === 'i') {
        setModal(null);
      }
      return;
    }
    if (DIRS[k]) {
      if (!ev.repeat) holdStart(k);
    } else if (k === 'shift') setDash(true);
    else if (k === 'f') doF();
    else if (k === 'i') setModal({ t: 'inventory' });
    else if (k === ' ') {
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
  camRef.current = { zoom, minZoom, pcx, pcy, panX, panY, dims };
  const speedMult = equipped?.equip?.mode === 'vehicle' ? (equipped.equip.speedMult ?? 1) : 1;
  const stepDur = ((dash ? DASH_MS : WALK_MS) * speedMult) / 1000;

  // Attachment sockets on the player rig (in the rig's own char grid). Derived
  // from the sprite, not a magic number, so they stay correct if the art changes.
  const playerW = Math.max(...character.sprite.map((l) => l.length));
  const HAND_X = playerW - 2; // ~ right-hand column
  const HAND_Y = 1; // second sprite line ≈ arm height

  // The three planetary buttons, in orbit order (top -> right). Order matches
  // ORBIT_ANGLES / ORBIT_POS. `keep` = don't collapse the orbit on click
  // (the hand slot opens its own popup right next to itself).
  const ORBIT_ITEMS = [
    {
      id: 'settings',
      label: 'SETTINGS',
      node: <GearIcon className="hud-orbit-icon" />,
      keep: false,
      run: () => setModal({ t: 'settings' }),
    },
    {
      id: 'inventory',
      label: 'INVENTORY',
      node: <BagIcon className="hud-orbit-icon" />,
      keep: false,
      run: () => setModal({ t: 'inventory' }),
    },
    {
      id: 'hand',
      label: 'HAND SLOT',
      // shows the equipped item itself; falls back to the hand icon when empty
      node: equipped ? (
        <pre style={{ color: equipped.color }}>{equipped.sprite.join('\n')}</pre>
      ) : (
        <HandIcon className="hud-orbit-icon" />
      ),
      keep: true,
      run: () => setHandMenu((v) => !v),
    },
  ];

  // Avatar art: every row padded to the same width so the <pre> box is exactly
  // the sprite's grid (no max-content slack to drift inside of).
  const avatarCols = Math.max(...character.sprite.map((l) => l.length));
  const avatarArt = character.sprite.map((l) => l.padEnd(avatarCols, ' ')).join('\n');

  const timeStr = formatWorldTime(wt);
  const secsToRefresh = Math.ceil((HOUR_MS - (wt % HOUR_MS)) / 1000);
  const refreshStr = `${String(Math.floor(secsToRefresh / 60)).padStart(2, '0')}:${String(
    secsToRefresh % 60,
  ).padStart(2, '0')}`;

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
              {/* Full sprite, not just the face — it fills the circle.
                  Rows are padded to one width and the box is pinned to an
                  exact `ch` count: with ragged rows (6/7/6) the <pre> is sized
                  by max-content, and any slack in that box makes flex centre
                  the BOX while the ink sits off to one side. */}
              <pre style={{ width: `${avatarCols}ch` }}>{avatarArt}</pre>
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

        {modal && (
          <button className="hud-x" onClick={xClose} aria-label="close">
            [x]
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
        <div
          className="scale-box"
          style={{ width: dims.w * dims.scale, height: dims.h * dims.scale }}
        >
          <div style={{ transform: `scale(${dims.scale})`, transformOrigin: '0 0' }}>
            <div
              className={'field phase-' + dayPhaseOf(wt)}
              ref={fieldRef}
              style={{ width: dims.w, height: dims.h }}
            >
              <div
                className="world"
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
                  transition:
                    camTween === 'zoom'
                      ? `transform ${ZOOM_MS}ms ease-out`
                      : camTween === 'recentre'
                        ? `transform ${RECENTRE_MS}ms ease-in-out`
                        : `transform ${stepDur}s linear`,
                }}
              >
              <OceanLayer />
              {LAND_LAYERS.map((l) => (
                <pre key={l.region} className={'ground region-' + l.region}>
                  {l.text}
                </pre>
              ))}
              <ShoreLayer />


              {/* garden: fence + doors, then a sprite per bed slot */}
              <pre
                className="garden-fence"
                style={{
                  left: `${GARDEN.x0 * TILE_CH}ch`,
                  top: `${GARDEN.y0 * TILE_LN}em`,
                  zIndex: GARDEN.y0,
                }}
              >
                {gardenFence(doors).join('\n')}
              </pre>
              {SLOTS.map((s, i) => {
                const c = crops.find((cr) => cr.slot === i);
                const spr = c ? slotSprite(c, wt) : EMPTY_SLOT;
                const thirsty = c && c.stage === 'growing' && cropStatus(c, wt).thirsty;
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
                  >
                    {spr.join('\n')}
                  </pre>
                );
              })}
              {crops.map((c) => {
                const st = cropStatus(c, wt);
                const badge =
                  c.stage === 'ready'
                    ? 'ready!'
                    : c.stage === 'failed'
                      ? 'x'
                      : st.thirsty
                        ? 'water!'
                        : '';
                if (!badge) return null;
                const s = SLOTS[c.slot];
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

              {ents.map((e) => (
                <pre
                  key={e.id}
                  className={
                    'ent ' +
                    e.kind +
                    (shaking === e.id ? ' shaking' : '') +
                    (e.fallFrom ? ' falling' : '')
                  }
                  style={{
                    left: `${e.x * TILE_CH}ch`,
                    top: `${e.y * TILE_LN}em`,
                    zIndex: footprint(e).row,
                    ...(e.fallFrom
                      ? ({ '--fall-from': `${-e.fallFrom}em` } as React.CSSProperties)
                      : {}),
                  }}
                >
                  {e.sprite.join('\n')}
                </pre>
              ))}

              {equipped?.equip?.mode === 'pet' && petPos && (
                <pre
                  className="ent pet"
                  style={{
                    left: `${petPos.x * TILE_CH}ch`,
                    top: `${petPos.y * TILE_LN}em`,
                    zIndex: petPos.y + 1,
                    transitionDuration: `${stepDur * 1.2}s`,
                  }}
                >
                  {equipped.sprite.join('\n')}
                </pre>
              )}

              {/* Player rig: the ONLY element positioned in world space. The
                  player sprite and any attached gear/held items are children
                  with fixed offsets in the rig's own grid, so they can never
                  desync from the player or from each other. Only the rig moves;
                  visual sizing is done with transform, never font-size. */}
              <div
                className="player-rig"
                style={{
                  left: `${player.x * TILE_CH}ch`,
                  top: `${player.y * TILE_LN}em`,
                  zIndex: player.y + PLAYER_T.hT - 1,
                  transitionDuration: `${stepDur}s`,
                }}
              >
                <pre className="player-sprite">{character.sprite.join('\n')}</pre>

                {equipped?.equip?.mode === 'vehicle' && (
                  <pre className="rig-gear" style={{ left: '-1ch', top: '2em' }}>
                    {equipped.sprite.join('\n')}
                  </pre>
                )}

                {equipped?.equip?.mode === 'hold' && (
                  <pre
                    className="rig-held"
                    style={{
                      left: `${HAND_X}ch`,
                      top: `${HAND_Y}em`,
                      color: equipped.color,
                      transform: `scale(${0.7 * (equipped.scale ?? 1)})`,
                    }}
                  >
                    {equipped.sprite.join('\n')}
                  </pre>
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
                (cropSlot >= 0 || gTarget || fTarget) &&
                (() => {
                  // priority: the plant you're next to, then a door, then any entity
                  const t = cropSlot >= 0 ? SLOTS[cropSlot] : (gTarget ?? fTarget!);
                  return (
                    <div
                      className="fpop"
                      style={{
                        left: `${t.x * TILE_CH + 1}ch`,
                        top: `${Math.max(0, t.y * TILE_LN - 1.6)}em`,
                      }}
                    >
                      [F]
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
                  oh nothing...
                </div>
              )}

              {bubbleEl}
              </div>
            </div>
          </div>
        </div>
      </div>

      {!modal && (
        <div className="kbd-hint">
          [WASD] move &#183; [Shift] dash &#183; [F] interact &#183; [I] inventory
        </div>
      )}

      <TouchControls onHold={holdStart} onRelease={holdEnd} onF={doF} onI={toggleInventory} />

      {modal && (
        <div
          className="overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) escClose();
          }}
        >
          {modal.t === 'inventory' && (
            <div className="panel">
              <div className="panel-title">
                &#9552;&#9552;&#9552; {modal.equipPick ? 'EQUIP WHAT?' : 'INVENTORY'}{' '}
                &#9552;&#9552;&#9552;
              </div>
              <InvGrid
                inv={inv}
                onItem={(it) => setModal({ t: 'detail', item: it })}
                bag={bag}
                equippedId={equipped?.ownedId ?? null}
                onBagItem={(o) => setModal({ t: 'detailOwned', ownedId: o.ownedId, sel: 0 })}
                equipPick={modal.equipPick}
                onEquipPick={(o) => equipOwned(o)}
              />
              <div className="hint">
                {modal.equipPick
                  ? 'pick something to hold · greyed items can’t be equipped · [Esc] cancel'
                  : 'click an item for details · [I] or [Esc] to close'}
              </div>
            </div>
          )}

          {modal.t === 'settings' && (
            <div className="panel">
              <div className="panel-title">&#9552;&#9552;&#9552; SETTINGS &#9552;&#9552;&#9552;</div>
              <div className="hint">nothing here yet &#183; [Esc] to close</div>
            </div>
          )}

          {modal.t === 'detail' && (
            <DetailPanel
              item={modal.item}
              onPlant={
                PLANTABLE_BASE.includes(modal.item) && inv[modal.item] > 0
                  ? () => plantBase(modal.item)
                  : undefined
              }
            />
          )}

          {modal.t === 'dialog' && (
            <div className="panel dialog-panel">
              <pre className="portrait small">{S.CAT.join('\n')}</pre>
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
              <pre className="portrait small">{S.HOUSE.join('\n')}</pre>
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
                <span className="shop-hdr-title">&#9552;&#9552;&#9552; SHOP &#9552;&#9552;&#9552;</span>
                <span className="shop-hdr-timer" title="restocks hourly">
                  &#9719; {refreshStr}
                </span>
                <span className="shop-hdr-money">&#164; {money}</span>
                <button className="shop-x" onClick={() => setModal(null)} aria-label="close shop">
                  [x]
                </button>
              </div>
              {modal.tab === 'buy' && (
                <>
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
                <pre className="portrait">{S.CAT.join('\n')}</pre>
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

          {modal.t === 'craft' &&
            (() => {
              const token = bag.find((o) => o.ownedId === modal.ownedId);
              return token ? (
                <CraftPanel
                  key={token.ownedId}
                  token={token}
                  onTake={(item) => craftFinish(token.ownedId, item, false)}
                  onEquip={(item) => craftFinish(token.ownedId, item, true)}
                  confirmClose={!!modal.confirmClose}
                  onConfirmResolve={(cancel) =>
                    cancel
                      ? setModal(null)
                      : setModal((m) => (m && m.t === 'craft' ? { ...m, confirmClose: false } : m))
                  }
                  onBusyChange={(b) => {
                    craftBusyRef.current = b;
                    // generation finished while the confirm dialog was open → dismiss it
                    if (!b) setModal((m) => (m && m.t === 'craft' && m.confirmClose ? { ...m, confirmClose: false } : m));
                  }}
                />
              ) : null;
            })()}

          {modal.t === 'detailOwned' &&
            (() => {
              const owned = bag.find((o) => o.ownedId === modal.ownedId);
              if (!owned) return null;
              const { labels, pick } = ownedOptList(owned);
              return (
                <div className="panel detail-panel">
                  <div className="panel-title">{owned.name}</div>
                  <pre className="detail-sprite" style={{ color: owned.color }}>{owned.sprite.join('\n')}</pre>
                  <p className="detail-desc">{owned.desc}</p>
                  <p className="detail-fact">* {owned.funcDesc}</p>
                  {labels.length > 0 && (
                    <OptList
                      opts={labels}
                      sel={modal.sel}
                      onSel={(i) => setModal({ ...modal, sel: i })}
                      onPick={pick}
                    />
                  )}
                  <div className="hint">[Esc] back</div>
                </div>
              );
            })()}

          {modal.t === 'crop' &&
            (() => {
              const c = crops.find((x) => x.slot === modal.slot);
              if (!c) return null;
              const st = cropStatus(c, wt);
              const mins = (ms: number) => Math.max(0, Math.ceil(ms / 60000));
              return (
                <div className="panel detail-panel">
                  <div className="panel-title">{c.name}</div>
                  <pre className="detail-sprite">{slotSprite(c, wt).join('\n')}</pre>
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
            'slot' + (s ? ' filled' : '') + (s && equipPick && !canEquip(s) ? ' disabled' : '')
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
              <pre className="mini" style={{ color: s.o.color }}>{s.o.sprite.join('\n')}</pre>
              {s.o.kind === 'token' && <span className="token-tag">TOKEN</span>}
              {equippedId === s.o.ownedId && <span className="equipped-tag">EQ</span>}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// Craft-token chat: the player describes an item, the LLM pipeline crafts it
// live — reference image thumbnail, stage status, the sprite materializing
// line by line, and Mitchy available for chat the whole time.
const CRAFT_STAGE_TEXT: Record<string, string> = {
  image: '[ sketching a reference picture... ]',
  drawing: '[ drawing ur sprite... ]',
  retrying: '[ hmm, not quite — adjusting... ]',
};

function CraftPanel({
  token,
  onTake,
  onEquip,
  confirmClose,
  onConfirmResolve,
  onBusyChange,
}: {
  token: OwnedItem;
  onTake: (item: ShopItem) => void;
  onEquip: (item: ShopItem) => void;
  confirmClose: boolean;
  onConfirmResolve: (cancel: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [log, setLog] = useState<{ who: 'cat' | 'me'; text: string }[]>([
    { who: 'cat', text: `tell me what u wanna craft... (something ${token.category}-ish)` },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [partial, setPartial] = useState<string[]>([]);
  const [refImg, setRefImg] = useState<string | null>(null);
  const [result, setResult] = useState<ShopItem | null>(null);
  // Mitchy's alternative-craft proposals after a benign failure (3 buttons).
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const partialLevel = useRef<number>(-1);

  function setBusyBoth(b: boolean) {
    setBusy(b);
    onBusyChange(b);
  }

  // Launch a craft for `text` — shared by the input field and the suggestion
  // buttons so both go through identical busy/progress/result handling.
  function startCraft(text: string) {
    setSuggestions(null);
    setLog((l) => [...l, { who: 'me', text }]);
    setBusyBoth(true);
    setStage(null);
    setPartial([]);
    setRefImg(null);
    partialLevel.current = -1;
    // Mitchy's opening line lands near-instantly while the pipeline runs.
    setBusyLine(null);
    getMitchyLine('a "hold on, i\'m crafting your thing right now" busy').then((line) => setBusyLine(line));

    craftItem(token.category, text, {
      onStage: (s) => setStage(s),
      onImage: (url) => setRefImg(url),
      onLine: (line, _i, level) => {
        // parallel retries can interleave: keep only the latest attempt's lines
        if (level !== partialLevel.current) {
          partialLevel.current = level;
          setPartial([line]);
        } else {
          setPartial((p) => [...p, line]);
        }
      },
    }).then((r) => {
      setBusyBoth(false);
      setStage(null);
      setPartial([]);
      if (r.ok) {
        if (r.refImage) setRefImg(r.refImage);
        setResult(r.item);
        setLog((l) => [...l, { who: 'cat', text: 'crafting... done! here u go:' }]);
      } else {
        setRefImg(null);
        setLog((l) => [...l, { who: 'cat', text: r.reply }]);
        if (r.suggestions?.length) setSuggestions(r.suggestions);
      }
    });
  }

  function submit() {
    const text = input.trim();
    if (!text || result) return;
    setInput('');

    // While a craft is running, the input becomes a live chat with Mitchy —
    // an independent call that never touches the running pipeline.
    if (busy) {
      setLog((l) => [...l, { who: 'me', text }]);
      mitchyChat(text).then((reply) => setLog((l) => [...l, { who: 'cat', text: reply }]));
      return;
    }

    startCraft(text);
  }

  return (
    <div className="panel craft-panel">
      <div className="panel-title">{token.name.toUpperCase()}</div>
      <div className="craft-log">
        {log.map((m, i) => (
          <div key={i} className={'craft-msg ' + m.who}>
            {m.who === 'cat' ? 'mitchy: ' : 'u: '}
            {m.text}
          </div>
        ))}
        {busy && <div className="craft-msg cat">mitchy: {busyLine ?? '...'}</div>}
      </div>

      {busy && (
        <div className="craft-live">
          {stage && <div className="craft-stage">{CRAFT_STAGE_TEXT[stage] ?? ''}</div>}
          <div className="craft-live-row">
            {refImg ? (
              <img className="craft-ref" src={refImg} alt="reference" title="mitchy's reference sketch" />
            ) : (
              stage === 'image' && <div className="craft-ref loading">?</div>
            )}
            {partial.length > 0 && <pre className="craft-partial">{partial.join('\n')}</pre>}
          </div>
        </div>
      )}

      {!busy && !result && suggestions && (
        <div className="craft-suggest-row">
          {suggestions.map((s, i) => (
            <button key={i} className="craft-suggest" onClick={() => startCraft(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      {!result && (
        <div className="craft-input-row">
          <input
            className="craft-input"
            value={input}
            autoFocus
            placeholder={busy ? 'chat with mitchy while she works...' : 'describe it...'}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              e.stopPropagation();
            }}
          />
          <button className="craft-send" onClick={submit}>
            [send]
          </button>
        </div>
      )}

      {result && (
        <div className="craft-result">
          <div className="craft-result-row">
            <pre className="detail-sprite" style={{ color: result.color }}>{result.sprite.join('\n')}</pre>
            {refImg && (
              <img className="craft-ref small" src={refImg} alt="reference" title="the reference picture this was drawn from" />
            )}
          </div>
          <div className="craft-result-name">{result.name}</div>
          <p className="detail-fact">* {result.funcDesc}</p>
          <div className="craft-btns">
            <button onClick={() => onEquip(result)}>Equip</button>
            <button onClick={() => onTake(result)}>Put inside ur inventory</button>
          </div>
        </div>
      )}

      {confirmClose && (
        <div className="craft-confirm">
          <div className="craft-confirm-box">
            <div>mitchy is still crafting! really walk away?</div>
            <div className="craft-btns">
              <button onClick={() => onConfirmResolve(false)}>Keep waiting</button>
              <button onClick={() => onConfirmResolve(true)}>Cancel it</button>
            </div>
          </div>
        </div>
      )}

      <div className="hint">
        {busy ? 'crafting takes a moment — u can chat meanwhile' : '[Esc] keep the token for later'}
      </div>
    </div>
  );
}

function DetailPanel({ item, onPlant }: { item: ItemType; onPlant?: () => void }) {
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
    <div className="panel detail-panel">
      <div className="panel-title">{ITEM_INFO[item].name}</div>
      <pre className="detail-sprite">{ITEM_SPRITES[item].join('\n')}</pre>
      <p className="detail-desc">{ITEM_INFO[item].desc}</p>
      <p className="detail-fact">* fun fact: {fact ?? '...'}</p>
      {onPlant && (
        <OptList opts={['Plant in garden']} sel={0} onSel={() => {}} onPick={onPlant} />
      )}
      <div className="hint">[Esc] back</div>
    </div>
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
      <div className="panel-title">
        &#9552;&#9552;&#9552; STORAGE {slot + 1} &#9552;&#9552;&#9552;
      </div>
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

// Cycles the pre-rendered water caustics frames (open-water specks, soft
// crease edges, and the bright crease web as separate layers, each its own
// colour). Self-contained so the animation re-renders only this layer, not
// the whole game. Respects prefers-reduced-motion with a single static frame.
function OceanLayer() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const iv = window.setInterval(() => setPhase((p) => (p + 1) % OCEAN_FRAMES.length), OCEAN_CFG.driftMs);
    return () => window.clearInterval(iv);
  }, []);
  return (
    <>
      <pre className="ocean">{OCEAN_FRAMES[phase].water}</pre>
      <pre className="ocean ocean-dim">{OCEAN_FRAMES[phase].dim}</pre>
      <pre className="ocean ocean-foam">{OCEAN_FRAMES[phase].foam}</pre>
    </>
  );
}

// The shoreline surge — a thin foam-edged sheet that pushes up the sand,
// holds, then recedes leaving wet-sand glaze. Rendered ABOVE the land layers
// so the wash paints over the sand. Its own slower loop, independent of the
// open-ocean caustics.
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
      <pre className="ocean shore-glaze">{f.glaze}</pre>
      <pre className="ocean shore-sheet">{f.sheet}</pre>
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
