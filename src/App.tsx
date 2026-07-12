import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  isWater,
  STRUCT_ENTS,
  wildSpawns,
  PLAYER_SPAWN,
  PLAYER_T,
  footprint,
  near,
} from './world';
import type { Ent, ItemType } from './world';
import { getFunFact, getPrice, getShopStock, craftItem, CATEGORIES } from './llm';
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
  HOUR_MS,
} from './time';
import type { TimeConfig } from './time';
import { loadSave, writeSave } from './save';
import type { SaveState } from './save';

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

// Camera viewport in world units (ch / lines). This is the default "frame";
// the mouse wheel can zoom out down to the whole map and back, never closer.
const VIEW_W = 112;
const VIEW_H = 40; // taller viewport → aspect closer to a screen, less letterbox
const MAX_ZOOM = 1;
const MIN_ZOOM = Math.max(VIEW_W / GROUND_W, VIEW_H / GROUND_H);
const ZOOM_STEP = 0.1;

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
  | { t: 'inventory' }
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
  | { t: 'craft'; ownedId: string }
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
      <div className="subtitle">a tiny monochrome village</div>
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
  const [charIdx] = useState(0); // future: character select screen
  const [petPos, setPetPos] = useState<{ x: number; y: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [wt, setWt] = useState(() => worldTime(timeCfgRef.current));
  const [stock, setStock] = useState<Record<Category, ShopItem[]> | null>(null);
  const talkTimer = useRef<number | undefined>(undefined);
  const nothingTimer = useRef<number | undefined>(undefined);
  const toastTimer = useRef<number | undefined>(undefined);
  const talkedRef = useRef(false);

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

  // ---- scaling (mobile-first: fit the whole field on screen) ----
  const fieldRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 940, h: 450, scale: 1 });
  useLayoutEffect(() => {
    const compute = () => {
      const el = fieldRef.current;
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const coarse = window.matchMedia('(hover: none), (pointer: coarse)').matches;
      const availW = window.innerWidth - 8;
      const availH = window.innerHeight - 8 - (coarse ? 150 : 0);
      // fill the screen (no upscale cap) — the field's aspect is close to a
      // screen's, so this leaves only thin side bars rather than big black ones
      const scale = Math.min(availW / w, availH / h);
      setDims({ w, h, scale });
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  // ---- movement & collision ----
  function tryMove(dx: number, dy: number) {
    setPlayer((p) => {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (nx < 0 || ny < 0 || nx + PLAYER_T.wT > MAP_W || ny + PLAYER_T.hT > MAP_H) {
        return p;
      }
      const prow = ny + PLAYER_T.hT - 1;
      for (const e of entsRef.current) {
        const f = footprint(e);
        if (f.row === prow && nx <= f.x1 && nx + PLAYER_T.wT - 1 >= f.x0) return p;
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

  // ---- zoom (mouse wheel) ----
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      if (modalRef.current) return; // let modals scroll normally
      e.preventDefault();
      setZoom((z) =>
        Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z - Math.sign(e.deltaY) * ZOOM_STEP)),
      );
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => window.removeEventListener('wheel', onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    // Mitchy plugs the craft tokens the first time, then chats randomly.
    const first = !talkedRef.current;
    talkedRef.current = true;
    setBubble({
      text: first ? TOKEN_LINE : TALK_LINES[Math.floor(Math.random() * TALK_LINES.length)],
      width: first ? 30 : 22,
    });
    talkTimer.current = window.setTimeout(() => setBubble(null), first ? 7000 : 5000);
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
      return null;
    });
  }

  function xClose() {
    setModal((m) =>
      !m ? m : m.t === 'detail' || m.t === 'detailOwned' ? { t: 'inventory' } : null,
    );
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
  const viewW = VIEW_W / zoom; // world chars visible
  const viewH = VIEW_H / zoom; // world lines visible
  const pcx = (player.x + PLAYER_T.wT / 2) * TILE_CH;
  const pcy = (player.y + PLAYER_T.hT / 2) * TILE_LN;
  const camX = Math.min(Math.max(pcx - viewW / 2, 0), GROUND_W - viewW);
  const camY = Math.min(Math.max(pcy - viewH / 2, 0), GROUND_H - viewH);
  const speedMult = equipped?.equip?.mode === 'vehicle' ? (equipped.equip.speedMult ?? 1) : 1;
  const stepDur = ((dash ? DASH_MS : WALK_MS) * speedMult) / 1000;

  // Attachment sockets on the player rig (in the rig's own char grid). Derived
  // from the sprite, not a magic number, so they stay correct if the art changes.
  const playerW = Math.max(...character.sprite.map((l) => l.length));
  const HAND_X = playerW - 2; // ~ right-hand column
  const HAND_Y = 1; // second sprite line ≈ arm height

  const timeStr = formatWorldTime(wt);
  const secsToRefresh = Math.ceil((HOUR_MS - (wt % HOUR_MS)) / 1000);
  const refreshStr = `${String(Math.floor(secsToRefresh / 60)).padStart(2, '0')}:${String(
    secsToRefresh % 60,
  ).padStart(2, '0')}`;

  return (
    <div className="app">
      <header className="hdr">
        <div className="hdr-left">
          <span className="hdr-title">ascii village</span>
          <span className="hdr-time">&#9719; {timeStr}</span>
        </div>
        <div className="hdr-right">
          <span className="hdr-coin" title="money">
            &#164;
          </span>
          <span className="hdr-money">{money}</span>
          <div className="hdr-avatar" title={character.name}>
            <pre>{character.face.join('\n')}</pre>
          </div>
          {modal ? (
            <button className="hdr-x" onClick={xClose} aria-label="close">
              [x]
            </button>
          ) : (
            <span className="hdr-x-spacer" />
          )}
        </div>
      </header>

      <div className="stage">
        <div
          className="scale-box"
          style={{ width: dims.w * dims.scale, height: dims.h * dims.scale }}
        >
          <div style={{ transform: `scale(${dims.scale})`, transformOrigin: '0 0' }}>
            <div className={'field phase-' + dayPhaseOf(wt)} ref={fieldRef}>
              <div
                className="world"
                style={{
                  left: `${-camX * zoom}ch`,
                  top: `${-camY * zoom}em`,
                  width: `${GROUND_W}ch`,
                  height: `${GROUND_H}em`,
                  transform: `scale(${zoom})`,
                  transition: `left ${stepDur}s linear, top ${stepDur}s linear, transform 0.15s ease`,
                }}
              >
              <OceanLayer />
              {LAND_LAYERS.map((l) => (
                <pre key={l.region} className={'ground region-' + l.region}>
                  {l.text}
                </pre>
              ))}

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
                  <pre className="rig-held" style={{ left: `${HAND_X}ch`, top: `${HAND_Y}em` }}>
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
              <div className="panel-title">&#9552;&#9552;&#9552; INVENTORY &#9552;&#9552;&#9552;</div>
              <InvGrid
                inv={inv}
                onItem={(it) => setModal({ t: 'detail', item: it })}
                bag={bag}
                equippedId={equipped?.ownedId ?? null}
                onBagItem={(o) => setModal({ t: 'detailOwned', ownedId: o.ownedId, sel: 0 })}
              />
              <div className="hint">click an item for details &#183; [I] or [Esc] to close</div>
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
                  <pre className="detail-sprite">{owned.sprite.join('\n')}</pre>
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
}: {
  inv: Record<ItemType, number>;
  onItem: (it: ItemType) => void;
  pick?: ItemType | null;
  onSell?: (it: ItemType) => void;
  bag?: OwnedItem[];
  equippedId?: string | null;
  onBagItem?: (o: OwnedItem) => void;
}) {
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
          className={'slot' + (s ? ' filled' : '')}
          onClick={
            s
              ? (ev) => {
                  ev.stopPropagation();
                  if (s.t === 'base') onItem(s.it);
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
              <pre className="mini">{s.o.sprite.join('\n')}</pre>
              {s.o.kind === 'token' && <span className="token-tag">TOKEN</span>}
              {equippedId === s.o.ownedId && <span className="equipped-tag">EQ</span>}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// Craft-token chat: the player describes an item, the (mock) LLM crafts it.
function CraftPanel({
  token,
  onTake,
  onEquip,
}: {
  token: OwnedItem;
  onTake: (item: ShopItem) => void;
  onEquip: (item: ShopItem) => void;
}) {
  const [log, setLog] = useState<{ who: 'cat' | 'me'; text: string }[]>([
    { who: 'cat', text: `tell me what u wanna craft... (something ${token.category}-ish)` },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShopItem | null>(null);

  function submit() {
    const text = input.trim();
    if (!text || busy || result) return;
    setInput('');
    setLog((l) => [...l, { who: 'me', text }]);
    setBusy(true);
    craftItem(token.category, text).then((r) => {
      setBusy(false);
      if (r.ok) {
        setResult(r.item);
        setLog((l) => [...l, { who: 'cat', text: 'crafting... done! here u go:' }]);
      } else {
        setLog((l) => [...l, { who: 'cat', text: r.reply }]);
      }
    });
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
        {busy && <div className="craft-msg cat">mitchy: ...</div>}
      </div>
      {!result && (
        <div className="craft-input-row">
          <input
            className="craft-input"
            value={input}
            autoFocus
            placeholder="describe it..."
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              e.stopPropagation();
            }}
          />
          <button className="craft-send" onClick={submit} disabled={busy}>
            [send]
          </button>
        </div>
      )}
      {result && (
        <div className="craft-result">
          <pre className="detail-sprite">{result.sprite.join('\n')}</pre>
          <div className="craft-result-name">{result.name}</div>
          <p className="detail-fact">* {result.funcDesc}</p>
          <div className="craft-btns">
            <button onClick={() => onEquip(result)}>Equip</button>
            <button onClick={() => onTake(result)}>Put inside ur inventory</button>
          </div>
        </div>
      )}
      <div className="hint">[Esc] keep the token for later</div>
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

// Cycles the pre-rendered ocean wave frames. Self-contained so the animation
// re-renders only this layer, not the whole game.
function OceanLayer() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const iv = window.setInterval(() => setPhase((p) => (p + 1) % OCEAN_FRAMES.length), 600);
    return () => window.clearInterval(iv);
  }, []);
  return <pre className="ocean">{OCEAN_FRAMES[phase]}</pre>;
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
