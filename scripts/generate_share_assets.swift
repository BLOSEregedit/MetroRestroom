import AppKit
import Foundation

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let logoURL = root.appendingPathComponent("miniprogram/images/logo.png")
let outputDirectory = root.appendingPathComponent("miniprogram/images/share")

guard let logo = NSImage(contentsOf: logoURL) else {
  fputs("无法读取 miniprogram/images/logo.png\n", stderr)
  exit(1)
}

try FileManager.default.createDirectory(
  at: outputDirectory,
  withIntermediateDirectories: true
)

func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1) -> NSColor {
  NSColor(srgbRed: red / 255, green: green / 255, blue: blue / 255, alpha: alpha)
}

func roundedRect(_ rect: NSRect, radius: CGFloat, fill: NSColor) {
  fill.setFill()
  NSBezierPath(roundedRect: rect, xRadius: radius, yRadius: radius).fill()
}

func drawText(
  _ text: String,
  in rect: NSRect,
  size: CGFloat,
  weight: NSFont.Weight,
  textColor: NSColor,
  alignment: NSTextAlignment = .left,
  lineHeight: CGFloat? = nil
) {
  let paragraph = NSMutableParagraphStyle()
  paragraph.alignment = alignment
  paragraph.lineBreakMode = .byWordWrapping
  if let height = lineHeight {
    paragraph.minimumLineHeight = height
    paragraph.maximumLineHeight = height
  }
  let attributes: [NSAttributedString.Key: Any] = [
    .font: NSFont.systemFont(ofSize: size, weight: weight),
    .foregroundColor: textColor,
    .paragraphStyle: paragraph,
  ]
  NSAttributedString(string: text, attributes: attributes).draw(in: rect)
}

func renderPNG(
  width: Int,
  height: Int,
  designWidth: CGFloat,
  designHeight: CGFloat,
  to url: URL,
  draw: () -> Void
) throws {
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: width,
    pixelsHigh: height,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ), let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    throw NSError(domain: "ShareAsset", code: 1)
  }

  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = context
  context.cgContext.scaleBy(
    x: CGFloat(width) / designWidth,
    y: CGFloat(height) / designHeight
  )
  draw()
  context.flushGraphics()
  NSGraphicsContext.restoreGraphicsState()

  guard let png = bitmap.representation(using: .png, properties: [:]) else {
    throw NSError(domain: "ShareAsset", code: 2)
  }
  try png.write(to: url)
}

func makeFriendImage() throws {
  try renderPNG(
    width: 600,
    height: 480,
    designWidth: 1000,
    designHeight: 800,
    to: outputDirectory.appendingPathComponent("share-friend.png")
  ) {
    color(246, 247, 248).setFill()
    NSRect(x: 0, y: 0, width: 1000, height: 800).fill()
    roundedRect(NSRect(x: 54, y: 54, width: 892, height: 692), radius: 48, fill: .white)
    roundedRect(NSRect(x: 54, y: 54, width: 14, height: 692), radius: 7, fill: color(0, 122, 255))

    logo.draw(in: NSRect(x: 112, y: 328, width: 230, height: 230))
    drawText("Metro 洗手间", in: NSRect(x: 112, y: 250, width: 260, height: 52), size: 34, weight: .semibold, textColor: color(31, 36, 41), alignment: .center)

    drawText("急用！", in: NSRect(x: 404, y: 428, width: 470, height: 88), size: 72, weight: .bold, textColor: color(0, 122, 255))
    drawText("就别绕圈～", in: NSRect(x: 404, y: 330, width: 500, height: 92), size: 72, weight: .bold, textColor: color(31, 36, 41))
    drawText("打开即用 · 位置一眼看清", in: NSRect(x: 407, y: 250, width: 480, height: 52), size: 29, weight: .medium, textColor: color(77, 91, 103))
    roundedRect(NSRect(x: 407, y: 228, width: 116, height: 8), radius: 4, fill: color(0, 168, 143))
  }
}

func makeTimelineImage() throws {
  try renderPNG(
    width: 600,
    height: 600,
    designWidth: 1000,
    designHeight: 1000,
    to: outputDirectory.appendingPathComponent("share-timeline.png")
  ) {
    color(248, 249, 250).setFill()
    NSRect(x: 0, y: 0, width: 1000, height: 1000).fill()

    logo.draw(in: NSRect(x: 75, y: 75, width: 850, height: 850))
  }
}

do {
  try makeFriendImage()
  try makeTimelineImage()
  print("已生成分享图片")
} catch {
  fputs("生成分享图片失败：\(error)\n", stderr)
  exit(1)
}
