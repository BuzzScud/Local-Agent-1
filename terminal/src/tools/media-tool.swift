// Agentic Coder's media helper, built on first use with the Mac's own Swift
// (media.mjs keeps the built copy in ~/.agentic-coder/tools). It uses only what
// macOS has: PDFKit for PDFs, ImageIO for pictures, AppKit for the clipboard.
//   pdf-text <file.pdf>                       → JSON {"pages": ["text of page 1", …]}
//   pdf-page <file.pdf> <page> <out.png> <max> → that page as a PNG, its long side at most <max> px
//   image <in> <out.jpg> <max>                → a JPEG, long side at most <max> px → JSON {"w","h"}
//   clipboard <out.png>                       → the clipboard's image as a PNG (exit 3: none there)
//   thumb <in> <cols> <rows>                  → JSON {"w","h","srcW","srcH","px"}: the picture as at most cols × rows·2 dots,
//                                               px = 6 hex digits a dot, row by row from the top ("------": see-through)
//   qlthumb <in> <cols> <rows>                → the same for any file or folder, from Quick Look's own thumbnail (a document's
//                                               first page, a video's frame), or its Finder icon ("icon": true); exit 6: none in 5 s
//   text-image <out.png> <w> <h> <text>       → black text on white (the tests' pictures)
//   text-pdf <out.pdf> <page> [<page> …]      → a PDF with one page of text per argument (the tests' PDFs)
//   screen-access                             → "yes" when this terminal may take pictures of the screen (Screen Recording), else "no"
//   screen-ask                                → asks macOS for it (its dialog, shown once), then as screen-access
//   windows                                   → JSON {"front": app, "windows": [{id, app, title, x, y, w, h}]}, front to back
import AppKit
import Foundation
import ImageIO
import PDFKit
import QuickLookThumbnailing
import UniformTypeIdentifiers

func fail(_ message: String, _ code: Int32 = 1) -> Never {
  FileHandle.standardError.write((message + "\n").data(using: .utf8)!)
  exit(code)
}

func writePNG(_ image: CGImage, to path: String) {
  guard let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: path) as CFURL, UTType.png.identifier as CFString, 1, nil) else { fail("cannot write \(path)") }
  CGImageDestinationAddImage(dest, image, nil)
  if !CGImageDestinationFinalize(dest) { fail("cannot write \(path)") }
}

// A picture no larger than `max` on its long side (never made larger).
func scaled(_ image: CGImage, max: Int) -> CGImage {
  let w = image.width, h = image.height
  let s = min(1.0, Double(max) / Double(Swift.max(w, h)))
  if s >= 1.0 { return image }
  let nw = Swift.max(1, Int(Double(w) * s)), nh = Swift.max(1, Int(Double(h) * s))
  guard let ctx = CGContext(data: nil, width: nw, height: nh, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return image }
  ctx.interpolationQuality = .high
  ctx.draw(image, in: CGRect(x: 0, y: 0, width: nw, height: nh))
  return ctx.makeImage() ?? image
}

// A picture as at most cols × rows·2 dots: JSON {"w","h","srcW","srcH","px"} (+ extra), px 6 hex digits a dot,
// row by row from the top. Half see-through or more is left out (a window's shadow): "------".
func dots(_ img: CGImage, cols: Int, rows: Int, extra: String) -> String {
  let s = min(Double(cols) / Double(img.width), Double(rows * 2) / Double(img.height))
  let w = Swift.max(1, Int((Double(img.width) * s).rounded())), h = Swift.max(1, Int((Double(img.height) * s).rounded()))
  var buf = [UInt8](repeating: 0, count: w * h * 4)
  let drawn: Bool = buf.withUnsafeMutableBytes { raw in
    guard let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
    ctx.interpolationQuality = .high
    ctx.draw(scaled(img, max: 512), in: CGRect(x: 0, y: 0, width: w, height: h))
    return true
  }
  if !drawn { fail("cannot draw") }
  // The buffer's first row is the picture's top.
  var px = ""
  px.reserveCapacity(w * h * 6)
  for i in 0..<(w * h) {
    let a = Int(buf[i * 4 + 3])
    if a < 128 { px += "------"; continue }
    for k in 0..<3 { px += String(format: "%02x", Swift.min(255, Int(buf[i * 4 + k]) * 255 / a)) }
  }
  return "{\"w\":\(w),\"h\":\(h),\"srcW\":\(img.width),\"srcH\":\(img.height),\"px\":\"\(px)\"\(extra)}"
}

let args = CommandLine.arguments
guard args.count >= 2 else { fail("usage: media-tool pdf-text|pdf-page|image|clipboard|text-image …") }

switch args[1] {
case "pdf-text":
  guard args.count >= 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[2])) else { fail("cannot open the PDF") }
  if doc.isLocked { fail("the PDF is locked with a password", 4) }
  var pages: [String] = []
  for i in 0..<doc.pageCount { pages.append(doc.page(at: i)?.string ?? "") }
  let data = try! JSONSerialization.data(withJSONObject: ["pages": pages])
  FileHandle.standardOutput.write(data)

case "pdf-page":
  guard args.count >= 6, let doc = PDFDocument(url: URL(fileURLWithPath: args[2])), let n = Int(args[3]), let max = Int(args[5]) else { fail("usage: pdf-page <file> <page> <out.png> <max>") }
  guard n >= 1, n <= doc.pageCount, let page = doc.page(at: n - 1) else { fail("no page \(n): the PDF has \(doc.pageCount)", 5) }
  let box = page.bounds(for: .mediaBox)
  let s = Double(max) / Double(Swift.max(box.width, box.height))
  let size = NSSize(width: box.width * s, height: box.height * s)
  let thumb = page.thumbnail(of: size, for: .mediaBox)
  guard let cg = thumb.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fail("cannot draw page \(n)") }
  writePNG(cg, to: args[4])
  print("{\"w\":\(cg.width),\"h\":\(cg.height),\"pages\":\(doc.pageCount)}")

case "image":
  guard args.count >= 5, let max = Int(args[4]) else { fail("usage: image <in> <out.jpg> <max>") }
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fail("not a picture macOS can open") }
  let out = scaled(img, max: max)
  guard let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[3]) as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { fail("cannot write \(args[3])") }
  CGImageDestinationAddImage(dest, out, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
  if !CGImageDestinationFinalize(dest) { fail("cannot write \(args[3])") }
  print("{\"w\":\(out.width),\"h\":\(out.height),\"srcW\":\(img.width),\"srcH\":\(img.height)}")

case "clipboard":
  guard args.count >= 3 else { fail("usage: clipboard <out.png>") }
  let pb = NSPasteboard.general
  guard let image = NSImage(pasteboard: pb), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fail("no picture on the clipboard", 3) }
  writePNG(cg, to: args[2])
  print("{\"w\":\(cg.width),\"h\":\(cg.height)}")

case "thumb":
  // A dot is half a Terminal cell (the prompt box's tray draws two in one with ▀), so a cell is two dots tall.
  guard args.count >= 5, let cols = Int(args[3]), let rows = Int(args[4]), cols > 0, rows > 0 else { fail("usage: thumb <in> <cols> <rows>") }
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: args[2]) as CFURL, nil), let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fail("not a picture macOS can open") }
  print(dots(img, cols: cols, rows: rows, extra: ""))

case "qlthumb":
  // QLThumbnailGenerator, not qlmanage -t: that one never returns for a folder or a zip (8 Oct 2026).
  guard args.count >= 5, let cols = Int(args[3]), let rows = Int(args[4]), cols > 0, rows > 0 else { fail("usage: qlthumb <in> <cols> <rows>") }
  let req = QLThumbnailGenerator.Request(fileAt: URL(fileURLWithPath: args[2]), size: CGSize(width: 256, height: 256), scale: 1, representationTypes: .all)
  let done = DispatchSemaphore(value: 0)
  var got: (CGImage, Bool)? = nil
  QLThumbnailGenerator.shared.generateBestRepresentation(for: req) { rep, _ in
    if let rep = rep { got = (rep.cgImage, rep.type == .icon) }
    done.signal()
  }
  if done.wait(timeout: .now() + 5) == .timedOut { fail("Quick Look made no picture of it", 6) }
  guard let (img, icon) = got else { fail("Quick Look made no picture of it", 6) }
  print(dots(img, cols: cols, rows: rows, extra: ",\"icon\":\(icon)"))

case "text-image":
  guard args.count >= 6, let w = Int(args[3]), let h = Int(args[4]) else { fail("usage: text-image <out.png> <w> <h> <text>") }
  guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fail("cannot draw") }
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  let ns = NSGraphicsContext(cgContext: ctx, flipped: false)
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = ns
  let font = NSFont.boldSystemFont(ofSize: CGFloat(h) / 4)
  let text = NSAttributedString(string: args[5], attributes: [.font: font, .foregroundColor: NSColor.black])
  let size = text.size()
  text.draw(at: NSPoint(x: (CGFloat(w) - size.width) / 2, y: (CGFloat(h) - size.height) / 2))
  NSGraphicsContext.restoreGraphicsState()
  guard let img = ctx.makeImage() else { fail("cannot draw") }
  writePNG(img, to: args[2])

case "text-pdf":
  guard args.count >= 4 else { fail("usage: text-pdf <out.pdf> <page text> …") }
  var box = CGRect(x: 0, y: 0, width: 612, height: 792)
  guard let pdf = CGContext(URL(fileURLWithPath: args[2]) as CFURL, mediaBox: &box, nil) else { fail("cannot write \(args[2])") }
  for text in args[3...] {
    pdf.beginPDFPage(nil)
    let ns = NSGraphicsContext(cgContext: pdf, flipped: false)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = ns
    NSAttributedString(string: text, attributes: [.font: NSFont.systemFont(ofSize: 18)]).draw(in: CGRect(x: 54, y: 54, width: 504, height: 684))
    NSGraphicsContext.restoreGraphicsState()
    pdf.endPDFPage()
  }
  pdf.closePDF()

case "screen-access":
  print(CGPreflightScreenCaptureAccess() ? "yes" : "no")

case "screen-ask":
  print(CGRequestScreenCaptureAccess() ? "yes" : "no")

case "windows":
  // The windows on screen, front to back: apps' own windows only (layer 0), none too small to
  // read. Without Screen Recording macOS leaves the titles out; the apps and sizes are there.
  let opts = CGWindowListOption(arrayLiteral: .optionOnScreenOnly, .excludeDesktopElements)
  let info = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] ?? []
  var list: [[String: Any]] = []
  for w in info {
    guard (w[kCGWindowLayer as String] as? Int) == 0, let id = w[kCGWindowNumber as String] as? Int,
          let b = w[kCGWindowBounds as String] as? [String: Any] else { continue }
    let width = (b["Width"] as? Double) ?? 0, height = (b["Height"] as? Double) ?? 0
    if width < 60 || height < 40 { continue }
    list.append(["id": id, "app": (w[kCGWindowOwnerName as String] as? String) ?? "", "title": (w[kCGWindowName as String] as? String) ?? "",
                 "x": (b["X"] as? Double) ?? 0, "y": (b["Y"] as? Double) ?? 0, "w": width, "h": height])
  }
  let front = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
  let data = try! JSONSerialization.data(withJSONObject: ["front": front, "windows": list])
  print(String(data: data, encoding: .utf8)!)

default:
  fail("unknown command \(args[1])")
}
