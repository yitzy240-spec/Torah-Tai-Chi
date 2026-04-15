from __future__ import annotations
from pydantic import BaseModel, Field, model_validator
from src.settings import OUTDOOR_ARCHETYPES


MAX_WORDS_PER_SECOND = 2.0  # above this the TTS delivers rushed speech


class Clip(BaseModel):
    index: int = Field(ge=0)
    voiceover: str = Field(min_length=1)
    visual_prompt: str = Field(min_length=1)
    duration_s: int = Field(ge=4, le=15)
    setting_id: str = Field(min_length=1)
    motion_ref_url: str | None = None

    @model_validator(mode="after")
    def _check_word_density(self) -> "Clip":
        words = len(self.voiceover.split())
        wps = words / self.duration_s
        if wps > MAX_WORDS_PER_SECOND:
            raise ValueError(
                f"clip {self.index} voiceover density {wps:.2f} wps exceeds "
                f"max {MAX_WORDS_PER_SECOND} wps ({words} words / {self.duration_s}s). "
                f"Seedance TTS will deliver this as rushed speech. Trim to "
                f"<= {int(MAX_WORDS_PER_SECOND * self.duration_s)} words "
                f"or increase duration."
            )
        return self


class ClipPlan(BaseModel):
    parsha: str = Field(min_length=1)
    hook: str = Field(min_length=1)
    full_script: str = Field(min_length=1)
    outdoor_archetype_id: str = Field(min_length=1)
    clips: list[Clip] = Field(min_length=4, max_length=4)

    @property
    def total_duration_s(self) -> int:
        return sum(c.duration_s for c in self.clips)

    @model_validator(mode="after")
    def _check_structure(self) -> "ClipPlan":
        if self.outdoor_archetype_id not in OUTDOOR_ARCHETYPES:
            raise ValueError(
                f"outdoor_archetype_id {self.outdoor_archetype_id!r} is not "
                f"in OUTDOOR_ARCHETYPES; allowed: {sorted(OUTDOOR_ARCHETYPES)}"
            )
        if self.clips[0].setting_id != "DOJO" or self.clips[1].setting_id != "DOJO":
            raise ValueError("clips 0 and 1 must have setting_id == 'DOJO'")
        if (self.clips[2].setting_id != self.outdoor_archetype_id
                or self.clips[3].setting_id != self.outdoor_archetype_id):
            raise ValueError(
                f"clips 2 and 3 must have setting_id == outdoor_archetype_id "
                f"({self.outdoor_archetype_id!r})"
            )
        total = self.total_duration_s
        if not (28 <= total <= 50):
            raise ValueError(f"total_duration_s {total} not in [28, 50]")
        return self
