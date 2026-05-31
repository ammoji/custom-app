"""
Generate Google Play Store assets at the exact specs Play requires:

  - play-assets/icon-512.png             (512x512 PNG, app icon)
  - play-assets/feature-graphic-1024x500.png  (1024x500 PNG, store banner)

Sources, in priority order:
  - assets/images/icon.png          (1024x1024 — PR 39.1 logo symbol)
  - uploads/HamareSetuLogo.jpeg     (1280x780 master with wordmark, if present)

The feature graphic prefers the master JPEG (looks better — has wordmark
+ tagline already baked in). Falls back to composing the icon + the
HamaraSetu / Shop Smart. Shop Local. text if the master isn't on disk.

Run:
    python scripts/build-play-assets.py

Dependency: Pillow (PIL). If not installed:
    pip install Pillow --break-system-packages
"""
from __future__ import annotations
from pathlib import Path
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print(
        "ERROR: Pillow is not installed.\n"
        "Install with:  pip install Pillow --break-system-packages",
        file=sys.stderr,
    )
    sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "play-assets"
OUT_DIR.mkdir(exist_ok=True)

ICON_SRC = ROOT / "assets" / "images" / "icon.png"
MASTER_LOGO = ROOT / "uploads" / "HamareSetuLogo.jpeg"

# Brand colors (from logo palette).
BRAND_GREEN = "#0E7C3A"
TEXT_DARK = "#1F2937"


def build_icon() -> None:
    """512x512 app icon for the Play Store listing."""
    if not ICON_SRC.exists():
        print(f"WARN: missing {ICON_SRC} — skipping app icon")
        return
    out = OUT_DIR / "icon-512.png"
    img = Image.open(ICON_SRC).convert("RGBA")
    # Composite onto white in case Play rejects transparent icons.
    bg = Image.new("RGBA", img.size, (255, 255, 255, 255))
    bg.paste(img, (0, 0), img if img.mode == "RGBA" else None)
    bg.convert("RGB").resize((512, 512), Image.LANCZOS).save(out, optimize=True)
    print(f"wrote {out}")


def _find_system_font(size: int) -> ImageFont.FreeTypeFont:
    """Pick a TTF that exists on Windows, macOS, or Linux."""
    candidates = [
        "C:/Windows/Fonts/segoeui.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNS.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in candidates:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()


def build_feature_graphic() -> None:
    """1024x500 store banner.

    Two strategies, picked at runtime:
      1. If the master JPEG exists, scale it to fit 1024x500 by height
         (preserves wordmark + tagline), center on a white canvas.
      2. Otherwise, compose the icon + text from scratch.
    """
    out = OUT_DIR / "feature-graphic-1024x500.png"
    canvas = Image.new("RGB", (1024, 500), "white")

    if MASTER_LOGO.exists():
        master = Image.open(MASTER_LOGO).convert("RGB")
        mw, mh = master.size
        # Fit by height first.
        new_h = 500
        new_w = int(mw * new_h / mh)
        # If too wide, fit by width instead.
        if new_w > 1024:
            new_w = 1024
            new_h = int(mh * new_w / mw)
        resized = master.resize((new_w, new_h), Image.LANCZOS)
        x = (1024 - new_w) // 2
        y = (500 - new_h) // 2
        canvas.paste(resized, (x, y))
        canvas.save(out, optimize=True)
        print(f"wrote {out}  (from master logo)")
        return

    # Fallback: compose icon + text. Layout:
    #   [icon 320x320 left padded]    HamaraSetu (large)
    #                                 Shop Smart. Shop Local. (small)
    if not ICON_SRC.exists():
        print(f"WARN: neither {MASTER_LOGO} nor {ICON_SRC} present — cannot build feature graphic")
        return

    icon = Image.open(ICON_SRC).convert("RGBA").resize((320, 320), Image.LANCZOS)
    canvas.paste(icon, (90, 90), icon)

    draw = ImageDraw.Draw(canvas)
    title_font = _find_system_font(76)
    tagline_font = _find_system_font(34)

    draw.text((460, 170), "HamaraSetu", fill=BRAND_GREEN, font=title_font)
    draw.text((460, 270), "Shop Smart. Shop Local.", fill=TEXT_DARK, font=tagline_font)

    canvas.save(out, optimize=True)
    print(f"wrote {out}  (composed fallback)")


def main() -> int:
    print(f"output dir: {OUT_DIR}")
    build_icon()
    build_feature_graphic()
    print("done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
