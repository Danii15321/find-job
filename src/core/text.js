/** Text helpers shared by the offer reader, the quality checks and the store. */

export function stripAccents(text) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Company or title to a file-safe slug: "Société Générale" → "societe_generale".
 * Legal suffixes are dropped so that "Acme SAS" and "Acme" share one name.
 */
export function slugify(text, { maxLength = 40 } = {}) {
  const slug = stripAccents(String(text))
    .toLowerCase()
    .replace(/&/g, " et ")
    .replace(/\b(sas|sasu|sarl|sa|gmbh|inc|ltd|llc|group|groupe)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLength)
    .replace(/_+$/g, "");
  return slug || "entreprise";
}

/** Lowercase, accent-free, single-spaced form used to compare words. */
export function normalize(text) {
  return stripAccents(String(text))
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9+#./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", eacute: "é", egrave: "è",
  ecirc: "ê", euml: "ë", agrave: "à", acirc: "â", ccedil: "ç", ocirc: "ô", ugrave: "ù",
  ucirc: "û", icirc: "î", iuml: "ï", oelig: "œ", rsquo: "’", lsquo: "‘", ldquo: "“",
  rdquo: "”", laquo: "«", raquo: "»", hellip: "…", mdash: "—", ndash: "–", bull: "•",
  middot: "·", euro: "€", deg: "°", Eacute: "É", Egrave: "È", Agrave: "À", Ccedil: "Ç",
};

export function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED[body] ?? NAMED[body.toLowerCase()] ?? match;
  });
}

/** HTML fragment to readable text, keeping paragraphs and list items. */
export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<li[^>]*>/gi, "\n• ")
      .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/ul|\/ol|\/tr|\/section|\/article)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain text to LaTeX source: the ten special characters escaped. */
export function escapeLatex(text) {
  return String(text).replace(/[\\{}&%$#_~^]/g, (c) =>
    ({ "\\": "\\textbackslash{}", "{": "\\{", "}": "\\}", "&": "\\&", "%": "\\%", $: "\\$", "#": "\\#", _: "\\_", "~": "\\textasciitilde{}", "^": "\\textasciicircum{}" })[c],
  );
}

/** "Le 1er novembre 2026", the French letter date. */
export function frenchDate(date = new Date()) {
  const d = new Date(date);
  const month = d.toLocaleDateString("fr-FR", { month: "long" });
  return `Le ${d.getDate() === 1 ? "1er" : d.getDate()} ${month} ${d.getFullYear()}`;
}
