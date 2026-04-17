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
            "<b>Merhaba!</b> Genel astroloji bilgisi paylaşan bir asistanım.\n\n"
            "Burçlar, gezegenler, evler ve harita kavramları hakkında yazabilirsin. "
            "Önce yerel bilgi tabanımdan ararım; gerekirse kısa bir özet üretirim.\n\n"
            "<b>Kişisel profil:</b> /dogum /saat /konum ile doğum bilgisi ekleyebilirsin; "
            "/harita ile eğitim amaçlı Güneş/Ay/Yükselen özeti alırsın.\n\n"
            "Dil: /lang tr veya /lang en — Aşağıdaki menüyü kullan veya doğrudan sorunu yaz."
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
            "/konum enlem boylam — Örn: 41.01 28.98 (varsayılan İstanbul)\n"
            "/harita — Güneş/Ay/Yükselen (eğitim amaçlı, ephem)\n"
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
            "Eğlence ve genel kültür amaçlıdır. /harita çıktıları ephem ile yaklaşıktır; "
            "profesyonel harita yerine geçmez.\n\n"
            "Veriler Telegram ve LLM sağlayıcısına gidebilir."
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
    },
    "en": {
        "start": (
            "<b>Hello!</b> I'm a general astrology info assistant.\n\n"
            "Ask about signs, planets, houses, and chart concepts. I search the local FAQ first, "
            "then use an LLM for a short answer.\n\n"
            "<b>Profile:</b> /dogum /saat /konum for birth data; /harita for an educational Sun/Moon/Asc summary.\n\n"
            "Language: /lang tr or /lang en — Use the menu below or type your question."
        ),
        "help": (
            "<b>Commands</b>\n"
            "/start — Welcome\n/menu — Main menu\n/help — This help\n/lang tr|en — Language\n"
            "/profil — Saved birth info\n"
            "/dogum YYYY-MM-DD — Birth date\n/saat HH:MM — Birth time (optional)\n"
            "/konum lat lon — e.g. 41.01 28.98 (default Istanbul)\n"
            "/harita — Sun/Moon/Asc (educational, ephem)\n"
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
            "For fun and general culture. /harita uses ephem approximations; not a professional chart.\n\n"
            "Data may go to Telegram and the LLM provider."
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
    },
}


def t(key: str, lang: Lang, **kwargs: object) -> str:
    block = MESSAGES.get(lang, MESSAGES["tr"])
    template = block.get(key) or MESSAGES["tr"].get(key, key)
    return template.format(**kwargs) if kwargs else template
