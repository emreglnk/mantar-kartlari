// iNaturalist API v1 istemcisi. Belgeler: https://api.inaturalist.org/v1/docs/
// Tarayıcıdan doğrudan çağrılır (CORS açık). Önbellekleme iki katmanlı:
//   1) bu modüldeki bellek içi Map (aynı oturumda tekrar istek atmamak için)
//   2) sw.js içindeki network-first API önbelleği (çevrimdışı kullanım için)
import { store } from "./store.js";

export const API = "https://api.inaturalist.org/v1";
export const TR_DEFAULT = 7183; // iNaturalist yer kimliği: Türkiye

const memo = new Map();

export async function api(path) {
  if (memo.has(path)) return memo.get(path);
  const p = (async () => {
    for (let i = 0; i < 3; i++) {
      const r = await fetch(API + path, { headers: { Accept: "application/json" } });
      if (r.status === 429) {
        await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
        continue;
      }
      if (!r.ok) throw new Error("iNaturalist " + r.status);
      return r.json();
    }
    throw new Error("iNaturalist yoğun, biraz sonra tekrar dene");
  })();
  memo.set(path, p);
  p.catch(() => memo.delete(path));
  return p;
}

export const fold = (s) =>
  s.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");

let turkeyId = TR_DEFAULT;
export const getTurkeyId = () => turkeyId;

/** 7183'ün gerçekten Türkiye olduğunu doğrular; değilse adla arar. */
export async function resolveTurkey() {
  try {
    const r = await api("/places/" + TR_DEFAULT);
    const pl = r.results && r.results[0];
    if (pl && /turk|türk/i.test(pl.name + " " + (pl.display_name || ""))) return turkeyId;
  } catch {}
  try {
    const r = await api("/places/autocomplete?q=Turkey&per_page=10");
    const pl = (r.results || []).find((p) => p.admin_level === 0) || (r.results || [])[0];
    if (pl) turkeyId = pl.id;
  } catch {}
  return turkeyId;
}

/** İl adını iNaturalist yer kimliğine çevirir; sonucu kalıcı olarak saklar. */
export async function resolveProvince(name, aliases = []) {
  const known = store.get("placeIds", {});
  if (known[name]) return known[name];
  const tries = [name, ...aliases, fold(name)];
  const want = tries.map(fold);
  for (const q of tries) {
    let r;
    try {
      r = await api("/places/autocomplete?q=" + encodeURIComponent(q) + "&per_page=20");
    } catch {
      continue;
    }
    const cands = (r.results || []).filter((p) => {
      const inTR =
        (p.ancestor_place_ids || []).includes(turkeyId) || /turk|türk/i.test(p.display_name || "");
      return inTR && p.id !== turkeyId;
    });
    const best =
      cands.find((p) => p.admin_level === 10 && want.includes(fold(p.name))) ||
      cands.find((p) => want.includes(fold(p.name))) ||
      cands.find((p) => p.admin_level === 10);
    if (best) {
      known[name] = best.id;
      store.set("placeIds", known);
      return best.id;
    }
  }
  return null;
}

/** Bir yerde (virgüllü yer kimlikleri) doğrulanmış gözlemi olan mantar türleri, gözlem sayısıyla. */
export async function speciesCounts(placeQuery, perPage) {
  const r = await api(
    `/observations/species_counts?place_id=${placeQuery}&iconic_taxa=Fungi&quality_grade=research&photos=true&locale=tr&per_page=${perPage}`
  );
  return (r.results || [])
    .filter((x) => x.taxon && x.taxon.rank === "species")
    .map((x) => ({
      id: x.taxon.id,
      name: x.taxon.name,
      common: x.taxon.preferred_common_name || "",
      count: x.count,
    }));
}

/** Bir türün lisanslı fotoğrafları. place verilmezse dünya geneli. */
export async function taxonPhotos(taxonId, place) {
  const r = await api(
    `/observations?taxon_id=${taxonId}${place ? "&place_id=" + place : ""}` +
      `&quality_grade=research&photos=true&photo_licensed=true&per_page=60&order_by=votes`
  );
  const out = [];
  for (const o of r.results || [])
    for (const p of o.photos || []) {
      if (!p.url || !p.license_code) continue;
      out.push({
        pid: p.id,
        url: p.url.replace(/\/square\./, "/large."),
        attr: p.attribution || "",
        lic: p.license_code,
        obsId: o.id,
        place: o.place_guess || "",
        date: o.observed_on || "",
      });
    }
  return out;
}

/** Türün Türkçe Wikipedia özeti (yoksa iNaturalist'in verdiği dildeki). */
export async function taxonSummary(taxonId) {
  const r = await api(`/taxa/${taxonId}?locale=tr`);
  const tx = r.results && r.results[0];
  if (!tx || !tx.wikipedia_summary) return null;
  // DOMParser belgesi etkisizdir: içindeki <img> yüklenmez, betik çalışmaz.
  const doc = new DOMParser().parseFromString(tx.wikipedia_summary, "text/html");
  return { text: doc.body.textContent.trim(), url: tx.wikipedia_url || null };
}
