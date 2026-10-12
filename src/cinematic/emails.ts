// The mail on the laptop (src/cinematic/): the inbox's history, the mails
// opened on top of it shot by shot, and the notifications. Six months of
// rejections, coming faster and faster: the first one gets the whole
// interaction (notification, inbox, the mail opening), the next ones open
// quicker and quicker, then only a notification flashes by, then the last.
//
// Body text of an opened mail is written with two markers:
//   *words*  the visual emphasis (a soft highlight after the window opens)
//   [words]  a keyword that survives and falls apart into letters (only the
//            final mail has these)
import { FRAMES, FIRST } from './config';

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
    from: 'Northstar Games',
    subject: 'Your Application — Junior Game Designer',
    body: [
      'Dear Applicant,',
      'Thank you for your interest in joining Northstar Games.',
      'After careful consideration, *we regret to inform you* that we will not be moving forward with your application at this time.',
      'We appreciate the time and effort you put into applying and wish you all the best in your future endeavors.',
    ],
    sign: ['Best regards,', 'Northstar Games Recruitment Team'],
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
    from: 'Cloverbyte Studio',
    // [..] = the keywords that survive and fall apart into letters
    subject: '[Application Update]',
    body: [
      'Dear Applicant,',
      '[Unfortunately], after careful consideration, your application was [not selected] for the position.',
      'While your background is impressive, we have decided to move forward with other candidates.',
      'We wish you success in your future endeavors.',
    ],
    sign: ['Cloverbyte Studio Recruitment Team'],
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
    from: 'Brightloop',
    subject: 'Your application to Brightloop',
    body: [
      'Hi,',
      'Thank you for applying for the 2D Artist role.',
      'We have decided to *go with another candidate* whose experience more closely matches our needs.',
      'Best of luck with your next steps.',
    ],
    sign: ['The Brightloop Team'],
  },
  {
    from: 'Glasswing Studio',
    subject: 'Application status: closed',
    body: [
      'Dear Applicant,',
      'Thank you for your patience during our hiring process.',
      '*Regrettably*, we will not be inviting you to the next round.',
      'We appreciate the time you put into your application.',
    ],
    sign: ['Glasswing Studio Talent Team'],
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
  open?: boolean; // already open when its shot cuts in (appears with the still)
  final?: boolean; // the last mail: its keywords fall apart
}

const F = FRAMES.map((f) => f.at);
// a mail opening from the inbox (it slides in a little)
const opens = (email: number, variant: Variant, left: number, top: number, width: number, appear: number, hide: number): WindowShot => ({
  email,
  variant,
  left,
  top,
  width,
  appear,
  hide,
  from: { x: 0, y: 6 },
});
// a mail already open when its shot cuts in (it replaces the one before, in the same cut)
const cutIn = (shot: number, email: number, variant: Variant, left: number, top: number, width: number): WindowShot => ({
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
  // the first: opened from its notification and the inbox, read while the camera holds
  opens(0, 'standard', 17, 6, 66, FIRST.open, F[1]),
  // then each one already open as its shot cuts in, replacing the one before
  // (no more notifications: the mails are simply there)
  cutIn(1, 1, 'standard', 18, 7, 66),
  cutIn(2, 3, 'portal', 15, 9, 68),
  cutIn(3, 4, 'standard', 17, 6, 66),
  cutIn(4, 6, 'standard', 14, 9, 68),
  cutIn(5, 5, 'portal', 18, 8, 66),
  cutIn(6, 7, 'standard', 16, 7, 67),
  // the last one, open from its cut and staying. Set right of centre so its
  // keywords sit straight above the door's place (the screen's middle), and
  // their letters fall straight down onto it
  {
    email: 2,
    variant: 'standard',
    left: 23.8,
    top: 6,
    width: 74,
    appear: F[7],
    from: { x: 0, y: 0 },
    open: true,
    final: true,
  },
];

// The notification (above the taskbar, bottom right): only the first mail
// gets one; it stays 2 s, then it is clicked and the inbox opens
export interface Toast {
  at: number;
  hide: number;
  from: string;
  text: string;
}
export const TOASTS: Toast[] = [{ at: FIRST.toast, hide: FIRST.inbox, from: 'Northstar Games', text: 'Your Application — Junior Game Designer' }];
// the chime: the notification's sound
export const CHIMES: number[] = TOASTS.map((t) => t.at);

// ---- the inbox ---------------------------------------------------------------------------
// Every mail the list shows, with the moment it arrives (ms; < 0 = already
// there). The list shows the latest arrival on top (among mails arriving
// together, the later one in this list). Rejections, and the ordinary mail
// of a life in between. unread until readAt (if ever); `select`: the row is
// selected (a soft blue) in that window, just before the mail opens.
export interface InboxItem {
  at: number;
  from: string;
  subject: string;
  time: string; // the list's date column
  unread?: boolean;
  readAt?: number;
  select?: [number, number];
}

// a sea of unread status updates, with life in between
const STATUS_FROM = [
  'Paper Lantern Interactive',
  'Driftwood Interactive',
  'Quietfox Studio',
  'Hollow Pine Games',
  'Saltmarsh Interactive',
  'Kitebird Studio',
  'Orbit Nine',
  'Foxglove Interactive',
  'Cinder Lane Games',
  'Little Lantern',
];
const LIFE: Omit<InboxItem, 'at'>[] = [
  { from: 'JobBoard', subject: '41 new jobs for "game designer"', time: '12 May' },
  { from: 'Mom', subject: 'Call me when you can?', time: '10 May', unread: true },
  { from: 'Bank of Lindenhall', subject: 'Payment reminder', time: '8 May' },
];
const routine: InboxItem[] = [];
STATUS_FROM.forEach((from, i) => {
  routine.push({ at: F[3], from, subject: 'Update on your status', time: `${Math.max(1, 12 - i)} May`, unread: true });
  if (i % 3 === 2 && LIFE[(i - 2) / 3]) routine.push({ at: F[3], ...LIFE[(i - 2) / 3] });
});

export const INBOX: InboxItem[] = [
  // already there on the first morning
  ...[
    { at: -1, from: 'JobBoard', subject: '23 new jobs for "game designer"', time: 'Sun' },
    { at: -1, from: 'Mom', subject: 'Sunday dinner?', time: 'Sat' },
    { at: -1, from: 'Parcel Post', subject: 'Your package is on its way', time: 'Sat' },
    { at: -1, from: 'ArtStation', subject: 'Your weekly digest', time: 'Fri' },
    { at: -1, from: 'Northstar Careers', subject: 'Application received — Junior Game Designer', time: 'Fri' },
    { at: -1, from: 'Bank of Lindenhall', subject: 'Your statement is ready', time: 'Thu' },
    { at: -1, from: 'Calendar', subject: 'Reminder: portfolio review with Jo', time: 'Wed' },
    { at: -1, from: 'Pixel Weekly', subject: 'Issue #208: 12 tips for better portfolios', time: 'Tue' },
    { at: -1, from: 'Tidewater Games', subject: 'Thanks for applying!', time: '27 Feb' },
  ].reverse(),
  // the first rejection: selected, then opened
  { at: TOASTS[0].at, from: 'Northstar Games', subject: 'Your Application — Junior Game Designer', time: '08:11', unread: true, readAt: WINDOWS[0].appear, select: [FIRST.select, WINDOWS[0].appear + 200] },
  { at: F[1], from: 'Pixel Weekly', subject: 'Issue #209: colour for UI', time: 'Tue' },
  { at: F[1], from: 'Moss & Moon Games', subject: 'Update regarding your application', time: '13:41', unread: true, readAt: WINDOWS[1].appear },
  { at: F[2], from: 'Mom', subject: 'Did you eat?', time: 'Tue', unread: true },
  { at: F[2], from: 'Pixelvale Studio', subject: 'Your application status', time: '16:18', unread: true, readAt: WINDOWS[2].appear },
  // the routine: a sea of unread status updates, rejections in between
  ...routine.reverse(),
  { at: F[3], from: 'Tidewater Games', subject: 'Re: Junior UI Artist', time: '15:02', unread: true, readAt: WINDOWS[3].appear },
  { at: F[4], from: 'Brightloop', subject: 'Your application to Brightloop', time: '19:40', unread: true, readAt: WINDOWS[4].appear },
  { at: F[5], from: 'Ember & Ash', subject: 'Application outcome', time: '21:15', unread: true, readAt: WINDOWS[5].appear },
  { at: F[6], from: 'Glasswing Studio', subject: 'Application status: closed', time: '23:50', unread: true, readAt: WINDOWS[6].appear },
  // the last one
  { at: F[7], from: 'Cloverbyte Studio', subject: 'Application Update', time: '02:46', unread: true, readAt: WINDOWS[7].appear },
];
