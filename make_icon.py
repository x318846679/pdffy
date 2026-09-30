#!/usr/bin/env python3
# 生成扩展图标（纯标准库，无需 Pillow）
import struct, zlib, os

OUT = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(OUT, exist_ok=True)

BLUE = (26, 115, 232, 255)
WHITE = (255, 255, 255, 255)


def write_png(path, w, h, px):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw.extend(px[y * w * 4:(y + 1) * w * 4])
    comp = zlib.compress(bytes(raw), 9)

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data +
                struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", comp))
        f.write(chunk(b"IEND", b""))


def make(size):
    w = h = size
    px = bytearray(w * h * 4)
    for i in range(w * h):
        px[i * 4:i * 4 + 4] = bytes(BLUE)

    # 圆角：四角透明
    r = max(2, size // 6)
    for y in range(h):
        for x in range(w):
            if x < r and y < r and (x - r) ** 2 + (y - r) ** 2 > r * r:
                px[(y * w + x) * 4 + 3] = 0
            if x >= w - r and y < r and (x - (w - r)) ** 2 + (y - r) ** 2 > r * r:
                px[(y * w + x) * 4 + 3] = 0
            if x < r and y >= h - r and (x - r) ** 2 + (y - (h - r)) ** 2 > r * r:
                px[(y * w + x) * 4 + 3] = 0
            if x >= w - r and y >= h - r and (x - (w - r)) ** 2 + (y - (h - r)) ** 2 > r * r:
                px[(y * w + x) * 4 + 3] = 0

    def rect(x0, y0, x1, y1, color):
        for y in range(max(0, int(y0)), min(h, int(y1))):
            for x in range(max(0, int(x0)), min(w, int(x1))):
                px[(y * w + x) * 4:(y * w + x) * 4 + 4] = bytes(color)

    def round_rect(x0, y0, x1, y1, rad, color):
        for y in range(max(0, int(y0)), min(h, int(y1))):
            for x in range(max(0, int(x0)), min(w, int(x1))):
                cx = cy = None
                if x - x0 < rad and y - y0 < rad:
                    cx, cy = x0 + rad, y0 + rad
                elif x1 - x < rad and y - y0 < rad:
                    cx, cy = x1 - rad, y0 + rad
                elif x - x0 < rad and y1 - y < rad:
                    cx, cy = x0 + rad, y1 - rad
                elif x1 - x < rad and y1 - y < rad:
                    cx, cy = x1 - rad, y1 - rad
                if cx is not None and (x - cx) ** 2 + (y - cy) ** 2 > rad * rad:
                    continue
                px[(y * w + x) * 4:(y * w + x) * 4 + 4] = bytes(color)

    def tri(p1, p2, p3, color):
        (x1, y1), (x2, y2), (x3, y3) = p1, p2, p3
        minx, maxx = max(0, int(min(x1, x2, x3))), min(w, int(max(x1, x2, x3)) + 1)
        miny, maxy = max(0, int(min(y1, y2, y3))), min(h, int(max(y1, y2, y3)) + 1)
        def sign(ax, ay, bx, by, cx, cy):
            return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy)
        for y in range(miny, maxy):
            for x in range(minx, maxx):
                d1 = sign(x, y, x1, y1, x2, y2)
                d2 = sign(x, y, x2, y2, x3, y3)
                d3 = sign(x, y, x3, y3, x1, y1)
                neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
                pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
                if not (neg and pos):
                    px[(y * w + x) * 4:(y * w + x) * 4 + 4] = bytes(color)

    # 白色对话气泡（翻译意象）
    bw0, bw1 = w * 0.20, w * 0.80
    bh0, bh1 = h * 0.16, h * 0.66
    round_rect(bw0, bh0, bw1, bh1, w * 0.12, WHITE)
    # 气泡小尾巴
    tri((w * 0.30, h * 0.66), (w * 0.30, h * 0.80), (w * 0.42, h * 0.66), WHITE)

    # 气泡内蓝色文字条（暗示文本）
    lh = h * 0.055
    y = h * 0.30
    widths = [(w * 0.30, w * 0.70), (w * 0.30, w * 0.62), (w * 0.30, w * 0.66)]
    for (x0, x1) in widths:
        round_rect(x0, y, x1, y + lh, lh / 2, BLUE)
        y += h * 0.13

    write_png(os.path.join(OUT, f"icon{size}.png"), w, h, px)
    print("written", f"icon{size}.png")


for s in (16, 48, 128):
    make(s)
