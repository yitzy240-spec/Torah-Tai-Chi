from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, model_validator
from src.settings import OUTDOOR_ARCHETYPES


class Clip(BaseModel):
    index: int = Field(ge=0)
    voiceover: str = Field(min_length=1)
    visual_prompt: str = Field(min_length=1)
    duration_s: int = Field(ge=4, le=15)
    setting_id: str = Field(min_length=1)
    caption_position: Literal["bottom", "top", "middle"] = "bottom"
    emotive_note: str | None = None
    motion_ref_url: str | None = None


class PlatformCaptions(BaseModel):
    tiktok: str = Field(min_length=1, max_length=300)
    instagram: str = Field(min_length=1, max_length=600)
    youtube_title: str = Field(min_length=1, max_length=100)
    youtube_description: str = Field(min_length=1, max_length=800)
    facebook: str = Field(min_length=1, max_length=600)


class ClipPlan(BaseModel):
    parsha: str = Field(min_length=1)
    hook: str = Field(min_length=1)
    full_script: str = Field(min_length=1)
    outdoor_archetype_id: str = Field(min_length=1)
    clips: list[Clip] = Field(min_length=3, max_length=8)
    captions: PlatformCaptions

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

        dojo_end = 0
        for i, c in enumerate(self.clips):
            if c.setting_id == "DOJO":
                if dojo_end != i:
                    raise ValueError(
                        f"clip {i} is DOJO but dojo block already ended at clip "
                        f"{dojo_end}; dojo clips must be contiguous at the start"
                    )
                dojo_end = i + 1
            elif c.setting_id == self.outdoor_archetype_id:
                pass
            else:
                raise ValueError(
                    f"clip {i} setting_id {c.setting_id!r} is neither 'DOJO' nor "
                    f"the outdoor_archetype_id {self.outdoor_archetype_id!r}"
                )

        if dojo_end == 0:
            raise ValueError("no DOJO clips — dojo block must have at least 1 clip")
        if dojo_end == len(self.clips):
            raise ValueError(
                "all clips are DOJO — outdoor block must have at least 1 clip"
            )

        total = self.total_duration_s
        if not (28 <= total <= 90):
            raise ValueError(f"total_duration_s {total} not in [28, 90]")
        return self
