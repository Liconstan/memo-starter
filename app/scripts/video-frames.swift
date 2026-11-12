// Still frames of a video, with what macOS already has (AVFoundation). No ffmpeg.
// usage: video-frames <video> <out-dir> [count] [max-width]
// Writes <out-dir>/frame-1.jpg ... frame-<count>.jpg, evenly spaced over the duration, each at most max-width
// pixels wide, and prints one line for each frame: "<file>\t<seconds>". A frame that cannot be made is skipped.
// src/frames.js builds this with swiftc at first use and runs the binary.
import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
if args.count < 3 {
  FileHandle.standardError.write("usage: video-frames <video> <out-dir> [count] [max-width]\n".data(using: .utf8)!)
  exit(2)
}
let video = URL(fileURLWithPath: args[1])
let outDir = URL(fileURLWithPath: args[2])
let count = max(1, args.count > 3 ? Int(args[3]) ?? 6 : 6)
let maxWidth = max(16, args.count > 4 ? Int(args[4]) ?? 1280 : 1280)
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)

let asset = AVURLAsset(url: video)
let duration = CMTimeGetSeconds(asset.duration)
if !(duration > 0) || duration.isNaN {
  FileHandle.standardError.write("the video has no duration\n".data(using: .utf8)!)
  exit(1)
}
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.maximumSize = CGSize(width: maxWidth, height: maxWidth * 4)
// Exact times, so a short clip gets six different frames (the decoder starts at the key frame before each time).
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero

// Evenly spaced, away from the very start and the very end: 1/(2n), 3/(2n), ...
var made = 0
for i in 0..<count {
  let seconds = duration * (Double(i) + 0.5) / Double(count)
  let time = CMTime(seconds: seconds, preferredTimescale: 600)
  var actual = CMTime.zero
  guard let image = try? gen.copyCGImage(at: time, actualTime: &actual) else { continue }
  let file = outDir.appendingPathComponent("frame-\(i + 1).jpg")
  guard let dest = CGImageDestinationCreateWithURL(file as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { continue }
  CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.72] as CFDictionary)
  if CGImageDestinationFinalize(dest) {
    made += 1
    print("\(file.path)\t\(String(format: "%.2f", CMTimeGetSeconds(actual)))")
  }
}
exit(made > 0 ? 0 : 1)
