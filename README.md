# Telegram Astroloji Asistanı

`python-telegram-bot` ile çalışan, yerel bilgi tabanı + **LLM** (OpenAI, **Groq** veya **Google Gemini**) ile desteklenen genel astroloji bilgisi botu. OpenAI hesabı zorunlu değildir.

## Özellikler (özet)

- **Komutlar:** `/start`, `/help`, `/menu`, `/sss`, `/burclar`, `/hakkinda`
- **Inline menü:** SSS kategorileri, burç listesi, yardım, hakkında (düğmelerle gezinme)
- **Serbest metin:** Önce `knowledge/faq.json` (alt dize + **rapidfuzz** bulanık eşleşme), yoksa seçilen LLM
- **Bağlam:** Son birkaç tur sohbet modele özet bağlam olarak gider (`CONVERSATION_MAX_TURNS`)
- **Spam önleme:** Sohbet başına dakikalık hız sınırı (`RATE_LIMIT_PER_MINUTE`)
- **UX:** Yanıt üretilirken “yazıyor…” göstergesi
- **Güvenlik çerçevesi:** Sistem + kullanıcı notu ile tıbbi/hukuki/finansal yönlendirme yok; emin olunmayan konularda çekingenlik
- **Loglama:** Konsol + yedeklemeli günlük dosyası (`logs/astro_bot.log`)
- **Uçtan uca çalışma:** **Long polling** (Railway veya kendi sunucunda süreç olarak çalışır; ayrı web sunucusu gerekmez)

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
   - İsteğe bağlı: `LLM_PROVIDER` (`openai` \| `groq` \| `gemini`), `LLM_MODEL`, `LOG_LEVEL`, vb. (`.env.example`)
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
│   ├── texts.py
│   ├── handlers/
│   │   ├── commands.py
│   │   ├── callbacks.py
│   │   ├── keyboards.py
│   │   └── messages.py
│   └── services/
│       ├── faq_service.py
│       ├── llm_service.py
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

- `id`, `category`, `title`, `triggers`, `answer`

## Notlar

- Bu bot yalnızca genel astroloji / kültürel bilgi amaçlıdır; profesyonel danışmanlık yerine geçmez.
- Kullandığın LLM sağlayıcısının ve Telegram’ın kullanım limitleri / ücretleri geçerlidir.
