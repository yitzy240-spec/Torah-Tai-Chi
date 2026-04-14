import json
from pathlib import Path
from typing import Any


def load_parshiot(path: Path) -> dict[str, dict[str, Any]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return {p["name"]: p for p in data["parshiot"]}


def get_parsha(name: str, path: Path) -> dict[str, Any]:
    parshiot = load_parshiot(path)
    for key, value in parshiot.items():
        if key.lower() == name.lower():
            return value
    raise KeyError(f"Parsha not found: {name}")


def get_parsha_script(name: str, option: str, path: Path) -> dict[str, Any]:
    parsha = get_parsha(name, path)
    for s in parsha.get("scripts", []):
        if s["option"].upper() == option.upper():
            return s
    raise KeyError(f"Option {option} not found for parsha {name}")
