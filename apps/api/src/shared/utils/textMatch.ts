/**
 * Turns what a person types into the search ("quero cortar o cabelo", "fazer as unhas em
 * Talatona") into the handful of terms that actually say what they want. Three steps, all
 * deliberately light — no dictionary of Portuguese, just enough to read a request:
 *
 *  1. Words that only carry the request ("quero", "fazer", "o", "de"…) are dropped. Left
 *     in, "de" alone would match almost every service ("Corte de Cabelo").
 *  2. Each remaining word is cut down to its stem, so "cortar", "corte" and "cortes" all
 *     become "cort", and "depilação" becomes "depil".
 *  3. A word from a known area of beauty services brings its siblings: "unhas" also finds
 *     "Manicure" and "Pedicure", "maquiagem" also finds "Maquilhagem".
 *
 * Matching then compares those variants against text with accents and case removed.
 */

export interface SearchTerm {
  /** The word as typed, lowercased. */
  word: string;
  /** Accent-free fragments; text containing any of them matches this term. */
  variants: string[];
  /** The same fragments in the forms stored text may have (with accents), for the DB filter. */
  patterns: string[];
}

const STOPWORDS = new Set(
  [
    // o pedido em si
    "quero", "queria", "quer", "queremos", "gostaria", "gostava", "preciso", "precisava", "precisamos",
    "procuro", "procurar", "procurando", "busco", "buscar", "fazer", "faz", "fazem", "faco", "fiz",
    "marcar", "agendar", "reservar", "ir", "ter", "tem", "tenho", "dar", "arranjar", "tratar",
    // artigos, preposições e afins
    "um", "uma", "uns", "umas", "o", "a", "os", "as", "de", "do", "da", "dos", "das", "di",
    "para", "pra", "pro", "por", "pelo", "pela", "com", "sem", "em", "no", "na", "nos", "nas",
    "ao", "aos", "e", "ou", "que", "se", "me", "mim", "eu", "meu", "minha", "meus", "minhas",
    "seu", "sua", "isso", "isto", "algo", "algum", "alguma", "onde", "aqui", "ali", "perto",
    "proximo", "proxima", "hoje", "amanha", "agora", "ja", "bom", "boa", "bons", "boas",
    "melhor", "lugar", "sitio", "espaco", "espacos", "servico", "servicos", "favor",
    "i", "want", "need", "to", "get", "the", "my", "an", "for", "near", "me",
  ].map((word) => word.normalize("NFD").replace(/[\u0300-\u036f]/g, "")),
);

/*
 * Areas of service people ask for in their own words. A term whose stem starts with any
 * trigger also matches every variant of the group. `stored` lists accented forms the
 * accent-free variants would miss in the database (Postgres `contains` keeps accents).
 */
const SERVICE_GROUPS: { triggers: string[]; variants: string[]; stored?: string[] }[] = [
  { triggers: ["cabel", "capilar", "cabeleir", "hair"], variants: ["cabel", "capilar", "hair"] },
  { triggers: ["cort"], variants: ["cort", "degrad", "fade"], stored: ["degradê"] },
  { triggers: ["barb", "beard"], variants: ["barb", "beard"] },
  { triggers: ["unh", "manicur", "pedicur", "verniz", "nail", "gelinh"], variants: ["unha", "manicur", "pedicur", "verniz", "nail", "gelinh"] },
  { triggers: ["tranc", "tranç", "braid", "rasta", "twist"], variants: ["tranc", "braid", "rasta", "twist"], stored: ["tranç"] },
  { triggers: ["maquilh", "maquiag", "maquil", "make"], variants: ["maquilh", "maquiag", "make"] },
  { triggers: ["massag", "massaj", "massa"], variants: ["massag", "massaj"] },
  { triggers: ["depil", "cera", "wax"], variants: ["depil", "wax"], stored: ["depilaç"] },
  { triggers: ["sobrancelh", "brow"], variants: ["sobrancelh", "brow"] },
  { triggers: ["pestan", "cilio", "lash"], variants: ["pestan", "cilio", "lash"], stored: ["cílio"] },
  { triggers: ["pint", "tint", "color", "madeix"], variants: ["pint", "tint", "color", "madeix"], stored: ["coloraç"] },
  { triggers: ["facial", "limpez", "pele", "skin", "estetic"], variants: ["facial", "pele", "skin", "estetic"], stored: ["estétic"] },
  { triggers: ["peruc", "extens", "megahair", "aplique", "wig"], variants: ["peruc", "extens", "megahair", "mega hair", "aplique", "wig"], stored: ["extensõ"] },
  { triggers: ["alis", "relax", "desfris", "progressiv"], variants: ["alis", "relax", "desfris", "progressiv"] },
  { triggers: ["pentead", "pentea", "escov", "brush"], variants: ["pentead", "escov"] },
];

export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Text ready for termMatches: accent-free words separated by single spaces, with one in front. */
export function searchableText(...fields: (string | null | undefined)[]): string {
  return ` ${normalizeText(fields.filter(Boolean).join(" ")).replace(/[^a-z0-9]+/g, " ")}`;
}

// Shorten a word only while what's left is still a recognisable fragment (4+ letters).
function strip(word: string, suffix: string | RegExp): string {
  const next = typeof suffix === "string" ? (word.endsWith(suffix) ? word.slice(0, -suffix.length) : word) : word.replace(suffix, "");
  return next.length >= 4 ? next : word;
}

/** A light Portuguese stem: "cortar"/"cortes" → "cort", "depilação" → "depil". Works on accented or plain text. */
export function stemWord(word: string): string {
  let stem = word.toLowerCase();
  if (stem.length <= 3) return stem;
  stem = strip(stem, /(ções|coes)$/);
  stem = strip(stem, /(ção|cao)$/);
  stem = strip(stem, /(ões|oes)$/);
  stem = strip(stem, "s");
  stem = strip(stem, "mento");
  stem = strip(stem, /(ar|er|ir)$/);
  stem = strip(stem, /[aeo]$/);
  return stem;
}

/** The terms a query is really asking for; empty when it has none (only stopwords). */
export function parseSearchQuery(query: string): SearchTerm[] {
  const seen = new Set<string>();
  const terms: SearchTerm[] = [];

  for (const raw of query.toLowerCase().split(/[\s,.;:!?()"'“”/+-]+/)) {
    const plain = normalizeText(raw);
    if (plain.length < 2 || STOPWORDS.has(plain)) continue;

    const stem = stemWord(plain);
    if (seen.has(stem)) continue;
    seen.add(stem);

    const variants = new Set([stem]);
    const patterns = new Set([stem, stemWord(raw)]);
    for (const group of SERVICE_GROUPS) {
      if (!group.triggers.some((trigger) => stem.startsWith(normalizeText(trigger)))) continue;
      group.variants.forEach((variant) => {
        variants.add(variant);
        patterns.add(variant);
      });
      group.stored?.forEach((pattern) => patterns.add(pattern));
    }

    terms.push({ word: raw, variants: [...variants], patterns: [...patterns] });
    if (terms.length === 8) break;
  }

  return terms;
}

/**
 * Whether `text` (from searchableText) has a word starting with one of the term's variants.
 * Word starts, not anywhere: "spa" must not match "espaço", nor "de" the middle of "idade".
 */
export function termMatches(term: SearchTerm, text: string): boolean {
  return term.variants.some((variant) => text.includes(` ${variant}`));
}
