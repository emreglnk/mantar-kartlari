# Mantar Kartları

Türkiye'deki mantar türlerini gerçek fotoğraflarla öğrenmek için flash kart uygulaması (PWA).

- Fotoğraflar ve gözlem sayıları [iNaturalist](https://www.inaturalist.org)'in araştırma düzeyindeki, lisanslı gözlemlerinden gelir. Her kartta türün farklı gözlemlerinden 10'a kadar fotoğraf kaydırılarak görülebilir.
- Yalnızca gözle görülen büyük mantarlar (şapkalılar, boletler, raf ve puf mantarları, kuzugöbekleri vb.); likenler, pas ve külleme mantarları yok.
- İl veya bölge seçilebilir; sorular o yerde çok gözlenen türlere ağırlık verir.
- Çoktan seçmeli ve kart çevirme modları, yanlış bilinen türleri daha sık soran tekrar sistemi.
- Ana ekrana yüklenebilir; görülen türler ve fotoğraflar çevrimdışı da açılır.

> **Toplama kararı için kullanma.** Fotoğraftan mantar teşhisi güvenilir değildir. Toplanan mantarı uzman birine elden gösterin.

## Yerel çalıştırma

```
python3 -m http.server 8080
```
Sonra http://localhost:8080 adresini aç.

## Yayın

`main` dalına her push'ta `.github/workflows/pages.yml` siteyi GitHub Pages'e yükler.
Depo ayarlarında **Settings → Pages → Source: GitHub Actions** seçili olmalı.

## Lisanslar

Fotoğrafların lisansı ve sahibi her fotoğrafın altında gösterilir. Wikipedia özetleri CC BY-SA.
