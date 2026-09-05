import { hash32 } from './rng.ts';

// Procedural phonology. Every polity gets a syllable inventory derived from its
// id, so a realm's settlements, rulers and gods all sound like they came from the
// same mouth. Children inherit the inventory and mutate one or two slots.

const ONSETS = [
  'b','d','f','g','h','k','l','m','n','p','r','s','t','v','y','z','th','sh','ch',
];
const CLUSTERS = ['br','dr','gr','kr','pr','tr','sk','st','sl','vr','gl','bl'];
const VOWELS = ['a', 'e', 'i', 'o', 'u'];
const DIGRAPHS = ['ae', 'ei', 'ou', 'ia', 'au', 'eo'];
const CODAS = ['', '', '', 'n', 'm', 'r', 'l', 's', 'k', 't', 'th', 'sh', 'nd', 'ng'];
const SUFFIXES = [
  'ia','os','ar','eth','un','ak','or','is','ai','en','um','ash','ir','on','esh','ur','al','ym',
];

export interface Phonology {
  onsets: string[];
  vowels: string[];
  codas: string[];
  suffixes: string[];
  syllables: number; // 2 or 3
}

function subset<T>(pool: readonly T[], seed: number, count: number): T[] {
  const out: T[] = [];
  let i = 0;
  let guard = 0;
  while (out.length < count && guard++ < 200) {
    const pickIdx = hash32(seed, i++, 0x51ed) % pool.length;
    const v = pool[pickIdx];
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

export function makePhonology(seed: number): Phonology {
  // Mostly plain consonants and single vowels, with at most a couple of clusters
  // and one digraph. Inventories any larger than this stop sounding like one
  // language and start sounding like a keyboard falling down the stairs.
  const onsets = subset(ONSETS, seed, 6 + (hash32(seed, 1) % 3));
  const clusterCount = hash32(seed, 5) % 3;
  for (const c of subset(CLUSTERS, seed ^ 0x33af, clusterCount)) onsets.push(c);
  const vowels = subset(VOWELS, seed ^ 0x9e37, 3 + (hash32(seed, 2) % 2));
  if (hash32(seed, 6) % 2 === 0) vowels.push(DIGRAPHS[hash32(seed, 7) % DIGRAPHS.length]);
  return {
    onsets,
    vowels,
    codas: subset(CODAS, seed ^ 0x1b3f, 4 + (hash32(seed, 3) % 3)),
    suffixes: subset(SUFFIXES, seed ^ 0x77aa, 2),
    syllables: 2,
  };
}

/** Child realms sound related but not identical. */
export function mutatePhonology(seed: number, generation: number): number {
  return hash32(seed, generation, 0x2b19) >>> 0;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Deterministic in (phonology seed, salt). No RNG stream is consumed, so names
 * can be regenerated at any time without disturbing the simulation.
 */
export function makeName(p: Phonology, seed: number, salt: number, opts?: { suffix?: boolean }): string {
  const syllables = p.syllables + (hash32(seed, salt, 9) % 3 === 0 ? 1 : 0);
  let s = '';
  let lastOnset = '';
  for (let i = 0; i < syllables; i++) {
    let on = p.onsets[hash32(seed, salt, i, 11) % p.onsets.length];
    if (on === lastOnset) on = p.onsets[hash32(seed, salt, i, 17) % p.onsets.length];
    lastOnset = on;
    const vo = p.vowels[hash32(seed, salt, i, 12) % p.vowels.length];
    // Codas only close the word, and only sometimes — CV(C) keeps it sayable.
    const co = i === syllables - 1 ? p.codas[hash32(seed, salt, i, 13) % p.codas.length] : '';
    s += on + vo + co;
  }
  if (opts?.suffix && hash32(seed, salt, 14) % 4 === 0) {
    s += p.suffixes[hash32(seed, salt, 15) % p.suffixes.length];
  }
  s = s.replace(/([aeiou])\1+/g, '$1').replace(/(.)\1\1+/g, '$1$1');
  return cap(s);
}

// Lowercase article, capitalised adjective: "the Vofeyir lands" reads right
// mid-sentence, "Greater Mostash" has to keep its capital either way.
const POLITY_FORMS = ['{n}', '{n}', '{n}', 'the {n} lands', '{n}ia', 'Greater {n}'];

/**
 * Articles stay lowercase in the stored name ("the Zasoham lands"); the
 * chronicle capitalises whatever starts a sentence. Otherwise every line
 * mentioning a realm mid-clause reads "outside The Zasoham lands".
 */
export function makePolityName(p: Phonology, seed: number, salt: number): string {
  const base = makeName(p, seed, salt, { suffix: true });
  const form = POLITY_FORMS[hash32(seed, salt, 21) % POLITY_FORMS.length];
  return form.replace('{n}', base);
}

const RELIGION_FORMS = [
  'the {n} Way',
  'the Cult of {n}',
  '{n}ism',
  'the {n} Rite',
  'the Faith of {n}',
  'the {n} Covenant',
];

export function makeReligionName(p: Phonology, seed: number, salt: number): string {
  const base = makeName(p, seed, salt, { suffix: false });
  return RELIGION_FORMS[hash32(seed, salt, 31) % RELIGION_FORMS.length].replace('{n}', base);
}

const EPITHETS = [
  'the Elder','the Younger','the Grim','the Wide-Handed','the Quiet','the Lame','the Fortunate',
  'the Bald','the Twice-Born','the Stubborn','the Far-Sighted','the Unlucky','the Mild','the Red',
];

export function makePersonName(p: Phonology, seed: number, salt: number, epithet: boolean): string {
  const base = makeName(p, seed, salt, { suffix: false });
  if (!epithet) return base;
  return base + ' ' + EPITHETS[hash32(seed, salt, 41) % EPITHETS.length];
}
