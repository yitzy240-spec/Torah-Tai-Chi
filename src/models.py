from __future__ import annotations
from pydantic import BaseModel, Field, model_validator
from src.settings import OUTDOOR_ARCHETYPES


class Clip(BaseModel):
    index: int = Field(ge=0)
    voiceover: str = Field(min_length=1)
    visual_prompt: str = Field(min_length=1)
    duration_s: int = Field(ge=4, le=15)
    setting_id: str = Field(min_length=1)
    motion_ref_url: str | None = None


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
        if not (28 <= total <= 45):
            raise ValueError(f"total_duration_s {total} not in [28, 45]")
        return self
