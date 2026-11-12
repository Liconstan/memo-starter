// Still frames of a video, with what macOS already has: scripts/video-frames.swift (AVFoundation), built one time
// with swiftc into <binDir>/video-frames, or qlmanage for one thumbnail when there is no Swift compiler. Nothing is
// installed. Each step runs as a child process with a time limit, so the server never waits on a video for long.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'video-frames.swift');

// binDir: where the built tool goes (the folder of the videos). timeout: for one video, in ms.
// count: the frames of one video. maxWidth: the width of a frame, in pixels. log: one line for a failure.
export function createFrames({ binDir, timeout = 90000, count = 6, maxWidth = 1280, log = (line) => console.error(line), source = SOURCE } = {}) {
  const bin = join(binDir, 'video-frames');
  let building = null;
  let method = null; // 'swift', 'qlmanage', or 'none' once known

  const which = async (tool) => { try { await run('xcrun', ['--find', tool], { timeout: 20000 }); return true; } catch { return false; } };

  // Builds the tool when it is missing or older than its source. One build at a time; a failure falls back to qlmanage.
  function prepare() {
    if (method) return Promise.resolve(method);
    building ||= (async () => {
      try {
        if (!existsSync(source)) throw new Error(`${source} is missing`);
        const fresh = existsSync(bin) && statSync(bin).mtimeMs >= statSync(source).mtimeMs;
        if (!fresh) {
          if (!(await which('swiftc'))) throw new Error('no swiftc');
          mkdirSync(binDir, { recursive: true });
          await run('swiftc', ['-O', '-o', bin, source], { timeout: 180000 });
        }
        method = 'swift';
      } catch (err) {
        log(`video frames: the Swift tool is not available (${err.message.split('\n')[0]}); one thumbnail with qlmanage instead.`);
        method = existsSync('/usr/bin/qlmanage') ? 'qlmanage' : 'none';
      }
      return method;
    })();
    return building;
  }

  // The frames of one video: [{ bytes, seconds }], JPEG. An empty list when no frame can be made.
  async function make(videoPath) {
    const how = await prepare();
    if (how === 'none') return [];
    const out = mkdtempSync(join(tmpdir(), 'memo-frames-'));
    try {
      if (how === 'swift') {
        const { stdout } = await run(bin, [videoPath, out, String(count), String(maxWidth)], { timeout, maxBuffer: 1 << 20 });
        return stdout.split('\n').filter(Boolean).map((line) => {
          const [file, seconds] = line.split('\t');
          return { bytes: readFileSync(file), seconds: Number(seconds) || 0 };
        });
      }
      // qlmanage gives one PNG thumbnail; sips makes a JPEG of it.
      await run('qlmanage', ['-t', '-s', String(maxWidth), '-o', out, videoPath], { timeout });
      const png = readdirSync(out).find((f) => f.endsWith('.png'));
      if (!png) return [];
      await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '72', join(out, png), '--out', join(out, 'frame-1.jpg')], { timeout: 30000 });
      return [{ bytes: readFileSync(join(out, 'frame-1.jpg')), seconds: 0 }];
    } catch (err) {
      log(`video frames: ${err.message.split('\n')[0]}`);
      return [];
    } finally { rmSync(out, { recursive: true, force: true }); }
  }
  return { prepare, make, method: () => method };
}
