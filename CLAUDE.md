# Mantar Kartları

Türkiye'deki mantar türlerini gerçek gözlem fotoğraflarıyla öğreten flash kart PWA'sı.
Fotoğraflar, gözlem sayıları ve Wikipedia özetleri çalışma anında iNaturalist API v1'den gelir.

## Yapı

Build adımı yok: düz ES modülleri, statik dosyalar. Doğrudan GitHub Pages'ten servis edilir.

```
index.html            işaretleme, meta, manifest/ikon bağlantıları
styles.css            tüm stil; renkler :root token'larında (açık + koyu tema)
manifest.webmanifest  PWA manifesti
sw.js                 service worker (shell / api / img önbellekleri)
src/app.js            durum, kart akışı, ağırlıklı seçim, UI olayları, SW kaydı
src/inat.js           iNaturalist istemcisi (api, yer çözümleme, tür sayıları, foto, özet)
src/regions.js        81 il → 7 bölge; ALIASES: iNat'ta farklı adla geçebilen iller
src/edibility.js      elle yazılmış yenilebilirlik notları (tür + cins düzeyi)
src/store.js          localStorage sarmalayıcı ("mk:" önekli)
icons/                PWA ikonları (Pillow ile üretildi)
```

## Çalıştırma

```
python3 -m http.server 8080      # ya da: npx serve .
```
Service worker yalnızca https veya localhost'ta çalışır. `file://` ile açma.

## Kurallar

- **sw.js'teki `VERSION`'ı artır** — shell dosyalarından herhangi birini değiştirdiğinde. Yeni dosya eklersen `SHELL_FILES`'a da ekle. Yoksa kullanıcılar eski sürümde kalır.
- **Yenilebilirlik verisi güvenlik açısından kritik.** `src/edibility.js`'e tür eklerken veya değiştirirken emin olmadığın bilgiyi yazma; şüphede `dikkat` kategorisini kullan. Bir türü asla zehirli benzeri olduğu halde düz `yenir` olarak işaretleme. Sayfadaki "toplama kararı için kullanma" uyarısı kalmalı.
- **Fotoğraf atfı zorunlu.** iNaturalist fotoğrafları CC lisanslı; her gösterilen fotoğrafın altında `attribution` metni ve gözlem linki bulunmalı. `photo_licensed=true` filtresini kaldırma.
- **iNaturalist API nezaketi:** dakikada ~60 istek sınırı var. `inat.js`'teki bellek içi önbelleği ve 429 geri çekilmesini koru; döngü içinde paralel istek patlatma. Bölge seçimi illeri sırayla çözer ve sonucu `localStorage`'da (`mk:placeIds`) tutar.
- **Yalnızca büyük mantarlar.** Tür listesi `inat.js`'teki `MACRO_TAXA` sınıflarıyla (Agaricomycetes, Pezizomycetes, Dacrymycetes) sınırlı. `iconic_taxa=Fungi`'ye dönme: likenler, pas ve külleme mantarları gelir.
- Kullanıcıya görünen tüm metinler Türkçe.
- Renkleri doğrudan bileşen kurallarına yazma; `:root` token'larını kullan, koyu temada da tanımla.

## Ağırlıklı seçim

`weight = max(count, 0.5) ^ (alpha/100) × srs`
- `count`: seçili yerdeki araştırma düzeyi gözlem sayısı (Türkiye genelinden tamamlanan türlerde 0.5)
- `srs = max(0.3, (1 + 1.5·yanlış) / (1 + 0.6·doğru))` — yanlış bilinen tür daha sık gelir
- Son birkaç tür tekrar sorulmaz (`S.recent`).

## Bilinen açık konular / fikirler

- iNat yer kimliği 7183'ün Türkiye olduğu varsayılıyor; `resolveTurkey()` doğrulayıp gerekirse adla arıyor.
- İl eşleştirme `places/autocomplete` + `admin_level === 10` ile yapılıyor; canlı API'de doğrulanmadı. Eşleşmeyen il olursa `ALIASES`'a ekle.
- Mevsim filtresi (gözlem ayına göre: "bu ay görülenler") eklenebilir: `species_counts` `month=` parametresini destekler.
- Çevrimdışı kalıcı deste: seçilen yerin N türünü ve her birinden birkaç fotoğrafı tek tuşla önbelleğe indirme.
