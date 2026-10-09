"""Procedural textures (numpy noise -> PIL)."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from meshlib import noise2d_tile, fbm, vnoise

def to_img(a):
    return Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))

def lerp(a, b, t):
    t = np.asarray(t)[..., None]
    return np.asarray(a) * (1 - t) + np.asarray(b) * t

def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def ground(S=512):
    n1 = noise2d_tile(S, S, 4, 5, 1)
    n2 = noise2d_tile(S, S, 16, 3, 2)
    n3 = noise2d_tile(S, S, 64, 2, 3)
    dark = np.array([0.13, 0.19, 0.07]); mid = np.array([0.27, 0.34, 0.12]); lite = np.array([0.40, 0.45, 0.17])
    dry = np.array([0.50, 0.45, 0.24]); soil = np.array([0.27, 0.21, 0.14])
    c = lerp(dark, mid, sstep(-0.5, 0.4, n1 + 0.4 * n2))
    c = lerp(c, lite, sstep(0.2, 0.9, n2 + 0.5 * n3) * 0.6)
    c = lerp(c, dry, sstep(0.25, 0.7, n1 - 0.3 * n3) * 0.7)
    c = lerp(c, soil, sstep(0.45, 0.8, -n1 + 0.4 * n3) * 0.8)
    # blade streaks
    rng = np.random.default_rng(4)
    img = to_img(c)
    d = ImageDraw.Draw(img)
    for _ in range(9000):
        x, y = rng.uniform(0, S, 2)
        L = rng.uniform(3, 10); a = rng.uniform(-0.6, 0.6) - np.pi / 2
        g = rng.uniform(0.6, 1.25)
        col = tuple(int(np.clip(v * g * 255, 0, 255)) for v in (lite if rng.random() < 0.7 else dry))
        for ox in (-S, 0, S):
            for oy in (-S, 0, S):
                d.line([(x + ox, y + oy), (x + ox + np.cos(a) * L, y + oy + np.sin(a) * L)], fill=col, width=1)
    return img.filter(ImageFilter.GaussianBlur(0.5))

def dirt_patch(S=512):
    ys, xs = np.mgrid[0:S, 0:S]
    u, v = xs / S * 2 - 1, ys / S * 2 - 1
    r = np.sqrt(u * u + v * v)
    p = np.stack([xs / S * 6, ys / S * 6, np.zeros_like(xs, float)], -1)
    n = fbm(p, 5, seed=7)
    n2 = fbm(p * 5, 3, seed=8)
    a = sstep(1.0, 0.55, r + n * 0.35)
    soil = np.array([0.30, 0.23, 0.16]); dark = np.array([0.18, 0.14, 0.10]); ash = np.array([0.42, 0.40, 0.37])
    c = lerp(soil, dark, sstep(-0.3, 0.5, n2))
    c = lerp(c, ash, sstep(0.35, 0.0, r) * sstep(-0.2, 0.5, n) * 0.5)
    c = c * (0.85 + 0.3 * sstep(-1, 1, n2))[..., None]
    rgba = np.dstack([c, a * (0.75 + 0.25 * sstep(-0.5, 0.5, n2))])
    img = Image.fromarray(np.clip(rgba * 255, 0, 255).astype(np.uint8), "RGBA")
    rng = np.random.default_rng(9)
    d = ImageDraw.Draw(img)
    for _ in range(0):  # pebbles
        x, y = rng.normal(S / 2, S / 5, 2)
        rr = rng.uniform(1, 3.5)
        g = int(rng.uniform(70, 140))
        d.ellipse([x - rr, y - rr * 0.8, x + rr, y + rr * 0.8], fill=(g, int(g * 0.95), int(g * 0.88), 230))
    return img

def birch_bark(W=256, H=512):
    ys, xs = np.mgrid[0:H, 0:W]
    p = np.stack([xs / W * 4, ys / H * 8, np.zeros_like(xs, float)], -1)
    n = fbm(p, 4, seed=11, period=(4, 8, None))
    c = lerp(np.array([0.93, 0.91, 0.86]), np.array([0.78, 0.76, 0.72]), sstep(-0.5, 0.6, n))
    img = to_img(c)
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(12)
    for _ in range(140):  # lenticels: horizontal dark dashes
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        L = rng.uniform(8, 50); t = rng.uniform(1, 3.5)
        g = int(rng.uniform(25, 80))
        for ox in (-W, 0, W):
            d.rectangle([x + ox, y, x + ox + L, y + t], fill=(g, g - 5, g - 8))
    for _ in range(10):  # black patches
        x, y = rng.uniform(0, W), rng.uniform(0, H)
        pts = []
        R = rng.uniform(10, 26)
        for k in range(14):
            a = k / 14 * 2 * np.pi
            rr = R * rng.uniform(0.5, 1.2)
            pts.append((x + np.cos(a) * rr * 1.6, y + np.sin(a) * rr * 0.6))
        for ox in (-W, 0, W):
            d.polygon([(px + ox, py) for px, py in pts], fill=(28, 25, 22))
    return img.filter(ImageFilter.GaussianBlur(0.6))

def generic_bark(W=256, H=256, base=(0.33, 0.23, 0.15), seed=21, stretch=6):
    ys, xs = np.mgrid[0:H, 0:W]
    p = np.stack([xs / W * 8, ys / H * 8 / stretch, np.zeros_like(xs, float)], -1)
    n = fbm(p, 5, seed=seed, period=(8, max(1, int(8 / stretch)), None))
    ridge = 1 - np.abs(noise2d_tile(W, H, 8, 3, seed + 1))
    ridge = ridge ** 3
    base = np.array(base)
    c = base * (0.45 + 0.75 * sstep(-0.6, 0.8, n))[..., None]
    c = c * (0.55 + 0.6 * (1 - ridge))[..., None]
    return to_img(c)

def wood_planks(S=256):
    ys, xs = np.mgrid[0:S, 0:S]
    plank = (ys // (S // 4))
    p = np.stack([xs / S * 2, ys / S * 24 + plank * 3.1, np.zeros_like(xs, float)], -1)
    n = fbm(p, 4, seed=31, period=(2, 24, None))
    grain = np.sin((ys / S * 60 + n * 6) * np.pi) * 0.5 + 0.5
    base = np.array([0.62, 0.45, 0.28])
    c = base * (0.75 + 0.2 * grain + 0.15 * n)[..., None]
    c = c * (0.85 + 0.15 * ((plank * 37 % 7) / 7))[..., None]
    gap = (ys % (S // 4)) < 3
    c[gap] *= 0.35
    return to_img(c)

def metal_rust(S=256):
    n = noise2d_tile(S, S, 6, 5, 41)
    n2 = noise2d_tile(S, S, 24, 3, 42)
    steel = np.array([0.16, 0.155, 0.15]); rust = np.array([0.38, 0.18, 0.08]); soot = np.array([0.05, 0.045, 0.04])
    c = lerp(steel, rust, sstep(0.25, 0.65, n + 0.3 * n2))
    c = lerp(c, soot, sstep(0.1, 0.6, -n + 0.2 * n2) * 0.8)
    return to_img(c * (0.9 + 0.2 * n2[..., None]))

def leaves(S=512, kind="birch", seed=51):
    """RGBA leaf cluster cards."""
    big = S * 2
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(seed)
    cx = big / 2
    if kind == "birch":
        greens = [(98, 128, 38), (122, 150, 46), (82, 112, 34), (140, 160, 52), (175, 160, 50), (200, 170, 40)]
        # twigs
        for k in range(6):
            a = rng.uniform(0, 2 * np.pi)
            d.line([(cx, cx), (cx + np.cos(a) * big * 0.38, cx + np.sin(a) * big * 0.38)], fill=(70, 55, 40, 255), width=3)
        for _ in range(320):
            r = big * 0.42 * np.sqrt(rng.random()); a = rng.uniform(0, 2 * np.pi)
            x, y = cx + np.cos(a) * r, cx + np.sin(a) * r
            L = rng.uniform(40, 66); Wd = L * 0.62; rot = rng.uniform(0, 2 * np.pi)
            col = greens[rng.choice(len(greens), p=[0.24, 0.24, 0.2, 0.18, 0.08, 0.06])]
            sh = rng.uniform(0.8, 1.15)
            col = tuple(int(min(255, v * sh)) for v in col) + (255,)
            pts = []
            for k in range(16):
                t = k / 15 * np.pi * 2
                rr = (np.abs(np.cos(t / 2)) ** 0.6)
                px = np.cos(t) * L / 2; py = np.sin(t) * Wd / 2 * (1 - 0.35 * np.cos(t))
                saw = 1 + 0.06 * (k % 2)
                pts.append((x + (px * np.cos(rot) - py * np.sin(rot)) * saw, y + (px * np.sin(rot) + py * np.cos(rot)) * saw))
            d.polygon(pts, fill=col)
            d.line([(x - np.cos(rot) * L / 2, y - np.sin(rot) * L / 2), (x + np.cos(rot) * L / 2, y + np.sin(rot) * L / 2)],
                   fill=tuple(int(v * 0.75) for v in col[:3]) + (255,), width=2)
    else:  # spruce branch spray: central twig with dense side twigs
        d.line([(cx, big * 0.02), (cx, big * 0.98)], fill=(72, 52, 36, 255), width=7)
        def needles(x0, y0, x1, y1, n, Lmin, Lmax):
            dx, dy = x1 - x0, y1 - y0
            ang = np.arctan2(dy, dx)
            for _ in range(n):
                t = rng.random()
                px, py = x0 + dx * t, y0 + dy * t
                a = ang + rng.choice([-1, 1]) * np.radians(rng.uniform(35, 75))
                L = rng.uniform(Lmin, Lmax) * (1 - 0.4 * t)
                g = rng.uniform(0.65, 1.25)
                col = (int(28 * g), int(60 * g + 6 * rng.random()), int(36 * g), 255)
                d.line([(px, py), (px + np.cos(a) * L, py + np.sin(a) * L)], fill=col, width=3)
        needles(cx, big * 0.02, cx, big * 0.98, 500, 22, 40)
        for k in range(15):
            t = 0.06 + k * 0.06
            y = big * t
            for side in (-1, 1):
                span = big * 0.44 * (1 - abs(t - 0.45) * 0.9)
                x1 = cx + side * span; y1 = y - big * 0.07
                d.line([(cx, y), (x1, y1)], fill=(64, 46, 32, 255), width=4)
                needles(cx, y, x1, y1, 120, 16, 30)
    return img.resize((S, S), Image.LANCZOS)

def stripes(W=32, H=64):
    a = np.zeros((H, W, 3))
    ys = np.arange(H)[:, None]
    white = (ys % H) < H * 0.55
    a[:] = np.array([0.10, 0.14, 0.42])
    a[white[:, 0]] = np.array([0.95, 0.95, 0.93])
    return to_img(a)

def flannel(S=128):
    ys, xs = np.mgrid[0:S, 0:S]
    a = ((xs // 16) % 2) * 0.5 + ((ys // 16) % 2) * 0.5
    thin = ((xs % 32) < 2) | ((ys % 32) < 2)
    base = np.array([0.55, 0.10, 0.08])
    dark = np.array([0.12, 0.05, 0.05])
    c = lerp(base, dark, a * 0.75)
    c[thin] = np.array([0.85, 0.75, 0.55])
    return to_img(c)

def charcoal_label(W=256, H=256):
    img = Image.new("RGB", (W, H), (176, 136, 92))
    n = noise2d_tile(W, H, 8, 3, 61)
    arr = np.asarray(img).astype(float) / 255 * (0.9 + 0.12 * n[..., None])
    img = to_img(arr)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 80, W, 176], fill=(170, 30, 25))
    try:
        f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 46)
        f2 = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 20)
        d.text((W / 2, 112), "УГОЛЬ", font=f, fill=(250, 235, 210), anchor="mm")
        d.text((W / 2, 155), "БЕРЁЗОВЫЙ  3 кг", font=f2, fill=(250, 220, 180), anchor="mm")
        d.text((W / 2, 40), "ДЛЯ МАНГАЛА", font=f2, fill=(40, 30, 20), anchor="mm")
    except Exception:
        pass
    return img

def wood_end(S=128):
    ys, xs = np.mgrid[0:S, 0:S]
    u, v = xs / S * 2 - 1, ys / S * 2 - 1
    r = np.sqrt(u * u + v * v)
    p = np.stack([u * 3, v * 3, np.zeros_like(u)], -1)
    n = fbm(p, 3, seed=71)
    rings = np.sin((r * 14 + n * 1.2) * np.pi) * 0.5 + 0.5
    c = lerp(np.array([0.78, 0.62, 0.42]), np.array([0.58, 0.42, 0.26]), rings * 0.7)
    c = lerp(c, np.array([0.30, 0.20, 0.12]), sstep(0.86, 0.95, r))
    return to_img(c)
