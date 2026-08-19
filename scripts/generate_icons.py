#!/usr/bin/env python3
"""生成 MetroRestroom 小程序全部图标：TabBar + 应用 Logo。

设计统一为「苹果蓝 #007AFF」主色，图标语义贴合「上海地铁厕所查询」主题。
"""

import os
from PIL import Image, ImageDraw

BASE_DIR = os.path.dirname(__file__)
ICONS_DIR = os.path.join(BASE_DIR, '..', 'miniprogram', 'images', 'icons')
LOGO_DIR = os.path.join(BASE_DIR, '..', 'miniprogram', 'images')
os.makedirs(ICONS_DIR, exist_ok=True)
os.makedirs(LOGO_DIR, exist_ok=True)

# 颜色系统
BLUE = (0, 122, 255, 255)      # 苹果蓝，对应 selectedColor / 品牌主色
WHITE = (255, 255, 255, 255)
GRAY = (138, 138, 138, 255)    # TabBar 未选中色
LIGHT_GRAY = (162, 169, 176, 255)
BG_TRANSPARENT = (0, 0, 0, 0)


def rounded_square(draw, xy, radius, fill=None, outline=None, width=1):
    """兼容旧版 Pillow 的圆角矩形绘制。"""
    try:
        draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)
    except AttributeError:
        draw.rectangle(xy, fill=fill, outline=outline, width=width)


def create(size):
    return Image.new('RGBA', (size, size), BG_TRANSPARENT)


# ---------------------------------------------------------------------------
# TabBar：首页
# ---------------------------------------------------------------------------
def draw_restroom_door(draw, size, color, fill_door=False, cutout_color=None):
    """洗手间门 + 人物剪影，居中绘制。"""
    pad = size // 8
    x1, y1 = pad, pad - size // 24
    x2, y2 = size - pad, size - pad
    radius = max(3, size // 14)
    sw = max(2, size // 16)

    if fill_door:
        rounded_square(draw, [x1, y1, x2, y2], radius, fill=color)
    else:
        rounded_square(draw, [x1, y1, x2, y2], radius, outline=color, width=sw)

    # 人物剪影：头部 + 身体，整体居中
    head_r = max(3, size // 10)
    cx = size // 2
    head_cy = y1 + (y2 - y1) * 0.32
    body_w = max(5, size // 5)
    body_h = max(8, int((y2 - head_cy - head_r) * 0.78))

    figure_color = cutout_color if cutout_color else color
    draw.ellipse(
        [(cx - head_r, head_cy - head_r), (cx + head_r, head_cy + head_r)],
        fill=figure_color,
    )
    body_top = head_cy + head_r - 1
    rounded_square(
        draw,
        [cx - body_w // 2, body_top, cx + body_w // 2, body_top + body_h],
        radius=max(2, size // 22),
        fill=figure_color,
    )


def generate_home_icons(size=48):
    inactive = create(size)
    draw_restroom_door(ImageDraw.Draw(inactive), size, GRAY, fill_door=False)

    active = create(size)
    draw_restroom_door(ImageDraw.Draw(active), size, BLUE, fill_door=True, cutout_color=WHITE)

    inactive.save(os.path.join(ICONS_DIR, 'home.png'))
    active.save(os.path.join(ICONS_DIR, 'home-active.png'))


# ---------------------------------------------------------------------------
# TabBar：我的
# ---------------------------------------------------------------------------
def draw_user_icon(draw, size, color):
    """简洁的人物头像轮廓。"""
    cx = size // 2
    head_r = max(4, size // 7)
    head_cy = size * 0.34
    draw.ellipse(
        [(cx - head_r, head_cy - head_r), (cx + head_r, head_cy + head_r)],
        fill=color,
    )
    # 身体用半圆弧线模拟肩膀
    body_r = max(9, size * 0.36)
    body_box = [cx - body_r, head_cy + head_r - 2, cx + body_r, head_cy + head_r - 2 + body_r * 2]
    draw.pieslice(body_box, start=0, end=180, fill=color)


def generate_user_icons(size=48):
    inactive = create(size)
    draw_user_icon(ImageDraw.Draw(inactive), size, LIGHT_GRAY)

    active = create(size)
    draw_user_icon(ImageDraw.Draw(active), size, BLUE)

    inactive.save(os.path.join(ICONS_DIR, 'usercenter.png'))
    active.save(os.path.join(ICONS_DIR, 'usercenter-active.png'))


# ---------------------------------------------------------------------------
# 应用 Logo：地铁 + 厕所主题
# ---------------------------------------------------------------------------
def draw_metro_restroom_logo(draw, size):
    """绘制「地铁站入口 + WC 标识」融合图标。

    造型：一个圆角方形蓝色背景上，白色地铁隧道拱门上立着一个简化的
    洗手间门 / WC 标识，让人一眼联想到「地铁里的厕所」。
    """
    # 背景已经是蓝色，这里只画白色图形
    pad = size // 7
    cx = size // 2

    # 1) 地铁隧道拱门（半圆 + 矩形门洞）
    arch_w = size - pad * 2
    arch_h = size * 0.66
    arch_left = cx - arch_w // 2
    arch_top = size - pad - arch_h
    arch_box = [arch_left, arch_top, arch_left + arch_w, arch_top + arch_h]
    draw.pieslice(arch_box, start=0, end=180, fill=WHITE)

    # 2) 拱门内画一个洗手间门形（与 TabBar home 图标呼应）
    door_w = int(arch_w * 0.42)
    door_h = int(arch_h * 0.72)
    door_x1 = cx - door_w // 2
    door_y1 = arch_top + arch_h - door_h  # 门底与拱门底部对齐
    door_x2 = door_x1 + door_w
    door_y2 = door_y1 + door_h
    door_radius = max(4, size // 22)
    rounded_square(draw, [door_x1, door_y1, door_x2, door_y2], door_radius, fill=BLUE)

    # 3) 门上的人物剪影（白色）
    figure_color = WHITE
    head_r = max(3, size // 14)
    head_cy = door_y1 + door_h * 0.25
    draw.ellipse(
        [(cx - head_r, head_cy - head_r), (cx + head_r, head_cy + head_r)],
        fill=figure_color,
    )
    body_w = max(5, size // 9)
    body_h = max(7, int((door_y2 - head_cy - head_r) * 0.72))
    body_top = head_cy + head_r - 1
    rounded_square(
        draw,
        [cx - body_w // 2, body_top, cx + body_w // 2, body_top + body_h],
        radius=max(2, size // 30),
        fill=figure_color,
    )

    # 4) 门顶小方块作为 WC / 站名灯箱
    sign_w = door_w
    sign_h = max(4, size // 14)
    sign_y = door_y1 - sign_h - size // 40
    rounded_square(
        draw,
        [cx - sign_w // 2, sign_y, cx + sign_w // 2, sign_y + sign_h],
        radius=max(2, size // 40),
        fill=WHITE,
    )


def generate_app_logo(size=192):
    img = Image.new('RGBA', (size, size), BLUE)
    draw = ImageDraw.Draw(img)
    draw_metro_restroom_logo(draw, size)
    img.save(os.path.join(LOGO_DIR, 'logo.png'))


def main():
    generate_home_icons(48)
    generate_user_icons(48)
    generate_app_logo(192)
    print('全部图标已生成/刷新：')
    print('  TabBar: home.png / home-active.png / usercenter.png / usercenter-active.png')
    print('  Logo:   miniprogram/images/logo.png')


if __name__ == '__main__':
    main()
