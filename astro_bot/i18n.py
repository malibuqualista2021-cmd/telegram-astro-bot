"""TR / EN bot metinleri."""

from __future__ import annotations

from typing import Literal

Lang = Literal["tr", "en"]


def get_lang(code: str | None) -> Lang:
    c = (code or "tr").strip().lower()
    return "en" if c.startswith("en") else "tr"


MESSAGES: dict[str, dict[str, str]] = {
    "tr": {
        "start": (
            "<b>Merhaba!</b> Astroloji odaklı sohbet arkadaşın burada: doğum haritası, aşk, ilişki, kariyer, ruh hali "
            "veya dönem enerjileri için yanınızdayım.\n\n"
            "<b>Doğum tarihi</b>, mümkünse <b>saat</b> ve <b>yer</b> yazman yeterli; saat yoksa yine yorum yaparım, "
            "yükselen ve evler daha genel kalabilir.\n\n"
            "<b>Kısayol:</b> /dogum /saat /konum — /harita natal özet; /finans finans astrolojisi (sembolik, yatırım tavsiyesi değil). "
            "/hatirla /notlarim /notlartemizle — bot seni dinlesin.\n\n"
            "Dil: /lang tr veya /lang en — Menüyü kullan veya doğrudan sorunu yaz."
        ),
        "help": (
            "<b>Komutlar</b>\n"
            "/start — Karşılama ve menü\n"
            "/menu — Ana menü\n"
            "/help — Bu yardım\n"
            "/lang tr|en — Dil\n"
            "/profil — Kayıtlı doğum bilgisi\n"
            "/dogum YYYY-MM-DD — Doğum tarihi\n"
            "/saat HH:MM — Doğum saati (isteğe bağlı)\n"
            "/konum enlem boylam — Örn: 41.01 28.98 (varsayılan İstanbul). Yükselen için doğum şehrinin koordinatı şart; Adana örn. 37.00 35.32\n"
            "/harita — Natal özet (Swiss Ephemeris: gezegenler, evler, açı örnekleri)\n"
            "/finans — Finans astrolojisi özeti (2/8/11 ev, Venüs–Jüpiter–Satürn; sembolik)\n"
            "/hatirla … veya hatırla: … — Tercih/düzeltme kaydet\n"
            "/notlarim — Kayıtlı notlar\n"
            "/notlartemizle — Notları sil\n"
            "/pdogum /psaat /pkonum /ptz — Partner haritası (sinastri)\n"
            "/sinastri — Çapraz açı listesi\n"
            "/psil — Partner verisini sil\n"
            "/sil — Tüm doğum/sohbet/not verisini sil (dil kalır)\n"
            "/stil klasik|psikolojik|populer|dengeli — Yorum üslubu\n"
            "/evsistemi placidus|whole|equal|koch|… — Ev sistemi\n"
            "/sss — SSS\n"
            "/burclar — 12 burç tarihleri\n"
            "/hakkinda — Sorumluluk reddi\n\n"
            "Serbest metin: önce SSS, sonra LLM. Profil doluysa yanıtlar bağlama eklenir.\n"
            "Üslup: düz yazıyla iste (ör. «sadece bilgi», «sohbet gibi», «günlük fal tarzı», «haritama göre», «horary» / «saat astrolojisi») — ayrı komut yok.\n\n"
            "<b>Önemli</b>\n"
            "• Genel bilgi; kesin kehanet yok.\n"
            "• Tıbbi/hukuki/finansal tavsiye yok.\n"
        ),
        "menu": "<b>Ana menü</b>\n\nKısayol seç veya mesaj yaz.",
        "rate_limit": "Çok hızlı mesaj gönderiyorsun. Kısa süre sonra tekrar dene.",
        "profil_empty": "Henüz doğum bilgisi yok. Örnek:\n/dogum 1995-07-21\n/saat 14:30\n/konum 41.01 28.98",
        "profil_ok": "<b>Profil</b>\n",
        "lang_ok": "Dil: Türkçe",
        "dogum_ok": "Doğum tarihi kaydedildi: {d}",
        "dogum_bad": "Kullanım: /dogum YYYY-MM-DD veya /dogum 21.07.1995",
        "saat_ok": "Doğum saati kaydedildi: {t}",
        "saat_bad": "Kullanım: /saat 14:30",
        "konum_ok": "Konum kaydedildi: {lat}, {lon}",
        "konum_bad": "Kullanım: /konum 41.0082 28.9784 (enlem boylam, ondalık)",
        "chart_need_date": "Önce /dogum ile tarih gir.",
        "about": (
            "<b>Astroloji asistanı</b>\n"
            "Eğlence ve genel kültür amaçlıdır. /harita Swiss Ephemeris (veya yedek ephem) ile hesaplanır; "
            "profesyonel danışmanlık yerine geçmez.\n\n"
            "<b>Veri</b>\n"
            "• Profil, partner, notlar ve üslup tercihin sunucuda (SQLite/Postgres) saklanabilir.\n"
            "• Sohbet özeti ve yerel bilgi dosyalarından kesitler LLM’e gidebilir.\n"
            "• /sil ile profil, partner, notlar, üslup ve sohbet özeti silinir (dil kalır).\n\n"
            "Telegram ve LLM sağlayıcısı gizlilik politikalarına da bak."
        ),
        "burclar": (
            "<b>12 burç</b> (yaklaşık Güneş tarihleri)\n\n"
            "♈ Koç — 21 Mar – 19 Nis\n♉ Boğa — 20 Nis – 20 May\n"
            "♊ İkizler — 21 May – 20 Haz\n♋ Yengeç — 21 Haz – 22 Tem\n"
            "♌ Aslan — 23 Tem – 22 Ağu\n♍ Başak — 23 Ağu – 22 Eyl\n"
            "♎ Terazi — 23 Eyl – 22 Eki\n♏ Akrep — 23 Eki – 21 Kas\n"
            "♐ Yay — 22 Kas – 21 Ara\n♑ Oğlak — 22 Ara – 19 Oca\n"
            "♒ Kova — 20 Oca – 18 Şub\n♓ Balık — 19 Şub – 20 Mar"
        ),
        "hatirla_usage": (
            "Kullanım: /hatirla Daha kısa ve net yaz\n"
            "veya mesajda: hatırla: astrolojiyi popüler dille anlat"
        ),
        "hatirla_ok": "Kaydedildi. Sonraki yanıtlarda bu tercihi dikkate alacağım.",
        "hatirla_bad": "Not boş olamaz.",
        "notlar_cleared": "Tüm notların silindi.",
        "pdogum_bad": "Kullanım: /pdogum YYYY-MM-DD",
        "pdogum_ok": "Partner doğum tarihi kaydedildi: {d}",
        "psaat_bad": "Kullanım: /psaat 14:30",
        "psaat_ok": "Partner doğum saati kaydedildi: {t}",
        "pkonum_bad": "Kullanım: /pkonum 41.01 28.98",
        "pkonum_ok": "Partner konumu kaydedildi: {lat}, {lon}",
        "ptz_bad": "Kullanım: /ptz Europe/Istanbul (IANA zaman dilimi)",
        "ptz_ok": "Partner zaman dilimi: {tz}",
        "psil_ok": "Partner astro verisi silindi.",
        "sinastri_need": "Önce senin /dogum ve partner /pdogum (gerekirse /psaat /pkonum /ptz).",
        "sinastri_empty": "Sinastri hesaplanamadı (Swiss Ephemeris gerekli veya veri eksik).",
        "sil_ok": "Profil, partner, üslup, sohbet özeti ve notların silindi. Dil ayarın aynı kaldı.",
        "feedback_why": "Ne geliştirelim? Bir sonraki mesajın kısa geri bildirim olarak kaydedilecek.",
        "feedback_saved": "Geri bildirimin not olarak kaydedildi.",
        "feedback_empty": "Boş mesaj; geri bildirim kaydedilmedi.",
        "stil_usage": "Kullanım: /stil klasik | psikolojik | populer | dengeli",
        "stil_bad": "Geçersiz. Örnek: /stil klasik",
        "stil_ok": "Yorum üslubu: <b>{label}</b>",
        "evsistemi_usage": (
            "Kullanım: /evsistemi placidus | whole | equal | koch | campanus | regiomontanus | porphyry\n"
            "(whole = tam burç evleri)"
        ),
        "evsistemi_bad": "Geçersiz ev sistemi. /evsistemi yazınca listeyi gör.",
        "evsistemi_ok": "Ev sistemi kaydedildi: <b>{hs}</b> (bir sonraki harita hesaplarında kullanılır).",
    },
    "en": {
        "start": (
            "<b>Hello!</b> I'm a general astrology info assistant.\n\n"
            "Ask about signs, planets, houses, and chart concepts. I search the local FAQ first, "
            "then use an LLM for a short answer.\n\n"
            "<b>Profile:</b> /dogum /saat /konum — /harita natal summary; /finance symbolic financial astrology (not investment advice). "
            "/remember /mynotes /clearnotes — teach the bot your style.\n\n"
            "Language: /lang tr or /lang en — Use the menu below or type your question."
        ),
        "help": (
            "<b>Commands</b>\n"
            "/start — Welcome\n/menu — Main menu\n/help — This help\n/lang tr|en — Language\n"
            "/profil — Saved birth info\n"
            "/dogum YYYY-MM-DD — Birth date\n/saat HH:MM — Birth time (optional)\n"
            "/konum lat lon — e.g. 41.01 28.98 (default Istanbul). Set birth city for correct Asc; e.g. Adana 37.00 35.32\n"
            "/harita — Natal summary (planets; houses if birth time set)\n"
            "/finance — Financial astrology read (2nd/8th/11th, Venus–Jupiter–Saturn; symbolic)\n"
            "/remember … — Save a preference\n/mynotes — List notes\n/clearnotes — Clear notes\n"
            "/pbirth /ptime /ploc /ptimezone — Partner chart (synastry)\n"
            "/synastry — Cross-aspect list\n"
            "/pclearpartner — Delete partner data only\n"
            "/sil or /delete_my_data — Wipe birth/chat/notes (keeps language)\n"
            "/style classical|psychological|popular|balanced — Reading style\n"
            "/housesystem placidus|whole|equal|koch|… — House system\n"
            "/sss — FAQ\n/burclar — Sign date ranges\n/hakkinda — Disclaimer\n\n"
            "Free text: FAQ first, then LLM. If a profile exists, replies include that context.\n"
            "Tone: say it in plain words (e.g. “facts only”, “chatty”, “daily horoscope style”, “based on my chart”, “horary”) — no extra command.\n\n"
            "<b>Notes</b>\n• General info only.\n• No medical/legal/financial advice.\n"
        ),
        "menu": "<b>Main menu</b>\n\nPick a shortcut or type a message.",
        "rate_limit": "You're sending messages too fast. Try again in a moment.",
        "profil_empty": "No birth data yet. Example:\n/dogum 1995-07-21\n/saat 14:30\n/konum 41.01 28.98",
        "profil_ok": "<b>Profile</b>\n",
        "lang_ok": "Language: English",
        "dogum_ok": "Birth date saved: {d}",
        "dogum_bad": "Usage: /dogum YYYY-MM-DD or /dogum 21.07.1995",
        "saat_ok": "Birth time saved: {t}",
        "saat_bad": "Usage: /saat 14:30",
        "konum_ok": "Location saved: {lat}, {lon}",
        "konum_bad": "Usage: /konum 41.0082 28.9784 (decimal lat lon)",
        "chart_need_date": "Set /dogum first.",
        "about": (
            "<b>Astrology assistant</b>\n"
            "For fun and general culture. /harita uses Swiss Ephemeris when available (otherwise a small ephem fallback). "
            "Not a professional consultation.\n\n"
            "<b>Data</b>\n"
            "• Profile, partner, notes, and style prefs may be stored on the server (SQLite/Postgres).\n"
            "• Chat summaries and snippets from local knowledge files may be sent to the LLM.\n"
            "• /sil clears profile, partner, notes, style, and chat summary (language kept).\n\n"
            "See Telegram and your LLM provider privacy policies."
        ),
        "burclar": (
            "<b>12 signs</b> (approximate Sun dates)\n\n"
            "♈ Aries — Mar 21 – Apr 19\n♉ Taurus — Apr 20 – May 20\n"
            "♊ Gemini — May 21 – Jun 20\n♋ Cancer — Jun 21 – Jul 22\n"
            "♌ Leo — Jul 23 – Aug 22\n♍ Virgo — Aug 23 – Sep 22\n"
            "♎ Libra — Sep 23 – Oct 22\n♏ Scorpio — Oct 23 – Nov 21\n"
            "♐ Sagittarius — Nov 22 – Dec 21\n♑ Capricorn — Dec 22 – Jan 19\n"
            "♒ Aquarius — Jan 20 – Feb 18\n♓ Pisces — Feb 19 – Mar 20"
        ),
        "hatirla_usage": (
            "Usage: /remember Keep answers shorter\n"
            "or in chat: remember: explain in plain language"
        ),
        "hatirla_ok": "Saved — I’ll apply this in future replies when it fits.",
        "hatirla_bad": "Note text can’t be empty.",
        "notlar_cleared": "All your notes were cleared.",
        "pdogum_bad": "Usage: /pbirth YYYY-MM-DD",
        "pdogum_ok": "Partner birth date saved: {d}",
        "psaat_bad": "Usage: /ptime 14:30",
        "psaat_ok": "Partner birth time saved: {t}",
        "pkonum_bad": "Usage: /ploc 41.01 28.98",
        "pkonum_ok": "Partner location saved: {lat}, {lon}",
        "ptz_bad": "Usage: /ptimezone Europe/London (IANA timezone)",
        "ptz_ok": "Partner timezone: {tz}",
        "psil_ok": "Partner astro data cleared.",
        "sinastri_need": "Set your /dogum and partner /pbirth first (optionally /ptime /ploc /ptimezone).",
        "sinastri_empty": "Could not compute synastry (need Swiss Ephemeris or more data).",
        "sil_ok": "Profile, partner, style, chat summary, and notes cleared. Language setting kept.",
        "feedback_why": "What should improve? Your next short message will be saved as feedback.",
        "feedback_saved": "Thanks — saved as a note for future replies.",
        "feedback_empty": "Empty message; nothing saved.",
        "stil_usage": "Usage: /style classical | psychological | popular | balanced",
        "stil_bad": "Invalid. Example: /style classical",
        "stil_ok": "Reading style: <b>{label}</b>",
        "evsistemi_usage": "Usage: /housesystem placidus | whole | equal | koch | campanus | regiomontanus | porphyry",
        "evsistemi_bad": "Invalid house system. Send /housesystem alone for the list.",
        "evsistemi_ok": "House system saved: <b>{hs}</b> (used on next chart calculations).",
    },
}


def t(key: str, lang: Lang, **kwargs: object) -> str:
    block = MESSAGES.get(lang, MESSAGES["tr"])
    template = block.get(key) or MESSAGES["tr"].get(key, key)
    return template.format(**kwargs) if kwargs else template
