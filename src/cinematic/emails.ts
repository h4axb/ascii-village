// The six rejection emails and where each window appears (src/cinematic/).
//
// Body text is written with two markers:
//   *words*  the visual emphasis (a soft highlight after the window opens)
//   [words]  a phrase that survives the montage and falls apart into letters
//            (only the last email has these)
import { T } from './config';

export type Variant = 'standard' | 'portal' | 'stacked';

export interface Email {
  from: string;
  subject: string;
  body: string[]; // paragraphs
  sign: string[]; // sign-off lines
}

export const EMAILS: Email[] = [
  {
    from: 'Pixelvale Studio',
    subject: 'Your Application — UI Artist',
    body: [
      'Dear Applicant,',
      'Thank you for your interest in joining Pixelvale Studio. After reviewing your portfolio, we have decided to move forward with *another candidate*.',
      'We appreciate the time you invested in your application.',
    ],
    sign: ['Best regards,', 'Pixelvale Recruiting Team'],
  },
  {
    from: 'Paper Lantern Interactive',
    subject: 'Application Status — Game Artist',
    body: [
      'Hello,',
      'Thank you for applying to our Game Artist position.',
      'After careful consideration, we regret to inform you that we will *not be moving forward* with your application at this time.',
      'We wish you success in your future endeavors.',
    ],
    sign: ['Paper Lantern Interactive'],
  },
  {
    from: 'Moss & Moon Games',
    subject: 'Update Regarding Your Application',
    body: [
      'Dear Applicant,',
      'We appreciate your interest in the Junior Game Designer position.',
      '*Unfortunately*, we received a large number of applications and are unable to offer you a position at this time.',
      'Thank you for considering our studio.',
    ],
    sign: ['Moss & Moon Games'],
  },
  {
    from: 'Cloverbyte Studio',
    subject: 'Your Application Result',
    body: [
      'Hello,',
      'Thank you for taking the time to share your work with us.',
      'While your portfolio showed potential, we have *selected candidates* whose experience more closely matches our current requirements.',
      'We appreciate your interest.',
    ],
    sign: ['Cloverbyte Hiring Team'],
  },
  {
    from: 'Driftwood Interactive',
    subject: 'Junior UI Designer — Application Decision',
    body: [
      'Dear Applicant,',
      'Thank you for your application and the opportunity to review your creative work.',
      'After consideration, your application was *not selected* for the next stage of our recruitment process.',
      'We wish you the best in your future career.',
    ],
    sign: ['Driftwood Interactive'],
  },
  {
    from: 'Northstar Games',
    // [..] = the phrases that survive; "Unfortunately" gains its "..." later
    subject: '[Application Update]',
    body: [
      'Dear Applicant,',
      '[Unfortunately], after careful consideration, your application was [not selected] for the position.',
      'We appreciate your interest in Northstar Games and the time you invested in sharing your work with us.',
      'We wish you success in your future endeavors.',
    ],
    sign: ['Northstar Games Recruitment Team'],
  },
];

// A window on the laptop screen: which email, its style, its place (in % of
// the screen), when it appears and leaves, and how it enters.
export interface WindowShot {
  email: number;
  variant: Variant;
  left: number; // % of the screen
  top: number;
  width: number;
  appear: number; // ms
  hide?: number; // ms; absent = stays (stacks) until the montage ends
  from: { x: number; y: number }; // entrance offset, px
  final?: boolean; // the last email: its phrases fall apart
}

export const WINDOWS: WindowShot[] = [
  // shot 1: one calm centred window
  { email: 0, variant: 'standard', left: 21, top: 10, width: 58, appear: T.shots[0], hide: T.shots[1], from: { x: 0, y: 6 } },
  // shot 2: upper right, the application-portal look
  { email: 1, variant: 'portal', left: 40, top: 5, width: 54, appear: T.shots[1], hide: T.shots[2], from: { x: 10, y: 0 } },
  // shot 3: to the left, darker, a quick vertical cut; it stays behind from shot 4 on
  { email: 2, variant: 'portal', left: 5, top: 13, width: 52, appear: T.shots[2], from: { x: 0, y: 14 } },
  // shot 4: closer to the centre, the screen starts to crowd
  { email: 3, variant: 'stacked', left: 25, top: 17, width: 52, appear: T.shots[3], from: { x: 0, y: 10 } },
  // shot 5: the first two return as layers underneath, the new one on top
  { email: 0, variant: 'standard', left: 44, top: 26, width: 50, appear: T.shots[4], from: { x: 6, y: 6 } },
  { email: 1, variant: 'portal', left: 9, top: 33, width: 48, appear: T.shots[4] + 90, from: { x: -6, y: 6 } },
  { email: 4, variant: 'stacked', left: 32, top: 8, width: 52, appear: T.shots[4] + 180, from: { x: 0, y: 12 } },
  // shot 6: Northstar, prominent, above everything
  { email: 5, variant: 'standard', left: 18, top: 9, width: 62, appear: T.shots[5], from: { x: 0, y: -14 }, final: true },
];

// the flash strength when a window appears (stronger as rejections pile up)
export const FLASH = [0.08, 0.12, 0.14, 0.18, 0.22, 0.3];
