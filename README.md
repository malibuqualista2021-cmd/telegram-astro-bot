# Telegram doğum haritası botu (MVP)

Doğum tarihi, yer ve (isteğe bağlı) saat toplar; haritayı **circular-natal-horoscope-js** (tropical, Placidus) ile hesaplar; ardından **OpenAI** ile veya API anahtarı yoksa **yerleşik şablonla** Türkçe kişisel yorum üretir.

## Gereksinimler

- Node.js **18+** (global `fetch` için)

## Kurulum

```bash
cd telegram-astro-bot
npm install
copy .env.example .env
```

`.env` içinde en az **`BOT_TOKEN`** olmalı (Telegram [@BotFather](https://t.me/BotFather)).

İsteğe bağlı:

- **`OPENAI_API_KEY`** — yoksa yorum yine çalışır (şablon modu).
- **`OPENAI_MODEL`** — varsayılan `gpt-4o-mini`.
- **`GEOCODE_USER_AGENT`** — OpenStreetMap Nominatim için tanımlayıcı (politika gereği anlamlı bir değer verin).
- **`PORT`** — varsayılan `3000`.

## Çalıştırma

```bash
npm start
```

- Telegram bot **long polling** ile ayağa kalkar.
- `http://localhost:PORT/health` adresinde basit sağlık kontrolü vardır.

## Dosya yapısı

| Dosya | Görev |
|--------|--------|
| `index.js` | Express + Telegraf akışı |
| `services/chartCalculator.js` | Harita hesaplama (AI yapmaz) |
| `services/interpretationService.js` | Yorum metni (OpenAI veya yedek şablon) |
| `services/sessionStore.js` | Bellek içi oturum |

## Notlar (MVP)

- Doğum yeri metni **Nominatim** ile koordinata çevrilir; ağ erişimi gerekir.
- Saat bilinmiyorsa harita **kısmi** moddadır: yükselen ve evler JSON’da yoktur; gezegen burçları için yerel **12:00** kullanılır (kütüphane timezone’u koordinattan türetir).
- Oturum verisi bellekte tutulur; sunucu yeniden başlayınca sıfırlanır.

## GitHub ve Railway ile canlıya alma

### 1) GitHub deposu

Proje kökünde (bu klasörde):

```bash
git init
git add .
git commit -m "Initial MVP: Telegram astro bot"
```

**Seçenek A — GitHub CLI (`gh`)**

```bash
gh auth login
gh repo create telegram-astro-bot --public --source=. --remote=origin --push
```

Depo adını değiştirmek istersen `telegram-astro-bot` yerine kendi adını yaz.

**Seçenek B — Web arayüzü**

1. [GitHub](https://github.com/new) üzerinden yeni repo oluştur (boş, README ekleme).
2. Aşağıdaki komutlarda `KULLANICI` ve `REPO` kısımlarını kendi hesabınla değiştir:

```bash
git remote add origin https://github.com/KULLANICI/REPO.git
git branch -M main
git push -u origin main
```

### 2) Railway

1. [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo** → bu repoyu seç.
2. **Variables** (ortam değişkenleri) ekle:

| Değişken | Zorunlu | Açıklama |
|----------|---------|----------|
| `BOT_TOKEN` | Evet | Telegram bot token |
| `OPENAI_API_KEY` | Hayır | Yorum için OpenAI |
| `OPENAI_MODEL` | Hayır | Örn. `gpt-4o-mini` |
| `GEOCODE_USER_AGENT` | Önerilir | Nominatim için; örn. `MyAstroBot/1.0 (github.com/kullanici/repo)` |
| `PORT` | Hayır | Railway genelde otomatik verir; yoksa uygulama 3000 kullanır |

3. **Deploy**: `npm start` ile süreç ayağa kalkar (Railway `PORT` atar; sunucu `0.0.0.0` üzerinde dinler).
4. **Sağlık kontrolü**: Railway sana verdiği alan adında `https://<domain>/health` → `{"ok":true,...}` görmelisin.

Bu MVP **long polling** kullanır; ayrıca webhook URL’i tanımlaman gerekmez. Tek servis/replica kullan (aynı `BOT_TOKEN` ile iki yerden polling yapma).

## Lisans

MIT
