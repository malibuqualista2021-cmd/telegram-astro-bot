# Telegram Astroloji Asistanı

`python-telegram-bot` ile çalışan, yerel bilgi tabanı + **LLM** (OpenAI, **Groq** veya **Google Gemini**) ile desteklenen genel astroloji bilgisi botu. OpenAI hesabı zorunlu değildir.

## Özellikler (özet)

- **Komutlar:** `/start`, `/help`, `/menu`, `/lang`, `/profil`, `/dogum`, `/saat`, `/konum`, `/harita`, `/sss`, `/burclar`, `/hakkinda`
- **Kişisel profil:** doğum tarihi/saati ve konum (enlem/boylam); LLM yanıtlarına yumuşak bağlam olarak eklenir
- **Eğitim amaçlı harita özeti:** Mümkünse **Swiss Ephemeris** (`pyswisseph`), yoksa `ephem` ile Güneş/Ay/Yükselen (yaklaşık; `/harita`)
- **Niyet:** bilgi / günlük-fal tarzı / şaka — yanıt tonu için ipuçları
- **Özet hafıza:** uzun sohbette eski kısım LLM ile özetlenir (`MEMORY_SUMMARIZE_AT_MSGS`)
- **Dil:** `/lang tr` veya `/lang en` — bot metinleri + LLM çıktısı dili
- **Inline menü:** SSS kategorileri, burç listesi, yardım, hakkında (düğmelerle gezinme)
- **Serbest metin:** Önce `knowledge/faq.json` (alt dize + **rapidfuzz** bulanık eşleşme), yoksa seçilen LLM
- **Sohbet üslubu (komutsuz):** Düz yazıyla örn. «sadece bilgi», «sohbet gibi», «günlük fal tarzı», «haritama göre», «horary» / «saat astrolojisi» — kalıcı mod; özel sohbette `chat_mode` veritabanında saklanır
- **Horary (eğitim):** «horary» modundayken her LLM yanıtında sorunun sorulduğu Telegram mesajının UTC zamanı + konum (`/konum` veya varsayılan) ile anlık harita özeti modele eklenir; otomatik klasik horary hükümü yok
- **Bağlam:** Son birkaç tur sohbet modele özet bağlam olarak gider (`CONVERSATION_MAX_TURNS`)
- **Spam önleme:** Sohbet başına dakikalık hız sınırı (`RATE_LIMIT_PER_MINUTE`)
- **UX:** Yanıt üretilirken “yazıyor…” göstergesi
- **Güvenlik çerçevesi:** Sistem + kullanıcı notu ile tıbbi/hukuki/finansal yönlendirme yok; emin olunmayan konularda çekingenlik
- **Loglama:** Konsol + yedeklemeli günlük dosyası (`logs/astro_bot.log`)
- **Uçtan uca çalışma:** **Long polling** (Railway veya kendi sunucunda süreç olarak çalışır; ayrı web sunucusu gerekmez)
- **Kalıcı veri (özel sohbet):** `data/bot_state.db` (SQLite) veya **`DATABASE_URL`** ile PostgreSQL — dil, profil, sohbet özeti; süreç yeniden başlasa da kalır (Railway’de kalıcılık için Postgres önerilir)
- **Özel sohbet:** Serbest metin (SSS → LLM) birebir sohbette her mesajda
- **Gruplar:** Metinle yanıt yalnızca mesajda **`@botkullaniciadi`** geçtiğinde (mention sonrası kalan metin işlenir; maliyet kontrolü)
- **Geri bildirim:** LLM yanıtının altında 👍/👎 — kayıt `data/analytics.db` (SQLite)
- **SSS çevirisi:** `faq.json` içinde `answer_en` — `/lang en` iken kullanılır
- **Girdi sınırı:** `MAX_USER_MESSAGE_CHARS` ile mesaj kırpma (token/maliyet)
- **İzleme:** İsteğe bağlı **`SENTRY_DSN`**

## GitHub’a gönderme

1. [GitHub](https://github.com/new) üzerinde **yeni boş bir repository** oluştur (README ekleme).
2. Bilgisayarda proje klasöründe:

```powershell
cd c:\Users\malib\telegram-astro-bot
git init
git add .
git commit -m "Initial commit: Telegram astroloji bot"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADIN/REPO_ADI.git
git push -u origin main
```

`KULLANICI_ADIN/REPO_ADI` kısmını kendi repo adresinle değiştir. İlk kez `git` kullanıyorsan `git config --global user.name` ve `user.email` ayarlaman istenebilir.

**.env dosyasını asla commit etme** — `.gitignore` içinde; token’lar sadece Railway’de (veya yerelde) ortam değişkeni olarak kalır.

## Railway’de çalıştırma

1. [Railway](https://railway.app) → **New Project** → **Deploy from GitHub repo** → bu repoyu seç.
2. **Variables** bölümüne ekle:
   - `TELEGRAM_BOT_TOKEN` (zorunlu)
   - LLM anahtarı (**en az biri**): `GROQ_API_KEY` (ücretsiz katman: [Groq](https://console.groq.com/keys)), veya `OPENAI_API_KEY`, veya `GEMINI_API_KEY` / `GOOGLE_API_KEY`
   - **Kalıcılık için önerilir:** Railway **PostgreSQL** ekle → `DATABASE_URL` otomatik gelir (profil/sohbet diskte kalır; yalnızca SQLite + geçici disk kullanırsan redeploy’da silinebilir)
   - İsteğe bağlı: `LLM_PROVIDER`, `LLM_MODEL`, `SENTRY_DSN`, `LOG_LEVEL`, vb. (`.env.example`)
3. Deploy ayarında başlangıç komutu repodaki `railway.toml` ile **`python -m astro_bot`** olarak ayarlanır; farklı bir şey yazma.
4. Deploy tamamlanınca loglarda `Polling başlatılıyor` benzeri satırları görmelisin; Telegram’da bota yazarak dene.

**Not:** Railway arayüzünde servis türü “web” gibi HTTP bekleyen bir şablon seçtiysen ve deploy takılıyorsa, bu proje **HTTP sunucusu açmaz**; uzun süre çalışan **tek süreç** (worker) olarak düşün. Gerekirse Railway dokümantasyonundan “custom start command / background worker” benzeri kuruluma bak.

## Kurulum (yerel)

1. Python 3.10+ önerilir.

2. Sanal ortam (isteğe bağlı):

```bash
python -m venv .venv
```

Windows (PowerShell):

```powershell
.\.venv\Scripts\Activate.ps1
```

3. Bağımlılıklar:

```bash
pip install -r requirements.txt
```

4. `.env` — `.env.example` dosyasını kopyalayıp doldurun:

```powershell
copy .env.example .env
```

- `TELEGRAM_BOT_TOKEN`: [@BotFather](https://t.me/BotFather)
- LLM: `GROQ_API_KEY` ([Groq](https://console.groq.com/keys)) veya `OPENAI_API_KEY` veya `GEMINI_API_KEY` — ayrıntılar `.env.example`
- İsteğe bağlı: `LLM_PROVIDER`, `LLM_MODEL`, `LOG_LEVEL`, `OPENAI_MAX_TOKENS`, `OPENAI_TEMPERATURE`, `FAQ_FUZZY_THRESHOLD`, `RATE_LIMIT_PER_MINUTE`, `CONVERSATION_MAX_TURNS`

## Çalıştırma

Proje kökünden:

```bash
python -m astro_bot
```

## Proje yapısı

```
telegram-astro-bot/
├── astro_bot/
│   ├── __main__.py
│   ├── main.py
│   ├── config.py
│   ├── settings.py
│   ├── i18n.py
│   ├── handlers/
│   │   ├── commands.py
│   │   ├── callbacks.py
│   │   ├── keyboards.py
│   │   ├── persistence.py
│   │   └── messages.py
│   └── services/
│       ├── faq_service.py
│       ├── llm_service.py
│       ├── profile_service.py
│       ├── chart_service.py
│       ├── horary_service.py
│       ├── intent_service.py
│       ├── memory_service.py
│       ├── feedback_store.py
│       └── rate_limit.py
├── knowledge/
│   └── faq.json
├── logs/                 # çalışınca oluşur (.gitignore)
├── .env.example
├── railway.toml
├── Procfile
├── requirements.txt
└── README.md
```

## Bilgi tabanı (`faq.json`)

İki biçim desteklenir:

1. **Dizi:** `[{ "id", "triggers", "answer", ... }, ...]`
2. **Nesne:** `{ "meta": { "categories": { "kategori_kodu": "Görünen ad" } }, "entries": [ ... ] }`

Her kayıt için önerilen alanlar:

- `id`, `category`, `title`, `triggers`, `answer`, isteğe bağlı `answer_en` (İngilizce SSS)

## Notlar

- Bu bot yalnızca genel astroloji / kültürel bilgi amaçlıdır; profesyonel danışmanlık yerine geçmez.
- Kullandığın LLM sağlayıcısının ve Telegram’ın kullanım limitleri / ücretleri geçerlidir.
