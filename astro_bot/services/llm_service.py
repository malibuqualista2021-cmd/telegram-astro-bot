"""Çoklu LLM sağlayıcı: OpenAI, Groq (OpenAI uyumlu), Google Gemini."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from openai import AsyncOpenAI

from astro_bot.services.conversation_mode import ChatMode, mode_system_instruction, normalize_chat_mode
from astro_bot.services.intent_service import Intent, intent_instruction
from astro_bot.services.memory_service import SUMMARY_PROMPT_EN, SUMMARY_PROMPT_TR

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_TR = """Sen bir Telegram astroloji asistanısın. Kullanıcılarla düz yazışarak konuşur; komut veya / işareti kullanması şart değil. İstediği yanıt üslubunu (daha bilgi odaklı, daha sohbet, günlük tema vb.) doğal cümlelerle belirtebilir.

Üslup:
- Sohbetvari ve doğal Türkçe kullan (“sen” ile hitap edebilirsin); robotik veya ansiklopedi gibi olmak zorunda değilsin.
- Kısa cümleler, gerektiğinde tek soru veya nazik bir cümleyle devam ettir; madde işareti sadece konu yoğunsa.
- Konuşma akışını koru; önceki mesajlara referans verebilirsin.

Kurallar:
- Sadece genel astroloji, burçlar, gezegenler, evler, elementler, açılar, retro, transit gibi konularda bilgilendirici yanıt ver.
- Tıbbi teşhis/tedavi, hukuki danışmanlık veya yatırım/finansal tavsiye VERME. Bu konularda kullanıcıyı ilgili uzmanlara yönlendir; kesin iddia kullanma.
- Kesin bilgi yoksa, soru astroloji dışındaysa veya spekülasyona giriyorsa bunu açıkça söyle; uydurma.
- Astrolojiyi kültürel/eğlence çerçevesinde konumlandır; bilimsel kesinlik iddiasında bulunma.
- Önceki mesajlar bağlam olarak verilebilir; tutarlı kal, güvenli ve genel bilgi sınırlarında kal."""

SYSTEM_PROMPT_EN = """You are a Telegram astrology assistant. Users chat in plain text—no slash commands required. They may ask for a reply style (more factual, chatty, daily-style themes, chart-focused) in natural language.

Tone:
- Sound natural and conversational (warm, not stiff); you don’t have to sound like an encyclopedia.
- Short sentences; use bullets only when the topic is dense.
- You may refer to earlier messages in the thread.

Rules:
- Cover only general astrology: signs, planets, houses, elements, aspects, retrogrades, transits.
- Do NOT give medical, legal, or financial advice; direct users to professionals; no absolute claims.
- If uncertain or off-topic, say so clearly; do not invent.
- Frame astrology as cultural/entertainment; no scientific certainty claims.
- Prior messages may be provided as context; stay safe and general."""

USER_SUFFIX_TR = (
    "\n\nNot: Sohbet gibi doğal yaz; sadece genel astroloji bilgisi ver; tıbbi/hukuki/finansal yönlendirme yapma. "
    "Emin değilsen belirt."
)

USER_SUFFIX_EN = (
    "\n\nNote: Reply in a natural conversational tone; general astrology only; no medical/legal/financial guidance. "
    "If unsure, say so. Reply in English."
)

GROQ_BASE_URL = "https://api.groq.com/openai/v1"


class LlmAstrologyService:
    """openai / groq: OpenAI SDK; gemini: google-generativeai."""

    def __init__(
        self,
        provider: str,
        api_key: str,
        model: str,
        *,
        max_tokens: int,
        temperature: float,
    ) -> None:
        self._provider = provider
        self._model = model
        self._max_tokens = max_tokens
        self._temperature = temperature
        self._api_key = api_key
        self._client: AsyncOpenAI | None = None
        if provider in ("openai", "groq"):
            kwargs: dict[str, Any] = {"api_key": api_key}
            if provider == "groq":
                kwargs["base_url"] = GROQ_BASE_URL
            self._client = AsyncOpenAI(**kwargs)

    def _build_system(
        self,
        lang: str,
        profile_hint: str,
        memory_summary: str,
        intent: Intent,
        chat_mode: ChatMode,
        horary_context: str = "",
    ) -> str:
        base = SYSTEM_PROMPT_EN if lang == "en" else SYSTEM_PROMPT_TR
        parts = [base]
        ih = intent_instruction(intent, lang)
        if ih:
            parts.append(ih)
        mh = mode_system_instruction(normalize_chat_mode(chat_mode), lang)
        if mh:
            parts.append(mh)
        if profile_hint:
            parts.append(profile_hint)
        hc = (horary_context or "").strip()
        if hc:
            parts.append(hc[:9000])
        if memory_summary.strip():
            prefix = "Conversation summary so far:\n" if lang == "en" else "Şu ana kadar özet:\n"
            parts.append(prefix + memory_summary.strip()[:3500])
        return "\n\n".join(parts)

    def _user_suffix(self, lang: str, *, horary: bool = False) -> str:
        base = USER_SUFFIX_EN if lang == "en" else USER_SUFFIX_TR
        if horary:
            if lang == "en":
                base += (
                    "\n\nHorary: your answer must use the chart data from the system message (houses, ruler, aspects). "
                    "Do not reply with generic Sun-sign personality text unrelated to that chart."
                )
            else:
                base += (
                    "\n\nHorary: yanıtını sistemdeki harita verisine (evler, yönetici, açılar) dayandır; "
                    "o haritayla bağlantısı olmayan hazır Güneş burcu metni yazma."
                )
        return base

    async def summarize_chunk(
        self,
        history_chunk: list[dict[str, Any]],
        lang: str,
    ) -> str:
        lines: list[str] = []
        for m in history_chunk:
            role = m.get("role", "")
            c = (m.get("content") or "").strip()
            if not c:
                continue
            if role == "user":
                lines.append(("User: " if lang == "en" else "Kullanıcı: ") + c)
            elif role == "assistant":
                lines.append(("Assistant: " if lang == "en" else "Asistan: ") + c)
        blob = "\n".join(lines)
        if not blob.strip():
            return ""
        head = SUMMARY_PROMPT_EN if lang == "en" else SUMMARY_PROMPT_TR
        user_msg = head + "\n\n" + blob
        # kısa özet için düşük token
        max_tok = min(256, self._max_tokens)
        if self._provider == "gemini":
            return await self._summarize_gemini(user_msg, max_tok)
        return await self._summarize_openai_compatible(user_msg, lang, max_tok)

    async def _summarize_openai_compatible(
        self,
        user_msg: str,
        lang: str,
        max_tokens: int,
    ) -> str:
        assert self._client is not None
        sys = (
            "You compress chat into a short neutral summary."
            if lang == "en"
            else "Sohbeti kısa ve nötr şekilde özetle."
        )
        try:
            completion = await self._client.chat.completions.create(
                model=self._model,
                temperature=0.2,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": sys},
                    {"role": "user", "content": user_msg},
                ],
            )
            out = (completion.choices[0].message.content or "").strip()
            return out[:2000]
        except Exception:
            logger.exception("Özet LLM çağrısı başarısız")
            return ""

    async def _summarize_gemini(self, user_msg: str, max_tokens: int) -> str:
        try:
            import google.generativeai as genai
        except ImportError:
            return ""

        genai.configure(api_key=self._api_key)
        model = genai.GenerativeModel(self._model)

        def _call() -> str:
            response = model.generate_content(
                user_msg,
                generation_config={
                    "temperature": 0.2,
                    "max_output_tokens": max_tokens,
                },
            )
            try:
                return (response.text or "").strip()[:2000]
            except (ValueError, AttributeError):
                return ""

        try:
            return await asyncio.to_thread(_call)
        except Exception:
            logger.exception("Gemini özet başarısız")
            return ""

    async def reply(
        self,
        user_message: str,
        history: list[dict[str, Any]] | None = None,
        *,
        lang: str = "tr",
        profile_hint: str = "",
        memory_summary: str = "",
        intent: Intent = "info",
        chat_mode: ChatMode = "default",
        horary_context: str = "",
    ) -> str:
        text = (user_message or "").strip()
        if not text:
            if lang == "en":
                return "Your message looks empty. Ask something about astrology."
            return "Mesajın boş görünüyor. Astroloji hakkında bir soru yazabilirsin."

        system = self._build_system(
            lang,
            profile_hint,
            memory_summary,
            intent,
            normalize_chat_mode(chat_mode),
            horary_context=horary_context,
        )
        is_horary = normalize_chat_mode(chat_mode) == "horary" and bool((horary_context or "").strip())
        suffix = self._user_suffix(lang, horary=is_horary)

        if self._provider == "gemini":
            return await self._reply_gemini(text, history, system, suffix, lang)
        return await self._reply_openai_compatible(text, history, system, suffix, lang)

    async def _reply_openai_compatible(
        self,
        text: str,
        history: list[dict[str, Any]] | None,
        system: str,
        suffix: str,
        lang: str,
    ) -> str:
        assert self._client is not None
        messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": text + suffix})

        try:
            completion = await self._client.chat.completions.create(
                model=self._model,
                temperature=self._temperature,
                max_tokens=self._max_tokens,
                messages=messages,
            )
        except Exception:
            logger.exception("%s çağrısı başarısız", self._provider)
            if lang == "en":
                return "Could not generate a reply right now. Try again later."
            return (
                "Şu an yapay zekâ ile yanıt üretilemedi. "
                "Daha sonra tekrar dene veya sorunu farklı şekilde sor."
            )

        choice = completion.choices[0].message
        out = (choice.content or "").strip()
        if not out:
            logger.warning("%s boş içerik döndü", self._provider)
            if lang == "en":
                return "I could not produce a clear answer. Try rephrasing."
            return (
                "Bu konuda net bir astroloji özeti veremedim. "
                "Soruyu biraz daha net yazarsan tekrar deneyebilirim."
            )
        return out

    async def _reply_gemini(
        self,
        text: str,
        history: list[dict[str, Any]] | None,
        system: str,
        suffix: str,
        lang: str,
    ) -> str:
        try:
            import google.generativeai as genai
        except ImportError:
            logger.exception("google-generativeai yüklü değil")
            return "Gemini için google-generativeai paketi eksik."

        genai.configure(api_key=self._api_key)
        model = genai.GenerativeModel(
            self._model,
            system_instruction=system,
        )

        ulab, alab = ("User", "Assistant") if lang == "en" else ("Kullanıcı", "Asistan")
        prompt_parts: list[str] = []
        if history:
            for h in history:
                role = h.get("role", "")
                content = (h.get("content") or "").strip()
                if not content:
                    continue
                if role == "user":
                    prompt_parts.append(f"{ulab}: {content}")
                elif role == "assistant":
                    prompt_parts.append(f"{alab}: {content}")
        prompt_parts.append(f"{ulab}: {text}{suffix}")
        prompt = "\n\n".join(prompt_parts)

        def _call() -> str:
            response = model.generate_content(
                prompt,
                generation_config={
                    "temperature": self._temperature,
                    "max_output_tokens": self._max_tokens,
                },
            )
            try:
                return (response.text or "").strip()
            except (ValueError, AttributeError):
                return ""

        try:
            out = await asyncio.to_thread(_call)
        except Exception:
            logger.exception("Gemini çağrısı başarısız")
            return (
                "Could not generate a reply right now."
                if lang == "en"
                else "Şu an yapay zekâ ile yanıt üretilemedi."
            )

        if not out:
            return (
                "I could not produce a clear answer."
                if lang == "en"
                else "Bu konuda net bir özet veremedim."
            )
        return out
