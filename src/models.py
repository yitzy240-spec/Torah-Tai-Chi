from pydantic import BaseModel, Field


class Clip(BaseModel):
    index: int = Field(ge=0)
    voiceover: str = Field(min_length=1)
    visual_prompt: str = Field(min_length=1)
    duration_s: int = Field(ge=4, le=15)


class ClipPlan(BaseModel):
    parsha: str = Field(min_length=1)
    hook: str = Field(min_length=1)
    full_script: str = Field(min_length=1)
    clips: list[Clip] = Field(min_length=1)

    @property
    def total_duration_s(self) -> int:
        return sum(c.duration_s for c in self.clips)
