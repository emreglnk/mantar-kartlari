import { REGIONS, ALIASES } from "./regions.js";
import { CAT, FOODISH, DANGER, edibility } from "./edibility.js";
import { store } from "./store.js";
import {
  getTurkeyId, resolveTurkey, resolveProvince, speciesCounts, taxonPhotos, taxonSummary,
} from "./inat.js";

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
  curPhoto: null,
  recent: [],
  shownPhotos: new Set(),
  answered: false,
};

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const els = {
  region: $("region"), province: $("province"), photo: $("photo"), status: $("status"),
  another: $("another"), obsTag: $("obsTag"), credit: $("credit"), opts: $("opts"),
  label: $("label"), nextBtn: $("nextBtn"), flipbar: $("flipbar"), selfgrade: $("selfgrade"),
  placeLabel: $("placeLabel"), sc: $("sc"), streak: $("streak"), net: $("net"),
};
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function setStatus(m) {
  els.status.hidden = false;
  els.status.textContent = m;
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
  setStatus("Türler yükleniyor…");
  els.opts.innerHTML = "";
  els.label.hidden = true;
  els.nextBtn.hidden = true;
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

async function showPhoto(t) {
  els.photo.hidden = true;
  els.another.hidden = true;
  els.obsTag.hidden = true;
  els.credit.textContent = "";
  setStatus("Fotoğraf yükleniyor…");
  let photos;
  try {
    photos = await photosFor(t);
  } catch (e) {
    setStatus(navigator.onLine ? e.message : "Çevrimdışısın ve bu türün fotoğrafları önbellekte yok.");
    return false;
  }
  if (!photos.length) {
    setStatus("Bu tür için lisanslı fotoğraf bulunamadı.");
    return false;
  }
  let fresh = photos.filter((p) => !S.shownPhotos.has(p.pid));
  if (!fresh.length) {
    photos.forEach((p) => S.shownPhotos.delete(p.pid));
    fresh = photos;
  }
  const p = fresh[Math.floor(Math.random() * fresh.length)];
  S.shownPhotos.add(p.pid);
  S.curPhoto = p;
  const loaded = await new Promise((res) => {
    els.photo.onload = () => res(true);
    els.photo.onerror = () => res(false);
    els.photo.src = p.url;
  });
  if (!loaded) {
    setStatus(navigator.onLine ? "Fotoğraf açılamadı." : "Bu fotoğraf önbellekte yok; çevrimiçi olunca gelir.");
    els.another.hidden = photos.length < 2;
    return false;
  }
  els.photo.alt = "Tahmin edilecek mantar fotoğrafı";
  els.photo.hidden = false;
  els.status.hidden = true;
  els.another.hidden = photos.length < 2;
  els.obsTag.textContent = `${photos.length} fotoğraftan biri`;
  els.obsTag.hidden = false;
  els.credit.innerHTML = `${esc(p.attr)} · <a href="https://www.inaturalist.org/observations/${p.obsId}" target="_blank" rel="noopener">gözlem</a>`;
  return true;
}

/* ---------- Kart akışı ---------- */
async function nextCard() {
  if (!S.species.length) return;
  S.answered = false;
  els.label.hidden = true;
  els.nextBtn.hidden = true;
  els.opts.innerHTML = "";
  els.flipbar.hidden = true;
  els.selfgrade.hidden = true;
  const t = pickTaxon();
  S.current = t;
  if (!(await showPhoto(t))) {
    els.nextBtn.hidden = false;
    return;
  }
  if (S.current !== t) return; // bu arada başka kart istendi
  if (S.mode === "mc") {
    for (const s of distractors(t)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "opt";
      b.dataset.id = s.id;
      const tr = displayName(s);
      b.innerHTML = `<span class="tr">${esc(tr)}</span>${tr !== s.name ? `<span class="la">${esc(s.name)}</span>` : ""}`;
      b.onclick = () => answer(s.id === t.id, b);
      els.opts.appendChild(b);
    }
  } else els.flipbar.hidden = false;
  prefetchNext();
}

function answer(right, btn) {
  if (S.answered) return;
  S.answered = true;
  for (const b of els.opts.querySelectorAll(".opt")) {
    b.disabled = true;
    if (+b.dataset.id === S.current.id) b.classList.add("right");
  }
  if (btn && !right) btn.classList.add("wrong");
  record(right);
  showLabel();
  els.nextBtn.hidden = false;
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
  els.sc.textContent = `${S.score.c}/${S.score.n}`;
  els.streak.textContent = `seri ${S.score.streak}`;
}

async function showLabel() {
  const t = S.current, e = t.ed, p = S.curPhoto, c = CAT[e.k];
  const st = S.stats[t.id] || { c: 0, w: 0 };
  const tr = displayName(t);
  els.label.innerHTML = `
    <div class="names"><h2>${esc(tr)}</h2>${tr !== t.name ? `<div class="la">${esc(t.name)}</div>` : ""}
      ${t.common && t.common !== tr ? `<div class="fam">Diğer adı: ${esc(t.common)}</div>` : ""}</div>
    <div><span class="badge ${c[1]}">${c[0]}</span>${e.genus ? ` <span class="hint">cins düzeyinde bilgi</span>` : ""}</div>
    ${e.note ? `<div class="note">${esc(e.note)}</div>` : ""}
    <dl class="meta">
      <dt>Seçili yerde</dt><dd>${t.count >= 1 ? t.count + " doğrulanmış gözlem" : "yerel gözlem yok"}</dd>
      <dt>Bu foto</dt><dd>${esc(p.place || "konum gizli")}${p.date ? " · " + esc(p.date) : ""}</dd>
      <dt>Senin karnen</dt><dd>${st.c} doğru · ${st.w} yanlış</dd>
    </dl>
    <div class="wiki" id="wiki">Açıklama yükleniyor…</div>
    <div class="links">
      <a href="https://www.inaturalist.org/taxa/${t.id}" target="_blank" rel="noopener">iNaturalist</a>
      <a id="wikiLink" href="https://tr.wikipedia.org/wiki/${encodeURIComponent(t.name.replace(/ /g, "_"))}" target="_blank" rel="noopener">Wikipedia</a>
      <a href="https://www.inaturalist.org/observations?taxon_id=${t.id}&place_id=${S.placeQuery}" target="_blank" rel="noopener">Haritada gözlemler</a>
    </div>`;
  els.label.hidden = false;
  els.flipbar.hidden = true;
  try {
    const sum = await taxonSummary(t.id);
    const w = $("wiki");
    if (!w || S.current !== t) return;
    w.textContent = sum ? sum.text : "Wikipedia özeti yok.";
    if (sum && sum.url) $("wikiLink").href = sum.url;
  } catch {
    const w = $("wiki");
    if (w) w.textContent = navigator.onLine ? "Açıklama alınamadı." : "Açıklama çevrimdışı önbellekte yok.";
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

/* ---------- Kontroller ---------- */
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
  if (S.species.length < 4) return setStatus("Bu filtrede yeterli tür yok.");
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
  els.sc.textContent = "0/0";
  els.streak.textContent = "seri 0";
};

els.nextBtn.onclick = () => nextCard();
els.another.onclick = () => showPhoto(S.current);
$("reveal").onclick = () => {
  S.answered = true;
  els.flipbar.hidden = true;
  els.selfgrade.hidden = false;
  showLabel();
};
$("gotRight").onclick = () => grade(true);
$("gotWrong").onclick = () => grade(false);
function grade(right) {
  record(right);
  els.selfgrade.hidden = true;
  nextCard();
}

els.photo.onclick = () => {
  $("zoomImg").src = els.photo.src;
  $("zoom").hidden = false;
};
$("zoom").onclick = () => ($("zoom").hidden = true);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") $("zoom").hidden = true;
  if (S.mode === "mc" && !S.answered && /^[1-4]$/.test(e.key)) {
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
