"""Çoklu LLM sağlayıcı: OpenAI, Groq (OpenAI uyumlu), Google Gemini."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from openai import AsyncOpenAI

from astro_bot.services.conversation_mode import ChatMode, mode_system_instruction, normalize_chat_mode
from astro_bot.services.intent_service import Intent, intent_instruction
from astro_bot.services.memory_service import SUMMARY_PROMPT_EN, SUMMARY_PROMPT_TR
from astro_bot.services.system_prompts import SYSTEM_PROMPT_EN, SYSTEM_PROMPT_TR, USER_SUFFIX_EN, USER_SUFFIX_TR

logger = logging.getLogger(__name__)

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
        chart_facts: str = "",
        synastry_facts: str = "",
        rag_context: str = "",
        expert_style_block: str = "",
        learned_notes: str = "",
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
        cf = (chart_facts or "").strip()
        if cf:
            parts.append(cf[:9000])
        sf = (synastry_facts or "").strip()
        if sf:
            parts.append(sf[:7000])
        rg = (rag_context or "").strip()
        if rg:
            parts.append(rg[:6500])
        es = (expert_style_block or "").strip()
        if es:
            parts.append(es[:2000])
        ln = (learned_notes or "").strip()
        if ln:
            parts.append(ln[:5000])
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
                    "\n\nHorary: do not repeat your previous reply’s chart paragraphs. "
                    "Max 1–2 clarifiers; then give a short synthesis. No trading/finance calls. Keep it brief."
                )
            else:
                base += (
                    "\n\nHorary: önceki mesajındaki harita paragraflarını tekrarlama. "
                    "En fazla 1–2 net soru; sonra kısa özet. Kripto/FX’te al-sat veya kazanç tarihi yok. Kısa yaz."
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

    async def _chain_plan_openai(
        self,
        user_msg: str,
        lang: str,
        model: str,
        data_tail: str,
    ) -> str:
        if not self._client:
            return ""
        sys_en = (
            "You are a brief planning module for an astrology assistant. "
            "Output at most 5 short bullets: user intent, which chart facts matter, caveats (missing time, symbolic framing), reply shape. "
            "No greeting; no emojis."
        )
        sys_tr = (
            "Sen astroloji asistanı için kısa plan modülüsün. En fazla 5 madde: kullanıcı niyeti, hangi harita verisi önemli, "
            "uyarılar (eksik saat, sembolik çerçeve), yanıt iskeleti. Selam yok; emoji yok."
        )
        sys = sys_en if lang == "en" else sys_tr
        user_blob = f"{user_msg[:2000]}\n\n---\nData excerpt:\n{data_tail[:3000]}"
        try:
            completion = await self._client.chat.completions.create(
                model=model,
                temperature=0.12,
                max_tokens=min(240, self._max_tokens),
                messages=[
                    {"role": "system", "content": sys},
                    {"role": "user", "content": user_blob},
                ],
            )
            return (completion.choices[0].message.content or "").strip()[:1600]
        except Exception:
            logger.exception("Zincir plan (openai uyumlu) başarısız")
            return ""

    async def _chain_plan_gemini(
        self,
        user_msg: str,
        lang: str,
        model_name: str,
        data_tail: str,
    ) -> str:
        try:
            import google.generativeai as genai
        except ImportError:
            return ""
        genai.configure(api_key=self._api_key)
        model = genai.GenerativeModel(model_name)
        prompt = (
            (user_msg[:2000] + "\n\nData excerpt:\n" + data_tail[:3000])
            if lang == "en"
            else (user_msg[:2000] + "\n\nVeri özeti:\n" + data_tail[:3000])
        )
        head = (
            "List at most 5 bullets: intent, relevant chart facts, caveats, reply structure. English only, no fluff."
            if lang == "en"
            else "En fazla 5 madde: niyet, ilgili harita verisi, uyarılar, yanıt yapısı. Türkçe, kısa."
        )

        def _call() -> str:
            r = model.generate_content(
                head + "\n\n" + prompt,
                generation_config={"temperature": 0.12, "max_output_tokens": 256},
            )
            try:
                return (r.text or "").strip()[:1600]
            except (ValueError, AttributeError):
                return ""

        try:
            return await asyncio.to_thread(_call)
        except Exception:
            logger.exception("Zincir plan (Gemini) başarısız")
            return ""

    async def reply(
        self,
        user_message: str,
        history: list[dict[str, Any]] | None = None,
        *,
        lang: str = "tr",
        profile_hint: str = "",
        chart_facts: str = "",
        synastry_facts: str = "",
        rag_context: str = "",
        expert_style_block: str = "",
        learned_notes: str = "",
        memory_summary: str = "",
        model_override: str | None = None,
        intent: Intent = "info",
        chat_mode: ChatMode = "default",
        horary_context: str = "",
        use_chain: bool = False,
    ) -> str:
        text = (user_message or "").strip()
        if not text:
            if lang == "en":
                return "Your message looks empty. Ask something about astrology."
            return "Mesajın boş görünüyor. Astroloji hakkında bir soru yazabilirsin."

        model_use = (model_override or "").strip() or self._model
        data_tail = ((chart_facts or "").strip() + "\n" + (synastry_facts or "").strip()).strip()
        plan = ""
        if use_chain and data_tail:
            if self._provider in ("openai", "groq"):
                plan = await self._chain_plan_openai(text, lang, model_use, data_tail)
            elif self._provider == "gemini":
                plan = await self._chain_plan_gemini(text, lang, model_use, data_tail)

        system = self._build_system(
            lang,
            profile_hint,
            memory_summary,
            intent,
            normalize_chat_mode(chat_mode),
            horary_context=horary_context,
            chart_facts=chart_facts,
            synastry_facts=synastry_facts,
            rag_context=rag_context,
            expert_style_block=expert_style_block,
            learned_notes=learned_notes,
        )
        if plan:
            hdr = (
                "INTERNAL_PLAN (do not paste verbatim; use only for coherence):"
                if lang == "en"
                else "İÇ_PLAN (kullanıcıya aynen yapıştırma; yalnızca tutarlılık için):"
            )
            system = system + "\n\n=== " + hdr + "\n" + plan

        is_horary = normalize_chat_mode(chat_mode) == "horary" and bool((horary_context or "").strip())
        suffix = self._user_suffix(lang, horary=is_horary)

        if self._provider == "gemini":
            return await self._reply_gemini(text, history, system, suffix, lang, model_name=model_use)
        return await self._reply_openai_compatible(text, history, system, suffix, lang, model=model_use)

    async def _reply_openai_compatible(
        self,
        text: str,
        history: list[dict[str, Any]] | None,
        system: str,
        suffix: str,
        lang: str,
        *,
        model: str | None = None,
    ) -> str:
        assert self._client is not None
        messages: list[dict[str, Any]] = [{"role": "system", "content": system}]
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": text + suffix})
        use_model = model or self._model

        try:
            completion = await self._client.chat.completions.create(
                model=use_model,
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
        *,
        model_name: str | None = None,
    ) -> str:
        try:
            import google.generativeai as genai
        except ImportError:
            logger.exception("google-generativeai yüklü değil")
            return "Gemini için google-generativeai paketi eksik."

        genai.configure(api_key=self._api_key)
        use_name = model_name or self._model
        model = genai.GenerativeModel(
            use_name,
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
