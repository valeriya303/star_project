"""Колір зорі за показником B–V (F11). Формула Баллестероса → температура → RGB."""
from __future__ import annotations

import math

NO_COLOR = "#d9d9d9"  # умовне позначення за відсутності B–V


def bv_to_temperature(bv: float) -> float:
    bv = max(-0.4, min(2.0, bv))
    return 4600.0 * (1.0 / (0.92 * bv + 1.7) + 1.0 / (0.92 * bv + 0.62))


def temperature_to_rgb(t: float) -> tuple[int, int, int]:
    t = t / 100.0
    if t <= 66:
        r = 255.0
        g = 99.4708025861 * math.log(t) - 161.1195681661
        b = 0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307
    else:
        r = 329.698727446 * ((t - 60) ** -0.1332047592)
        g = 288.1221695283 * ((t - 60) ** -0.0755148492)
        b = 255.0
    clamp = lambda v: int(max(0, min(255, round(v))))  # noqa: E731
    return clamp(r), clamp(g), clamp(b)


def bv_to_hex(bv: float | None) -> str:
    if bv is None:
        return NO_COLOR
    r, g, b = temperature_to_rgb(bv_to_temperature(bv))
    return f"#{r:02x}{g:02x}{b:02x}"
