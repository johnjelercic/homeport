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

// Picks a filename in `dir` that doesn't exist yet, appending " (1)",
// " (2)", … to the base name as needed.
function uniqueFilename(dir, originalName) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  let candidate = originalName;
  let n = 1;
  while (fs.existsSync(path.join(dir, candidate))) {
    candidate = `${base} (${n})${ext}`;
    n++;
  }
  return candidate;
}

// Run on every freshly uploaded photo, after multer has written it to
// disk. Caps its long edge at MAX_LONG_EDGE, keeping its aspect ratio:
//
// - HEIC/HEIF: always converted (browsers other than Safari can't show
//   HEIC) to a same-named .jpg, and the HEIC original is removed — so
//   uploads never need a separate .converted.jpg cache file.
// - JPEG/PNG/WebP with a long edge over the cap: scaled down in place,
//   keeping its format (so a PNG's transparency survives). The EXIF
//   orientation is baked into the pixels first (`.rotate()` with no
//   angle), because sharp drops EXIF metadata on output — without this a
//   phone photo taken upright would come out sideways.
// - Anything already within the cap, and all GIFs (possibly animated):
//   left completely untouched. Browsers honor EXIF orientation on their
//   own, so an untouched photo still displays the right way up.
//
// Returns { file, resized, converted } — `file` is the name the photo
// ended up under (differs from the input only for HEIC).
async function normalizeUploadedPhoto(dir, filename) {
  const srcPath = path.join(dir, filename);
  const ext = path.extname(filename).toLowerCase();

  if (isHeic(filename)) {
    const jpgName = uniqueFilename(dir, path.basename(filename, path.extname(filename)) + '.jpg');
    const jpgPath = path.join(dir, jpgName);
    try {
      const resized = await heicToJpeg(srcPath, jpgPath);
      fs.unlinkSync(srcPath);
      return { file: jpgName, resized, converted: true };
    } catch (e) {
      try { fs.unlinkSync(jpgPath); } catch (_) { /* never got written */ }
      throw e;
    }
  }

  if (ext === '.gif') return { file: filename, resized: false, converted: false };

  const meta = await sharp(srcPath).metadata();
  if (Math.max(meta.width, meta.height) <= MAX_LONG_EDGE) {
    return { file: filename, resized: false, converted: false };
  }

  // sharp can't write over the file it's reading from, so write to a
  // temporary name (whose extension isn't a photo type, so it's never
  // picked up by the photo list mid-write) and swap it into place.
  const tmpPath = srcPath + '.resizing';
  try {
    let pipeline = sharp(srcPath).rotate().resize(RESIZE_OPTS);
    if (meta.format === 'png') pipeline = pipeline.png();
    else if (meta.format === 'webp') pipeline = pipeline.webp({ quality: JPEG_QUALITY });
    else pipeline = pipeline.jpeg({ quality: JPEG_QUALITY });
    await pipeline.toFile(tmpPath);
    fs.renameSync(tmpPath, srcPath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch (_) { /* never got written */ }
    throw e;
  }
  return { file: filename, resized: true, converted: false };
}

module.exports = {
  MAX_LONG_EDGE,
  isHeic,
  heicToJpeg,
  uniqueFilename,
  normalizeUploadedPhoto
};
