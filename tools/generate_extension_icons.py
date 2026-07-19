from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "src" / "icons"
MASTER_SIZE = 256


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/seguiemj.ttf",
    ]
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default()


def draw_icon() -> Image.Image:
    image = Image.new("RGBA", (MASTER_SIZE, MASTER_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    outer = (16, 16, MASTER_SIZE - 16, MASTER_SIZE - 16)
    inner = (28, 28, MASTER_SIZE - 28, MASTER_SIZE - 28)

    # Base shell
    draw.rounded_rectangle(outer, radius=56, fill=(8, 16, 30, 255), outline=(75, 229, 255, 160), width=3)

    # Background glow
    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse((44, 40, 220, 216), fill=(0, 204, 255, 64))
    glow_draw.ellipse((120, 110, 240, 230), fill=(255, 126, 51, 60))
    glow = glow.filter(ImageFilter.GaussianBlur(28))
    image.alpha_composite(glow)

    # Inner panel
    draw.rounded_rectangle(inner, radius=40, fill=(10, 24, 44, 230), outline=(165, 248, 255, 54), width=2)

    # Top gloss
    gloss = Image.new("RGBA", image.size, (0, 0, 0, 0))
    gloss_draw = ImageDraw.Draw(gloss)
    gloss_draw.rounded_rectangle((30, 30, 226, 118), radius=36, fill=(255, 255, 255, 22))
    gloss = gloss.filter(ImageFilter.GaussianBlur(12))
    image.alpha_composite(gloss)

    # Scan frame corners
    frame_color = (88, 241, 255, 235)
    accent_color = (255, 169, 62, 235)
    w = 8
    pad = 58
    arm = 34
    # top-left
    draw.rounded_rectangle((pad, pad, pad + arm, pad + w), radius=4, fill=frame_color)
    draw.rounded_rectangle((pad, pad, pad + w, pad + arm), radius=4, fill=frame_color)
    # top-right
    draw.rounded_rectangle((MASTER_SIZE - pad - arm, pad, MASTER_SIZE - pad, pad + w), radius=4, fill=frame_color)
    draw.rounded_rectangle((MASTER_SIZE - pad - w, pad, MASTER_SIZE - pad, pad + arm), radius=4, fill=frame_color)
    # bottom-left
    draw.rounded_rectangle((pad, MASTER_SIZE - pad - w, pad + arm, MASTER_SIZE - pad), radius=4, fill=accent_color)
    draw.rounded_rectangle((pad, MASTER_SIZE - pad - arm, pad + w, MASTER_SIZE - pad), radius=4, fill=accent_color)
    # bottom-right
    draw.rounded_rectangle((MASTER_SIZE - pad - arm, MASTER_SIZE - pad - w, MASTER_SIZE - pad, MASTER_SIZE - pad), radius=4, fill=accent_color)
    draw.rounded_rectangle((MASTER_SIZE - pad - w, MASTER_SIZE - pad - arm, MASTER_SIZE - pad, MASTER_SIZE - pad), radius=4, fill=accent_color)

    # Center question mark
    font = load_font(118)
    text = "?"
    text_box = draw.textbbox((0, 0), text, font=font)
    tw = text_box[2] - text_box[0]
    th = text_box[3] - text_box[1]
    tx = (MASTER_SIZE - tw) / 2
    ty = 58

    text_glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    glow_text_draw = ImageDraw.Draw(text_glow)
    glow_text_draw.text((tx, ty), text, font=font, fill=(98, 243, 255, 190))
    text_glow = text_glow.filter(ImageFilter.GaussianBlur(10))
    image.alpha_composite(text_glow)

    draw.text((tx, ty), text, font=font, fill=(238, 252, 255, 255))

    # Dot + sparkle
    draw.ellipse((120, 177, 137, 194), fill=(255, 188, 84, 255))
    draw.ellipse((178, 72, 196, 90), fill=(255, 188, 84, 235))
    draw.rounded_rectangle((185, 62, 189, 100), radius=2, fill=(255, 219, 154, 220))
    draw.rounded_rectangle((168, 79, 206, 83), radius=2, fill=(255, 219, 154, 220))

    return image


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    master = draw_icon()
    for size in (16, 48, 128):
        resized = master.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(OUT_DIR / f"icon{size}.png")


if __name__ == "__main__":
    main()
