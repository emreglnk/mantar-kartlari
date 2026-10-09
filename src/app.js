import { REGIONS, ALIASES } from "./regions.js";
import { CAT, FOODISH, DANGER, edibility } from "./edibility.js";
import { store } from "./store.js";
import {
  fold, getTurkeyId, resolveTurkey, resolveProvince, speciesCounts, taxonPhotos, taxonSummary,
} from "./inat.js";

const PER_CARD = 10; // bir kartta kaydırılabilen en fazla fotoğraf

/* ---------- Durum ---------- */
const S = {
  region: store.get("region", "Tümü"),
  province: store.get("province", ""),
  mode: store.get("mode", "mc"),
  diff: store.get("diff", "hard"),
  filter: store.get("filter", "all"),
  alpha: store.get("alpha", 70),
  pool: store.get("pool", 80),
  stats: store.get("stats", {}), // taxonId -> {c, w}
  score: { c: 0, n: 0, streak: 0 },
  placeQuery: "",
  allSpecies: [],
  species: [],
  current: null,
  gallery: [], // bu kartın fotoğrafları
  slide: -1, // galeride görünen fotoğrafın sırası
  recent: [],
  shownPhotos: new Set(),
  answered: false,
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const els = {
  region: $("region"), province: $("province"), track: $("track"), status: $("status"),
  counter: $("counter"), dots: $("dots"), prevPh: $("prevPh"), nextPh: $("nextPh"), credit: $("credit"),
  prompt: $("prompt"), opts: $("opts"), label: $("label"), actionbar: $("actionbar"),
  reveal: $("reveal"), gotWrong: $("gotWrong"), gotRight: $("gotRight"), nextBtn: $("nextBtn"),
  placeLabel: $("placeLabel"), sc: $("sc"), streak: $("streak"), streakPill: $("streakPill"),
  net: $("net"), sheet: $("sheet"),
};
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const icon = (name, cls = "ic") => `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const motion = () => (reduceMotion ? "auto" : "smooth");

function setStatus(m) {
  els.status.hidden = false;
  els.status.textContent = m;
}
/** Eylem çubuğunda yalnızca verilen düğmeleri gösterir; hiçbiri yoksa çubuğu gizler. */
function setActions(...show) {
  for (const b of [els.reveal, els.gotWrong, els.gotRight, els.nextBtn]) b.hidden = !show.includes(b);
  els.actionbar.hidden = !show.length;
}

/* ---------- Yer ---------- */
async function currentPlaceIds() {
  if (S.province) {
    const id = await resolveProvince(S.province, ALIASES[S.province]);
    return id ? [id] : null;
  }
  if (S.region !== "Tümü") {
    const ids = [];
    const list = REGIONS[S.region];
    for (let i = 0; i < list.length; i++) {
      setStatus(`${S.region} illeri eşleştiriliyor… ${i + 1}/${list.length}`);
      const id = await resolveProvince(list[i], ALIASES[list[i]]);
      if (id) ids.push(id);
    }
    return ids.length ? ids : null;
  }
  return [getTurkeyId()];
}

/* ---------- Tür havuzu ---------- */
const withEd = (s) => ({ ...s, ed: edibility(s.name) });

async function loadSpecies() {
  resetCard();
  clearGallery();
  setStatus("Türler yükleniyor…");
  const tr = getTurkeyId();
  let ids = await currentPlaceIds();
  let label = S.province || (S.region === "Tümü" ? "Türkiye" : S.region + " Bölgesi");
  if (!ids) {
    ids = [tr];
    label = "Türkiye (il eşleşmedi)";
  }
  S.placeQuery = ids.join(",");
  const perPage = Math.min(200, Math.max(20, S.pool));
  let sp = (await speciesCounts(S.placeQuery, perPage)).map(withEd);

  // Yerel tür azsa Türkiye geneliyle tamamla; eklenenlerin yerel sayısı yok.
  if (sp.length < 12 && S.placeQuery !== String(tr)) {
    const have = new Set(sp.map((s) => s.id));
    for (const s of await speciesCounts(tr, perPage))
      if (!have.has(s.id)) sp.push(withEd({ ...s, count: 0.5 }));
    label += " + Türkiye geneli";
  }
  S.allSpecies = sp;
  S.species = applyFilter(sp);
  els.placeLabel.textContent = `${label} · ${S.species.length} tür`;
  if (S.species.length < 4) {
    setStatus("Bu seçimde yeterli tür yok. Filtreyi ya da yeri değiştir.");
    return;
  }
  nextCard();
}

function applyFilter(sp) {
  if (S.filter === "food")
    return sp.filter((s) => FOODISH.has(s.ed.k) || (["olumcul", "zehirli"].includes(s.ed.k) && !s.ed.genus));
  if (S.filter === "danger") return sp.filter((s) => DANGER.has(s.ed.k));
  return sp;
}
const displayName = (s) => s.ed.tr || s.common || s.name;

/* ---------- Seçim: gözlem sayısı ^ alpha × tekrar katsayısı ---------- */
function weightOf(s) {
  const a = S.alpha / 100;
  const st = S.stats[s.id] || { c: 0, w: 0 };
  const srs = Math.max(0.3, (1 + st.w * 1.5) / (1 + st.c * 0.6));
  return Math.pow(Math.max(s.count, 0.5), a) * srs;
}
function pickWeighted(list) {
  const ws = list.map(weightOf);
  let r = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) if ((r -= ws[i]) <= 0) return list[i];
  return list[list.length - 1];
}
function pickTaxon() {
  const avoid = new Set(S.recent);
  const pool = S.species.filter((s) => !avoid.has(s.id));
  const t = pickWeighted(pool.length ? pool : S.species);
  S.recent.push(t.id);
  if (S.recent.length > Math.min(8, Math.floor(S.species.length / 2))) S.recent.shift();
  return t;
}
function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function distractors(t) {
  const others = S.allSpecies.filter((s) => s.id !== t.id);
  const genus = t.name.split(" ")[0];
  let pick = [];
  if (S.diff === "hard") {
    pick = shuffle(others.filter((s) => s.name.split(" ")[0] === genus)).slice(0, 3);
    if (pick.length < 3) {
      // Aynı cinsten yetmezse farklı yenilebilirlik kategorisindekileri öne al: en öğretici karışıklık.
      const rest = shuffle(others.filter((s) => !pick.includes(s)));
      rest.sort((a, b) => (b.ed.k !== t.ed.k) - (a.ed.k !== t.ed.k));
      pick = pick.concat(rest.slice(0, 3 - pick.length));
    }
  } else pick = shuffle(others).slice(0, 3);
  return shuffle([t, ...pick]);
}

/* ---------- Fotoğraf: önce seçili yer, sonra Türkiye, sonra dünya ---------- */
const photoCache = new Map();
async function photosFor(t) {
  const key = t.id + "|" + S.placeQuery;
  if (photoCache.has(key)) return photoCache.get(key);
  const tr = getTurkeyId();
  let list = await taxonPhotos(t.id, S.placeQuery);
  if (list.length < 4 && S.placeQuery !== String(tr)) list = list.concat(await taxonPhotos(t.id, tr));
  if (list.length < 4) list = list.concat(await taxonPhotos(t.id, null));
  const uniq = [...new Map(list.map((p) => [p.pid, p])).values()];
  photoCache.set(key, uniq);
  return uniq;
}

/** Karta girecek fotoğraflar: önce görülmemişler, önce her gözlemden bir tane (farklı bireyler). */
function pickGallery(photos) {
  const seen = (p) => S.shownPhotos.has(p.pid);
  const ordered = shuffle(photos).sort((a, b) => seen(a) - seen(b));
  const firsts = new Map();
  for (const p of ordered) if (!firsts.has(p.obsId)) firsts.set(p.obsId, p);
  let out = [...firsts.values()];
  if (out.length < PER_CARD) out = out.concat(ordered.filter((p) => !out.includes(p)));
  return out.slice(0, PER_CARD);
}

const preload = (url) =>
  new Promise((res) => {
    const im = new Image();
    im.onload = () => res(true);
    im.onerror = () => res(false);
    im.src = url;
  });
const photoMeta = (p) => (p ? `${p.place || "konum gizli"}${p.date ? " · " + p.date : ""}` : "");

function clearGallery() {
  S.gallery = [];
  S.slide = -1;
  els.track.innerHTML = "";
  els.dots.innerHTML = "";
  els.counter.hidden = els.prevPh.hidden = els.nextPh.hidden = true;
  els.credit.textContent = "";
}

async function showGallery(t) {
  clearGallery();
  setStatus("Fotoğraf yükleniyor…");
  let photos;
  try {
    photos = await photosFor(t);
  } catch (e) {
    if (S.current === t)
      setStatus(navigator.onLine ? e.message : "Çevrimdışısın ve bu türün fotoğrafları önbellekte yok.");
    return false;
  }
  if (S.current !== t) return false;
  if (!photos.length) {
    setStatus("Bu tür için lisanslı fotoğraf bulunamadı.");
    return false;
  }
  const list = pickGallery(photos);
  // İlk fotoğraf açılmadan şıkları gösterme; açılamayanı at, sıradakini dene.
  while (list.length && !(await preload(list[0].url))) list.shift();
  if (S.current !== t) return false;
  if (!list.length) {
    setStatus(navigator.onLine ? "Fotoğraflar açılamadı." : "Bu türün fotoğrafları önbellekte yok; çevrimiçi olunca gelir.");
    return false;
  }
  S.gallery = list;
  const n = list.length;
  els.track.innerHTML = list
    .map(
      (p, i) =>
        `<figure class="slide"><img class="bg" alt="" aria-hidden="true"><img class="ph" alt="Tahmin edilecek mantar, fotoğraf ${i + 1}/${n}"></figure>`
    )
    .join("");
  els.dots.innerHTML = n > 1 ? "<i></i>".repeat(n) : "";
  els.track.scrollLeft = 0;
  setSlide(0);
  els.status.hidden = true;
  return true;
}

/** Fotoğrafı yalnızca görünür olunca ya da komşusu görünürken yükler. */
function loadSlide(i) {
  const fig = els.track.children[i];
  if (!fig || fig.dataset.loaded) return;
  fig.dataset.loaded = "1";
  const url = S.gallery[i].url;
  const ph = fig.querySelector(".ph");
  ph.onload = () => ph.classList.add("loaded");
  ph.onerror = () => fig.classList.add("broken");
  ph.src = url;
  fig.querySelector(".bg").src = url;
}

function setSlide(i) {
  if (i === S.slide || !S.gallery[i]) return;
  S.slide = i;
  const n = S.gallery.length, p = S.gallery[i];
  loadSlide(i);
  loadSlide(i + 1);
  loadSlide(i - 1);
  S.shownPhotos.add(p.pid);
  els.counter.textContent = `${i + 1} / ${n}`;
  els.counter.hidden = els.prevPh.hidden = els.nextPh.hidden = n < 2;
  els.prevPh.disabled = i === 0;
  els.nextPh.disabled = i === n - 1;
  [...els.dots.children].forEach((d, j) => d.classList.toggle("on", j === i));
  els.credit.innerHTML = `${esc(p.attr)} · <a href="https://www.inaturalist.org/observations/${p.obsId}" target="_blank" rel="noopener">gözlem</a>`;
  const pm = $("photoMeta");
  if (pm) pm.textContent = photoMeta(p);
}

function goSlide(i) {
  if (!S.gallery.length) return;
  i = Math.max(0, Math.min(S.gallery.length - 1, i));
  els.track.scrollTo({ left: i * els.track.clientWidth, behavior: motion() });
}

let scrollRaf = 0;
els.track.addEventListener(
  "scroll",
  () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const w = els.track.clientWidth;
      if (w) setSlide(Math.round(els.track.scrollLeft / w));
    });
  },
  { passive: true }
);
addEventListener("resize", () => {
  if (S.slide >= 0) els.track.scrollLeft = S.slide * els.track.clientWidth;
});
els.prevPh.onclick = () => goSlide(S.slide - 1);
els.nextPh.onclick = () => goSlide(S.slide + 1);

/* ---------- Kart akışı ---------- */
function resetCard() {
  S.answered = false;
  els.label.hidden = true;
  els.label.innerHTML = "";
  els.opts.innerHTML = "";
  els.prompt.hidden = true;
  setActions();
}

async function nextCard() {
  if (!S.species.length) return;
  resetCard();
  const t = pickTaxon();
  S.current = t;
  if (!(await showGallery(t))) {
    if (S.current === t) setActions(els.nextBtn);
    return;
  }
  if (S.current !== t) return; // bu arada başka kart istendi
  els.prompt.hidden = false;
  if (S.mode === "mc") {
    els.prompt.textContent = "Bu hangi mantar?";
    distractors(t).forEach((s, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt";
      b.dataset.id = s.id;
      const tr = displayName(s);
      b.innerHTML =
        `<span class="key">${i + 1}</span><span class="txt"><span class="tr">${esc(tr)}</span>` +
        `${tr !== s.name ? `<span class="la">${esc(s.name)}</span>` : ""}</span>`;
      b.onclick = () => answer(s.id === t.id, b);
      els.opts.appendChild(b);
    });
  } else {
    els.prompt.textContent = "Adını biliyor musun? Fotoğrafları kaydırıp bak, sonra kartı çevir.";
    setActions(els.reveal);
  }
  prefetchNext();
}

function answer(right, btn) {
  if (S.answered) return;
  S.answered = true;
  for (const b of els.opts.querySelectorAll(".opt")) {
    b.disabled = true;
    const isRight = +b.dataset.id === S.current.id;
    if (isRight) b.classList.add("right");
    else b.classList.add(b === btn ? "wrong" : "dim");
    if (isRight || b === btn) b.insertAdjacentHTML("beforeend", icon(isRight ? "check" : "x", "ic mark"));
  }
  record(right);
  showLabel(right);
  setActions(els.nextBtn);
  els.nextBtn.focus({ preventScroll: true });
}

function record(right) {
  const st = S.stats[S.current.id] || { c: 0, w: 0 };
  right ? st.c++ : st.w++;
  S.stats[S.current.id] = st;
  store.set("stats", S.stats);
  S.score.n++;
  if (right) {
    S.score.c++;
    S.score.streak++;
  } else S.score.streak = 0;
  showScore();
}
function showScore() {
  els.sc.textContent = `${S.score.c}/${S.score.n}`;
  els.streak.textContent = S.score.streak;
  els.streakPill.hidden = S.score.streak < 2;
}

/** Sonuç kartı. verdict: çoktan seçmelide doğru/yanlış; kart çevirmede undefined. */
async function showLabel(verdict) {
  const t = S.current, e = t.ed, c = CAT[e.k];
  const st = S.stats[t.id] || { c: 0, w: 0 };
  const tr = displayName(t);
  const alt = t.common && ![fold(tr), fold(t.name)].includes(fold(t.common)) ? t.common : "";
  const link = (href, text, id = "") =>
    `<a class="chip"${id ? ` id="${id}"` : ""} href="${href}" target="_blank" rel="noopener">${text}${icon("ext")}</a>`;
  els.label.innerHTML = `
    ${verdict === undefined ? "" : `<div class="verdict ${verdict ? "ok" : "bad"}">${icon(verdict ? "check" : "x", "ic sm")}${verdict ? "Doğru" : "Yanlış"}</div>`}
    <div class="names">
      <h2>${esc(tr)}</h2>
      ${tr !== t.name ? `<div class="latin">${esc(t.name)}</div>` : ""}
      ${alt ? `<div class="alt">Diğer adı: ${esc(alt)}</div>` : ""}
    </div>
    <div class="badge-row"><span class="badge ${c[1]}">${c[0]}</span>${e.genus ? `<span class="hint">cins düzeyinde bilgi</span>` : ""}</div>
    ${e.note ? `<p class="note">${esc(e.note)}</p>` : ""}
    <dl class="facts">
      <dt>Seçili yerde</dt><dd>${t.count >= 1 ? t.count + " doğrulanmış gözlem" : "yerel gözlem yok"}</dd>
      <dt>Bu foto</dt><dd id="photoMeta">${esc(photoMeta(S.gallery[S.slide]))}</dd>
      <dt>Senin karnen</dt><dd>${st.c} doğru · ${st.w} yanlış</dd>
    </dl>
    <p class="wiki" id="wiki">Açıklama yükleniyor…</p>
    <button type="button" class="more-link" id="wikiMore" hidden>Devamını oku</button>
    <div class="links">
      ${link(`https://www.inaturalist.org/taxa/${t.id}`, "iNaturalist")}
      ${link(`https://tr.wikipedia.org/wiki/${encodeURIComponent(t.name.replace(/ /g, "_"))}`, "Wikipedia", "wikiLink")}
      ${link(`https://www.inaturalist.org/observations?taxon_id=${t.id}&place_id=${S.placeQuery}`, "Haritada gözlemler")}
    </div>`;
  els.label.hidden = false;
  // Sonuç kartının başı ekranın üst yarısına gelsin; fotoğraf ve şıklar kısmen görünür kalır.
  const top = els.label.getBoundingClientRect().top, want = innerHeight * 0.4;
  if (top > want) scrollBy({ top: top - want, behavior: motion() });
  try {
    const sum = await taxonSummary(t.id);
    const w = $("wiki");
    if (!w || S.current !== t) return;
    w.textContent = sum ? sum.text : "Wikipedia özeti yok.";
    if (sum && sum.url) $("wikiLink").href = sum.url;
    w.classList.add("clamp");
    if (w.scrollHeight > w.clientHeight + 2) {
      const more = $("wikiMore");
      more.hidden = false;
      more.onclick = () => {
        w.classList.remove("clamp");
        more.hidden = true;
      };
    } else w.classList.remove("clamp");
  } catch {
    const w = $("wiki");
    if (w && S.current === t)
      w.textContent = navigator.onLine ? "Açıklama alınamadı." : "Açıklama çevrimdışı önbellekte yok.";
  }
}

/** Sıradaki olası türün fotoğraf listesini ve bir fotoğrafını önceden çeker; SW önbelleğine de girer. */
function prefetchNext() {
  if (!navigator.onLine) return;
  const cand = pickWeighted(S.species);
  photosFor(cand)
    .then((ph) => {
      const p = ph[Math.floor(Math.random() * ph.length)];
      if (p) new Image().src = p.url;
    })
    .catch(() => {});
}

/* ---------- Ayarlar sayfası ---------- */
const openSheet = () => els.sheet.showModal();
$("placeBtn").onclick = openSheet;
$("settingsBtn").onclick = openSheet;
$("sheetClose").onclick = () => els.sheet.close();
// Arka plana (dialog'un kendi kutusuna, içeriğin dışına) dokunulunca kapat.
els.sheet.addEventListener("click", (e) => {
  if (e.target === els.sheet) els.sheet.close();
});

function fillRegions() {
  els.region.innerHTML = `<option>Tümü</option>` + Object.keys(REGIONS).map((r) => `<option>${r}</option>`).join("");
  els.region.value = S.region in REGIONS ? S.region : "Tümü";
  S.region = els.region.value;
  fillProvinces();
}
function fillProvinces() {
  const list =
    S.region === "Tümü"
      ? Object.values(REGIONS).flat().sort((a, b) => a.localeCompare(b, "tr"))
      : REGIONS[S.region];
  els.province.innerHTML =
    `<option value="">${S.region === "Tümü" ? "Tüm iller" : "Bölgenin tamamı"}</option>` +
    list.map((p) => `<option>${p}</option>`).join("");
  els.province.value = list.includes(S.province) ? S.province : "";
  S.province = els.province.value;
}
els.region.onchange = () => {
  S.region = els.region.value;
  S.province = "";
  store.set("region", S.region);
  store.set("province", "");
  fillProvinces();
  S.recent = [];
  run();
};
els.province.onchange = () => {
  S.province = els.province.value;
  store.set("province", S.province);
  if (S.province && S.region === "Tümü") {
    const r = Object.keys(REGIONS).find((k) => REGIONS[k].includes(S.province));
    if (r) {
      S.region = r;
      store.set("region", r);
      fillRegions();
    }
  }
  S.recent = [];
  run();
};

function seg(id, key, onChange) {
  const el = $(id);
  const sync = () =>
    el.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === S[key])));
  el.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    S[key] = b.dataset.v;
    store.set(key, S[key]);
    sync();
    onChange && onChange();
  };
  sync();
}
seg("mode", "mode", () => nextCard());
seg("diff", "diff");
seg("filter", "filter", () => {
  S.species = applyFilter(S.allSpecies);
  if (S.species.length < 4) {
    resetCard();
    clearGallery();
    return setStatus("Bu filtrede yeterli tür yok.");
  }
  S.recent = [];
  nextCard();
});

const alpha = $("alpha"), pool = $("pool");
const showAlpha = () =>
  ($("alphaV").textContent = S.alpha == 0 ? "yok" : S.alpha >= 80 ? "yüksek" : S.alpha >= 40 ? "orta" : "düşük");
alpha.value = S.alpha;
pool.value = S.pool;
$("poolV").textContent = S.pool;
showAlpha();
alpha.oninput = () => {
  S.alpha = +alpha.value;
  store.set("alpha", S.alpha);
  showAlpha();
};
pool.oninput = () => ($("poolV").textContent = pool.value);
pool.onchange = () => {
  S.pool = +pool.value;
  store.set("pool", S.pool);
  run();
};
$("resetStats").onclick = () => {
  S.stats = {};
  store.set("stats", {});
  S.score = { c: 0, n: 0, streak: 0 };
  showScore();
};

/* ---------- Eylemler, yakınlaştırma, klavye ---------- */
els.nextBtn.onclick = () => nextCard();
els.reveal.onclick = () => {
  S.answered = true;
  showLabel();
  setActions(els.gotWrong, els.gotRight);
};
els.gotRight.onclick = () => grade(true);
els.gotWrong.onclick = () => grade(false);
function grade(right) {
  record(right);
  nextCard();
}

els.track.onclick = (e) => {
  const img = e.target.closest(".ph");
  if (!img || !img.src) return;
  $("zoomImg").src = img.src;
  $("zoom").hidden = false;
};
$("zoom").onclick = () => ($("zoom").hidden = true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("zoom").hidden = true;
  if (els.sheet.open || e.target.closest("select,input,textarea")) return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    goSlide(S.slide + (e.key === "ArrowRight" ? 1 : -1));
  } else if (S.mode === "mc" && !S.answered && /^[1-4]$/.test(e.key)) {
    const b = els.opts.querySelectorAll(".opt")[+e.key - 1];
    b && b.click();
  }
});

/* ---------- PWA: bağlantı durumu, yükleme, service worker ---------- */
function netState() {
  els.net.hidden = navigator.onLine;
}
addEventListener("online", netState);
addEventListener("offline", netState);
netState();

let installEvt = null;
const installBtn = $("install");
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvt = e;
  installBtn.hidden = false;
});
installBtn.onclick = async () => {
  if (!installEvt) return;
  installEvt.prompt();
  await installEvt.userChoice.catch(() => {});
  installEvt = null;
  installBtn.hidden = true;
};
addEventListener("appinstalled", () => (installBtn.hidden = true));

// iOS'ta beforeinstallprompt yok: Safari'de ve henüz yüklenmemişse elle yükleme ipucu göster.
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
if (isIOS && !standalone && !store.get("iosHintDismissed", false)) {
  const h = $("iosHint");
  h.hidden = false;
  h.querySelector("button").onclick = () => {
    h.hidden = true;
    store.set("iosHintDismissed", true);
  };
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const nw = reg.installing;
      nw && nw.addEventListener("statechange", () => {
        if (nw.state === "installed" && navigator.serviceWorker.controller) $("update").hidden = false;
      });
    });
    $("update").onclick = () => reg.waiting && reg.waiting.postMessage("skipWaiting");
  }).catch(() => {});
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // İlk kurulumdaki clients.claim de bu olayı tetikler; sadece kullanıcı güncellemeyi istediyse yenile.
    if (reloading || $("update").hidden) return;
    reloading = true;
    location.reload();
  });
}

/* ---------- Başlat ---------- */
let runId = 0;
async function run() {
  const my = ++runId;
  try {
    await loadSpecies();
  } catch (e) {
    if (my === runId)
      setStatus(
        navigator.onLine
          ? "Bağlantı hatası: " + e.message + ". Sayfayı yenile."
          : "Çevrimdışısın ve bu yer için tür listesi önbellekte yok. Daha önce açtığın bir yeri seç."
      );
  }
}

fillRegions();
resolveTurkey().then(run);
