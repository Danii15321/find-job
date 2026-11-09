/**
 * Read a job offer from its URL. Job boards usually publish a schema.org
 * JobPosting in JSON-LD; it is preferred over the page text, which is kept as
 * a fallback. Pages rendered only by JavaScript or behind a login come back
 * "thin": the agent then reads them another way or asks for the text.
 */
import { FindJobError } from "../core/store.js";
import { decodeEntities, htmlToText } from "../core/text.js";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MAX_TEXT = 40_000;

export async function fetchOffer(url, { timeoutMs = 20_000 } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new FindJobError("INVALID_INPUT", `URL invalide : ${url}`);
  }
  if (!/^https?:$/.test(parsed.protocol)) throw new FindJobError("INVALID_INPUT", "Seules les URL http(s) sont acceptées.");
  let response;
  try {
    response = await fetch(parsed, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml", "accept-language": "fr-FR,fr;q=0.9,en;q=0.8" },
    });
  } catch (error) {
    throw new FindJobError("OFFER_UNREACHABLE", `Offre injoignable (${error.cause?.code ?? error.name}) : ${url}`);
  }
  const html = await response.text();
  if (!response.ok)
    return { ...emptyOffer(url, response.url), status: response.status, quality: "blocked", hint: hint(response.status) };
  return { ...parseOffer(html, response.url || url), url, status: response.status };
}

function hint(status) {
  if (status === 401 || status === 403 || status === 999)
    return "Le site refuse les lectures automatiques : lire la page avec le navigateur ou demander le texte de l’offre.";
  if (status === 404 || status === 410) return "L’offre n’existe plus ou l’URL est incomplète.";
  return "Lecture impossible : lire la page autrement ou demander le texte de l’offre.";
}

function emptyOffer(url, finalUrl) {
  return { url, finalUrl, title: "", company: "", location: "", contract: "", datePosted: "", description: "", text: "", structured: false };
}

export function parseOffer(html, finalUrl = "") {
  const posting = findJobPosting(html);
  const meta = (name) => {
    const re = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i");
    const reversed = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, "i");
    return decodeEntities((re.exec(html) ?? reversed.exec(html))?.[1] ?? "").trim();
  };
  const pageTitle = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").trim();
  const main = /<main[\s\S]*?<\/main>/i.exec(html)?.[0] ?? /<article[\s\S]*?<\/article>/i.exec(html)?.[0] ?? html;
  const pageText = htmlToText(main.replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, " ")).slice(0, MAX_TEXT);

  const offer = {
    finalUrl,
    title: posting?.title ? decodeEntities(posting.title).trim() : meta("og:title") || pageTitle,
    company: organization(posting) || meta("og:site_name"),
    location: location(posting),
    contract: [].concat(posting?.employmentType ?? []).join(", "),
    datePosted: posting?.datePosted ?? "",
    validThrough: posting?.validThrough ?? "",
    salary: salary(posting),
    description: posting?.description ? htmlToText(decodeEntities(posting.description).replace(/\\n/g, "\n")).slice(0, MAX_TEXT) : meta("og:description") || meta("description"),
    text: pageText,
    structured: !!posting,
  };
  const length = Math.max(offer.description.length, offer.text.length);
  offer.quality = posting && offer.description.length > 300 ? "structured" : length > 800 ? "text" : "thin";
  if (offer.quality === "thin")
    offer.hint = "Peu de texte lisible (page rendue en JavaScript ou connexion requise) : lire la page avec le navigateur ou demander le texte de l’offre.";
  return offer;
}

function findJobPosting(html) {
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, body] of blocks) {
    let data;
    try {
      data = JSON.parse(body.trim());
    } catch {
      continue;
    }
    const stack = [data];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      const type = [].concat(node["@type"] ?? []);
      if (type.includes("JobPosting")) return node;
      if (node["@graph"]) stack.push(node["@graph"]);
    }
  }
  return null;
}

function organization(posting) {
  const org = posting?.hiringOrganization;
  if (!org) return "";
  return decodeEntities(typeof org === "string" ? org : (org.name ?? "")).trim();
}

function location(posting) {
  const places = [].concat(posting?.jobLocation ?? []);
  const names = places
    .map((place) => {
      const address = place?.address ?? {};
      if (typeof address === "string") return address;
      return [address.addressLocality, address.addressRegion, address.addressCountry?.name ?? address.addressCountry]
        .filter((part) => typeof part === "string" && part)
        .join(", ");
    })
    .filter(Boolean);
  if (posting?.jobLocationType === "TELECOMMUTE") names.push("Télétravail");
  return [...new Set(names)].join(" · ");
}

function salary(posting) {
  const base = posting?.baseSalary;
  if (!base) return "";
  const value = base.value ?? {};
  const amount = value.minValue && value.maxValue ? `${value.minValue}–${value.maxValue}` : (value.value ?? value.minValue ?? "");
  return [amount, base.currency, value.unitText].filter(Boolean).join(" ");
}

/** Markdown kept next to the CV: what the CV was adapted to, even if the offer disappears. */
export function offerMarkdown(offer) {
  const lines = [
    `# ${offer.title || "Offre"}${offer.company ? ` — ${offer.company}` : ""}`,
    "",
    ...[
      ["URL", offer.url],
      ["Lieu", offer.location],
      ["Contrat", offer.contract],
      ["Salaire", offer.salary],
      ["Publiée le", offer.datePosted],
    ]
      .filter(([, value]) => value)
      .map(([label, value]) => `- **${label}** : ${value}`),
    "",
    "## Description",
    "",
    offer.description || offer.text || "_Texte indisponible._",
  ];
  if (offer.description && offer.text && offer.text.length > offer.description.length * 1.5)
    lines.push("", "## Texte de la page", "", offer.text);
  return `${lines.join("\n").trim()}\n`;
}
