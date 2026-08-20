#!/usr/bin/env python3
"""生成微信 TabBar 图标：首页与个人中心使用统一的线性图标。"""

import os
from PIL import Image, ImageDraw

ICONS_DIR = os.path.join(os.path.dirname(__file__), '..', 'miniprogram', 'images', 'icons')
SIZE = 48

# 颜色
SCALE = 4
BLUE = (0, 122, 255, 255)
GRAY = (138, 138, 138, 255)


def icon_canvas():
    return Image.new('RGBA', (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))


def draw_home(draw, color):
    """屋檐、门洞和基座，表达首页入口。"""
    width = 3 * SCALE
    draw.line([(8 * SCALE, 23 * SCALE), (24 * SCALE, 9 * SCALE), (40 * SCALE, 23 * SCALE)], fill=color, width=width, joint='curve')
    draw.line([(12 * SCALE, 20 * SCALE), (12 * SCALE, 39 * SCALE), (36 * SCALE, 39 * SCALE), (36 * SCALE, 20 * SCALE)], fill=color, width=width, joint='curve')
    draw.rounded_rectangle([20 * SCALE, 29 * SCALE, 28 * SCALE, 39 * SCALE], radius=2 * SCALE, outline=color, width=width)


def draw_user(draw, color):
    """圆形头像与肩部轮廓，表达个人中心入口。"""
    width = 3 * SCALE
    draw.ellipse([18 * SCALE, 8 * SCALE, 30 * SCALE, 20 * SCALE], outline=color, width=width)
    draw.arc([11 * SCALE, 18 * SCALE, 37 * SCALE, 44 * SCALE], start=198, end=342, fill=color, width=width)
    draw.line([(11 * SCALE, 31 * SCALE), (11 * SCALE, 39 * SCALE), (37 * SCALE, 39 * SCALE), (37 * SCALE, 31 * SCALE)], fill=color, width=width, joint='curve')


def save_icon(filename, painter, color):
    image = icon_canvas()
    painter(ImageDraw.Draw(image), color)
    image.resize((SIZE, SIZE), Image.Resampling.LANCZOS).save(
        os.path.join(ICONS_DIR, filename),
    )


def main():
    save_icon('home.png', draw_home, GRAY)
    save_icon('home-active.png', draw_home, BLUE)
    save_icon('usercenter.png', draw_user, GRAY)
    save_icon('usercenter-active.png', draw_user, BLUE)
    print('TabBar 图标已生成：首页与个人中心线性图标（普通／选中态）。')


if __name__ == '__main__':
    main()
