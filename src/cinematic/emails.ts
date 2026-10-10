// The mail on the laptop (src/cinematic/): the inbox's history, the mails
// opened on top of it shot by shot, and the notification of the first shot.
//
// Body text of an opened mail is written with two markers:
//   *words*  the visual emphasis (a soft highlight after the window opens)
//   [words]  a keyword that survives and falls apart into letters (only the
//            final mail has these)
import { FRAMES } from './config';

export type Variant = 'standard' | 'portal' | 'stacked';

export interface Email {
  from: string;
  subject: string;
  body: string[]; // paragraphs
  sign: string[]; // sign-off lines
}

// the mails that get opened
export const EMAILS: Email[] = [
  {
    from: 'Lumen Forge Games',
    subject: 'Your application — Junior Game Artist',
    body: [
      'Dear Applicant,',
      'Thank you for your interest in joining Lumen Forge Games.',
      '*We regret to inform you* that we will not be moving forward with your application at this time.',
      'We wish you every success in your search.',
    ],
    sign: ['Kind regards,', 'Lumen Forge Recruiting'],
  },
  {
    from: 'Moss & Moon Games',
    subject: 'Update regarding your application',
    body: [
      'Hello,',
      'We appreciate your interest in the Junior Game Designer position.',
      '*Unfortunately*, we received a large number of applications and are unable to offer you a position at this time.',
      'Thank you for considering our studio.',
    ],
    sign: ['Moss & Moon Games'],
  },
  {
    from: 'Northstar Games',
    // [..] = the keywords that survive; "Unfortunately" gains its "..." later
    subject: '[Application Update]',
    body: [
      'Dear Applicant,',
      '[Unfortunately], after careful consideration, your application was [not selected] for the position.',
      'While your background is impressive, we have decided to move forward with other candidates.',
      'We wish you success in your future endeavors.',
    ],
    sign: ['Northstar Games Recruitment Team'],
  },
];

// An opened mail on the laptop screen: which email, its style, its place (in %
// of the screen), when it opens and closes, and how it enters.
export interface WindowShot {
  email: number;
  variant: Variant;
  left: number; // % of the screen
  top: number;
  width: number;
  appear: number; // ms
  hide?: number; // ms; absent = stays until the montage ends
  from: { x: number; y: number }; // entrance offset, px
  final?: boolean; // the last mail: its keywords fall apart
}

const F = FRAMES.map((f) => f.at);
export const WINDOWS: WindowShot[] = [
  // Phase 2: two rejections, one a shot, each opened over the inbox
  {
    email: 0,
    variant: 'standard',
    left: 30,
    top: 10,
    width: 52,
    appear: F[1] + 500,
    hide: F[2],
    from: { x: 0, y: 8 },
  },
  {
    email: 1,
    variant: 'portal',
    left: 24,
    top: 14,
    width: 54,
    appear: F[2] + 450,
    hide: F[3],
    from: { x: 8, y: 0 },
  },
  // Phase 4: the final one, prominent (it arrived the night before)
  {
    email: 2,
    variant: 'standard',
    left: 20,
    top: 8,
    width: 60,
    appear: F[5] + 400,
    from: { x: 0, y: -10 },
    final: true,
  },
];

// the flash strength when a mail opens (a little stronger each time)
export const FLASH = [0.08, 0.12, 0.2];

// Phase 1's notification (above the taskbar, bottom right)
export const TOAST = {
  at: F[0] + 900,
  hide: F[1] - 300,
  from: 'Northstar Games',
  text: 'Thank you for your application to Northstar Games.',
};

// ---- the inbox ---------------------------------------------------------------------------
// Every mail the list shows, with the moment it arrives (ms; < 0 = already
// there). The list shows the latest arrival on top (among mails arriving
// together, the later one in this list); the blocks below are written
// newest first and reversed. Rejections, and the ordinary mail of a life in
// between. unread until readAt (if ever).
export interface InboxItem {
  at: number;
  from: string;
  subject: string;
  time: string; // the list's date column
  unread?: boolean;
  readAt?: number;
}

// Phase 3: a sea of unread status updates, with life in between
const STATUS_FROM = [
  'Pixelvale Studio',
  'Paper Lantern Interactive',
  'Cloverbyte Studio',
  'Driftwood Interactive',
  'Tidewater Games',
  'Ember & Ash',
  'Quietfox Studio',
  'Brightloop',
  'Hollow Pine Games',
  'Saltmarsh Interactive',
  'Kitebird Studio',
  'Orbit Nine',
  'Foxglove Interactive',
  'Cinder Lane Games',
  'Glasswing Studio',
  'Little Lantern',
];
const LIFE: Omit<InboxItem, 'at'>[] = [
  { from: 'JobBoard', subject: '41 new jobs for "game artist"', time: '2 Apr' },
  {
    from: 'Mom',
    subject: 'Call me when you can?',
    time: '1 Apr',
    unread: true,
  },
  { from: 'Bank of Lindenhall', subject: 'Payment reminder', time: '31 Mar' },
  {
    from: 'Pixel Weekly',
    subject: 'Issue #212: finding your style',
    time: '28 Mar',
  },
  {
    from: 'Parcel Post',
    subject: 'Your parcel could not be delivered',
    time: '26 Mar',
  },
];
const routine: InboxItem[] = [];
STATUS_FROM.forEach((from, i) => {
  routine.push({
    at: F[3],
    from,
    subject: 'Update on your status',
    time: i < 2 ? ['10:52', '09:14'][i] : `${Math.max(1, 3 - Math.floor(i / 5))} Apr`,
    unread: true,
  });
  if (i % 3 === 2 && LIFE[(i - 2) / 3]) routine.push({ at: F[3], ...LIFE[(i - 2) / 3] });
});

export const INBOX: InboxItem[] = [
  // already there on the first morning
  ...[
    {
      at: -1,
      from: 'JobBoard',
      subject: '23 new jobs for "game artist"',
      time: 'Sun',
    },
    { at: -1, from: 'Mom', subject: 'Sunday dinner?', time: 'Sat' },
    {
      at: -1,
      from: 'Parcel Post',
      subject: 'Your package is on its way',
      time: 'Sat',
    },
    { at: -1, from: 'ArtStation', subject: 'Your weekly digest', time: 'Fri' },
    {
      at: -1,
      from: 'Northstar Careers',
      subject: 'Application received — UI Artist',
      time: 'Fri',
    },
    {
      at: -1,
      from: 'Bank of Lindenhall',
      subject: 'Your statement is ready',
      time: 'Thu',
    },
    {
      at: -1,
      from: 'Calendar',
      subject: 'Reminder: portfolio review with Jo',
      time: 'Wed',
    },
    {
      at: -1,
      from: 'Pixel Weekly',
      subject: 'Issue #208: 12 tips for better portfolios',
      time: 'Tue',
    },
    {
      at: -1,
      from: 'Tidewater Games',
      subject: 'Thanks for applying!',
      time: '27 Feb',
    },
    {
      at: -1,
      from: 'Steam',
      subject: 'A game on your wishlist is on sale',
      time: '26 Feb',
    },
  ].reverse(),
  // Phase 1
  {
    at: TOAST.at,
    from: 'Northstar Games',
    subject: 'Thank you for your application',
    time: '08:11',
    unread: true,
    readAt: F[1],
  },
  // Phase 2
  {
    at: F[1],
    from: 'Pixel Weekly',
    subject: 'Issue #209: colour for UI',
    time: 'Tue',
  },
  {
    at: F[1],
    from: 'Lumen Forge Games',
    subject: 'Your application — Junior Game Artist',
    time: '13:41',
    unread: true,
    readAt: WINDOWS[0].appear,
  },
  { at: F[2], from: 'Steam', subject: 'Your wishlist is on sale', time: 'Thu' },
  { at: F[2], from: 'Mom', subject: 'Did you eat?', time: 'Thu', unread: true },
  {
    at: F[2],
    from: 'Moss & Moon Games',
    subject: 'Update regarding your application',
    time: '17:35',
    unread: true,
    readAt: WINDOWS[1].appear,
  },
  // Phase 3
  ...routine.reverse(),
  // Phase 4
  {
    at: F[4],
    from: 'Northstar Games',
    subject: 'Application Update',
    time: '23:49',
    unread: true,
    readAt: WINDOWS[2].appear,
  },
];

// Phase 3's scroll down the list (rows, eased like a scroll wheel's ticks)
export const SCROLL = { at: [F[3] + 500, F[4] - 300] as const, rows: 14 };
