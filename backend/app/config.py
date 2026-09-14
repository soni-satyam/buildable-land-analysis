"""
Loads the configurable setback/buffer distances from config/setbacks.yaml
so they can be changed without editing code.
"""
from pathlib import Path
import yaml

CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "setbacks.yaml"


def load_setback_config(path: Path = CONFIG_PATH) -> dict:
    with open(path, "r") as f:
        return yaml.safe_load(f)


def get_buffer_ft(config: dict, layer_name: str, override_ft: float | None = None) -> float:
    """
    Returns the buffer distance (in feet) for a given constraint layer,
    allowing a per-request override (e.g. from query params or map UI).
    """
    if override_ft is not None:
        return override_ft
    layer_cfg = config.get("setbacks", {}).get(layer_name, {})
    return layer_cfg.get("buffer_ft", 0)
