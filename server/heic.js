const fs = require('fs');
const path = require('path');
const heicConvert = require('heic-convert');

const HEIC_EXTENSIONS = new Set(['.heic', '.heif']);

// Cache files sit right next to the original, as requested — e.g.
// IMG_1234.HEIC -> IMG_1234.HEIC.converted.jpg — so the pairing is obvious
// at a glance in File Station and trivial to clean up by hand (delete both
// files with a matching prefix).
const CACHE_SUFFIX = '.converted.jpg';

function isHeic(filename) {
  return HEIC_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

// Converts a HEIC/HEIF file to JPEG and caches the result next to it,
// skipping the (relatively slow — several hundred ms, scales with photo
// size) conversion if a cached copy already exists and is at least as new
// as the source. Returns the cache file's name (not full path) plus
// whether a conversion actually ran this time, so callers (e.g. the
// startup scan) can report accurately rather than saying "converted" for
// files that were really just verified as already up to date.
async function ensureConverted(dir, heicFilename) {
  const srcPath = path.join(dir, heicFilename);
  const cacheFilename = heicFilename + CACHE_SUFFIX;
  const cachePath = path.join(dir, cacheFilename);

  const srcStat = fs.statSync(srcPath);
  let stale = true;
  if (fs.existsSync(cachePath)) {
    stale = fs.statSync(cachePath).mtimeMs < srcStat.mtimeMs;
  }

  if (stale) {
    const inputBuffer = fs.readFileSync(srcPath);
    // quality: 1 = maximum JPEG quality (least lossy) — preserving quality
    // as well as this format conversion can, per the request. File size is
    // a secondary concern for a wall display's photo frame.
    const outputBuffer = await heicConvert({ buffer: inputBuffer, format: 'JPEG', quality: 1 });
    fs.writeFileSync(cachePath, outputBuffer);
  }

  return { cacheFilename, converted: stale };
}

// A cached .converted.jpg whose source .heic/.heif no longer exists (the
// original was deleted but its cache wasn't) gets removed automatically —
// keeps the folder clean without relying on remembering to delete both
// files every time, per "if/when we cycle out the photos... keep things
// clean."
function cleanupOrphanedCaches(dir, allFiles) {
  const fileSet = new Set(allFiles);
  allFiles
    .filter((f) => f.endsWith(CACHE_SUFFIX))
    .forEach((cacheFile) => {
      const originalName = cacheFile.slice(0, -CACHE_SUFFIX.length);
      if (!fileSet.has(originalName)) {
        try { fs.unlinkSync(path.join(dir, cacheFile)); } catch (e) { /* best effort */ }
      }
    });
}

module.exports = { isHeic, ensureConverted, cleanupOrphanedCaches, CACHE_SUFFIX };
