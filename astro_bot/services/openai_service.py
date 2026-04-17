"""OpenAI ile Türkçe astroloji yanıtları (kısa bağlam desteği)."""

from __future__ import annotations

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


class OpenAiAstrologyService:
    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        max_tokens: int,
        temperature: float,
    ) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._model = model
        self._max_tokens = max_tokens
        self._temperature = temperature

    async def reply(
        self,
        user_message: str,
        history: list[dict[str, Any]] | None = None,
    ) -> str:
        text = (user_message or "").strip()
        if not text:
            return "Mesajın boş görünüyor. Astroloji hakkında bir soru yazabilirsin."

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
            logger.exception("OpenAI çağrısı başarısız")
            return (
                "Şu an yapay zekâ ile yanıt üretilemedi. "
                "Daha sonra tekrar dene veya sorunu farklı şekilde sor."
            )

        choice = completion.choices[0].message
        out = (choice.content or "").strip()
        if not out:
            logger.warning("OpenAI boş içerik döndü")
            return (
                "Bu konuda net bir astroloji özeti veremedim. "
                "Soruyu biraz daha net yazarsan tekrar deneyebilirim."
            )
        return out
