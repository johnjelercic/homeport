Drop JPG, PNG, WebP, GIF, or HEIC/HEIF files directly in this folder.

They'll automatically show up in the display's idle-timeout photo frame
(no restart needed — the list is read fresh each time the display goes
idle). This file itself is ignored, since it isn't an image.

HEIC/HEIF files (the default format on iPhones) are automatically
converted to JPEG the first time they're needed, and cached next to the
original as "<filename>.converted.jpg" so it only has to happen once.
If you remove a HEIC photo, its cached copy is cleaned up automatically
the next time the photo list is loaded — you only need to delete the
original.
