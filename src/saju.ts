// Saju (사주, the Four Pillars) for Mitchy's daily luck reading. Computed in
// code because a language model can't do this calendar arithmetic reliably;
// the model only puts the result into Mitchy's words (llm.ts mitchyLuck).
//
// Like everyday saju apps, the daily reading compares the player's DAY MASTER
// (the heavenly stem of their birth day) with TODAY's day pillar: the ten-god
// relation between the two (십신) sets the theme of the day. The element the
// birth chart has least of gives the lucky colour and direction.
//
// Precision: day pillars are exact (a 60-day cycle). The year starts at
// 입춘 and months at the solar terms, taken as fixed dates here (accurate to
// about a day), so a birthday right on a boundary can land one month off.
// There is no hour pillar (it would need the birth time).

export type Element = 'wood' | 'fire' | 'earth' | 'metal' | 'water';

const STEMS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const STEM_KO = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const BRANCHES = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const BRANCH_KO = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
const ANIMALS = ['rat', 'ox', 'tiger', 'rabbit', 'dragon', 'snake', 'horse', 'goat', 'monkey', 'rooster', 'dog', 'pig'];
const STEM_EL: Element[] = ['wood', 'wood', 'fire', 'fire', 'earth', 'earth', 'metal', 'metal', 'water', 'water'];
const BRANCH_EL: Element[] = ['water', 'earth', 'wood', 'wood', 'earth', 'fire', 'fire', 'earth', 'metal', 'metal', 'earth', 'water'];
const ELEMENTS: Element[] = ['wood', 'fire', 'earth', 'metal', 'water'];

export interface Pillar {
  stem: number; // 0..9
  branch: number; // 0..11
}
export const pillarName = (p: Pillar) => `${STEMS[p.stem]}${BRANCHES[p.branch]} (${STEM_KO[p.stem]}${BRANCH_KO[p.branch]})`;
const yinYang = (stem: number) => (stem % 2 === 0 ? 'yang' : 'yin');
export const stemLabel = (stem: number) => `${STEMS[stem]} ${yinYang(stem)} ${STEM_EL[stem]}`;
export const pillarLabel = (p: Pillar) =>
  `${pillarName(p)}, ${yinYang(p.stem)} ${STEM_EL[p.stem]} ${ANIMALS[p.branch]}`;
const pillarOf = (i60: number): Pillar => ({ stem: ((i60 % 10) + 10) % 10, branch: ((i60 % 12) + 12) % 12 });

// Julian day number of a calendar date (no time zone involved)
function jdn(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

// The day pillar: 甲子 when (JDN + 49) is a multiple of 60 (2000-01-01 is 戊午)
export const dayPillar = (y: number, m: number, d: number) => pillarOf(jdn(y, m, d) + 49);

// The solar terms that start each saju month (寅 month first), as fixed dates
const TERM_STARTS: [number, number][] = [
  [2, 4], [3, 6], [4, 5], [5, 6], [6, 6], [7, 7], [8, 8], [9, 8], [10, 8], [11, 7], [12, 7], [1, 6],
];
const onOrAfter = (m: number, d: number, [tm, td]: [number, number]) => m > tm || (m === tm && d >= td);

export function yearPillar(y: number, m: number, d: number): Pillar {
  const sajuYear = onOrAfter(m, d, [2, 4]) ? y : y - 1; // the year turns at 입춘
  return pillarOf(sajuYear - 4); // 1984 is 甲子
}

export function monthPillar(y: number, m: number, d: number): Pillar {
  // months since 寅: the last solar term passed
  let n = 11; // before Feb 4 and from Jan 6: 丑 month (n = 11), before Jan 6: 子 (n = 10)
  if (!onOrAfter(m, d, [1, 6])) n = 10;
  for (let i = 0; i < 11; i++) if (m >= 2 && onOrAfter(m, d, TERM_STARTS[i])) n = i;
  const ys = yearPillar(y, m, d).stem;
  const firstStem = ((ys % 5) * 2 + 2) % 10; // 甲/己 years start at 丙寅
  return { stem: (firstStem + n) % 10, branch: (2 + n) % 12 };
}

// The ten gods (십신): what the other stem is to the day master
const PRODUCES: Record<Element, Element> = { wood: 'fire', fire: 'earth', earth: 'metal', metal: 'water', water: 'wood' };
const CONTROLS: Record<Element, Element> = { wood: 'earth', earth: 'water', water: 'fire', fire: 'metal', metal: 'wood' };
export interface TenGod {
  name: string; // Korean name + gloss
  theme: string; // what it means for the day
}
const GODS: Record<string, TenGod> = {
  'same,same': { name: '비견 (Friend)', theme: 'companions, teamwork and standing your ground' },
  'same,diff': { name: '겁재 (Rival)', theme: 'friendly rivalry and keeping an eye on spending' },
  'out,same': { name: '식신 (Eating God)', theme: 'enjoyment, good food, creativity and things flowing easily' },
  'out,diff': { name: '상관 (Hurting Officer)', theme: 'bold self expression, speaking up, a little rebellious streak' },
  'wealth,same': { name: '편재 (Windfall)', theme: 'lucky finds, quick deals and spontaneous gains' },
  'wealth,diff': { name: '정재 (Steady Wealth)', theme: 'steady earnings, careful work paying off' },
  'officer,same': { name: '편관 (Challenge)', theme: 'pressure and challenge that courage turns into a win' },
  'officer,diff': { name: '정관 (Order)', theme: 'order, responsibility and being recognised' },
  'resource,same': { name: '편인 (Intuition)', theme: 'intuition, odd ideas and some quiet alone time' },
  'resource,diff': { name: '정인 (Support)', theme: 'support, learning and being looked after' },
};
export function tenGod(dayMaster: number, other: number): TenGod {
  const a = STEM_EL[dayMaster];
  const b = STEM_EL[other];
  const kind =
    a === b ? 'same' : PRODUCES[a] === b ? 'out' : CONTROLS[a] === b ? 'wealth' : CONTROLS[b] === a ? 'officer' : 'resource';
  return GODS[`${kind},${dayMaster % 2 === other % 2 ? 'same' : 'diff'}`];
}

const LUCK_OF: Record<Element, { colour: string; direction: string }> = {
  wood: { colour: 'green', direction: 'east' },
  fire: { colour: 'red', direction: 'south' },
  earth: { colour: 'yellow', direction: 'the centre' },
  metal: { colour: 'white', direction: 'west' },
  water: { colour: 'deep blue', direction: 'north' },
};

export interface DailySaju {
  dayMaster: string; // e.g. "甲 yang wood"
  element: Element; // the day master's element
  todayElement: Element; // today's stem element
  chart: string; // the three birth pillars
  today: string; // today's day pillar
  god: TenGod;
  weak: Element; // the element the chart has least of
  colour: string;
  direction: string;
}

// birth: "YYYY-MM-DD"; today: the player's local date
export function dailySaju(birth: string, today: Date): DailySaju | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const yp = yearPillar(y, mo, d);
  const mp = monthPillar(y, mo, d);
  const dp = dayPillar(y, mo, d);
  const tp = dayPillar(today.getFullYear(), today.getMonth() + 1, today.getDate());
  const count = Object.fromEntries(ELEMENTS.map((e) => [e, 0])) as Record<Element, number>;
  for (const p of [yp, mp, dp]) {
    count[STEM_EL[p.stem]]++;
    count[BRANCH_EL[p.branch]]++;
  }
  // the scarcest element; ties go to the one the day master needs most (its resource)
  const order = [PRODUCES[PRODUCES[PRODUCES[PRODUCES[STEM_EL[dp.stem]]]]], ...ELEMENTS];
  const weak = order.reduce((best, e) => (count[e] < count[best] ? e : best), order[0]);
  return {
    dayMaster: stemLabel(dp.stem),
    element: STEM_EL[dp.stem],
    todayElement: STEM_EL[tp.stem],
    chart: `year ${pillarName(yp)}, month ${pillarName(mp)}, day ${pillarName(dp)}`,
    today: pillarLabel(tp),
    god: tenGod(dp.stem, tp.stem),
    weak,
    ...LUCK_OF[weak],
  };
}
