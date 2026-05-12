# Telegram doğum haritası botu (MVP)

GitHub: [malibuqualista2021-cmd/telegram-astro-bot](https://github.com/malibuqualista2021-cmd/telegram-astro-bot)

Doğum tarihi, yer ve (isteğe bağlı) saat toplar; haritayı **circular-natal-horoscope-js** (tropical, Placidus) ile hesaplar; metin yorumunu **Groq** (Llama) ile üretir. `/start` sonrası menüye ek olarak **serbest astroloji sorusu** yazılabilir: mesaj `messageClassifier` ile ayrılır (`general_astro_knowledge`, `personal_chart_question`, `unsupported_transit_or_future`, `risky_question`, `normal_flow`). Genel kavramlarda önce **`astroKnowledgeService`** içindeki sözlük katmanı, gerekirse Groq tamamlayıcı kullanılır.

## Gereksinimler

- Node.js **18+** (global `fetch` için)

## Groq API key

1. [Groq Console](https://console.groq.com/) hesabı aç veya giriş yap.
2. **API Keys** bölümünden yeni anahtar oluştur.
3. Yerelde `.env` içine `GROQ_API_KEY=...` yaz; Railway’de **Variables** olarak aynı isimle ekle.

Varsayılan model: **`llama-3.3-70b-versatile`**. İstersen `GROQ_MODEL` ile değiştirebilirsin (Groq’un desteklediği bir model adı olmalı).

## Kurulum

```bash
cd telegram-astro-bot
npm install
copy .env.example .env
```

`.env` içinde **zorunlu** değişkenler (örnek için `.env.example` dosyasına bak):

- **`BOT_TOKEN`** — Telegram [@BotFather](https://t.me/BotFather)
- **`GROQ_API_KEY`** — [Groq Console](https://console.groq.com/keys)

İsteğe bağlı:

- **`GROQ_MODEL`** — varsayılan `llama-3.3-70b-versatile`
- **`PORT`** — yoksa **3000** kullanılır (Railway genelde `PORT` tanımlar)
- **`GEOCODE_USER_AGENT`** — OpenStreetMap Nominatim için tanımlayıcı (politika gereği anlamlı bir değer verin)

## Çalıştırma

```bash
npm start
```

- Telegram bot **long polling** ile ayağa kalkar.
- `http://localhost:PORT/` ve `http://localhost:PORT/health` düz metin: `Astrology bot is running`

## Dosya yapısı

| Dosya | Görev |
|--------|--------|
| `config/env.js` | `.env` doğrulama (`BOT_TOKEN`, `GROQ_API_KEY`; `PORT` varsayılan 3000) |
| `index.js` | Express + Telegraf akışı, hata yakalama |
| `services/logger.js` | Yapılandırılmış konsol logları |
| `services/chartCalculator.js` | Harita hesaplama (LLM yapmaz) |
| `services/interpretationService.js` | Groq: konu yorumu, serbest kişisel soru, kavram (astroKnowledge’e delege) |
| `services/astroKnowledgeService.js` | Kavram sözlüğü (gezegen, burç, ev, açı, retro, ASC, MC, element, nitelik) + genel cevap |
| `services/messageClassifier.js` | Serbest metin sınıflandırması (general / personal / unsupported / risky / normal_flow) |
| `services/sessionStore.js` | Bellek içi oturum; son harita `lastChartData` ile sohbet |
| `services/userProfileStore.js` | Telegram `userId` ile doğum profili ve son `chartData` (MVP: bellek) |

## Notlar (MVP)

- Doğum yeri metni **Nominatim** ile koordinata çevrilir; ağ erişimi gerekir.
- Saat bilinmiyorsa harita **kısmi** moddadır: yükselen ve evler JSON’da yoktur; gezegen burçları için yerel **12:00** kullanılır (kütüphane timezone’u koordinattan türetir).
- Oturum verisi bellekte tutulur; sunucu yeniden başlayınca sıfırlanır.
- **Kullanıcı profili (doğum bilgisi):** Bu MVP sürümde profiller `userProfileStore` ile bellekte tutulur. **Railway veya süreç yeniden başlarsa kayıtlar silinebilir.** Üretim için PostgreSQL, Redis veya Supabase gibi kalıcı depolama önerilir. `/reset` komutu profili bilinçli olarak siler.
- Groq veya ağ hatalarında kullanıcıya kısa bir hata mesajı gösterilir; ayrıntılar **Railway / sunucu loglarında** `logger` ile yazılır.

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
| `BOT_TOKEN` | Evet | Telegram bot token |
| `GROQ_API_KEY` | Evet | Groq API anahtarı ([console](https://console.groq.com/keys)) |
| `GROQ_MODEL` | Hayır | Varsayılan: `llama-3.3-70b-versatile` |
| `GEOCODE_USER_AGENT` | Önerilir | Nominatim için; örn. `MyAstroBot/1.0 (github.com/kullanici/repo)` |
| `PORT` | Hayır | Railway genelde otomatik verir; tanımlı değilse uygulama **3000** kullanır |

3. **Deploy**: `npm start` ile süreç ayağa kalkar (Railway `PORT` atar; sunucu `0.0.0.0` üzerinde dinler).
4. **Sağlık kontrolü**: `https://<domain>/` veya `/health` → düz metin: `Astrology bot is running`
5. **Loglar**: Railway **Deployments → View Logs**; Groq hatalarında `HTTP status`, `mesaj` ve stack izleri görünür.

Bu MVP **long polling** kullanır; webhook gerekmez. Tek servis/replica kullan (aynı `BOT_TOKEN` ile iki yerden polling yapma).

## Lisans

MIT
