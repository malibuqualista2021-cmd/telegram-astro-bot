"""Çoklu LLM sağlayıcı: OpenAI, Groq (OpenAI uyumlu), Google Gemini."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """Sen bir Telegram astroloji asistanısın.

Kurallar:
- Sadece genel astroloji, burçlar, gezegenler, evler, elementler, açılar, retro, transit gibi konularda bilgilendirici ve nötr yanıt ver.
- Tıbbi teşhis/tedavi, hukuki danışmanlık veya yatırım/finansal tavsiye VERME. Bu konularda kullanıcıyı ilgili uzmanlara yönlendir; kesin iddia kullanma.
- Yanıtların Türkçe, yapılandırılmış ve mümkün olduğunca kısa olsun (birkaç kısa paragraf veya madde işareti kullanabilirsin).
- Kesin bilgi yoksa, soru astroloji dışındaysa veya spekülasyona giriyorsa bunu açıkça söyle; uydurma.
- Astrolojiyi kültürel/eğlence çerçevesinde konumlandır; bilimsel kesinlik iddiasında bulunma.
- Kullanıcının önceki bir iki tur mesajı bağlam olarak verilebilir; tutarlı kal ama yine de güvenli ve genel bilgi sınırlarında kal."""

USER_SUFFIX = (
    "\n\nNot: Sadece genel astroloji bilgisi ver; tıbbi/hukuki/finansal yönlendirme yapma. "
    "Emin değilsen belirt."
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

    async def reply(
        self,
        user_message: str,
        history: list[dict[str, Any]] | None = None,
    ) -> str:
        text = (user_message or "").strip()
        if not text:
            return "Mesajın boş görünüyor. Astroloji hakkında bir soru yazabilirsin."

        if self._provider == "gemini":
            return await self._reply_gemini(text, history)
        return await self._reply_openai_compatible(text, history)

    async def _reply_openai_compatible(
        self,
        text: str,
        history: list[dict[str, Any]] | None,
    ) -> str:
        assert self._client is not None
        messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": text + USER_SUFFIX})

        try:
            completion = await self._client.chat.completions.create(
                model=self._model,
                temperature=self._temperature,
                max_tokens=self._max_tokens,
                messages=messages,
            )
        except Exception:
            logger.exception("%s çağrısı başarısız", self._provider)
            return (
                "Şu an yapay zekâ ile yanıt üretilemedi. "
                "Daha sonra tekrar dene veya sorunu farklı şekilde sor."
            )

        choice = completion.choices[0].message
        out = (choice.content or "").strip()
        if not out:
            logger.warning("%s boş içerik döndü", self._provider)
            return (
                "Bu konuda net bir astroloji özeti veremedim. "
                "Soruyu biraz daha net yazarsan tekrar deneyebilirim."
            )
        return out

    async def _reply_gemini(
        self,
        text: str,
        history: list[dict[str, Any]] | None,
    ) -> str:
        try:
            import google.generativeai as genai
        except ImportError:
            logger.exception("google-generativeai yüklü değil")
            return "Gemini için google-generativeai paketi eksik. Yöneticiye bildir."

        genai.configure(api_key=self._api_key)
        model = genai.GenerativeModel(
            self._model,
            system_instruction=SYSTEM_PROMPT,
        )

        prompt_parts: list[str] = []
        if history:
            for h in history:
                role = h.get("role", "")
                content = (h.get("content") or "").strip()
                if not content:
                    continue
                if role == "user":
                    prompt_parts.append(f"Kullanıcı: {content}")
                elif role == "assistant":
                    prompt_parts.append(f"Asistan: {content}")
        prompt_parts.append(f"Kullanıcı: {text}{USER_SUFFIX}")
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
                "Şu an yapay zekâ ile yanıt üretilemedi. "
                "Daha sonra tekrar dene veya sorunu farklı şekilde sor."
            )

        if not out:
            return (
                "Bu konuda net bir astroloji özeti veremedim. "
                "Soruyu biraz daha net yazarsan tekrar deneyebilirim."
            )
        return out
