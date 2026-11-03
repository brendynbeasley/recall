# Renders the Recall logo (gradient tile + two tilted cards, matching .intro-logo) as PWA icons.
# Usage: python tools/make-icons.py
import colorsys, os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'icons')
os.makedirs(OUT, exist_ok=True)

def hsl(h, s, l):
    r, g, b = colorsys.hls_to_rgb(h / 360, l, s)
    return (round(r * 255), round(g * 255), round(b * 255))

def logo(size, maskable=False):
    S = size * 4  # supersample for smooth edges
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    c1, c2 = hsl(252, .86, .64), hsl(292, .80, .60)
    grad = Image.new('RGBA', (S, S))
    gp = grad.load()
    for y in range(S):
        for x in range(S):
            t = (x + y) / (2 * S - 2)
            gp[x, y] = tuple(round(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)) + (255,)
    mask = Image.new('L', (S, S), 0)
    pad = 0 if maskable else round(S * .06)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, S - pad, S - pad], radius=0 if maskable else round(S * .22), fill=255)
    img.paste(grad, (0, 0), mask)
    inner = .62 if maskable else .78  # maskable icons keep content inside the safe zone
    def card(angle, dx, dy, alpha):
        w, hgt = round(S * .44 * inner), round(S * .52 * inner)
        layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        cx, cy = S // 2 + round(dx * S), S // 2 + round(dy * S)
        ImageDraw.Draw(layer).rounded_rectangle([cx - w // 2, cy - hgt // 2, cx + w // 2, cy + hgt // 2], radius=round(S * .07 * inner), fill=(255, 255, 255, alpha))
        return layer.rotate(angle, center=(cx, cy), resample=Image.BICUBIC)
    img = Image.alpha_composite(img, card(-8, .025 * inner, .025 * inner, 140))
    img = Image.alpha_composite(img, card(10, 0, 0, 245))
    return img.resize((size, size), Image.LANCZOS)

for size in (192, 512):
    logo(size).save(os.path.join(OUT, f'icon-{size}.png'))
logo(512, maskable=True).save(os.path.join(OUT, 'icon-maskable-512.png'))
logo(180, maskable=True).save(os.path.join(OUT, 'apple-touch-icon.png'))
print('icons written to', os.path.abspath(OUT))
