// Seasonal decoration layer: falling particles, corner-art SVGs, and (for
// Christmas) a light-string garland, rendered into the #decoration element
// that sits behind .app (see display.css — .app has z-index:1 so this
// layer, at z-index:0, never covers any calendar content).
//
// This is a standalone module on purpose: it has no dependency on app.js
// beyond the #decoration element and a theme id string, so the calendar
// logic doesn't need to know anything about how each season is drawn.
// Wired in from app.js's applyTheme(), which already resolves the active
// theme and has its `id` in scope.
//
// Ported directly from the design mockup reviewed and approved before this
// file existed — see the corner-art / particle / light-string comments
// below for the reasoning behind each theme's specific art.
(function () {
  'use strict';

  // Kept deliberately restrained for a display that runs unattended, all
  // day, in the kitchen: fewer/fainter particles than the "bolder" option
  // explored in the mockup.
  const PARTICLE_COUNT = 11;
  const PARTICLE_MAX_OPACITY = 0.42;
  // Corner-art opacity dimming is off for now (was 0.62) -- richer,
  // file-based illustration art loses too much vibrancy at that dim level.
  // Revisit once there's a broader set of file-based art to judge against.
  const CORNER_OPACITY = 1;

  // How much of the corner-art box's width a file-based piece is allowed to
  // actually use, measured from the outer (visible) edge -- the rest is
  // left as headroom that falls behind the calendar's opaque day-cells.
  // Established empirically: local x-coordinates past about 80 of the
  // 130-wide viewBox convention this app uses elsewhere start disappearing
  // behind the grid. Used by the auto-fit step below so a dropped-in file
  // doesn't have to be hand-measured against that rule every time.
  const SAFE_ZONE_FRACTION = 80 / 130;

  // A small standalone bat silhouette for Halloween's falling particles
  // (the counterpart to Fall's leaves / Winter's snow).
  const batParticleSVG = `<svg viewBox="0 0 32 18" xmlns="http://www.w3.org/2000/svg">
    <path d="M16,9 C13,4 7,2 0,4 C5,6 8,8 8,11 C5,10 3,11 0,10 C4,13 10,14 14,10
             C15,11 15,11 16,10 C17,11 17,11 18,10 C22,14 28,13 32,10
             C29,11 27,10 24,11 C24,8 27,6 32,4 C25,2 19,4 16,9 Z" fill="#2A2230"/>
  </svg>`;

  // Fall, both corners (mirrored) — a tied bundle of dried corn stalks with
  // pumpkins resting at the base. Gradient shading throughout, tapered
  // leaf-blade shapes, and pumpkin ridge lines that bow toward the center
  // (like lines of longitude on a globe) rather than crossing strokes.
  const cornSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="cornGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#FFC98A" stop-opacity="0.5"/>
          <stop offset="55%" stop-color="#FFC98A" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="#FFC98A" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="stalkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#D9A441"/>
          <stop offset="55%" stop-color="#A9701F"/>
          <stop offset="100%" stop-color="#8B5A2B"/>
        </linearGradient>
        <radialGradient id="earGrad" cx="35%" cy="25%" r="80%">
          <stop offset="0%" stop-color="#F0C56A"/>
          <stop offset="100%" stop-color="#C1872F"/>
        </radialGradient>
        <radialGradient id="pumpkinGrad" cx="32%" cy="28%" r="80%">
          <stop offset="0%" stop-color="#F3A24A"/>
          <stop offset="65%" stop-color="#DD7F22"/>
          <stop offset="100%" stop-color="#B05F14"/>
        </radialGradient>
        <!-- One leaf blade, reused with different transforms/colors below —
             tapered at both ends, widest a third of the way along, bowed
             into a droop rather than a uniform-width stroke. -->
        <path id="leafBlade" d="M0,0 C 10,-7 26,-9 40,-2 C 54,4 62,14 66,26
                                 C 60,29 56,26 50,20 C 38,9 22,3 8,5
                                 C 4,5 1,3 0,0 Z"/>
      </defs>

      <ellipse cx="55" cy="300" rx="95" ry="150" fill="url(#cornGlow)"/>

      <!-- dried, drooping leaves, tucked behind the stalks -->
      <use href="#leafBlade" fill="#C98A3E" transform="translate(36,150) rotate(8)"/>
      <use href="#leafBlade" fill="#8B5A2B" transform="translate(58,182) rotate(18) scale(1.05)"/>
      <use href="#leafBlade" fill="#B5591E" transform="translate(30,222) rotate(-4) scale(0.95)"/>
      <use href="#leafBlade" fill="#C98A3E" transform="translate(66,132) rotate(-14) scale(0.85)"/>
      <use href="#leafBlade" fill="#8B5A2B" transform="translate(40,262) rotate(24) scale(1.1)"/>
      <use href="#leafBlade" fill="#B5591E" transform="translate(70,246) rotate(2) scale(0.9)"/>

      <!-- stalks, leaning together and tied -->
      <g fill="none" stroke="url(#stalkGrad)" stroke-width="6" stroke-linecap="round">
        <path d="M26,396 C 24,320 16,240 30,150 C 36,104 44,76 48,54"/>
        <path d="M48,396 C 46,320 42,236 52,146 C 57,102 62,78 66,58"/>
        <path d="M70,396 C 74,320 80,234 70,144 C 65,104 58,80 55,62"/>
        <path d="M92,396 C 90,318 96,238 82,150 C 76,108 68,82 64,64"/>
      </g>
      <!-- tassels, fanning from each stalk tip -->
      <g fill="none" stroke="#E8C77A" stroke-width="3" stroke-linecap="round">
        <path d="M48,54 C 44,42 46,30 40,20 M48,54 C 52,44 50,32 56,22"/>
        <path d="M66,58 C 62,46 64,34 58,24 M66,58 C 70,48 68,36 74,26"/>
        <path d="M55,62 C 51,50 53,38 47,28"/>
        <path d="M64,64 C 68,52 66,40 72,30"/>
      </g>

      <!-- husked corn ears, tapered with peeled-back husk flaps -->
      <g>
        <path d="M40,196 C 48,198 52,210 50,228 C 49,240 45,248 40,250 C 35,248 31,240 30,228 C 28,210 32,198 40,196 Z"
              fill="url(#earGrad)" stroke="#8B5A2B" stroke-width="2" transform="rotate(-9 40 222)"/>
        <path d="M35,198 C 30,192 28,184 32,178 C 36,183 38,190 38,198 Z" fill="#DCC088" transform="rotate(-9 40 222)"/>
        <g stroke="#8B5A2B" stroke-width="1.3" opacity=".6" transform="rotate(-9 40 222)">
          <path d="M32,206 Q40,204 48,206 M31,215 Q40,213 49,215 M31,224 Q40,222 49,224 M32,233 Q40,231 48,233 M33,241 Q40,239 47,241"/>
        </g>

        <path d="M80,220 C 87,222 90,233 88,249 C 87,259 83,266 80,268 C 76,266 72,259 71,249 C 69,233 73,222 80,220 Z"
              fill="url(#earGrad)" stroke="#8B5A2B" stroke-width="2" transform="rotate(8 80 246)"/>
        <path d="M76,222 C 72,216 71,209 74,204 C 78,209 79,215 79,222 Z" fill="#DCC088" transform="rotate(8 80 246)"/>
        <g stroke="#8B5A2B" stroke-width="1.2" opacity=".6" transform="rotate(8 80 246)">
          <path d="M72,229 Q80,227 87,229 M71,237 Q80,235 88,237 M71,245 Q80,243 88,245 M72,253 Q80,251 87,253"/>
        </g>
      </g>

      <!-- twine, wrapped twice with a small knot -->
      <g stroke="#6B4423" stroke-linecap="round" fill="none">
        <path d="M14,296 C 40,286 80,286 106,298" stroke-width="4"/>
        <path d="M15,309 C 41,301 79,301 105,311" stroke-width="4"/>
        <path d="M56,292 C 54,300 54,308 56,315 C 52,310 51,300 54,293 Z" fill="#8A5A36" stroke-width="1"/>
      </g>

      <!-- pumpkins resting at the base, built from real ridge curves (each
           one bows toward the pumpkin's own center, like a globe's
           longitude lines) rather than crossing strokes -->
      <g>
        <path d="M56,376 C58,366 63,362 66,364 C64,368 61,372 60,377 Z" fill="#7A9B5E"/>
        <ellipse cx="60" cy="396" rx="26" ry="20" fill="url(#pumpkinGrad)" stroke="#93490F" stroke-width="2"/>
        <g stroke="#93490F" stroke-width="1.3" fill="none" opacity=".55">
          <path d="M42,380 Q49,396 42,412"/>
          <path d="M51,377 Q56,396 51,415"/>
          <path d="M60,376 Q60,396 60,416"/>
          <path d="M69,377 Q64,396 69,415"/>
          <path d="M78,380 Q71,396 78,412"/>
        </g>
        <rect x="57" y="368" width="6" height="10" rx="2.5" fill="#6B5A2B" transform="rotate(-4 60 373)"/>

        <path d="M14,392 C16,384 20,381 23,383 C21,386 19,389 18,393 Z" fill="#7A9B5E"/>
        <ellipse cx="18" cy="406" rx="19" ry="15" fill="url(#pumpkinGrad)" stroke="#93490F" stroke-width="1.8"/>
        <g stroke="#93490F" stroke-width="1.1" fill="none" opacity=".55">
          <path d="M4,394 Q9,406 4,418"/>
          <path d="M11,392 Q15,406 11,420"/>
          <path d="M18,391 Q18,406 18,421"/>
          <path d="M25,392 Q21,406 25,420"/>
          <path d="M32,394 Q27,406 32,418"/>
        </g>
        <rect x="15.5" y="384" width="5" height="8" rx="2" fill="#6B5A2B" transform="rotate(5 18 388)"/>

        <path d="M92,384 C94,376 99,373 102,375 C100,378 97,382 96,386 Z" fill="#7A9B5E"/>
        <ellipse cx="96" cy="399" rx="22" ry="17.5" fill="url(#pumpkinGrad)" stroke="#93490F" stroke-width="2"/>
        <g stroke="#93490F" stroke-width="1.2" fill="none" opacity=".55">
          <path d="M80,386 Q86,399 80,412"/>
          <path d="M88,383 Q92,399 88,415"/>
          <path d="M96,382 Q96,399 96,416"/>
          <path d="M104,383 Q100,399 104,415"/>
          <path d="M112,386 Q106,399 112,412"/>
        </g>
        <rect x="93" y="375" width="5.5" height="9" rx="2.2" fill="#6B5A2B" transform="rotate(-6 96 379)"/>
      </g>
    </svg>`;

  // Winter, both corners (mirrored) — a snowman. Bottom-anchored the same
  // way as the corn stalks; the falling snow does most of the winter
  // feeling, so this just adds a bit of character.
  const snowmanSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="snowGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#DCEBFF" stop-opacity="0.45"/>
          <stop offset="55%" stop-color="#DCEBFF" stop-opacity="0.14"/>
          <stop offset="100%" stop-color="#DCEBFF" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="snowBall" cx="35%" cy="28%" r="80%">
          <stop offset="0%" stop-color="#FFFFFF"/>
          <stop offset="100%" stop-color="#D7E4F0"/>
        </radialGradient>
      </defs>
      <ellipse cx="55" cy="300" rx="95" ry="150" fill="url(#snowGlow)"/>

      <!-- ground drift -->
      <ellipse cx="45" cy="398" rx="70" ry="14" fill="#E6EEF6"/>

      <!-- body -->
      <circle cx="46" cy="352" r="42" fill="url(#snowBall)" stroke="#C3D5E5" stroke-width="1.5"/>
      <circle cx="42" cy="272" r="31" fill="url(#snowBall)" stroke="#C3D5E5" stroke-width="1.5"/>
      <circle cx="40" cy="210" r="22" fill="url(#snowBall)" stroke="#C3D5E5" stroke-width="1.5"/>

      <!-- stick arms -->
      <g stroke="#6B4423" stroke-width="3.5" stroke-linecap="round">
        <path d="M64,268 C 84,260 98,246 108,224"/>
        <path d="M96,236 L110,228 M96,236 L104,248"/>
        <path d="M18,276 C 4,272 -6,260 -10,244"/>
      </g>

      <!-- coal buttons -->
      <g fill="#3A3630">
        <circle cx="42" cy="258" r="3.2"/>
        <circle cx="40" cy="274" r="3.2"/>
        <circle cx="39" cy="290" r="3.2"/>
      </g>

      <!-- scarf -->
      <path d="M20,226 C 30,234 50,234 60,226 L60,236 C 50,244 30,244 20,236 Z" fill="#A6362F"/>
      <path d="M46,234 C 44,246 40,256 44,266 C 48,260 50,250 50,238 Z" fill="#8C2B26"/>

      <!-- face -->
      <g fill="#3A3630">
        <circle cx="32" cy="204" r="2.6"/>
        <circle cx="48" cy="203" r="2.6"/>
      </g>
      <path d="M39,212 L58,216 L39,220 Z" fill="#D9791E"/>
      <g fill="#3A3630" opacity=".85">
        <circle cx="30" cy="224" r="1.6"/><circle cx="35" cy="228" r="1.6"/>
        <circle cx="41" cy="229" r="1.6"/><circle cx="47" cy="227" r="1.6"/>
      </g>

      <!-- top hat -->
      <rect x="16" y="186" width="48" height="8" rx="3" fill="#2B2723"/>
      <rect x="26" y="146" width="28" height="42" rx="2" fill="#2B2723"/>
      <rect x="26" y="180" width="28" height="6" fill="#A6362F"/>
    </svg>`;

  // Halloween, left corner — a friendly, classic scarecrow: round smiling
  // burlap face, straw hair and straw-burst hands under a floppy sun hat,
  // a ruffled bandana collar, a patched vest over a plaid shirt, and jeans.
  // viewBox is widened on the left/right (vs. the other scenes' 0 130) so
  // the outstretched arms aren't clipped by the SVG's own viewport.
  const scarecrowSVG = `
    <svg class="corner-art" viewBox="-15 0 145 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="scarecrowGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#F0A339" stop-opacity="0.34"/>
          <stop offset="55%" stop-color="#7C4FA0" stop-opacity="0.13"/>
          <stop offset="100%" stop-color="#7C4FA0" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="hatGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#E3B45E"/>
          <stop offset="100%" stop-color="#B0812F"/>
        </linearGradient>
        <radialGradient id="faceGrad" cx="35%" cy="28%" r="80%">
          <stop offset="0%" stop-color="#F5E4B8"/>
          <stop offset="100%" stop-color="#D9BC7E"/>
        </radialGradient>
        <linearGradient id="vestGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#48576A"/>
          <stop offset="100%" stop-color="#2E3946"/>
        </linearGradient>
        <linearGradient id="jeansGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#557195"/>
          <stop offset="100%" stop-color="#37516F"/>
        </linearGradient>
        <path id="strawSpike" d="M0,0 C-3,-8 -2,-16 0,-24 C2,-16 3,-8 0,0 Z"/>
      </defs>

      <ellipse cx="52" cy="300" rx="100" ry="150" fill="url(#scarecrowGlow)"/>

      <!-- legs (jeans) -->
      <path d="M26,256 C22,292 18,332 24,378 C30,384 38,384 42,378 C42,332 44,292 44,256 Z" fill="url(#jeansGrad)" stroke="#233245" stroke-width="2"/>
      <path d="M50,256 C50,292 50,332 50,378 C54,384 62,384 68,378 C74,332 70,292 70,256 Z" fill="url(#jeansGrad)" stroke="#233245" stroke-width="2"/>
      <rect x="52" y="330" width="14" height="16" rx="2" fill="#7A2E20" opacity=".85" transform="rotate(-6 59 338)"/>
      <g fill="#E3B54F">
        <g transform="translate(32,378)">
          <use href="#strawSpike" transform="rotate(150)"/><use href="#strawSpike" transform="rotate(165)"/>
          <use href="#strawSpike" transform="rotate(180)"/><use href="#strawSpike" transform="rotate(195)"/>
          <use href="#strawSpike" transform="rotate(210)"/>
        </g>
        <g transform="translate(62,378)">
          <use href="#strawSpike" transform="rotate(150)"/><use href="#strawSpike" transform="rotate(165)"/>
          <use href="#strawSpike" transform="rotate(180)"/><use href="#strawSpike" transform="rotate(195)"/>
          <use href="#strawSpike" transform="rotate(210)"/>
        </g>
      </g>

      <!-- arms -->
      <path d="M28,190 C10,186 -8,180 -22,182 C-24,190 -22,198 -14,200 C0,202 16,198 30,204 Z" fill="url(#vestGrad)" stroke="#1E2733" stroke-width="2"/>
      <path d="M62,190 C80,186 98,180 112,182 C114,190 112,198 104,200 C90,202 74,198 60,204 Z" fill="url(#vestGrad)" stroke="#1E2733" stroke-width="2"/>
      <g fill="#E3B54F">
        <g transform="translate(-22,190)">
          <use href="#strawSpike" transform="rotate(-160)"/><use href="#strawSpike" transform="rotate(-180)"/>
          <use href="#strawSpike" transform="rotate(160)"/><use href="#strawSpike" transform="rotate(140)"/>
          <use href="#strawSpike" transform="rotate(-140)"/>
        </g>
        <g transform="translate(112,190)">
          <use href="#strawSpike" transform="rotate(-20)"/><use href="#strawSpike" transform="rotate(0)"/>
          <use href="#strawSpike" transform="rotate(20)"/><use href="#strawSpike" transform="rotate(40)"/>
          <use href="#strawSpike" transform="rotate(-40)"/>
        </g>
      </g>

      <!-- plaid shirt sleeves -->
      <path d="M22,178 C14,180 8,186 8,194 L30,198 L34,180 Z" fill="#A6453A" stroke="#6B2E20" stroke-width="1.5"/>
      <path d="M68,178 C76,180 82,186 82,194 L60,198 L56,180 Z" fill="#A6453A" stroke="#6B2E20" stroke-width="1.5"/>

      <!-- vest -->
      <path d="M24,182 C24,168 66,168 66,182 L70,254 C70,266 20,266 20,254 Z" fill="url(#vestGrad)" stroke="#1E2733" stroke-width="2"/>
      <circle cx="45" cy="200" r="2.2" fill="#D9BC7E"/>
      <circle cx="45" cy="216" r="2.2" fill="#D9BC7E"/>
      <circle cx="45" cy="232" r="2.2" fill="#D9BC7E"/>
      <rect x="26" y="192" width="12" height="11" rx="2" fill="#D97B29" transform="rotate(-8 32 197)"/>
      <rect x="54" y="196" width="11" height="11" rx="2" fill="#3E6EA5" transform="rotate(7 59 201)"/>
      <rect x="24" y="228" width="12" height="11" rx="2" fill="#5E8C4B" transform="rotate(6 30 233)"/>
      <rect x="53" y="232" width="12" height="12" rx="2" fill="#B5432F" transform="rotate(-7 59 238)"/>

      <!-- neck: a dedicated skin-tone patch that always bridges the head
           to the collar, regardless of how the curves round on either
           side — this is what fixes the "head floating above the
           shoulders" look. -->
      <rect x="35" y="163" width="20" height="22" rx="7" fill="url(#faceGrad)"/>

      <!-- ruffled bandana collar at the neck -->
      <path d="M20,180 C20,172 70,172 70,180 C70,186 64,182 58,186 C52,190 48,184 45,184
               C42,184 38,190 32,186 C26,182 20,186 20,180 Z" fill="#E8A23D" stroke="#B5732A" stroke-width="1.5"/>

      <!-- head — a touch smaller and sitting lower, right down on the
           neck patch, so there's no gap to the shoulders -->
      <circle cx="45" cy="150" r="26" fill="url(#faceGrad)" stroke="#C7A263" stroke-width="2"/>
      <circle cx="36" cy="144" r="2.8" fill="#3A2E1C"/>
      <circle cx="54" cy="144" r="2.8" fill="#3A2E1C"/>
      <path d="M45,152 L40,161 L50,161 Z" fill="#D9791E"/>
      <ellipse cx="31" cy="159" rx="4.6" ry="3" fill="#EFA3A0" opacity=".65"/>
      <ellipse cx="59" cy="159" rx="4.6" ry="3" fill="#EFA3A0" opacity=".65"/>
      <path d="M32,167 Q45,176 58,167" stroke="#3A2E1C" stroke-width="2.2" fill="none" stroke-linecap="round"/>

      <!-- straw hair, only at the ears now — the crown is fully covered
           by the (lowered, better-fitted) hat -->
      <g fill="#E3B54F">
        <g transform="translate(19,142)">
          <use href="#strawSpike" transform="rotate(-125) scale(1.05)"/><use href="#strawSpike" transform="rotate(-145)"/>
          <use href="#strawSpike" transform="rotate(-165)"/>
        </g>
        <g transform="translate(71,142)">
          <use href="#strawSpike" transform="rotate(125) scale(1.05)"/><use href="#strawSpike" transform="rotate(145)"/>
          <use href="#strawSpike" transform="rotate(165)"/>
        </g>
      </g>

      <!-- floppy sun hat — lowered and widened so the brim actually
           rests down over the head (previously it barely grazed the
           top), with a soft shadow underneath to ground it -->
      <path d="M0,148 C -10,143 -7,131 4,127 C 18,120 70,120 86,127
               C 97,131 100,143 90,148 C 74,138 16,138 0,148 Z" fill="url(#hatGrad)" stroke="#8A6220" stroke-width="2"/>
      <path d="M14,130 C 10,108 22,90 45,90 C 68,90 80,108 76,130
               C 64,122 26,122 14,130 Z" fill="url(#hatGrad)" stroke="#8A6220" stroke-width="2"/>
      <path d="M16,126 C 32,121 58,121 74,126" stroke="#8B5A2B" stroke-width="4" fill="none" stroke-linecap="round"/>
      <ellipse cx="45" cy="134" rx="22" ry="6" fill="#5A3A12" opacity=".18"/>
      <path d="M60,114 C 66,110 74,112 76,118 C 70,118 64,120 60,122 Z" fill="#6F8F52"/>
    </svg>
`;

  // Halloween, right corner — two jack-o'-lanterns, carved and glowing,
  // plus a black cat sitting alongside them, tail curled around its paws.
  const catPumpkinsSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="catGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#F0A339" stop-opacity="0.4"/>
          <stop offset="55%" stop-color="#7C4FA0" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#7C4FA0" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="jackGrad" cx="32%" cy="26%" r="80%">
          <stop offset="0%" stop-color="#F0923D"/>
          <stop offset="65%" stop-color="#D46A16"/>
          <stop offset="100%" stop-color="#A24E10"/>
        </radialGradient>
        <radialGradient id="catGrad" cx="35%" cy="22%" r="85%">
          <stop offset="0%" stop-color="#3A3742"/>
          <stop offset="100%" stop-color="#17151C"/>
        </radialGradient>
      </defs>

      <ellipse cx="55" cy="300" rx="95" ry="150" fill="url(#catGlow)"/>

      <!-- black cat, peering over the big pumpkin, paws draped over the
           rim — modeled after the reference photo: big round eyes, tall
           wide-based ears, a hint of a lighter muzzle, front-on so it
           reads the same however this corner gets mirrored. -->

      <!-- tail/body, wrapping around the base of the pumpkin -->
      <path d="M88,368 C102,366 113,352 109,332 C106,321 98,318 93,324
               C101,326 104,336 100,346 C97,356 90,362 88,368 Z"
            fill="url(#catGrad)" stroke="#0D0C10" stroke-width="1.5"/>

      <!-- head + ears merged into one silhouette so the ears read as
           part of the head rather than separate stuck-on triangles;
           chin sits behind the pumpkin (drawn next) so only the upper
           face shows above the rim -->
      <path d="M34,330
               C34,316 34,306 32,306
               L38,286
               L50,305
               C55,300 69,300 74,305
               L86,286
               L92,306
               C90,306 90,316 90,330
               C90,346 85,358 62,360
               C39,358 34,346 34,330 Z"
            fill="url(#catGrad)" stroke="#0D0C10" stroke-width="1.5"/>
      <path d="M35,303 L38,291 L46,304 Z" fill="#2A2732"/>
      <path d="M89,303 L86,291 L78,304 Z" fill="#2A2732"/>

      <!-- a hint of lighter muzzle fur, like the reference -->
      <ellipse cx="62" cy="344" rx="12" ry="8" fill="#4A4650" opacity=".55"/>

      <!-- big round amber eyes, like the reference photos, with a small
           round pupil and a catchlight instead of a green cartoon slit -->
      <ellipse cx="50" cy="326" rx="5.8" ry="6.6" fill="#E3B54F"/>
      <ellipse cx="74" cy="326" rx="5.8" ry="6.6" fill="#E3B54F"/>
      <ellipse cx="50" cy="327" rx="2.6" ry="3.2" fill="#1B140C"/>
      <ellipse cx="74" cy="327" rx="2.6" ry="3.2" fill="#1B140C"/>
      <ellipse cx="48.4" cy="324" rx="1.1" ry="1.4" fill="#FFF7E4" opacity=".85"/>
      <ellipse cx="72.4" cy="324" rx="1.1" ry="1.4" fill="#FFF7E4" opacity=".85"/>

      <path d="M59,340 L65,340 L62,344 Z" fill="#C46B7A"/>
      <path d="M60,346 Q62,349 64,346" stroke="#0D0C10" stroke-width="1.2" fill="none" stroke-linecap="round"/>
      <g stroke="#5A5765" stroke-width="0.8" opacity=".7">
        <path d="M40,338 L22,333 M40,342 L21,342 M40,346 L22,350"/>
        <path d="M84,338 L102,333 M84,342 L103,342 M84,346 L102,350"/>
      </g>

      <!-- two jack-o'-lanterns, moved up with the cat (see note above) so
           the chin still tucks behind this near one's rim -->
      <g>
        <ellipse cx="62" cy="366" rx="30" ry="22" fill="url(#jackGrad)" stroke="#7C3B0C" stroke-width="2"/>
        <g stroke="#7C3B0C" stroke-width="1.3" fill="none" opacity=".5">
          <path d="M42,348 Q50,366 42,384"/>
          <path d="M52,345 Q58,366 52,387"/>
          <path d="M62,344 Q62,366 62,388"/>
          <path d="M72,345 Q66,366 72,387"/>
          <path d="M82,348 Q74,366 82,384"/>
        </g>
        <rect x="58" y="336" width="7" height="11" rx="2.5" fill="#5B4A1E" transform="rotate(-5 62 341)"/>
        <path d="M63,334 C 68,328 74,328 76,332 C 71,332 67,334 65,338 Z" fill="#4C7A3E"/>
        <g fill="#FFD98A" opacity=".92">
          <path d="M50,358 L56,352 L58,362 Z"/>
          <path d="M74,358 L68,352 L66,362 Z"/>
          <path d="M50,372 L56,368 L60,373 L64,368 L70,372 L64,377 L60,374 L56,377 Z"/>
        </g>

        <ellipse cx="20" cy="374" rx="21" ry="16" fill="url(#jackGrad)" stroke="#7C3B0C" stroke-width="1.8"/>
        <g stroke="#7C3B0C" stroke-width="1.1" fill="none" opacity=".5">
          <path d="M6,360 Q11,374 6,388"/>
          <path d="M13,358 Q17,374 13,390"/>
          <path d="M20,357 Q20,374 20,391"/>
          <path d="M27,358 Q23,374 27,390"/>
          <path d="M34,360 Q29,374 34,388"/>
        </g>
        <rect x="17" y="348" width="5.5" height="9" rx="2" fill="#5B4A1E" transform="rotate(5 20 352)"/>
        <g fill="#FFD98A" opacity=".92">
          <path d="M11,368 L16,363 L17,371 Z"/>
          <path d="M29,368 L24,363 L23,371 Z"/>
          <path d="M12,379 L16,376 L20,380 L24,376 L28,379 L23,383 L20,381 L17,383 Z"/>
        </g>
      </g>

      <!-- paws, draped confidently over the top of the pumpkin -->
      <g fill="url(#catGrad)" stroke="#0D0C10" stroke-width="1.2">
        <ellipse cx="47" cy="352" rx="9" ry="6.5" transform="rotate(-8 47 352)"/>
        <ellipse cx="77" cy="352" rx="9" ry="6.5" transform="rotate(8 77 352)"/>
      </g>
      <g stroke="#0D0C10" stroke-width="0.8" opacity=".6">
        <path d="M42,349 L42,355 M47,348 L47,355 M52,349 L52,355"/>
        <path d="M72,349 L72,355 M77,348 L77,355 M82,349 L82,355"/>
      </g>

      <!-- a soft grounding shadow, since this cluster now sits a little
           above the very bottom edge instead of flush against it -->
      <ellipse cx="40" cy="392" rx="52" ry="10" fill="#000000" opacity=".08"/>
    </svg>
`;

  // Thanksgiving, both corners (mirrored) — a turkey with a fanned tail
  // (the tail doubles as the tall vertical element the other scenes fill
  // with stalks/a tree), with a couple of gourds at its feet. No falling
  // particles for this theme — the turkey scene stands alone.
  const turkeySVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="turkeyGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#F0B15C" stop-opacity="0.46"/>
          <stop offset="55%" stop-color="#F0B15C" stop-opacity="0.14"/>
          <stop offset="100%" stop-color="#F0B15C" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="turkeyBodyGrad" cx="35%" cy="25%" r="85%">
          <stop offset="0%" stop-color="#A9702F"/>
          <stop offset="100%" stop-color="#6B4A22"/>
        </radialGradient>
        <radialGradient id="gourdGrad" cx="32%" cy="26%" r="80%">
          <stop offset="0%" stop-color="#E7B24A"/>
          <stop offset="65%" stop-color="#C68A1F"/>
          <stop offset="100%" stop-color="#96650F"/>
        </radialGradient>
        <!-- one tail feather, reused via <use> at different rotations/colors,
             fanned from a single pivot the way a turkey's tail spreads -->
        <path id="tailFeather" d="M0,0 C -9,-26 -9,-58 0,-84 C 9,-58 9,-26 0,0 Z"/>
      </defs>

      <ellipse cx="55" cy="300" rx="95" ry="150" fill="url(#turkeyGlow)"/>

      <!-- fanned tail feathers, pivoting from the base of the body -->
      <g transform="translate(58,330)">
        <use href="#tailFeather" fill="#7A2E20" transform="rotate(-58)"/>
        <use href="#tailFeather" fill="#9C3B2E" transform="rotate(-39)"/>
        <use href="#tailFeather" fill="#C1652E" transform="rotate(-20)"/>
        <use href="#tailFeather" fill="#D9A441" transform="rotate(0)"/>
        <use href="#tailFeather" fill="#C1652E" transform="rotate(20)"/>
        <use href="#tailFeather" fill="#9C3B2E" transform="rotate(39)"/>
        <use href="#tailFeather" fill="#7A2E20" transform="rotate(58)"/>
        <g fill="#F1DCA8" opacity=".8">
          <ellipse cx="0" cy="-78" rx="3.5" ry="6" transform="rotate(-58)"/>
          <ellipse cx="0" cy="-78" rx="3.5" ry="6" transform="rotate(-20)"/>
          <ellipse cx="0" cy="-78" rx="3.5" ry="6" transform="rotate(20)"/>
          <ellipse cx="0" cy="-78" rx="3.5" ry="6" transform="rotate(58)"/>
        </g>
      </g>

      <!-- body -->
      <ellipse cx="58" cy="356" rx="30" ry="34" fill="url(#turkeyBodyGrad)" stroke="#4A331A" stroke-width="2"/>
      <path d="M40,340 C 30,346 26,362 32,378 C 40,376 46,364 46,350 Z" fill="#5C4020" opacity=".85"/>
      <g stroke="#4A331A" stroke-width="1" opacity=".5">
        <path d="M34,350 Q40,362 36,374"/>
        <path d="M38,346 Q44,358 40,372"/>
      </g>

      <!-- neck + head -->
      <path d="M42,332 C 36,318 36,304 44,294" fill="none" stroke="#6B4A22" stroke-width="10" stroke-linecap="round"/>
      <circle cx="46" cy="288" r="11" fill="#6B4A22"/>
      <path d="M46,296 C 44,303 44,309 47,313 C 50,308 50,301 49,296 Z" fill="#C1272D"/>
      <path d="M52,286 C 56,288 58,292 56,297 C 53,294 51,290 52,286 Z" fill="#C1272D"/>
      <path d="M56,289 L64,292 L56,295 Z" fill="#E3A93E"/>
      <circle cx="49" cy="284" r="1.6" fill="#1B140C"/>

      <!-- legs -->
      <g stroke="#D9822E" stroke-width="3" stroke-linecap="round">
        <path d="M50,388 L48,400 M48,400 L42,400 M48,400 L48,406 M48,400 L54,400"/>
        <path d="M66,388 L68,400 M68,400 L62,400 M68,400 L68,406 M68,400 L74,400"/>
      </g>

      <!-- a couple of gourds at its feet for the harvest feel -->
      <ellipse cx="88" cy="388" rx="15" ry="12" fill="url(#gourdGrad)" stroke="#7A5410" stroke-width="1.5"/>
      <path d="M86,377 C88,372 92,370 94,372 C92,375 90,378 89,381 Z" fill="#6F8F52"/>
      <ellipse cx="18" cy="392" rx="13" ry="10.5" fill="url(#gourdGrad)" stroke="#7A5410" stroke-width="1.4"/>
      <path d="M16,382 C18,378 21,376 23,378 C21,380 19,383 18,386 Z" fill="#6F8F52"/>
    </svg>`;

  // Christmas, left corner — a lit tree: layered pine tiers, scattered
  // ornaments, a garland of glowing string lights, and a star topper.
  const christmasTreeSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="treeGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#F5D889" stop-opacity="0.4"/>
          <stop offset="55%" stop-color="#3E7A52" stop-opacity="0.14"/>
          <stop offset="100%" stop-color="#3E7A52" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="pineGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3E8158"/>
          <stop offset="100%" stop-color="#1F5C3A"/>
        </linearGradient>
        <linearGradient id="trunkGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#7A5533"/>
          <stop offset="100%" stop-color="#523A22"/>
        </linearGradient>
        <filter id="bulbGlow" x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="2.4"/>
        </filter>
      </defs>

      <ellipse cx="55" cy="300" rx="95" ry="150" fill="url(#treeGlow)"/>

      <!-- ground mound + trunk -->
      <ellipse cx="46" cy="372" rx="38" ry="10" fill="#1F5C3A" opacity=".25"/>
      <rect x="38" y="322" width="14" height="52" fill="url(#trunkGrad)" stroke="#3A2814" stroke-width="1.5"/>

      <!-- three pine tiers, largest at the bottom, scalloped bough edges -->
      <path d="M45,238 L2,318 C12,312 18,322 26,316 C34,310 39,322 46,316
               C53,310 58,322 66,316 C74,310 80,322 88,318 Z"
            fill="url(#pineGrad)" stroke="#173F28" stroke-width="2"/>
      <path d="M45,178 L16,248 C23,243 28,252 35,247 C41,242 45,252 51,247
               C57,242 62,252 69,247 C74,243 74,248 74,248 Z"
            fill="url(#pineGrad)" stroke="#173F28" stroke-width="2"/>
      <path d="M45,132 L30,182 C34,178 38,185 42,181 C45,178 47,185 51,181
               C55,178 58,185 60,182 Z"
            fill="url(#pineGrad)" stroke="#173F28" stroke-width="2"/>

      <!-- ornament baubles -->
      <g stroke="#0000002a" stroke-width="0.5">
        <circle cx="25" cy="288" r="5" fill="#C1272D"/>
        <circle cx="60" cy="300" r="5" fill="#E8C34A"/>
        <circle cx="38" cy="308" r="4.5" fill="#2B6CB0"/>
        <circle cx="20" cy="232" r="4.5" fill="#E8C34A"/>
        <circle cx="58" cy="228" r="4" fill="#C1272D"/>
        <circle cx="41" cy="200" r="3.5" fill="#2B6CB0"/>
        <circle cx="70" cy="270" r="4.5" fill="#C1272D"/>
      </g>
      <g fill="#FFFFFF" opacity=".55">
        <circle cx="23" cy="286" r="1.2"/><circle cx="58" cy="298" r="1.2"/>
        <circle cx="36" cy="306" r="1.1"/><circle cx="18" cy="230" r="1.1"/>
      </g>

      <!-- garland of glowing string lights, draped between each tier -->
      <path d="M8,310 Q24,330 40,312 Q56,332 72,312 Q84,328 86,314" stroke="#EADFC4" stroke-width="1.2" fill="none" opacity=".8"/>
      <path d="M18,240 Q30,256 42,242 Q54,256 66,242 Q71,248 72,244" stroke="#EADFC4" stroke-width="1.2" fill="none" opacity=".8"/>
      <path d="M33,184 Q40,194 47,184 Q52,190 56,185" stroke="#EADFC4" stroke-width="1" fill="none" opacity=".8"/>
      <g>
        <g filter="url(#bulbGlow)" opacity=".85">
          <circle cx="24" cy="329" r="3.5" fill="#E8C34A"/>
          <circle cx="56" cy="331" r="3.5" fill="#C1272D"/>
          <circle cx="80" cy="322" r="3.5" fill="#4C9BD9"/>
          <circle cx="30" cy="255" r="3" fill="#C1272D"/>
          <circle cx="60" cy="255" r="3" fill="#E8C34A"/>
          <circle cx="40" cy="193" r="2.5" fill="#4C9BD9"/>
        </g>
        <circle cx="24" cy="329" r="2" fill="#F5D889"/>
        <circle cx="56" cy="331" r="2" fill="#E8878C"/>
        <circle cx="80" cy="322" r="2" fill="#9CCBEF"/>
        <circle cx="30" cy="255" r="1.7" fill="#E8878C"/>
        <circle cx="60" cy="255" r="1.7" fill="#F5D889"/>
        <circle cx="40" cy="193" r="1.4" fill="#9CCBEF"/>
      </g>

      <!-- star topper -->
      <circle cx="45" cy="130" r="14" fill="#F5D889" opacity=".35" filter="url(#bulbGlow)"/>
      <path d="M45,116 L48,126 L58,126 L50,132 L53,142 L45,135 L37,142 L40,132 L32,126 L42,126 Z" fill="#E8C34A" stroke="#B0812F" stroke-width="1"/>
    </svg>`;

  // Christmas, right corner — the nativity: Bethlehem's star over a simple
  // stable, Mary and Joseph in silhouette at the manger with the infant
  // resting in it, and a resting lamb. The traditional focus, not a
  // secular winter scene.
  const nativitySVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="nightGlow" cx="50%" cy="35%" r="60%">
          <stop offset="0%" stop-color="#1B2A4A" stop-opacity="0.5"/>
          <stop offset="60%" stop-color="#1B2A4A" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="#1B2A4A" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="mangerGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#FFE9B8" stop-opacity="0.75"/>
          <stop offset="55%" stop-color="#F5D889" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#F5D889" stop-opacity="0"/>
        </radialGradient>
        <path id="sparkle" d="M0,-9 C1,-2 2,-1 9,0 C2,1 1,2 0,9 C-1,2 -2,1 -9,0 C-2,-1 -1,-2 0,-9 Z"/>
      </defs>

      <ellipse cx="65" cy="190" rx="90" ry="190" fill="url(#nightGlow)"/>
      <ellipse cx="65" cy="290" rx="55" ry="90" fill="url(#mangerGlow)"/>

      <!-- scattered stars -->
      <g fill="#EADFC4" opacity=".75">
        <use href="#sparkle" transform="translate(20,42) scale(.5)"/>
        <use href="#sparkle" transform="translate(102,32) scale(.6)"/>
        <use href="#sparkle" transform="translate(16,95) scale(.4)"/>
        <use href="#sparkle" transform="translate(112,78) scale(.5)"/>
        <use href="#sparkle" transform="translate(95,130) scale(.4)"/>
        <use href="#sparkle" transform="translate(30,130) scale(.35)"/>
      </g>

      <!-- the Star of Bethlehem -->
      <circle cx="65" cy="50" r="16" fill="#FFF4D6" opacity=".4"/>
      <use href="#sparkle" fill="#FFF7E4" stroke="#E8C34A" stroke-width=".5" transform="translate(65,50) scale(1.7)"/>

      <!-- stable frame -->
      <path d="M65,95 L14,175 L22,182 L65,110 L108,182 L116,175 Z" fill="#1B2036"/>
      <rect x="20" y="175" width="6" height="158" fill="#1B2036"/>
      <rect x="104" y="175" width="6" height="158" fill="#1B2036"/>

      <!-- a resting lamb, off to the side — a fluffy scalloped body, a
           distinct head with ears, and little legs so it reads as a lamb
           rather than a blob -->
      <g fill="#1B2036">
        <path d="M10,350 C7,342 13,337 20,339 C23,333 32,333 34,340
                 C40,338 44,345 39,351 C42,357 35,362 28,359
                 C23,363 14,363 10,358 C5,358 4,353 10,350 Z"/>
        <circle cx="9" cy="337" r="7.5"/>
        <ellipse cx="4" cy="329" rx="3" ry="5" transform="rotate(-25 4 329)"/>
        <ellipse cx="13" cy="329" rx="3" ry="5" transform="rotate(20 13 329)"/>
        <g stroke="#1B2036" stroke-width="3.2" stroke-linecap="round">
          <path d="M14,360 L14,369 M22,361 L22,370 M30,359 L31,368 M37,354 L40,362"/>
        </g>
      </g>

      <!-- Mary, kneeling at the manger -->
      <path d="M34,335 C31,305 28,278 36,258 C40,248 48,248 51,258 C55,278 53,305 56,335 Z" fill="#1B2036"/>
      <circle cx="44" cy="253" r="11" fill="#1B2036"/>

      <!-- Joseph, standing with a shepherd's staff -->
      <path d="M76,335 C73,295 70,258 80,232 C85,220 94,220 97,232 C103,258 100,295 103,335 Z" fill="#1B2036"/>
      <circle cx="88" cy="227" r="10.5" fill="#1B2036"/>
      <path d="M104,250 C104,244 112,244 112,250 L110,335" stroke="#1B2036" stroke-width="3" fill="none" stroke-linecap="round"/>

      <!-- the manger itself: a basket-style trough on crossed leg supports,
           the way it's traditionally drawn, with the infant resting in it -->
      <g stroke="#1B2036" stroke-width="3" stroke-linecap="round">
        <path d="M52,330 L43,352 M52,330 L60,352"/>
        <path d="M78,330 L70,352 M78,330 L86,352"/>
      </g>
      <path d="M44,318 C44,309 86,309 86,318 C86,326 80,333 65,333 C50,333 44,326 44,318 Z" fill="#1B2036"/>
      <!-- a little straw over the rim -->
      <g stroke="#D9A441" stroke-width="1.4" stroke-linecap="round" opacity=".8">
        <path d="M48,312 L46,305 M55,309 L54,302 M76,309 L77,302 M83,312 L85,305"/>
      </g>
      <!-- the infant, swaddled and glowing -->
      <ellipse cx="65" cy="313" rx="15" ry="3" fill="#F5D889" opacity=".5"/>
      <path d="M52,317 C52,308 58,304 68,305 C78,306 80,313 76,318 C70,322 56,323 52,317 Z" fill="#FFE9B8" stroke="#E8C89A" stroke-width="1"/>
      <circle cx="74" cy="308" r="6" fill="#FFE9B8" stroke="#E8C89A" stroke-width="1"/>
      <path d="M57,313 C61,310 65,310 69,312 M58,318 C63,316 68,316 72,318" stroke="#E8C89A" stroke-width="1" fill="none" opacity=".7"/>
    </svg>`;

  // Spring, left corner — a forsythia branch, arching and bare except for
  // the small four-petal blooms that appear directly on the wood before
  // any leaves do (the real plant's signature look), with a couple of
  // tulips at the base.
  const forsythiaSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="springGlowL" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#E9E86C" stop-opacity="0.32"/>
          <stop offset="55%" stop-color="#A8D96B" stop-opacity="0.14"/>
          <stop offset="100%" stop-color="#A8D96B" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="branchGradL" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#8A7458"/>
          <stop offset="100%" stop-color="#6B5A45"/>
        </linearGradient>
        <linearGradient id="stemGradL" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6FAE4A"/>
          <stop offset="100%" stop-color="#4C8C3C"/>
        </linearGradient>
        <g id="forsythiaBloom">
          <ellipse cx="0" cy="-4.2" rx="2.1" ry="4.2" fill="#F5D033"/>
          <ellipse cx="0" cy="4.2" rx="2.1" ry="4.2" fill="#F0C929"/>
          <ellipse cx="-4.2" cy="0" rx="4.2" ry="2.1" fill="#F0C929"/>
          <ellipse cx="4.2" cy="0" rx="4.2" ry="2.1" fill="#F5D033"/>
          <circle r="1.4" fill="#B5591E"/>
        </g>
        <path id="tulipCupL" d="M-9,0 C-9,-10 -5,-18 0,-22 C5,-18 9,-10 9,0 C9,4 5,6 0,4 C-5,6 -9,4 -9,0 Z"/>
        <path id="tulipLeafL" d="M0,0 C4,-18 2,-34 -6,-46 C-10,-32 -8,-14 0,0 Z"/>
      </defs>

      <ellipse cx="50" cy="290" rx="95" ry="150" fill="url(#springGlowL)"/>

      <!-- arching branches, bare wood -->
      <g fill="none" stroke="url(#branchGradL)" stroke-width="3.5" stroke-linecap="round">
        <path d="M18,400 C14,332 6,262 22,192 C30,152 46,122 58,98"/>
        <path d="M32,400 C28,322 22,254 40,184 C48,148 64,116 80,90"/>
        <path d="M46,400 C44,330 40,272 56,214 C64,180 78,152 92,124"/>
        <path d="M10,400 C6,342 0,284 12,224 C18,196 28,172 36,152"/>
      </g>

      <!-- blooms scattered along the branches -->
      <g>
        <use href="#forsythiaBloom" transform="translate(22,192) scale(1.1) rotate(10)"/>
        <use href="#forsythiaBloom" transform="translate(15,240) scale(0.9) rotate(-20)"/>
        <use href="#forsythiaBloom" transform="translate(28,150) scale(1.2) rotate(35)"/>
        <use href="#forsythiaBloom" transform="translate(40,184) scale(1) rotate(-10)"/>
        <use href="#forsythiaBloom" transform="translate(35,230) scale(1.15) rotate(20)"/>
        <use href="#forsythiaBloom" transform="translate(48,140) scale(0.85) rotate(-30)"/>
        <use href="#forsythiaBloom" transform="translate(58,98) scale(1.1) rotate(15)"/>
        <use href="#forsythiaBloom" transform="translate(56,214) scale(1) rotate(-15)"/>
        <use href="#forsythiaBloom" transform="translate(64,180) scale(1.1) rotate(25)"/>
        <use href="#forsythiaBloom" transform="translate(74,150) scale(0.95) rotate(-20)"/>
        <use href="#forsythiaBloom" transform="translate(80,90) scale(1.05) rotate(10)"/>
        <use href="#forsythiaBloom" transform="translate(12,224) scale(0.9) rotate(15)"/>
        <use href="#forsythiaBloom" transform="translate(18,270) scale(1) rotate(-25)"/>
        <use href="#forsythiaBloom" transform="translate(36,152) scale(1.1) rotate(30)"/>
        <use href="#forsythiaBloom" transform="translate(92,124) scale(1) rotate(-10)"/>
        <use href="#forsythiaBloom" transform="translate(86,106) scale(0.9) rotate(20)"/>
      </g>

      <!-- tulips at the base -- red and orange -->
      <g>
        <use href="#tulipLeafL" fill="#4C8C3C" transform="translate(18,382) rotate(-10)"/>
        <path d="M18,384 L19,342" stroke="url(#stemGradL)" stroke-width="3" fill="none" stroke-linecap="round"/>
        <use href="#tulipCupL" fill="#D1483C" stroke="#A8362C" stroke-width="1" transform="translate(19,342) rotate(4)"/>

        <use href="#tulipLeafL" fill="#4C8C3C" transform="translate(40,382) rotate(12) scale(0.9)"/>
        <path d="M42,384 L43,354" stroke="url(#stemGradL)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <use href="#tulipCupL" fill="#E8863D" stroke="#B5591E" stroke-width="1" transform="translate(43,354) rotate(-6) scale(0.85)"/>
      </g>
    </svg>`;

  // Spring, right corner — a redbud branch: thinner twigs than the
  // forsythia's, with small clustered magenta blossoms right on the bare
  // wood, plus purple and white tulips for contrast with the left corner.
  const redbudSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="springGlowR" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#E9E86C" stop-opacity="0.3"/>
          <stop offset="55%" stop-color="#D46FA0" stop-opacity="0.13"/>
          <stop offset="100%" stop-color="#D46FA0" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="trunkGradR" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#6B5A45"/>
          <stop offset="50%" stop-color="#4A3C2C"/>
          <stop offset="100%" stop-color="#6B5A45"/>
        </linearGradient>
        <radialGradient id="canopyGradR" cx="38%" cy="28%" r="80%">
          <stop offset="0%" stop-color="#E389B0"/>
          <stop offset="100%" stop-color="#B84A80"/>
        </radialGradient>
        <linearGradient id="stemGradR" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#6FAE4A"/>
          <stop offset="100%" stop-color="#4C8C3C"/>
        </linearGradient>
        <g id="redbudBloom">
          <circle cx="-2.2" cy="-1" r="2.3" fill="#C6538C"/>
          <circle cx="2.1" cy="-1.4" r="2.1" fill="#D46FA0"/>
          <circle cx="0" cy="2" r="2.4" fill="#B84A80"/>
          <circle cx="-0.8" cy="0.8" r="1.6" fill="#E389B0"/>
        </g>
        <path id="tulipCupR" d="M-9,0 C-9,-10 -5,-18 0,-22 C5,-18 9,-10 9,0 C9,4 5,6 0,4 C-5,6 -9,4 -9,0 Z"/>
        <path id="tulipLeafR" d="M0,0 C4,-18 2,-34 -6,-46 C-10,-32 -8,-14 0,0 Z"/>
      </defs>

      <ellipse cx="55" cy="260" rx="95" ry="160" fill="url(#springGlowR)"/>

      <!-- a redbud is a small tree, not a shrub -- a low trunk that forks
           into two or three main limbs, unlike the forsythia's fountain of
           bare canes -->
      <path d="M52,400 C51,362 50,322 54,288 C55,278 59,272 64,268" fill="none" stroke="url(#trunkGradR)" stroke-width="12" stroke-linecap="round"/>
      <path d="M64,268 C60,248 53,224 42,204 C38,196 34,190 29,184" fill="none" stroke="url(#trunkGradR)" stroke-width="7" stroke-linecap="round"/>
      <path d="M64,268 C71,246 82,222 97,201 C103,192 109,184 115,177" fill="none" stroke="url(#trunkGradR)" stroke-width="7" stroke-linecap="round"/>
      <g fill="none" stroke="url(#trunkGradR)" stroke-width="3.5" stroke-linecap="round">
        <path d="M42,204 C33,193 20,184 8,180"/>
        <path d="M34,192 C29,172 33,150 26,132"/>
        <path d="M97,201 C106,186 108,166 100,148"/>
        <path d="M105,186 C116,176 126,168 132,164"/>
        <path d="M54,288 C43,281 30,278 18,281"/>
        <path d="M60,272 C69,258 84,250 97,248"/>
      </g>

      <!-- soft canopy masses, layered to suggest the dense blossom cover a
           redbud gets before any leaves come in -->
      <g fill="url(#canopyGradR)" opacity=".92">
        <ellipse cx="24" cy="188" rx="26" ry="32"/>
        <ellipse cx="60" cy="156" rx="30" ry="36"/>
        <ellipse cx="96" cy="172" rx="28" ry="34"/>
        <ellipse cx="112" cy="216" rx="22" ry="28"/>
        <ellipse cx="14" cy="234" rx="20" ry="24"/>
        <ellipse cx="72" cy="220" rx="25" ry="26"/>
        <ellipse cx="45" cy="222" rx="20" ry="22"/>
      </g>

      <!-- discrete bloom clusters on top, breaking up the canopy silhouette
           and giving it texture -->
      <g>
        <use href="#redbudBloom" transform="translate(10,178) scale(1.15)"/>
        <use href="#redbudBloom" transform="translate(24,158) scale(1.3)"/>
        <use href="#redbudBloom" transform="translate(38,192) scale(1)"/>
        <use href="#redbudBloom" transform="translate(50,138) scale(1.2)"/>
        <use href="#redbudBloom" transform="translate(64,126) scale(1.3)"/>
        <use href="#redbudBloom" transform="translate(78,150) scale(1.1)"/>
        <use href="#redbudBloom" transform="translate(90,146) scale(1.2)"/>
        <use href="#redbudBloom" transform="translate(104,168) scale(1)"/>
        <use href="#redbudBloom" transform="translate(116,198) scale(1.1)"/>
        <use href="#redbudBloom" transform="translate(122,232) scale(0.95)"/>
        <use href="#redbudBloom" transform="translate(96,232) scale(1.15)"/>
        <use href="#redbudBloom" transform="translate(60,206) scale(1.2)"/>
        <use href="#redbudBloom" transform="translate(30,214) scale(1.1)"/>
        <use href="#redbudBloom" transform="translate(8,222) scale(1)"/>
        <use href="#redbudBloom" transform="translate(16,252) scale(1.1)"/>
        <use href="#redbudBloom" transform="translate(38,246) scale(1)"/>
        <use href="#redbudBloom" transform="translate(80,196) scale(1.05)"/>
      </g>

      <!-- tulips at the base -- purple and white -->
      <g>
        <use href="#tulipLeafR" fill="#4C8C3C" transform="translate(22,382) rotate(8)"/>
        <path d="M22,384 L23,344" stroke="url(#stemGradR)" stroke-width="3" fill="none" stroke-linecap="round"/>
        <use href="#tulipCupR" fill="#8B5FA8" stroke="#6B4680" stroke-width="1" transform="translate(23,344) rotate(-4)"/>

        <use href="#tulipLeafR" fill="#4C8C3C" transform="translate(44,382) rotate(-10) scale(0.9)"/>
        <path d="M40,384 L41,356" stroke="url(#stemGradR)" stroke-width="2.5" fill="none" stroke-linecap="round"/>
        <use href="#tulipCupR" fill="#F5F0E8" stroke="#D9CBB8" stroke-width="1" transform="translate(41,356) rotate(6) scale(0.85)"/>
      </g>
    </svg>`;

  // St. Patrick's Day, left corner — closely modeled on classic leprechaun
  // clip-art (big round head, wild curly hair and beard, wide-flared green
  // top hat, cheerful gap-toothed grin, pot of gold in both hands). The
  // "curl" symbol is reused all over the hair/beard/eyebrows to build a
  // wavy, voluminous silhouette instead of a single smooth blob.
  const leprechaunSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="lepGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#E8C34A" stop-opacity="0.3"/>
          <stop offset="55%" stop-color="#2E9A4C" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#2E9A4C" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="coatGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#34A855"/>
          <stop offset="100%" stop-color="#1E7A3C"/>
        </linearGradient>
        <linearGradient id="lapelGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4ABE70"/>
          <stop offset="100%" stop-color="#2E9A4C"/>
        </linearGradient>
        <linearGradient id="trouserGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#23823F"/>
          <stop offset="100%" stop-color="#155C2C"/>
        </linearGradient>
        <radialGradient id="lepFaceGrad" cx="35%" cy="28%" r="80%">
          <stop offset="0%" stop-color="#FBE8C4"/>
          <stop offset="100%" stop-color="#E8C896"/>
        </radialGradient>
        <linearGradient id="hatGradLep" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#1B6B34"/>
          <stop offset="50%" stop-color="#34A855"/>
          <stop offset="100%" stop-color="#1B6B34"/>
        </linearGradient>
        <linearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#F5E28A"/>
          <stop offset="100%" stop-color="#C9A227"/>
        </linearGradient>
        <radialGradient id="lepPotGrad" cx="35%" cy="25%" r="80%">
          <stop offset="0%" stop-color="#3A3A3A"/>
          <stop offset="100%" stop-color="#141414"/>
        </radialGradient>
        <radialGradient id="lepCoinGrad" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#F5DD7E"/>
          <stop offset="100%" stop-color="#C9A227"/>
        </radialGradient>
        <g id="clover">
          <path d="M0,0 C-1,-6 -6,-8 -8,-4 C-6,-1 -3,0 0,0 Z"/>
          <path d="M0,0 C1,-6 6,-8 8,-4 C6,-1 3,0 0,0 Z"/>
          <path d="M0,0 C-5,2 -6,7 -2,8 C0,5 0,2 0,0 Z"/>
        </g>
        <!-- a single wavy curl -- reused, scaled and rotated, to build all
             the hair, beard and eyebrow volume -->
        <path id="curl" d="M0,4 C-1,0 1,-4 5,-5 C9,-6 13,-4 14,0
                            C10,-1 6,-1 3,2 C1,4 1,6 0,8 C-1,7 0,6 0,4 Z"/>
      </defs>

      <ellipse cx="65" cy="270" rx="95" ry="160" fill="url(#lepGlow)"/>

      <!-- short, stubby legs, green-striped like the clip-art -->
      <path d="M38,315 C36,331 36,347 40,359 C44,365 52,365 54,359 C55,347 54,331 54,315 Z" fill="url(#trouserGrad)" stroke="#0F3A1C" stroke-width="1.5"/>
      <path d="M76,315 C75,331 74,347 75,359 C76,365 84,365 88,359 C92,347 92,331 90,315 Z" fill="url(#trouserGrad)" stroke="#0F3A1C" stroke-width="1.5"/>
      <g stroke="#0F3A1C" stroke-width="1.5" opacity=".35">
        <path d="M37,325 L54,325 M37,336 L54,336 M38,347 L55,347"/>
        <path d="M75,325 L92,325 M75,336 L92,336 M75,347 L91,347"/>
      </g>

      <!-- shoes with gold buckles -->
      <path d="M33,358 C31,368 37,374 47,374 C55,374 57,368 53,360 Z" fill="#141414"/>
      <rect x="40" y="360" width="9" height="9" rx="1.5" fill="url(#goldGrad)" stroke="#8A6A1E" stroke-width=".6" transform="rotate(-4 44.5 364.5)"/>
      <path d="M75,358 C73,368 79,374 89,374 C97,374 99,368 95,360 Z" fill="#141414"/>
      <rect x="82" y="360" width="9" height="9" rx="1.5" fill="url(#goldGrad)" stroke="#8A6A1E" stroke-width=".6" transform="rotate(4 86.5 364.5)"/>

      <!-- round, compact torso with lapels and buttons -->
      <path d="M34,252 C34,240 96,240 96,252 L101,328 C101,341 29,341 29,328 Z" fill="url(#coatGrad)" stroke="#0F3A1C" stroke-width="2"/>
      <path d="M55,244 L46,258 L58,274 L65,262 L72,274 L84,258 L75,244" fill="url(#lapelGrad)" stroke="#155C2C" stroke-width="1.2"/>
      <circle cx="65" cy="278" r="3" fill="url(#goldGrad)" stroke="#8A6A1E" stroke-width=".5"/>
      <circle cx="65" cy="292" r="3" fill="url(#goldGrad)" stroke="#8A6A1E" stroke-width=".5"/>
      <circle cx="65" cy="306" r="3" fill="url(#goldGrad)" stroke="#8A6A1E" stroke-width=".5"/>
      <!-- belt -->
      <rect x="29" y="313" width="72" height="13" fill="#141414"/>
      <rect x="57" y="311" width="17" height="17" rx="2" fill="url(#goldGrad)" stroke="#8A6A1E" stroke-width="1"/>
      <rect x="62" y="315.5" width="7" height="8" rx="1" fill="#2A1F14"/>
      <!-- white shirt collar -->
      <path d="M50,246 C45,244 43,240 45,236 C55,232 75,232 85,236 C87,240 85,244 80,246 Z" fill="#F5F0E8" stroke="#D9CBB0" stroke-width=".7"/>

      <!-- pot of gold, held in both hands -->
      <ellipse cx="65" cy="312" rx="27" ry="9" fill="#050505"/>
      <path d="M39,309 C37,328 48,339 65,339 C82,339 93,328 91,309 Z" fill="url(#lepPotGrad)" stroke="#000000" stroke-width="1.5"/>
      <path d="M45,314 C44,322 48,329 52,332" stroke="#5A5A5A" stroke-width="1.5" fill="none" opacity=".5"/>
      <g stroke="#8A6A1E" stroke-width="1">
        <circle cx="50" cy="299" r="8" fill="url(#lepCoinGrad)"/>
        <circle cx="65" cy="291" r="9.5" fill="url(#lepCoinGrad)"/>
        <circle cx="80" cy="299" r="8" fill="url(#lepCoinGrad)"/>
        <circle cx="58" cy="307" r="6.5" fill="url(#lepCoinGrad)"/>
        <circle cx="72" cy="307" r="6.5" fill="url(#lepCoinGrad)"/>
        <circle cx="65" cy="303" r="6" fill="url(#lepCoinGrad)"/>
      </g>
      <g stroke="#8A6A1E" stroke-width=".6" fill="none" opacity=".6">
        <path d="M65,286 Q68,291 65,296"/>
        <path d="M50,294 Q53,299 50,304"/>
      </g>

      <!-- arms, curving down to hold the pot, with simple fingers on the
           hands gripping the rim -->
      <path d="M30,258 C19,270 15,290 26,307 C31,314 41,313 44,305 C41,291 37,274 39,260 Z" fill="url(#coatGrad)" stroke="#0F3A1C" stroke-width="1.5"/>
      <path d="M100,258 C111,270 115,290 104,307 C99,314 89,313 86,305 C89,291 93,274 91,260 Z" fill="url(#coatGrad)" stroke="#0F3A1C" stroke-width="1.5"/>
      <circle cx="32" cy="309" r="7.5" fill="url(#lepFaceGrad)" stroke="#C7A263" stroke-width=".6"/>
      <circle cx="98" cy="309" r="7.5" fill="url(#lepFaceGrad)" stroke="#C7A263" stroke-width=".6"/>
      <g stroke="#C7A263" stroke-width="1" opacity=".7">
        <path d="M27,306 L24,310 M31,312 L29,316 M36,311 L35,315"/>
        <path d="M103,306 L106,310 M99,312 L101,316 M94,311 L95,315"/>
      </g>

      <!-- neck -->
      <rect x="53" y="226" width="24" height="22" rx="9" fill="url(#lepFaceGrad)"/>

      <!-- big, round chibi head -->
      <circle cx="65" cy="188" r="40" fill="url(#lepFaceGrad)" stroke="#C7A263" stroke-width="1.5"/>

      <!-- ears -->
      <path d="M24,180 C16,177 12,187 18,195 C22,198 27,193 27,187 Z" fill="url(#lepFaceGrad)" stroke="#C7A263" stroke-width="1"/>
      <path d="M106,180 C114,177 118,187 112,195 C108,198 103,193 103,187 Z" fill="url(#lepFaceGrad)" stroke="#C7A263" stroke-width="1"/>

      <!-- wild, curly ginger hair, built from a base mass plus scattered
           curls so the silhouette is bumpy and voluminous, not a smooth
           blob -->
      <g>
        <path d="M14,178 C4,166 4,146 16,132 C26,124 40,128 43,140 C34,142 26,150 24,164 C23,172 20,178 14,178 Z" fill="#D9791E"/>
        <path d="M116,178 C126,166 126,146 114,132 C104,124 90,128 87,140 C96,142 104,150 106,164 C107,172 110,178 116,178 Z" fill="#D9791E"/>
        <g fill="#C9702E">
          <use href="#curl" transform="translate(8,160) scale(1.6) rotate(200)"/>
          <use href="#curl" transform="translate(6,140) scale(1.4) rotate(230)"/>
          <use href="#curl" transform="translate(16,124) scale(1.5) rotate(260)"/>
          <use href="#curl" transform="translate(30,118) scale(1.3) rotate(290)"/>
          <use href="#curl" transform="translate(20,150) scale(1.2) rotate(220)"/>
          <use href="#curl" transform="translate(122,160) scale(-1.6,1.6) rotate(200)"/>
          <use href="#curl" transform="translate(124,140) scale(-1.4,1.4) rotate(230)"/>
          <use href="#curl" transform="translate(114,124) scale(-1.5,1.5) rotate(260)"/>
          <use href="#curl" transform="translate(100,118) scale(-1.3,1.3) rotate(290)"/>
          <use href="#curl" transform="translate(110,150) scale(-1.2,1.2) rotate(220)"/>
        </g>
      </g>

      <!-- bushy eyebrows, built from overlapping curls rather than a
           single stroke -->
      <g fill="#C9702E">
        <use href="#curl" transform="translate(38,169) scale(1.5) rotate(100)"/>
        <use href="#curl" transform="translate(47,162) scale(1.6) rotate(75)"/>
        <use href="#curl" transform="translate(58,163) scale(1.3) rotate(50)"/>
        <use href="#curl" transform="translate(92,169) scale(-1.5,1.5) rotate(100)"/>
        <use href="#curl" transform="translate(83,162) scale(-1.6,1.6) rotate(75)"/>
        <use href="#curl" transform="translate(72,163) scale(-1.3,1.3) rotate(50)"/>
      </g>

      <!-- big eyes with iris, pupil and a catchlight -->
      <ellipse cx="51" cy="180" rx="6.2" ry="7.2" fill="#FFFFFF" stroke="#00000022" stroke-width=".6"/>
      <circle cx="52" cy="181" r="3.7" fill="#5B8FC7"/>
      <circle cx="52" cy="181" r="2" fill="#1A1A1A"/>
      <circle cx="49.8" cy="178.5" r="1.1" fill="#FFFFFF"/>
      <ellipse cx="79" cy="180" rx="6.2" ry="7.2" fill="#FFFFFF" stroke="#00000022" stroke-width=".6"/>
      <circle cx="80" cy="181" r="3.7" fill="#5B8FC7"/>
      <circle cx="80" cy="181" r="2" fill="#1A1A1A"/>
      <circle cx="77.8" cy="178.5" r="1.1" fill="#FFFFFF"/>

      <!-- freckles -->
      <g fill="#C9702E" opacity=".5">
        <circle cx="43" cy="190" r="1"/>
        <circle cx="47" cy="193" r="1"/>
        <circle cx="60" cy="192" r="1"/>
        <circle cx="70" cy="192" r="1"/>
        <circle cx="83" cy="193" r="1"/>
        <circle cx="87" cy="190" r="1"/>
      </g>

      <!-- rosy cheeks -->
      <ellipse cx="37" cy="192" rx="7" ry="5" fill="#F0847A" opacity=".5"/>
      <ellipse cx="93" cy="192" rx="7" ry="5" fill="#F0847A" opacity=".5"/>

      <!-- nose -->
      <ellipse cx="65" cy="190" rx="5" ry="4" fill="#E8A15A"/>

      <!-- big bushy beard and mustache, one continuous wavy mass so it
           reads as full and curly rather than a smooth blob -- dips low
           in the middle so the open smile stays visible -->
      <path d="M17,178 C13,202 18,226 32,240 C43,251 56,257 65,257 C74,257 87,251 98,240
               C112,226 117,202 113,178 C104,190 96,198 88,202
               C90,196 90,190 86,186 C82,194 76,200 65,204
               C54,200 48,194 44,186 C40,190 40,196 42,202
               C34,198 26,190 17,178 Z"
            fill="#D9791E" stroke="#A85A16" stroke-width="1.5"/>
      <g fill="#C9702E">
        <use href="#curl" transform="translate(20,190) scale(1.6) rotate(200)"/>
        <use href="#curl" transform="translate(18,212) scale(1.5) rotate(215)"/>
        <use href="#curl" transform="translate(26,230) scale(1.5) rotate(235)"/>
        <use href="#curl" transform="translate(38,244) scale(1.4) rotate(255)"/>
        <use href="#curl" transform="translate(52,254) scale(1.3) rotate(275)"/>
        <use href="#curl" transform="translate(110,190) scale(-1.6,1.6) rotate(200)"/>
        <use href="#curl" transform="translate(112,212) scale(-1.5,1.5) rotate(215)"/>
        <use href="#curl" transform="translate(104,230) scale(-1.5,1.5) rotate(235)"/>
        <use href="#curl" transform="translate(92,244) scale(-1.4,1.4) rotate(255)"/>
        <use href="#curl" transform="translate(78,254) scale(-1.3,1.3) rotate(275)"/>
      </g>
      <g stroke="#B85F22" stroke-width="1.1" fill="none" opacity=".45">
        <path d="M40,222 C38,232 40,242 46,249"/>
        <path d="M65,226 L65,252"/>
        <path d="M90,222 C92,232 90,242 84,249"/>
      </g>

      <!-- big open, cheerful smile with a hint of teeth -->
      <path d="M46,203 Q65,225 84,203 Q65,216 46,203 Z" fill="#FFFFFF" stroke="#3A2E1C" stroke-width="1.3"/>
      <path d="M51,207 Q65,213 79,207" stroke="#3A2E1C" stroke-width=".9" fill="none" opacity=".4"/>

      <!-- hat -- wide flared green brim, tall crown, dark band, ornate
           gold buckle, and a shamrock like the reference art -->
      <path d="M17,152 C17,142 35,135 65,135 C95,135 113,142 113,152 C113,160 95,165 65,165 C35,165 17,160 17,152 Z"
            fill="url(#hatGradLep)" stroke="#0F3A1C" stroke-width="1.5"/>
      <rect x="41" y="64" width="48" height="80" rx="8" fill="url(#hatGradLep)" stroke="#0F3A1C" stroke-width="1.5"/>
      <path d="M50,76 Q54,100 47,122" stroke="#0F3A1C" stroke-width="1" opacity=".2" fill="none"/>
      <path d="M80,74 Q76,98 82,120" stroke="#0F3A1C" stroke-width="1" opacity=".2" fill="none"/>
      <rect x="41" y="112" width="48" height="14" fill="#2A1F14"/>
      <rect x="56" y="110" width="18" height="18" rx="2" fill="url(#goldGrad)" stroke="#8A6A1E" stroke-width="1"/>
      <rect x="61" y="115" width="8" height="8" rx="1" fill="#2A1F14"/>
      <use href="#clover" fill="#2E9A4C" stroke="#0F3A1C" stroke-width=".8" transform="translate(34,96) scale(1.3) rotate(-12)"/>

      <!-- a shamrock floating beside him, and a couple at his feet -->
      <use href="#clover" fill="#2E9A4C" stroke="#155C2C" stroke-width=".7" transform="translate(12,215) scale(1.5) rotate(-8)"/>
      <use href="#clover" fill="#2E9A4C" stroke="#155C2C" stroke-width=".6" transform="translate(20,352) scale(1.3) rotate(10)"/>
      <use href="#clover" fill="#1E7A3C" stroke="#0F3A1C" stroke-width=".6" transform="translate(108,354) scale(1.1) rotate(-15)"/>
    </svg>`;

  // St. Patrick's Day, right corner — a rainbow arcing down to a pot of
  // gold, coins spilling out, clovers scattered around the base.
  const rainbowPotSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="rainbowGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#E8C34A" stop-opacity="0.3"/>
          <stop offset="55%" stop-color="#2E9A4C" stop-opacity="0.15"/>
          <stop offset="100%" stop-color="#2E9A4C" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="potGrad" cx="35%" cy="25%" r="80%">
          <stop offset="0%" stop-color="#3A3A3A"/>
          <stop offset="100%" stop-color="#141414"/>
        </radialGradient>
        <radialGradient id="coinGrad" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#F5DD7E"/>
          <stop offset="100%" stop-color="#C9A227"/>
        </radialGradient>
        <g id="cloverR">
          <path d="M0,0 C-1,-6 -6,-8 -8,-4 C-6,-1 -3,0 0,0 Z"/>
          <path d="M0,0 C1,-6 6,-8 8,-4 C6,-1 3,0 0,0 Z"/>
          <path d="M0,0 C-5,2 -6,7 -2,8 C0,5 0,2 0,0 Z"/>
        </g>
      </defs>

      <ellipse cx="55" cy="290" rx="95" ry="150" fill="url(#rainbowGlow)"/>

      <!-- rainbow, arcing down from off-canvas to the pot -->
      <g fill="none" stroke-linecap="round">
        <path d="M-10,40 C 50,10 110,50 96,150" stroke="#C6402F" stroke-width="9"/>
        <path d="M-10,49 C 46,21 101,58 87,152" stroke="#E8863D" stroke-width="9"/>
        <path d="M-10,58 C 42,32 92,66 78,154" stroke="#F0C929" stroke-width="9"/>
        <path d="M-10,67 C 38,43 83,74 69,156" stroke="#2E9A4C" stroke-width="9"/>
        <path d="M-10,76 C 34,54 74,82 60,158" stroke="#3E8BC4" stroke-width="9"/>
        <path d="M-10,85 C 30,65 65,90 51,160" stroke="#8B5FA8" stroke-width="9"/>
      </g>

      <!-- pot of gold -->
      <path d="M28,317 C26,333 34,345 55,345 C76,345 84,333 82,317 Z" fill="url(#potGrad)" stroke="#000000" stroke-width="1.5"/>
      <ellipse cx="55" cy="317" rx="27" ry="8" fill="#050505"/>
      <ellipse cx="55" cy="314" rx="24" ry="6.5" fill="url(#potGrad)" stroke="#000000" stroke-width="1"/>

      <!-- coins spilling out -->
      <g stroke="#8A6A1E" stroke-width="1">
        <circle cx="40" cy="307" r="8" fill="url(#coinGrad)"/>
        <circle cx="55" cy="301" r="9" fill="url(#coinGrad)"/>
        <circle cx="70" cy="308" r="8" fill="url(#coinGrad)"/>
        <circle cx="48" cy="315" r="7" fill="url(#coinGrad)"/>
        <circle cx="62" cy="315" r="7" fill="url(#coinGrad)"/>
        <circle cx="20" cy="335" r="6" fill="url(#coinGrad)"/>
        <circle cx="90" cy="333" r="6.5" fill="url(#coinGrad)"/>
      </g>

      <!-- clovers scattered at the base -->
      <use href="#cloverR" fill="#2E9A4C" stroke="#155C2C" stroke-width=".6" transform="translate(14,345) scale(1.2) rotate(8)"/>
      <use href="#cloverR" fill="#1E7A3C" stroke="#0F3A1C" stroke-width=".6" transform="translate(100,341) scale(1.1) rotate(-12)"/>
      <use href="#cloverR" fill="#2E9A4C" stroke="#155C2C" stroke-width=".6" transform="translate(78,347) scale(0.9) rotate(20)"/>
    </svg>`;

  // Easter, left corner — a plain, rugged cross on a grassy hill at dawn,
  // with Easter lilies at the base. References the Christian meaning of
  // the day: the cross, and the sunrise associated with the resurrection.
  const easterCrossSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="dawnGlowL" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stop-color="#F5D9A8" stop-opacity="0.45"/>
          <stop offset="55%" stop-color="#E8A8C0" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#E8A8C0" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="woodGradL" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#8A6A4A"/>
          <stop offset="50%" stop-color="#6B4F35"/>
          <stop offset="100%" stop-color="#8A6A4A"/>
        </linearGradient>
        <linearGradient id="hillGradL" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#8FB56E"/>
          <stop offset="100%" stop-color="#5C8C46"/>
        </linearGradient>
        <path id="raySpike" d="M0,0 L-5,-70 L5,-70 Z"/>
        <g id="easterLily">
          <path d="M0,0 L-1,-38" stroke="#6FA85C" stroke-width="3" fill="none" stroke-linecap="round"/>
          <path d="M-1,-30 C-9,-34 -13,-42 -9,-50" stroke="#6FA85C" stroke-width="2.5" fill="none" stroke-linecap="round"/>
          <path d="M-14,-46 C-14,-58 -6,-67 0,-71 C6,-67 14,-58 14,-46 C14,-38 7,-34 0,-34 C-7,-34 -14,-38 -14,-46 Z"
                fill="#FBF8F2" stroke="#D9CBB0" stroke-width="1"/>
          <path d="M0,-71 C-3,-64 -3,-56 0,-50 C3,-56 3,-64 0,-71 Z" fill="#E8D9B8" opacity=".5"/>
          <ellipse cx="0" cy="-50" rx="2.6" ry="4.5" fill="#E8C34A"/>
        </g>
      </defs>

      <ellipse cx="55" cy="260" rx="95" ry="160" fill="url(#dawnGlowL)"/>

      <!-- sunrise rays behind the cross -->
      <g fill="#F5D9A8" opacity=".35">
        <use href="#raySpike" transform="translate(65,131) rotate(-40) scale(.9)"/>
        <use href="#raySpike" transform="translate(65,131) rotate(-20) scale(1.1)"/>
        <use href="#raySpike" transform="translate(65,131) rotate(0) scale(1.2)"/>
        <use href="#raySpike" transform="translate(65,131) rotate(20) scale(1.1)"/>
        <use href="#raySpike" transform="translate(65,131) rotate(40) scale(.9)"/>
        <use href="#raySpike" transform="translate(65,131) rotate(-60) scale(.75)"/>
        <use href="#raySpike" transform="translate(65,131) rotate(60) scale(.75)"/>
      </g>

      <!-- grassy hill -->
      <path d="M-10,400 C0,352 30,336 65,336 C100,336 128,352 138,400 Z" fill="url(#hillGradL)" stroke="#4A7038" stroke-width="1"/>

      <!-- the cross, plain and rugged -->
      <rect x="58" y="66" width="14" height="290" rx="2" fill="url(#woodGradL)" stroke="#4A3624" stroke-width="1.5"/>
      <rect x="34" y="124" width="62" height="14" rx="2" fill="url(#woodGradL)" stroke="#4A3624" stroke-width="1.5"/>
      <path d="M60,80 L70,80 M60,340 L70,340" stroke="#4A3624" stroke-width="1" opacity=".5"/>

      <!-- lilies at the base -->
      <use href="#easterLily" transform="translate(24,370) scale(1.05) rotate(-6)"/>
      <use href="#easterLily" transform="translate(100,374) scale(0.95) rotate(8)"/>
      <use href="#easterLily" transform="translate(60,382) scale(0.8) rotate(-3)"/>
    </svg>`;

  // Easter, right corner — the empty tomb: the stone rolled away, radiant
  // light where the body should have been, and the folded linen grave
  // cloth (John 20:6-7) left behind. Deliberately no figure — the empty
  // tomb itself is the resurrection symbol, and it pairs with the left
  // corner's cross without needing to depict anyone.
  const easterTombSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="dawnGlowR" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stop-color="#F5D9A8" stop-opacity="0.45"/>
          <stop offset="55%" stop-color="#E8A8C0" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#E8A8C0" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="rockGradR" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#B0A896"/>
          <stop offset="100%" stop-color="#7C7566"/>
        </linearGradient>
        <radialGradient id="tombLight" cx="50%" cy="35%" r="70%">
          <stop offset="0%" stop-color="#FFF8E0"/>
          <stop offset="60%" stop-color="#FFE9B8"/>
          <stop offset="100%" stop-color="#F0C878"/>
        </radialGradient>
        <radialGradient id="stoneGrad" cx="32%" cy="26%" r="85%">
          <stop offset="0%" stop-color="#E4D7AC"/>
          <stop offset="100%" stop-color="#AE9C68"/>
        </radialGradient>
        <g id="easterLilyR">
          <path d="M0,0 L-1,-34" stroke="#6FA85C" stroke-width="2.5" fill="none" stroke-linecap="round"/>
          <path d="M-12,-40 C-12,-51 -5,-59 0,-62 C5,-59 12,-51 12,-40 C12,-33 6,-30 0,-30 C-6,-30 -12,-33 -12,-40 Z"
                fill="#FBF8F2" stroke="#D9CBB0" stroke-width="1"/>
          <ellipse cx="0" cy="-44" rx="2.3" ry="4" fill="#E8C34A"/>
        </g>
      </defs>

      <ellipse cx="60" cy="240" rx="100" ry="185" fill="url(#dawnGlowR)"/>

      <!-- a craggy, irregular rock outcropping -- a jagged mix of
           straight and gently curved segments at different heights,
           rather than one smooth dome, so it reads as natural stone --
           big and tall enough that the doorway reads as a small opening
           cut into a substantial mountain, solidly planted on the
           ground, rather than a small mound perched above it -->
      <path d="M-10,400 L-10,265 C-8,233 -2,205 12,187 L26,199 L20,145
               C26,116 36,104 44,122 L46,87
               C52,60 66,54 72,79 L80,56
               C92,65 100,91 96,122 L114,114
               C126,133 134,173 132,214 L140,238 L140,400 Z"
            fill="url(#rockGradR)" stroke="#5C5648" stroke-width="2" stroke-linejoin="round"/>
      <path d="M8,317 Q20,260 14,217 M108,303 Q96,260 104,217 M58,132 Q68,110 78,121"
            stroke="#8F8778" stroke-width="2" fill="none" opacity=".4"/>

      <!-- the archway, carved into the rock -- a dark frame around a
           radiant, empty interior, proportioned like an actual doorway
           (rounded top, roughly as tall as it is wide) so it reads
           clearly as a tomb entrance rather than a narrow slot -- raised
           well clear of the footer-text/viewport safe-zone cutoff (the
           bottom sliver of the corner box is not reliably visible) so
           the doorway doesn't appear to sink below the page -->
      <path d="M34,373 L34,299 C34,275 90,275 90,299 L90,373 Z" fill="none" stroke="#4A4438" stroke-width="7"/>
      <path d="M37,373 L37,300 C37,281 87,281 87,300 L87,373 Z" fill="url(#tombLight)"/>

      <!-- the stone, rolled just aside from the entrance -- large enough
           to read as the same door-sized stone that sealed the tomb, not
           a pebble -- with a shallow groove showing the short distance it
           travelled, and ring texture plus a highlight to keep it
           reading as a separate, rounded, rolled object -- raised to
           match the doorway's new ground line -->
      <path d="M-8,369 Q9,363 26,369" stroke="#6B6558" stroke-width="2.5" fill="none" opacity=".5"/>
      <ellipse cx="14" cy="357" rx="30" ry="10" fill="#000000" opacity=".14"/>
      <ellipse cx="14" cy="332" rx="32" ry="34" fill="url(#stoneGrad)" stroke="#7A6E52" stroke-width="2.5"/>
      <g stroke="#C4B78E" stroke-width="1.4" fill="none" opacity=".7">
        <ellipse cx="14" cy="332" rx="22" ry="23"/>
        <ellipse cx="14" cy="332" rx="11" ry="12"/>
      </g>
      <ellipse cx="4" cy="319" rx="8" ry="10" fill="#EDE2BE" opacity=".55"/>

      <!-- the folded linen cloth, left behind, just inside the entrance -->
      <path d="M50,367 C50,359 76,359 76,367 C76,372 68,374 63,373 C58,374 50,372 50,367 Z" fill="#F5EFE0" stroke="#D9CBB0" stroke-width="1"/>
      <path d="M56,363 L56,368 M63,362 L63,368 M70,363 L70,368" stroke="#D9CBB0" stroke-width="1" opacity=".7"/>

      <!-- a lily at the foot of the entrance -->
      <use href="#easterLilyR" transform="translate(100,367) scale(0.9) rotate(8)"/>
    </svg>`;

  // New Year's, left corner — two champagne flutes leaning in for a
  // toast, bubbles rising through the gold liquid, and a burst of
  // sparkle right where the rims meet, with a gold bow at the base for
  // a bit of extra ornament.
  const champagneToastSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="nyGlowL" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stop-color="#E8D48A" stop-opacity="0.32"/>
          <stop offset="55%" stop-color="#8A7FA8" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="#8A7FA8" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="glassStemGradL" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#DCD5E6"/>
          <stop offset="100%" stop-color="#B8ADC8"/>
        </linearGradient>
        <linearGradient id="glassBodyGradL" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#EFE9F5" stop-opacity=".55"/>
          <stop offset="50%" stop-color="#FFFFFF" stop-opacity=".25"/>
          <stop offset="100%" stop-color="#DCD3E8" stop-opacity=".55"/>
        </linearGradient>
        <linearGradient id="bubblyGradL" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stop-color="#C9932E"/>
          <stop offset="100%" stop-color="#F8E3A3"/>
        </linearGradient>
        <linearGradient id="goldGradL" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#F5E28A"/>
          <stop offset="100%" stop-color="#A8842E"/>
        </linearGradient>
        <path id="sparkle4L" d="M0,-7 C1,-2.2 2.2,-1 7,0 C2.2,1 1,2.2 0,7 C-1,2.2 -2.2,1 -7,0 C-2.2,-1 -1,-2.2 0,-7 Z"/>
        <g id="fluteL">
          <ellipse cx="0" cy="0" rx="13" ry="4" fill="url(#glassStemGradL)" stroke="#8B7FA0" stroke-width="1"/>
          <rect x="-2.2" y="-58" width="4.4" height="58" rx="2" fill="url(#glassStemGradL)" stroke="#8B7FA0" stroke-width=".8"/>
          <path d="M-5,-58 C-7,-92 -11,-128 -13,-152 C-13,-156 13,-156 13,-152 C11,-128 7,-92 5,-58 Z"
                fill="url(#glassBodyGradL)" stroke="#8B7FA0" stroke-width="1.2"/>
          <path d="M-9,-110 C-10,-130 -12,-142 -12.5,-152 C-12.5,-155 12.5,-155 12.5,-152 C12,-142 10,-130 9,-110
                   C9,-107 -9,-107 -9,-110 Z" fill="url(#bubblyGradL)"/>
          <g fill="#FFF7DE" opacity=".85">
            <circle cx="-3" cy="-118" r="1.1"/>
            <circle cx="2.5" cy="-131" r="1.3"/>
            <circle cx="-1" cy="-143" r="1"/>
            <circle cx="4" cy="-114" r=".9"/>
            <circle cx="0" cy="-160" r="1" opacity=".7"/>
          </g>
          <path d="M-8,-70 C-9,-95 -11,-120 -12,-140" stroke="#FFFFFF" stroke-width="1.6" fill="none" opacity=".4" stroke-linecap="round"/>
        </g>
      </defs>

      <ellipse cx="55" cy="215" rx="95" ry="160" fill="url(#nyGlowL)"/>

      <!-- two flutes, leaning in with a visible gap between the rims so
           both glasses still read clearly -->
      <use href="#fluteL" transform="translate(40,340) rotate(6)"/>
      <use href="#fluteL" transform="translate(90,340) rotate(-6)"/>

      <!-- the clink -- a burst of sparkle bridging the gap between rims -->
      <circle cx="65" cy="186" r="16" fill="#FFF7DE" opacity=".35"/>
      <g fill="#F5E28A">
        <use href="#sparkle4L" transform="translate(65,184) scale(1.3)"/>
        <use href="#sparkle4L" transform="translate(50,192) scale(.7)"/>
        <use href="#sparkle4L" transform="translate(80,190) scale(.8)"/>
        <use href="#sparkle4L" transform="translate(66,170) scale(.55)"/>
      </g>

      <!-- a gold bow tied at the base, for a little extra ornament -->
      <g transform="translate(65,337)">
        <path d="M0,0 C-4,-8 -18,-10 -22,-2 C-24,4 -14,7 -2,2 Z" fill="url(#goldGradL)" stroke="#7A611F" stroke-width="1"/>
        <path d="M0,0 C4,-8 18,-10 22,-2 C24,4 14,7 2,2 Z" fill="url(#goldGradL)" stroke="#7A611F" stroke-width="1"/>
        <circle cx="0" cy="0" r="4.5" fill="url(#goldGradL)" stroke="#7A611F" stroke-width="1"/>
        <path d="M-3,4 L-8,16 L-3,14 Z M3,4 L8,16 L3,14 Z" fill="url(#goldGradL)" stroke="#7A611F" stroke-width=".8"/>
      </g>
    </svg>`;

  // New Year's, right corner — one firework burst, built from curved,
  // drooping "willow" trails (each a quadratic curve, not a straight
  // ray) plus scattered gold spark dots, so it reads like the real
  // thing rather than a starburst icon. Randomized per render for
  // variety; called from cornerArtFor, not a static template.
  function buildFireworkBurst(cx, cy, scale, palette) {
    const n = 16 + Math.floor(Math.random() * 6);
    // Trails droop downward with "gravity", which can push the lowest
    // bursts' tips into the footer-text safe zone (viewBox y > ~365) --
    // clamp each trail's absolute y so that never happens.
    const maxEy = Math.max(15, 355 - cy);
    let trails = '';
    let cores = '';
    let sparks = '';
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2 + (Math.random() * 0.3 - 0.15);
      const len = (34 + Math.random() * 26) * scale;
      const droop = (8 + Math.random() * 14) * scale;
      const ex = Math.cos(angle) * len;
      const ey = Math.min(Math.sin(angle) * len + droop, maxEy);
      const mx = ex * 0.55;
      const my = ey * 0.5;
      const color = palette[i % palette.length];
      // Two-layer stroke -- a wider, softer glow underneath a narrower,
      // near-white-hot core -- reads as far more vivid/lit-up than a
      // single flat stroke.
      const wGlow = (2.6 + Math.random() * 1.6).toFixed(1);
      const wCore = (1 + Math.random() * 0.7).toFixed(1);
      const op = (0.85 + Math.random() * 0.15).toFixed(2);
      const d = `M0,0 Q${mx.toFixed(1)},${my.toFixed(1)} ${ex.toFixed(1)},${ey.toFixed(1)}`;
      trails += `<path d="${d}" stroke="${color}" stroke-width="${wGlow}" fill="none" stroke-linecap="round" opacity="${(op * 0.55).toFixed(2)}"/>`;
      cores += `<path d="${d}" stroke="${color}" stroke-width="${wCore}" fill="none" stroke-linecap="round" opacity="${op}"/>`;
      if (Math.random() > 0.25) {
        sparks += `<circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="${(1.1 + Math.random() * 1.1).toFixed(1)}" fill="#FFF7DE" opacity="${(0.7 + Math.random() * 0.3).toFixed(2)}"/>`;
      }
    }
    return `<g transform="translate(${cx},${cy})">
      ${trails}${cores}${sparks}
    </g>`;
  }

  function buildFireworksSVG() {
    // Saturated, varied palettes (each burst two-tone, with a bright
    // white-gold core) for a punchier, more colorful show than a single
    // muted gold/lavender pairing.
    const red = ['#E63946', '#FFFFFF', '#F5E28A'];
    const teal = ['#2EC4B6', '#FFFFFF', '#F5E28A'];
    const gold = ['#F5C542', '#FFFFFF', '#E63946'];
    const violet = ['#9D6FD9', '#FFFFFF', '#F5E28A'];
    const green = ['#4CAF6D', '#FFFFFF', '#F5E28A'];
    const pink = ['#F45FA0', '#FFFFFF', '#F5E28A'];
    // Spread across most of the corner's height, kept toward the low-x
    // (visible/outer) side of the box, with the two biggest, most
    // colorful bursts low down so the fireworks read with real punch in
    // the lower corner rather than being confined to a small patch up top.
    const bursts = [
      buildFireworkBurst(30, 65, 1.05, gold),
      buildFireworkBurst(68, 40, 0.7, pink),
      buildFireworkBurst(14, 150, 0.85, teal),
      buildFireworkBurst(78, 130, 0.6, violet),
      buildFireworkBurst(28, 295, 1.8, red),
      buildFireworkBurst(75, 335, 1.15, green),
    ].join('');
    return `
      <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="nyGlowR" cx="40%" cy="55%" r="60%">
            <stop offset="0%" stop-color="#E8D48A" stop-opacity="0.28"/>
            <stop offset="55%" stop-color="#8A7FA8" stop-opacity="0.15"/>
            <stop offset="100%" stop-color="#8A7FA8" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <ellipse cx="45" cy="230" rx="110" ry="220" fill="url(#nyGlowR)"/>
        ${bursts}
      </svg>`;
  }

  // A string of lights swagged across the top of the page, behind the
  // header — Christmas only, and separate from the corner art. Full width
  // via a non-uniform viewBox (preserveAspectRatio="none"), so it stretches
  // to fit whatever the window width is rather than tiling or clipping.
  // Only 3 relaxed sags (more reads as excessive scalloping on a narrow
  // kiosk window), with bulbs spaced evenly along the actual wire curve —
  // one every ~12" like a real strand — rather than only at each sag's
  // low point. Uses the fact that a quadratic Bezier whose control point's
  // x sits at the exact midpoint of its endpoints' x makes x(t) linear in
  // t, so a bulb's y at any x can be computed directly.
  function buildLightStringSVG() {
    const hangs = [{ x: 0, y: 10 }, { x: 333, y: 10 }, { x: 666, y: 10 }, { x: 1000, y: 10 }];
    const dipY = 84;
    let wire = `M${hangs[0].x},${hangs[0].y}`;
    for (let i = 0; i < hangs.length - 1; i++) {
      const a = hangs[i], b = hangs[i + 1];
      wire += ` Q${(a.x + b.x) / 2},${dipY} ${b.x},${b.y}`;
    }
    function yAt(x) {
      for (let i = 0; i < hangs.length - 1; i++) {
        const a = hangs[i], b = hangs[i + 1];
        if (x >= a.x && x <= b.x) {
          const t = (x - a.x) / (b.x - a.x);
          return (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * dipY + t * t * b.y;
        }
      }
      return hangs[hangs.length - 1].y;
    }
    const colors = ['#C1272D', '#E8C34A', '#3E8158', '#4C9BD9'];
    const glowColors = ['#E8878C', '#F5D889', '#7FBF95', '#9CCBEF'];
    const spacing = 46; // ~one bulb every 12" on a real strand
    let glow = '', bulbs = '', i = 0;
    for (let x = 16; x <= 984; x += spacing, i++) {
      const y = yAt(x).toFixed(1);
      const delay = (i * 0.41 % 2.6).toFixed(2);
      glow += `<circle cx="${x}" cy="${y}" r="5.2" fill="${colors[i % colors.length]}"/>`;
      bulbs += `<circle class="bulb" cx="${x}" cy="${y}" r="2.7" fill="${glowColors[i % glowColors.length]}" style="animation-delay:-${delay}s"/>`;
    }
    return `
      <svg class="light-string" viewBox="0 0 1000 110" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="stringBulbGlow" x="-150%" y="-150%" width="400%" height="400%">
            <feGaussianBlur stdDeviation="2.6"/>
          </filter>
        </defs>
        <path d="${wire}" stroke="#8A7A5C" stroke-width="1.6" fill="none" opacity=".55"/>
        <g filter="url(#stringBulbGlow)" opacity=".85">${glow}</g>
        ${bulbs}
      </svg>`;
  }

  // Summer, left corner — green trees and grass with a couple of birds
  // overhead. Replaces the picnic-item draft (watermelon/lemonade/blanket)
  // with a simpler, more universal "summer day" scene per John's redirect.
  function buildBird(cx, cy, scale, rot, color) {
    return `<path d="M-9,2 C-6,-6 -3,-6 0,0 C3,-6 6,-6 9,2" stroke="${color}" stroke-width="${(1.6 * scale).toFixed(1)}" fill="none" stroke-linecap="round" transform="translate(${cx},${cy}) rotate(${rot}) scale(${scale})"/>`;
  }

  function buildTree(cx, cy, scale, trunkGrad, canopyFill, canopyShade) {
    return `<g transform="translate(${cx},${cy}) scale(${scale})">
      <path d="M-5,0 L-3,-58 L3,-58 L5,0 Z" fill="url(#${trunkGrad})"/>
      <g fill="${canopyFill}">
        <circle cx="-20" cy="-70" r="22"/>
        <circle cx="20" cy="-70" r="22"/>
        <circle cx="0" cy="-90" r="26"/>
        <circle cx="0" cy="-62" r="27"/>
      </g>
      <g fill="${canopyShade}" opacity=".35">
        <circle cx="14" cy="-58" r="18"/>
        <circle cx="0" cy="-50" r="16"/>
      </g>
    </g>`;
  }

  const summerTreesSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="summerGlowL" cx="45%" cy="55%" r="55%">
          <stop offset="0%" stop-color="#FBE07A" stop-opacity="0.3"/>
          <stop offset="55%" stop-color="#1E8A96" stop-opacity="0.1"/>
          <stop offset="100%" stop-color="#1E8A96" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="groundGradL" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#8FBE5C"/>
          <stop offset="100%" stop-color="#5FA23C"/>
        </linearGradient>
        <linearGradient id="trunkGradL" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#8A6A46"/>
          <stop offset="100%" stop-color="#6B4F32"/>
        </linearGradient>
        <linearGradient id="trunkGradL2" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#7C5D3C"/>
          <stop offset="100%" stop-color="#5C4228"/>
        </linearGradient>
      </defs>

      <ellipse cx="45" cy="260" rx="100" ry="170" fill="url(#summerGlowL)"/>

      <!-- grassy mound at the base -->
      <path d="M-10,400 C10,380 40,374 65,382 C90,390 112,380 140,394 L140,400 Z" fill="url(#groundGradL)"/>
      <path d="M-10,398 C15,384 45,380 70,388 C95,394 115,386 140,396" stroke="#3E7A34" stroke-width="2" fill="none" opacity=".45"/>

      <!-- two trees, staggered for depth -->
      ${buildTree(30, 400, 0.85, 'trunkGradL2', '#5C9C46', '#3E7A34')}
      ${buildTree(80, 400, 1.15, 'trunkGradL', '#6FAE4A', '#4C8C3C')}

      <!-- birds, flying free in the open sky above the trees -->
      ${buildBird(30, 90, 1.1, -8, '#4A6B5C')}
      ${buildBird(58, 130, 0.85, 10, '#3E7A34')}
      ${buildBird(20, 160, 0.7, -14, '#4A6B5C')}

      <!-- a few grass tufts -->
      <g stroke="#3E7A34" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6">
        <path d="M8,398 C8,388 4,382 2,376"/>
        <path d="M16,398 C17,386 20,380 22,372"/>
        <path d="M110,398 C110,388 114,382 116,374"/>
        <path d="M120,398 C119,388 123,382 126,376"/>
      </g>
    </svg>`;

  // Summer, right corner — a bright sun with radiating rays as the
  // scene's hero, grounded by one more tree and grass, with birds
  // crossing near it.
  function buildSunburst(cx, cy, scale, rayId, n) {
    let rays = '';
    for (let i = 0; i < n; i++) {
      const angle = (360 / n) * i;
      rays += `<use href="#${rayId}" transform="rotate(${angle.toFixed(1)})"/>`;
    }
    return `<g transform="translate(${cx},${cy}) scale(${scale})">
      <g fill="#F7D24A">${rays}</g>
      <circle r="30" fill="url(#sunFaceGradR)" stroke="#E8A93A" stroke-width="2"/>
    </g>`;
  }

  const summerSunSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="summerGlowR" cx="45%" cy="40%" r="60%">
          <stop offset="0%" stop-color="#FBE07A" stop-opacity="0.36"/>
          <stop offset="55%" stop-color="#1E8A96" stop-opacity="0.1"/>
          <stop offset="100%" stop-color="#1E8A96" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="sunFaceGradR" cx="38%" cy="32%" r="70%">
          <stop offset="0%" stop-color="#FFF3B0"/>
          <stop offset="100%" stop-color="#F7C233"/>
        </radialGradient>
        <linearGradient id="groundGradR" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#8FBE5C"/>
          <stop offset="100%" stop-color="#5FA23C"/>
        </linearGradient>
        <linearGradient id="trunkGradR" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#8A6A46"/>
          <stop offset="100%" stop-color="#6B4F32"/>
        </linearGradient>
        <path id="sunRayR" d="M-3.5,-32 L3.5,-32 L0,-46 Z"/>
      </defs>

      <ellipse cx="50" cy="170" rx="100" ry="150" fill="url(#summerGlowR)"/>

      <!-- the sun, high and prominent -->
      ${buildSunburst(45, 90, 1, 'sunRayR', 12)}

      <!-- grounding tree + grass -->
      <path d="M-10,400 C10,380 40,374 65,382 C90,390 112,380 140,394 L140,400 Z" fill="url(#groundGradR)"/>
      <path d="M-10,398 C15,384 45,380 70,388 C95,394 115,386 140,396" stroke="#3E7A34" stroke-width="2" fill="none" opacity=".45"/>
      <g transform="translate(75,400) scale(1.05)">
        <path d="M-5,0 L-3,-58 L3,-58 L5,0 Z" fill="url(#trunkGradR)"/>
        <g fill="#6FAE4A">
          <circle cx="-20" cy="-70" r="22"/>
          <circle cx="20" cy="-70" r="22"/>
          <circle cx="0" cy="-90" r="26"/>
          <circle cx="0" cy="-62" r="27"/>
        </g>
        <g fill="#4C8C3C" opacity=".35">
          <circle cx="14" cy="-58" r="18"/>
          <circle cx="0" cy="-50" r="16"/>
        </g>
      </g>

      <!-- birds crossing near the sun -->
      ${buildBird(20, 130, 0.9, 6, '#4A6B5C')}
      ${buildBird(40, 170, 0.7, -10, '#3E7A34')}

      <!-- grass tufts -->
      <g stroke="#3E7A34" stroke-width="2" fill="none" stroke-linecap="round" opacity=".6">
        <path d="M10,398 C10,388 6,382 4,376"/>
        <path d="M18,398 C19,386 22,380 24,372"/>
      </g>
    </svg>`;

  // Memorial Day, left corner — a full flag, waving out from the pole at
  // real landscape proportions (not the narrow, mostly-hidden sliver from
  // the previous draft) plus a small row of tombstones. The laurel-branch
  // "wreath" from the previous draft read as a sapling next to the flag,
  // so it's gone — just the flag and the grave markers now.
  const memorialFlagSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="memGlowL" cx="45%" cy="35%" r="55%">
          <stop offset="0%" stop-color="#2E3F6E" stop-opacity="0.22"/>
          <stop offset="60%" stop-color="#2E3F6E" stop-opacity="0.08"/>
          <stop offset="100%" stop-color="#2E3F6E" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="memPoleGradL" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#EDF0F5"/>
          <stop offset="50%" stop-color="#4A5568"/>
          <stop offset="100%" stop-color="#EDF0F5"/>
        </linearGradient>
        <linearGradient id="memNavyGradL" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#3B4E80"/>
          <stop offset="100%" stop-color="#242F52"/>
        </linearGradient>
        <linearGradient id="stoneGradMemL" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#C7CCD6"/>
          <stop offset="100%" stop-color="#9AA1AF"/>
        </linearGradient>
        <path id="memStarL" d="M0,-4.4 L1.1,-1.5 L4.2,-1.4 L1.7,0.6 L2.6,3.6 L0,1.8 L-2.6,3.6 L-1.7,0.6 L-4.2,-1.4 L-1.1,-1.5 Z"/>
      </defs>

      <ellipse cx="45" cy="200" rx="95" ry="170" fill="url(#memGlowL)"/>

      <!-- tombstones at the base -->
      <g>
        <path d="M2,398 L2,362 C2,352 18,352 18,362 L18,398 Z" fill="url(#stoneGradMemL)" stroke="#7E8494" stroke-width="1.5"/>
        <path d="M28,398 L28,346 C28,334 48,334 48,346 L48,398 Z" fill="url(#stoneGradMemL)" stroke="#7E8494" stroke-width="1.5"/>
        <path d="M56,398 L56,364 C56,354 70,354 70,364 L70,398 Z" fill="url(#stoneGradMemL)" stroke="#7E8494" stroke-width="1.5"/>
        <path d="M34,346 L42,346 M38,340 L38,352" stroke="#7E8494" stroke-width="1.5" opacity=".6"/>
      </g>

      <!-- flagpole, kept toward the outer edge of the corner so the flag
           extends out across the visible margin rather than into the
           grid -->
      <path d="M22,400 L22,95" stroke="#2A2F3D" stroke-width="9" stroke-linecap="round" opacity=".18"/>
      <path d="M22,400 L22,95" stroke="url(#memPoleGradL)" stroke-width="5" stroke-linecap="round"/>
      <circle cx="22" cy="88" r="7" fill="#E8C876" stroke="#A8842E" stroke-width="1.5"/>

      <!-- the flag itself, drawn at real landscape proportions (wider than
           tall) and waving fully out from the pole -->
      <g transform="translate(22,108)">
        <path d="M0,0 C33.3,-7 61.8,7 95,0 L95,11 C61.8,18 33.3,4 0,11 Z" fill="#B23A48"/>
        <path d="M0,11 C33.3,4 61.8,18 95,11 L95,22 C61.8,29 33.3,15 0,22 Z" fill="#EDE7D8"/>
        <path d="M0,22 C33.3,15 61.8,29 95,22 L95,34 C61.8,41 33.3,27 0,34 Z" fill="#B23A48"/>
        <path d="M0,34 C33.3,27 61.8,41 95,34 L95,45 C61.8,52 33.3,38 0,45 Z" fill="#EDE7D8"/>
        <path d="M0,45 C33.3,38 61.8,52 95,45 L95,56 C61.8,63 33.3,49 0,56 Z" fill="#B23A48"/>
        <rect x="0" y="0" width="38" height="34" fill="url(#memNavyGradL)" stroke="#1B2033" stroke-width="1"/>
        <g fill="#F4F1E8">
          <use href="#memStarL" transform="translate(7,7) scale(0.55)"/>
          <use href="#memStarL" transform="translate(19,7) scale(0.55)"/>
          <use href="#memStarL" transform="translate(31,7) scale(0.55)"/>
          <use href="#memStarL" transform="translate(13,17) scale(0.55)"/>
          <use href="#memStarL" transform="translate(25,17) scale(0.55)"/>
          <use href="#memStarL" transform="translate(7,27) scale(0.55)"/>
          <use href="#memStarL" transform="translate(19,27) scale(0.55)"/>
          <use href="#memStarL" transform="translate(31,27) scale(0.55)"/>
        </g>
      </g>
    </svg>`;

  // Fourth of July, left corner — a full American flag, big and waving,
  // as the theme's own hero (not a small accent) since John's redirect
  // was specifically "America's birthday, celebrated with fireworks and
  // the American flag." Grounded with grass and a taller pole than
  // Memorial Day's, since this flag is the main event rather than one
  // element in a bigger scene.
  const julyFlagSVG = `
    <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="julyGlowL" cx="45%" cy="35%" r="55%">
          <stop offset="0%" stop-color="#B0293C" stop-opacity="0.22"/>
          <stop offset="55%" stop-color="#2E3F6E" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#2E3F6E" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="julyPoleGradL" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#EDF0F5"/>
          <stop offset="50%" stop-color="#4A5568"/>
          <stop offset="100%" stop-color="#EDF0F5"/>
        </linearGradient>
        <linearGradient id="julyNavyGradL" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#3B4E80"/>
          <stop offset="100%" stop-color="#242F52"/>
        </linearGradient>
        <linearGradient id="groundGradJulyL" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#8FBE5C"/>
          <stop offset="100%" stop-color="#5FA23C"/>
        </linearGradient>
        <path id="julyStarL" d="M0,-4.4 L1.1,-1.5 L4.2,-1.4 L1.7,0.6 L2.6,3.6 L0,1.8 L-2.6,3.6 L-1.7,0.6 L-4.2,-1.4 L-1.1,-1.5 Z"/>
      </defs>

      <ellipse cx="55" cy="180" rx="105" ry="180" fill="url(#julyGlowL)"/>

      <!-- grassy mound at the base -->
      <path d="M-10,400 C10,380 40,374 65,382 C90,390 112,380 140,394 L140,400 Z" fill="url(#groundGradJulyL)"/>
      <path d="M-10,398 C15,384 45,380 70,388 C95,394 115,386 140,396" stroke="#3E7A34" stroke-width="2" fill="none" opacity=".45"/>

      <!-- flagpole -->
      <path d="M20,398 L20,78" stroke="#2A2F3D" stroke-width="9" stroke-linecap="round" opacity=".18"/>
      <path d="M20,398 L20,78" stroke="url(#julyPoleGradL)" stroke-width="5" stroke-linecap="round"/>
      <circle cx="20" cy="70" r="7" fill="#E8C876" stroke="#A8842E" stroke-width="1.5"/>

      <!-- the flag itself -- big, full landscape proportions, waving out
           from the pole across most of the corner's width -->
      <g transform="translate(20,90)">
        <path d="M0,0 C38.5,-9 71.5,9 110,0 L110,13 C71.5,22 38.5,4 0,13 Z" fill="#B0293C"/>
        <path d="M0,13 C38.5,4 71.5,22 110,13 L110,26 C71.5,35 38.5,17 0,26 Z" fill="#F5F4F0"/>
        <path d="M0,26 C38.5,17 71.5,35 110,26 L110,38 C71.5,47 38.5,29 0,38 Z" fill="#B0293C"/>
        <path d="M0,38 C38.5,29 71.5,47 110,38 L110,51 C71.5,60 38.5,42 0,51 Z" fill="#F5F4F0"/>
        <path d="M0,51 C38.5,42 71.5,60 110,51 L110,64 C71.5,73 38.5,55 0,64 Z" fill="#B0293C"/>
        <rect x="0" y="0" width="44" height="38" fill="url(#julyNavyGradL)" stroke="#1B2033" stroke-width="1"/>
        <g fill="#F4F1E8">
          <use href="#julyStarL" transform="translate(8,8) scale(0.6)"/>
          <use href="#julyStarL" transform="translate(22,8) scale(0.6)"/>
          <use href="#julyStarL" transform="translate(36,8) scale(0.6)"/>
          <use href="#julyStarL" transform="translate(15,17) scale(0.6)"/>
          <use href="#julyStarL" transform="translate(29,17) scale(0.6)"/>
          <use href="#julyStarL" transform="translate(8,26) scale(0.6)"/>
          <use href="#julyStarL" transform="translate(22,26) scale(0.6)"/>
          <use href="#julyStarL" transform="translate(36,26) scale(0.6)"/>
          <use href="#julyStarL" transform="translate(15,33) scale(0.6)"/>
          <use href="#julyStarL" transform="translate(29,33) scale(0.6)"/>
        </g>
      </g>
    </svg>`;

  function buildFireworksPatrioticSVG() {
    // Same buildFireworkBurst machinery as New Year's, just red/white/blue
    // palettes instead of the varied party-colors set.
    const red = ['#B0293C', '#FFFFFF', '#F5C542'];
    const blue = ['#2E3F6E', '#FFFFFF', '#F5C542'];
    const silver = ['#C7CCD6', '#FFFFFF', '#B0293C'];
    const bursts = [
      buildFireworkBurst(30, 65, 1.05, blue),
      buildFireworkBurst(68, 40, 0.7, red),
      buildFireworkBurst(14, 150, 0.85, silver),
      buildFireworkBurst(78, 130, 0.6, blue),
      buildFireworkBurst(28, 295, 1.8, red),
      buildFireworkBurst(75, 335, 1.15, silver),
    ].join('');
    return `
      <svg class="corner-art" viewBox="0 0 130 400" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <radialGradient id="julyGlowR" cx="40%" cy="55%" r="60%">
            <stop offset="0%" stop-color="#B0293C" stop-opacity="0.22"/>
            <stop offset="55%" stop-color="#2E3F6E" stop-opacity="0.12"/>
            <stop offset="100%" stop-color="#2E3F6E" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <ellipse cx="45" cy="230" rx="110" ry="220" fill="url(#julyGlowR)"/>
        ${bursts}
      </svg>`;
  }

  // Halloween uses two different scenes (scarecrow / cat + pumpkins) rather
  // than the same mirrored art on both sides; every other decorated theme
  // mirrors one piece of art across both corners.
  function cornerArtFor(themeId, side) {
    if (themeId === 'fall') return cornSVG;
    if (themeId === 'winter') return snowmanSVG;
    if (themeId === 'halloween') return side === 'left' ? scarecrowSVG : catPumpkinsSVG;
    if (themeId === 'thanksgiving') return turkeySVG;
    if (themeId === 'christmas') return side === 'left' ? christmasTreeSVG : nativitySVG;
    if (themeId === 'spring') return side === 'left' ? forsythiaSVG : redbudSVG;
    if (themeId === 'st-patricks-day') return side === 'left' ? leprechaunSVG : rainbowPotSVG;
    if (themeId === 'easter') return side === 'left' ? easterCrossSVG : easterTombSVG;
    if (themeId === 'new-year') return side === 'left' ? champagneToastSVG : buildFireworksSVG();
    if (themeId === 'summer') return side === 'left' ? summerTreesSVG : summerSunSVG;
    if (themeId === 'memorial-day') return side === 'left' ? memorialFlagSVG : '';
    if (themeId === 'fourth-of-july') return side === 'left' ? julyFlagSVG : buildFireworksPatrioticSVG();
    return '';
  }

  // Themes whose corner art is a real SVG file under public/themes/<id>/
  // (left.svg / right.svg) instead of markup written into this file. This
  // is the pipeline for every theme going forward: an artist (or generated
  // art) delivers a vector file, it's dropped in the theme's folder, and
  // its id is added here — no other code changes needed. SVG specifically
  // (not PNG/raster) because Homeport runs on whatever display someone
  // plugs it into, so the art has to stay crisp at any resolution rather
  // than being baked for one screen size.
  //
  // The 12 themes handled by cornerArtFor above stay on inline SVG — they
  // were already built and approved before this pipeline existed, and
  // migrating already-shipped art would only add regression risk for no
  // visible benefit. New themes are added here, not there.
  const FILE_ART_THEMES = [];

  function cornerArtPathFor(themeId, side) {
    if (!FILE_ART_THEMES.includes(themeId)) return null;
    return `themes/${themeId}/${side}.svg`;
  }

  const DECORATED_THEMES = ['fall', 'halloween', 'thanksgiving', 'winter', 'christmas', 'spring', 'st-patricks-day', 'easter', 'new-year', 'summer', 'memorial-day', 'fourth-of-july', ...FILE_ART_THEMES];

  // Settings/calendar refreshes re-call render() every few minutes with the
  // same theme id (see app.js's refreshThemeAndDisplaySettings). Skip the
  // rebuild in that case so the falling particles and twinkling lights
  // don't visibly restart mid-animation on every routine refresh.
  let lastThemeId;

  // Bumped on every render() call and captured by each file-based corner-art
  // fetch below, so a stale response is discarded even if someone switches
  // away from and then back to the same theme while the first request is
  // still in flight -- comparing themeId alone would miss that case, since
  // the id would match again by the time the old fetch resolves.
  let renderGeneration = 0;

  function render(themeId) {
    const layer = document.getElementById('decoration');
    if (!layer) return;
    if (themeId === lastThemeId) return;
    lastThemeId = themeId;
    renderGeneration += 1;
    const myGeneration = renderGeneration;
    layer.innerHTML = '';

    if (!DECORATED_THEMES.includes(themeId)) return;

    // Thanksgiving, St. Patrick's Day, Easter, and Memorial Day have no
    // falling particles — just the corner scenes (falling shamrocks/coins,
    // petals over the tomb scene, or confetti-like bits over a solemn
    // memorial scene would all read as gimmicky). File-art themes default
    // to none too, rather than silently guessing "snowflake" for whatever
    // theme gets added next -- a particle style is opt-in, added here by
    // name once someone actually wants one for that theme.
    const count = (themeId === 'thanksgiving' || themeId === 'st-patricks-day' || themeId === 'easter' || themeId === 'memorial-day' || FILE_ART_THEMES.includes(themeId)) ? 0 : PARTICLE_COUNT;

    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      const left = Math.random() * 100;
      const dur = 14 + Math.random() * 12;
      const delay = -(Math.random() * dur);
      const drift = (Math.random() * 140 - 70).toFixed(0) + 'px';
      const spin = (Math.random() * 360 - 180).toFixed(0) + 'deg';
      p.className = 'particle ' + (
        themeId === 'fall' ? ('leaf l' + (1 + (i % 4))) :
        themeId === 'halloween' ? 'bat' :
        themeId === 'spring' ? ('petal p' + (1 + (i % 3))) :
        themeId === 'new-year' ? ('confetti c' + (1 + (i % 3))) :
        themeId === 'summer' ? ('sunspeck s' + (1 + (i % 3))) :
        themeId === 'fourth-of-july' ? ('julyspark j' + (1 + (i % 3))) :
        'snowflake'
      );
      p.style.left = left + 'vw';
      p.style.setProperty('--pmax', PARTICLE_MAX_OPACITY);
      p.style.setProperty('--drift', drift);
      p.style.setProperty('--spin', spin);
      p.style.animationDuration = dur + 's';
      p.style.animationDelay = delay + 's';
      if (themeId === 'fall') {
        const sz = 12 + Math.random() * 10;
        p.style.width = sz + 'px'; p.style.height = sz + 'px';
      } else if (themeId === 'halloween') {
        const sz = 20 + Math.random() * 10;
        p.style.width = sz + 'px'; p.style.height = (sz * 0.55) + 'px';
        p.innerHTML = batParticleSVG;
      } else if (themeId === 'spring') {
        const sz = 8 + Math.random() * 6;
        p.style.width = sz + 'px'; p.style.height = sz + 'px';
      } else if (themeId === 'new-year') {
        const sz = 6 + Math.random() * 4;
        p.style.width = sz + 'px'; p.style.height = (sz * 1.6) + 'px';
      } else if (themeId === 'summer') {
        const sz = 6 + Math.random() * 3;
        p.style.width = sz + 'px'; p.style.height = sz + 'px';
      } else if (themeId === 'fourth-of-july') {
        const sz = 6 + Math.random() * 3;
        p.style.width = sz + 'px'; p.style.height = sz + 'px';
      }
      layer.appendChild(p);
    }

    function attachCornerArt(rawHtml, side, autoFit) {
      const wrap = document.createElement('div');
      wrap.innerHTML = rawHtml.trim();
      const svg = wrap.firstElementChild;
      if (!svg) return;
      svg.classList.add('corner-art', side);

      if (autoFit) {
        // File-based art (see FILE_ART_THEMES) may come from a tool that
        // exported a much bigger canvas than the actual drawing -- pad
        // around the artist's artboard, extra breathing room, whatever.
        // Rather than requiring every file to be hand-measured and
        // hand-fitted to this app's viewBox/safe-zone convention before it
        // can be dropped in, measure what's actually drawn and fit that.
        svg.style.opacity = '0';
        layer.appendChild(svg);
        try {
          const bbox = svg.getBBox();
          if (bbox.width > 0 && bbox.height > 0) {
            // Widen the viewBox (without touching its height) so the real
            // artwork only ever fills SAFE_ZONE_FRACTION of the box's
            // width, with xMinYMax alignment pinning it to the outer edge
            // and the ground -- the same corner these apps' hand-drawn
            // pieces sit in, just computed instead of eyeballed.
            const paddedWidth = bbox.width / SAFE_ZONE_FRACTION;
            svg.setAttribute('viewBox', `${bbox.x} ${bbox.y} ${paddedWidth} ${bbox.height}`);
            svg.setAttribute('preserveAspectRatio', 'xMinYMax meet');
          }
        } catch (e) {
          // getBBox can throw on a detached or not-yet-laid-out element in
          // some browsers -- fall back to the file's own viewBox as
          // authored rather than leaving nothing on screen.
        }
        svg.style.opacity = CORNER_OPACITY;
        return;
      }

      svg.style.opacity = CORNER_OPACITY;
      layer.appendChild(svg);
    }

    ['left', 'right'].forEach((side) => {
      const filePath = cornerArtPathFor(themeId, side);
      if (filePath) {
        const fallbackToLegacy = () => {
          // The active theme may have changed again while this request was
          // in flight (rapid clicking through the settings preview, say) --
          // discard a stale response rather than dropping art for a theme
          // that isn't showing anymore into the live layer.
          if (myGeneration !== renderGeneration) return;
          // No file-based art for this side yet (a theme can have file art
          // on one corner and still be using the legacy hand-coded piece on
          // the other) -- fall back rather than leaving the corner empty.
          const fallbackHtml = cornerArtFor(themeId, side);
          if (fallbackHtml) attachCornerArt(fallbackHtml, side);
        };
        fetch(filePath)
          .then((r) => (r.ok ? r.text() : ''))
          .then((svgText) => {
            if (myGeneration !== renderGeneration) return;
            if (!svgText) return fallbackToLegacy();
            attachCornerArt(svgText, side, true);
          })
          .catch(fallbackToLegacy);
        return;
      }
      const html = cornerArtFor(themeId, side);
      if (!html) return;
      attachCornerArt(html, side);
    });

    if (themeId === 'christmas') {
      const wrap = document.createElement('div');
      wrap.innerHTML = buildLightStringSVG().trim();
      const svg = wrap.firstElementChild;
      svg.style.opacity = CORNER_OPACITY;
      layer.appendChild(svg);
    }
  }

  window.HomeportDecorations = { render };
})();
