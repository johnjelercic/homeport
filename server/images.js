const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const heicDecode = require('heic-decode');

// A Raspberry Pi has far less memory than a NAS, so keep sharp lean:
// no in-memory operation cache, and one libvips worker thread per image.
// Uploads are processed one photo at a time anyway (see
// normalizeUploadedPhoto's caller), so extra threads would only raise
// the peak memory of a big batch upload without making it much faster.
sharp.cache(false);
sharp.concurrency(1);

// Longest edge any stored photo is allowed to have. 3840px covers a 4K
// display natively in either orientation (landscape 3840x2160 or a
// portrait-mounted 2160x3840) with the photo frame's letterboxed
// `object-fit: contain`, so nothing is ever upscaled on anything up to 4K
// — while still cutting a 24/48MP phone photo to a fraction of its size.
// Aspect ratio is always preserved (fit: 'inside'), and a photo that's
// already this size or smaller is never enlarged.
const MAX_LONG_EDGE = 3840;
const JPEG_QUALITY = 90;

const HEIC_EXTENSIONS = new Set(['.heic', '.heif']);

function isHeic(filename) {
  return HEIC_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

const RESIZE_OPTS = {
  width: MAX_LONG_EDGE,
  height: MAX_LONG_EDGE,
  fit: 'inside',
  withoutEnlargement: true
};

// Decodes a HEIC/HEIF file straight to raw pixels and hands them to
// sharp, so the photo is only JPEG-encoded once (at the end) instead of
// HEIC -> JPEG -> resize -> JPEG again. libheif applies the file's own
// rotation (its `irot`/`imir` boxes) while decoding, so the pixels that
// come out are already upright.
async function sharpFromHeic(srcPath) {
  const { width, height, data } = await heicDecode({ buffer: fs.readFileSync(srcPath) });
  const pixels = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return { image: sharp(pixels, { raw: { width, height, channels: 4 } }), width, height };
}

// Writes a HEIC/HEIF file out as a (size-capped) JPEG at destPath.
// Returns whether it had to be scaled down.
async function heicToJpeg(srcPath, destPath) {
  const { image, width, height } = await sharpFromHeic(srcPath);
  await image.resize(RESIZE_OPTS).jpeg({ quality: JPEG_QUALITY }).toFile(destPath);
  return Math.max(width, height) > MAX_LONG_EDGE;
}

// Moves a finished file from the staging folder into `destDir` under
// `desiredName` (or "name (1).ext", "name (2).ext", … if taken), in one
// atomic step. A hard link either appears complete or not at all — so the
// photo list can never see a half-written file — and unlike rename it
// fails instead of overwriting when the name is already taken, so two
// uploads finishing at the same instant with the same filename can't
// clobber each other. Staging lives inside the photos folder, so source
// and destination are always on the same filesystem, which links need.
function publishFile(srcPath, destDir, desiredName) {
  const ext = path.extname(desiredName);
  const base = path.basename(desiredName, ext);
  for (let n = 0; ; n++) {
    const candidate = n === 0 ? desiredName : `${base} (${n})${ext}`;
    try {
      fs.linkSync(srcPath, path.join(destDir, candidate));
      fs.unlinkSync(srcPath);
      return candidate;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

// Run on every uploaded photo while it's still in the hidden staging
// folder (photos/.incoming/), before the photo frame can see it. Caps its
// long edge at MAX_LONG_EDGE, keeping its aspect ratio, then publishes
// the finished file into `destDir` as `desiredName`:
//
// - HEIC/HEIF: always converted (browsers other than Safari can't show
//   HEIC) to a same-named .jpg. The HEIC original never reaches the
//   photos folder, so uploads never need a .converted.jpg cache file.
// - JPEG/PNG/WebP with a long edge over the cap: scaled down, keeping
//   its format (so a PNG's transparency survives). The EXIF orientation
//   is baked into the pixels first (`.rotate()` with no angle), because
//   sharp drops EXIF metadata on output — without this a phone photo
//   taken upright would come out sideways.
// - Anything already within the cap, and all GIFs (possibly animated):
//   published byte-for-byte as uploaded. Browsers honor EXIF orientation
//   on their own, so an untouched photo still displays the right way up.
// - If processing fails (corrupt file, unsupported variant), the photo
//   is published as uploaded rather than lost, and the error rethrown
//   with `publishedAs` set so the caller can report it.
//
// The staged upload is always gone from the staging folder afterwards.
// Returns { file, resized, converted } — `file` is the final name in
// destDir (differs from desiredName for HEIC, or on a name collision).
async function normalizeUploadedPhoto(stagedPath, desiredName, destDir) {
  const outPath = stagedPath + '.out';
  try {
    const ext = path.extname(desiredName).toLowerCase();

    if (isHeic(desiredName)) {
      const resized = await heicToJpeg(stagedPath, outPath);
      const jpgName = path.basename(desiredName, path.extname(desiredName)) + '.jpg';
      return { file: publishFile(outPath, destDir, jpgName), resized, converted: true };
    }

    if (ext !== '.gif') {
      const meta = await sharp(stagedPath).metadata();
      if (Math.max(meta.width, meta.height) > MAX_LONG_EDGE) {
        let pipeline = sharp(stagedPath).rotate().resize(RESIZE_OPTS);
        if (meta.format === 'png') pipeline = pipeline.png();
        else if (meta.format === 'webp') pipeline = pipeline.webp({ quality: JPEG_QUALITY });
        else pipeline = pipeline.jpeg({ quality: JPEG_QUALITY });
        await pipeline.toFile(outPath);
        return { file: publishFile(outPath, destDir, desiredName), resized: true, converted: false };
      }
    }

    return { file: publishFile(stagedPath, destDir, desiredName), resized: false, converted: false };
  } catch (e) {
    if (fs.existsSync(stagedPath)) {
      try { e.publishedAs = publishFile(stagedPath, destDir, desiredName); } catch (_) { /* reported below */ }
    }
    throw e;
  } finally {
    for (const leftover of [outPath, stagedPath]) {
      try { fs.unlinkSync(leftover); } catch (_) { /* already moved or never written */ }
    }
  }
}

// Empties the staging folder. Called once at startup, when no upload can
// be in progress, to clear out anything a crash or power cut left behind
// mid-upload.
function clearStaging(stagingDir) {
  if (!fs.existsSync(stagingDir)) return 0;
  let removed = 0;
  for (const f of fs.readdirSync(stagingDir)) {
    try { fs.rmSync(path.join(stagingDir, f), { recursive: true, force: true }); removed++; } catch (_) { /* best effort */ }
  }
  return removed;
}

module.exports = {
  MAX_LONG_EDGE,
  isHeic,
  heicToJpeg,
  normalizeUploadedPhoto,
  clearStaging
};
