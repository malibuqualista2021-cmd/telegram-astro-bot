# Telegram doğum haritası botu (MVP)

GitHub: [malibuqualista2021-cmd/telegram-astro-bot](https://github.com/malibuqualista2021-cmd/telegram-astro-bot)

Doğum tarihi, yer ve (isteğe bağlı) saat toplar; haritayı **circular-natal-horoscope-js** (tropical, Placidus) ile hesaplar; yorumu **OpenAI** ile üretir.

## Gereksinimler

- Node.js **18+** (global `fetch` için)

## Kurulum

```bash
cd telegram-astro-bot
npm install
copy .env.example .env
```

`.env` içinde **zorunlu** değişkenler:

- **`BOT_TOKEN`** — Telegram [@BotFather](https://t.me/BotFather)
- **`OPENAI_API_KEY`** — yorum metni için

İsteğe bağlı:

- **`OPENAI_MODEL`** — varsayılan `gpt-4o-mini`.
- **`PORT`** — yoksa **3000** kullanılır (Railway genelde `PORT` tanımlar).
- **`GEOCODE_USER_AGENT`** — OpenStreetMap Nominatim için tanımlayıcı (politika gereği anlamlı bir değer verin).

## Çalıştırma

```bash
npm start
```

- Telegram bot **long polling** ile ayağa kalkar.
- `http://localhost:PORT/` ve `http://localhost:PORT/health` düz metin: `Astrology bot is running`

## Dosya yapısı

| Dosya | Görev |
|--------|--------|
| `config/env.js` | `.env` doğrulama (`BOT_TOKEN`, `OPENAI_API_KEY`; `PORT` varsayılan 3000) |
| `index.js` | Express + Telegraf akışı, hata yakalama |
| `services/logger.js` | Yapılandırılmış konsol logları |
| `services/chartCalculator.js` | Harita hesaplama (AI yapmaz) |
| `services/interpretationService.js` | OpenAI yorum metni |
| `services/sessionStore.js` | Bellek içi oturum |

## Notlar (MVP)

- Doğum yeri metni **Nominatim** ile koordinata çevrilir; ağ erişimi gerekir.
- Saat bilinmiyorsa harita **kısmi** moddadır: yükselen ve evler JSON’da yoktur; gezegen burçları için yerel **12:00** kullanılır (kütüphane timezone’u koordinattan türetir).
- Oturum verisi bellekte tutulur; sunucu yeniden başlayınca sıfırlanır.

## GitHub ve Railway ile canlıya alma

### 1) GitHub deposu

Bu proje şu depoda tutuluyor: **https://github.com/malibuqualista2021-cmd/telegram-astro-bot** (`main`).

Yerel değişiklikleri göndermek için:

```bash
git add .
git commit -m "mesajın"
git push origin main
```

**Tamamen yeni bir depo** açmak istersen (ör. farklı isim veya hesap):

```bash
gh auth login
gh repo create YENI-REPO-ADI --public --source=. --remote=yeni --push
```

Sonra `git remote remove origin` ve `git remote rename yeni origin` gibi adımlarla tek `origin` kullanabilirsin; ya da Railway’de yeni repoyu bağlarsın.

### 2) Railway

1. [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo** → bu repoyu seç.
2. **Variables** (ortam değişkenleri) ekle:

| Değişken | Zorunlu | Açıklama |
|----------|---------|----------|
| `BOT_TOKEN` | Evet | Telegram bot token (eski Python servisinde `TELEGRAM_BOT_TOKEN` kullandıysan Railway’de adı **`BOT_TOKEN`** olacak şekilde güncelle) |
| `OPENAI_API_KEY` | Evet | Yorum üretimi (OpenAI) |
| `OPENAI_MODEL` | Hayır | Örn. `gpt-4o-mini` |
| `GEOCODE_USER_AGENT` | Önerilir | Nominatim için; örn. `MyAstroBot/1.0 (github.com/kullanici/repo)` |
| `PORT` | Hayır | Railway genelde otomatik verir; tanımlı değilse uygulama **3000** kullanır |

3. **Deploy**: `npm start` ile süreç ayağa kalkar (Railway `PORT` atar; sunucu `0.0.0.0` üzerinde dinler).
4. **Sağlık kontrolü**: `https://<domain>/` veya `/health` → düz metin: `Astrology bot is running`

Bu MVP **long polling** kullanır; ayrıca webhook URL’i tanımlaman gerekmez. Tek servis/replica kullan (aynı `BOT_TOKEN` ile iki yerden polling yapma).

## Lisans

MIT
