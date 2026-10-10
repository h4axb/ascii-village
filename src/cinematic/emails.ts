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
  {
    from: 'Pixelvale Studio',
    subject: 'Your application status',
    body: [
      'Hi there,',
      'Thanks for applying for the Environment Artist role and for your patience.',
      'After reviewing your portfolio, we have decided *not to proceed* with your application.',
      'We encourage you to apply again in the future.',
    ],
    sign: ['Best,', 'The Pixelvale Team'],
  },
  {
    from: 'Tidewater Games',
    subject: 'Re: Junior UI Artist',
    body: [
      'Dear Applicant,',
      'Thank you for taking the time to apply.',
      '*Unfortunately*, the position has now been filled.',
      'We will keep your details on file should anything suitable come up.',
    ],
    sign: ['Kind regards,', 'Tidewater Games HR'],
  },
  {
    from: 'Ember & Ash',
    subject: 'Application outcome',
    body: [
      'Hello,',
      'We appreciate your interest in Ember & Ash.',
      'We are sorry to let you know that you have *not been shortlisted* for this role.',
      'Thank you again, and good luck with your search.',
    ],
    sign: ['Ember & Ash Recruiting'],
  },
  {
    from: 'Northstar Games',
    subject: 'Thank you for your application',
    body: [
      'Dear Applicant,',
      'Thank you for your application for the UI Artist position at Northstar Games. We have received it, and our team will review it carefully.',
      "We'll be in touch *soon*.",
    ],
    sign: ['Warm regards,', 'Northstar Games Recruitment Team'],
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
  open?: boolean; // already open when its shot cuts in (appears with the still, no flash)
  final?: boolean; // the last mail: its keywords fall apart
}

const F = FRAMES.map((f) => f.at);
// a rejection, already open when its shot cuts in (it appears with the
// still, in the same cut)
const rejection = (shot: number, email: number, variant: Variant, left: number, top: number, width: number): WindowShot => ({
  email,
  variant,
  left,
  top,
  width,
  appear: F[shot],
  hide: F[shot + 1],
  from: { x: 0, y: 0 },
  open: true,
});
export const WINDOWS: WindowShot[] = [
  // the thank-you, opened from its notification (the camera holds)
  {
    email: 6,
    variant: 'standard',
    left: 26,
    top: 12,
    width: 52,
    appear: F[0] + 1600,
    hide: F[1],
    from: { x: 0, y: 8 },
  },
  // then a rejection a shot, a little elsewhere each time
  rejection(1, 0, 'standard', 30, 10, 52),
  rejection(2, 1, 'portal', 24, 14, 54),
  rejection(3, 3, 'standard', 27, 9, 52),
  rejection(4, 4, 'standard', 22, 13, 54),
  rejection(5, 5, 'portal', 29, 11, 52),
  // the last one, prominent (it arrived in the night), set right of centre
  // so its keywords sit straight above the door's place (the screen's
  // middle), and their letters fall straight down onto it
  {
    email: 2,
    variant: 'standard',
    left: 31.3,
    top: 8,
    width: 60,
    appear: F[6],
    from: { x: 0, y: 0 },
    open: true,
    final: true,
  },
];

// the flash strength when a mail opens (a little stronger each time)
export const FLASH = 0.05; // the flash when the thank-you opens

// the thank-you's notification (above the taskbar, bottom right)
export const TOAST = {
  at: F[0] + 900,
  hide: F[0] + 1600, // clicked: the mail opens
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

// a sea of unread status updates, with life in between
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
  // the thank-you
  {
    at: TOAST.at,
    from: 'Northstar Games',
    subject: 'Thank you for your application',
    time: '08:11',
    unread: true,
    readAt: WINDOWS[0].appear,
  },
  // the first rejections
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
    readAt: WINDOWS[1].appear,
  },
  { at: F[2], from: 'Steam', subject: 'Your wishlist is on sale', time: 'Thu' },
  { at: F[2], from: 'Mom', subject: 'Did you eat?', time: 'Thu', unread: true },
  {
    at: F[2],
    from: 'Moss & Moon Games',
    subject: 'Update regarding your application',
    time: '17:35',
    unread: true,
    readAt: WINDOWS[2].appear,
  },
  // the routine: a sea of unread status updates, rejections in between
  ...routine.reverse(),
  { at: F[3], from: 'Pixelvale Studio', subject: 'Your application status', time: '11:02', unread: true, readAt: WINDOWS[3].appear },
  { at: F[4], from: 'Tidewater Games', subject: 'Re: Junior UI Artist', time: '14:15', unread: true, readAt: WINDOWS[4].appear },
  { at: F[5], from: 'Ember & Ash', subject: 'Application outcome', time: '23:40', unread: true, readAt: WINDOWS[5].appear },
  // the last one
  {
    at: F[6],
    from: 'Northstar Games',
    subject: 'Application Update',
    time: '02:31',
    unread: true,
    readAt: WINDOWS[6].appear,
  },
];
