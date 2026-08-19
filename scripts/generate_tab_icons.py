#!/usr/bin/env python3
"""生成微信 TabBar 图标：首页改用洗手间门形图标，选中态使用苹果蓝。"""

import math
import os
from PIL import Image, ImageDraw

ICONS_DIR = os.path.join(os.path.dirname(__file__), '..', 'miniprogram', 'images', 'icons')
SIZE = 48

# 颜色
BLUE = (0, 122, 255, 255)      # 苹果蓝，对应 app.json selectedColor / profile 主色
WHITE = (255, 255, 255, 255)
GRAY = (138, 138, 138, 255)    # 未选中灰，对应 tabBar color #8A8A8A
ORIGIN_GREEN = (7, 193, 96)      # 旧图标填充色


def create_base():
    return Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))


def draw_restroom_door(draw, color, fill_door=False, cutout_color=None):
    """绘制洗手间门 + 人物剪影图标。"""
    # 门板外框
    frame = [10, 6, 38, 42]
    radius = 4
    if fill_door:
        draw.rounded_rectangle(frame, radius=radius, fill=color)
    else:
        draw.rounded_rectangle(frame, radius=radius, outline=color, width=3)

    # 人物剪影
    head_box = [(19, 14), (29, 24)]        # 头部圆
    body_box = [19, 25, 29, 40]            # 身体（圆角矩形）
    body_radius = 2

    figure_color = cutout_color if cutout_color else color
    draw.ellipse(head_box, fill=figure_color)
    draw.rounded_rectangle(body_box, radius=body_radius, fill=figure_color)


def generate_home_icons():
    # 未选中：灰色轮廓门板 + 灰色人物
    inactive = create_base()
    draw_restroom_door(ImageDraw.Draw(inactive), GRAY, fill_door=False)

    # 选中：蓝色填充门板 + 白色人物镂空
    active = create_base()
    draw_restroom_door(ImageDraw.Draw(active), BLUE, fill_door=True, cutout_color=WHITE)

    inactive.save(os.path.join(ICONS_DIR, 'home.png'))
    active.save(os.path.join(ICONS_DIR, 'home-active.png'))


def _distance(c1, c2):
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(c1[:3], c2[:3])))


def recolor_green_to_blue(src_path, dst_path):
    """将旧绿色图标映射为苹果蓝，保留白色镂空与抗锯齿。"""
    img = Image.open(src_path).convert('RGBA')
    pixels = list(img.getdata())
    new_pixels = []
    for r, g, b, a in pixels:
        if a < 10:
            new_pixels.append((0, 0, 0, 0))
            continue

        # 判断颜色更靠近原始绿还是白色
        d_green = _distance((r, g, b), ORIGIN_GREEN)
        d_white = _distance((r, g, b), WHITE[:3])

        if d_green + d_white == 0:
            ratio = 1.0
        else:
            ratio = d_white / (d_green + d_white)
        ratio = max(0.0, min(1.0, ratio))

        nr = int(WHITE[0] * (1 - ratio) + BLUE[0] * ratio)
        ng = int(WHITE[1] * (1 - ratio) + BLUE[1] * ratio)
        nb = int(WHITE[2] * (1 - ratio) + BLUE[2] * ratio)
        new_pixels.append((nr, ng, nb, a))

    img.putdata(new_pixels)
    img.save(dst_path)


def generate_usercenter_active():
    recolor_green_to_blue(
        os.path.join(ICONS_DIR, 'usercenter-active.png'),
        os.path.join(ICONS_DIR, 'usercenter-active.png'),
    )


def main():
    generate_home_icons()
    generate_usercenter_active()
    print('TabBar 图标已生成：home.png / home-active.png / usercenter-active.png')


if __name__ == '__main__':
    main()
