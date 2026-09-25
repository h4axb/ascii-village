// ---------------------------------------------------------------------------
// LOCAL CONTENT POLICY — the one filter that always runs.
//
// The LLM-side check (screenCraftPrompt's `sensitive` flag) is best-effort and
// fail-open by design: its catch block returns `sensitive: false`, so a network
// blip, a parse failure, or the offline/mock craft path all skip it entirely.
// This module is the floor underneath that — free, deterministic, offline, and
// on every craft path — so the blatant cases can never slip through just
// because a request failed.
//
// It is deliberately a blunt instrument. It catches unambiguous words, not
// phrasing or intent; the model check on top is what handles the subtle cases
// a word list cannot. Matching is whole-token (after the same normalization
// parseSpec uses), so innocent substrings are safe — "assassin bug" trips it,
// but "class" does not contain a match at all, and "grape" is never read as
// "rape".
// ---------------------------------------------------------------------------

// Whole tokens only. Kept short and unambiguous on purpose: a long fuzzy list
// generates false positives that are far more annoying in a playtest than the
// rare miss, and the model-side check is the second layer.
const BLOCKED_TOKENS = new Set([
  // sexual
  'porn', 'porno', 'pornographic', 'nude', 'nudes', 'naked', 'sex', 'sexual', 'sexy',
  'nsfw', 'erotic', 'fetish', 'genitals', 'penis', 'vagina', 'boobs', 'breasts',
  'rape', 'rapist', 'molest', 'incest', 'hentai',
  // violence / gore. NOT blocked on purpose: skull, sword, knife, axe, bone —
  // all ordinary cozy-game craftables (pirate decor, garden tools, fantasy
  // props). This list targets injury to a body, not fantasy or tool imagery.
  'gore', 'gory', 'decapitated', 'decapitation', 'dismembered', 'mutilated',
  'mutilation', 'torture', 'tortured', 'massacre', 'murder', 'murdered',
  'suicide', 'lynch', 'lynching', 'beheading', 'beheaded', 'behead',
  'disembowel', 'severed', 'blood', 'bloody', 'bloodbath', 'corpse',
  'entrails', 'slaughter', 'slaughtered', 'gruesome', 'maimed',
  // hate / slurs (category words; explicit slurs deliberately not enumerated
  // here — the model check covers those, and listing them in source is worse)
  'nazi', 'nazis', 'hitler', 'genocide', 'kkk', 'holocaust',
  // real-world weapons intended to harm people
  'gun', 'guns', 'rifle', 'pistol', 'shotgun', 'firearm', 'ak47', 'grenade',
  'bomb', 'bombs', 'explosive', 'landmine',
  // drugs
  'cocaine', 'heroin', 'meth', 'methamphetamine', 'crack', 'lsd', 'fentanyl',
]);

// Multi-word phrases, checked against the normalized string rather than
// tokens, for cases a single word cannot express.
const BLOCKED_PHRASES = [
  'child porn',
  'school shooting',
  'kill myself',
  'kill children',
  'dead body',
  'dead bodies',
];

// Same normalization parseSpec applies, so both see identical text.
function normalize(prompt: string): string {
  return prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
}

export interface PolicyVerdict {
  allowed: boolean;
  // Never echoes what the player typed back at them — just a neutral refusal.
  reason?: string;
}

const REFUSAL =
  "I'd rather not make that one. Try something else — a plant, a tool, a creature, anything that fits the island.";

export function checkPolicy(prompt: string): PolicyVerdict {
  const norm = normalize(prompt);

  for (const phrase of BLOCKED_PHRASES) {
    if (norm.includes(phrase)) return { allowed: false, reason: REFUSAL };
  }

  const tokens = norm.split(/[\s-]+/).filter(Boolean);
  for (const tok of tokens) {
    if (BLOCKED_TOKENS.has(tok)) return { allowed: false, reason: REFUSAL };
    // strip a trailing plural 's' so "guns"/"bombs" style variants are caught
    // even when only the singular is listed
    if (tok.endsWith('s') && BLOCKED_TOKENS.has(tok.slice(0, -1))) {
      return { allowed: false, reason: REFUSAL };
    }
  }

  return { allowed: true };
}
