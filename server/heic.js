const fs = require('fs');
const path = require('path');
const { isHeic, heicToJpeg } = require('./images');

// HEIC/HEIF files uploaded through Settings are converted to a plain .jpg
// on upload (see images.js normalizeUploadedPhoto) and never reach this
// module. This caching path is for HEIC files dropped into the photos
// folder directly (File Station, scp, …), which the app can't convert at
// the moment they arrive.
//
// Cache files sit right next to the original — e.g.
// IMG_1234.HEIC -> IMG_1234.HEIC.converted.jpg — so the pairing is obvious
// at a glance in File Station and trivial to clean up by hand (delete both
// files with a matching prefix).
const CACHE_SUFFIX = '.converted.jpg';

// Converts a HEIC/HEIF file to JPEG (capped at the same 3840px long edge
// as uploads) and caches the result next to it, skipping the conversion if
// a cached copy already exists and is at least as new as the source.
// Returns the cache file's name (not full path) plus whether a conversion
// actually ran this time, so callers (e.g. the startup scan) can report
// accurately rather than saying "converted" for files that were really
// just verified as already up to date.
async function ensureConverted(dir, heicFilename) {
  const srcPath = path.join(dir, heicFilename);
  const cacheFilename = heicFilename + CACHE_SUFFIX;
  const cachePath = path.join(dir, cacheFilename);

  const srcStat = fs.statSync(srcPath);
  let stale = true;
  if (fs.existsSync(cachePath)) {
    stale = fs.statSync(cachePath).mtimeMs < srcStat.mtimeMs;
  }

  if (stale) await heicToJpeg(srcPath, cachePath);

  return { cacheFilename, converted: stale };
}

// A cached .converted.jpg whose source .heic/.heif no longer exists (the
// original was deleted but its cache wasn't) gets removed automatically —
// keeps the folder clean without relying on remembering to delete both
// files every time.
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
