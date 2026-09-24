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
  // day, in the kitchen: fewer/fainter particles and lower corner-art
  // opacity than the "bolder" option explored in the mockup.
  const PARTICLE_COUNT = 11;
  const PARTICLE_MAX_OPACITY = 0.42;
  const CORNER_OPACITY = 0.62;

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
        <!-- one straw spike, reused via <use> at different rotations to
             build every straw burst (hair, hands, ankles) -->
        <path id="strawSpike" d="M0,0 C-3,-8 -2,-16 0,-24 C2,-16 3,-8 0,0 Z"/>
      </defs>

      <ellipse cx="52" cy="300" rx="100" ry="150" fill="url(#scarecrowGlow)"/>

      <!-- legs (jeans), standing slightly apart, with a patch -->
      <path d="M26,256 C22,292 18,332 24,378 C30,384 38,384 42,378 C42,332 44,292 44,256 Z" fill="url(#jeansGrad)" stroke="#233245" stroke-width="2"/>
      <path d="M50,256 C50,292 50,332 50,378 C54,384 62,384 68,378 C74,332 70,292 70,256 Z" fill="url(#jeansGrad)" stroke="#233245" stroke-width="2"/>
      <rect x="52" y="330" width="14" height="16" rx="2" fill="#7A2E20" opacity=".85" transform="rotate(-6 59 338)"/>
      <!-- ankle straw bursts -->
      <g fill="#E3B54F">
        <g transform="translate(32,378)">
          <use href="#strawSpike" transform="rotate(150)"/><use href="#strawSpike" transform="rotate(165)"/>
          <use href="#strawSpike" transform="rotate(180)"/><use href="#strawSpike" transform="rotate(195)"/>
          <use href="#strawSpike" transform="rotate(210)"/>
        </g>
        <g transform="translate(62,378)">
          <use href="#strawSpike" transform="rotate(-30)"/><use href="#strawSpike" transform="rotate(-15)"/>
          <use href="#strawSpike" transform="rotate(0)"/><use href="#strawSpike" transform="rotate(15)"/>
          <use href="#strawSpike" transform="rotate(30)"/>
        </g>
      </g>

      <!-- arms, reaching out and slightly up, ending in straw-burst hands -->
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

      <!-- plaid shirt sleeves peeking above the vest at the shoulders -->
      <path d="M22,178 C14,180 8,186 8,194 L30,198 L34,180 Z" fill="#A6453A" stroke="#6B2E20" stroke-width="1.5"/>
      <path d="M68,178 C76,180 82,186 82,194 L60,198 L56,180 Z" fill="#A6453A" stroke="#6B2E20" stroke-width="1.5"/>

      <!-- vest with buttons and colorful patches, over the torso -->
      <path d="M24,182 C24,168 66,168 66,182 L70,254 C70,266 20,266 20,254 Z" fill="url(#vestGrad)" stroke="#1E2733" stroke-width="2"/>
      <circle cx="45" cy="200" r="2.2" fill="#D9BC7E"/>
      <circle cx="45" cy="216" r="2.2" fill="#D9BC7E"/>
      <circle cx="45" cy="232" r="2.2" fill="#D9BC7E"/>
      <rect x="26" y="192" width="12" height="11" rx="2" fill="#D97B29" transform="rotate(-8 32 197)"/>
      <rect x="54" y="196" width="11" height="11" rx="2" fill="#3E6EA5" transform="rotate(7 59 201)"/>
      <rect x="24" y="228" width="12" height="11" rx="2" fill="#5E8C4B" transform="rotate(6 30 233)"/>
      <rect x="53" y="232" width="12" height="12" rx="2" fill="#B5432F" transform="rotate(-7 59 238)"/>

      <!-- ruffled bandana collar at the neck -->
      <path d="M20,180 C20,172 70,172 70,180 C70,186 64,182 58,186 C52,190 48,184 45,184
               C42,184 38,190 32,186 C26,182 20,186 20,180 Z" fill="#E8A23D" stroke="#B5732A" stroke-width="1.5"/>

      <!-- head -->
      <circle cx="45" cy="142" r="29" fill="url(#faceGrad)" stroke="#C7A263" stroke-width="2"/>
      <circle cx="35" cy="136" r="3" fill="#3A2E1C"/>
      <circle cx="55" cy="136" r="3" fill="#3A2E1C"/>
      <path d="M45,144 L40,154 L50,154 Z" fill="#D9791E"/>
      <ellipse cx="30" cy="152" rx="5" ry="3.2" fill="#EFA3A0" opacity=".65"/>
      <ellipse cx="60" cy="152" rx="5" ry="3.2" fill="#EFA3A0" opacity=".65"/>
      <path d="M31,160 Q45,170 59,160" stroke="#3A2E1C" stroke-width="2.2" fill="none" stroke-linecap="round"/>

      <!-- straw hair, poking out from under the hat -->
      <g fill="#E3B54F">
        <g transform="translate(16,132)">
          <use href="#strawSpike" transform="rotate(-120) scale(1.1)"/><use href="#strawSpike" transform="rotate(-140)"/>
          <use href="#strawSpike" transform="rotate(-160)"/><use href="#strawSpike" transform="rotate(180)"/>
        </g>
        <g transform="translate(74,132)">
          <use href="#strawSpike" transform="rotate(120) scale(1.1)"/><use href="#strawSpike" transform="rotate(140)"/>
          <use href="#strawSpike" transform="rotate(160)"/><use href="#strawSpike" transform="rotate(180)"/>
        </g>
        <g transform="translate(45,108)">
          <use href="#strawSpike" transform="rotate(-15) scale(1.15)"/><use href="#strawSpike" transform="rotate(0) scale(1.2)"/>
          <use href="#strawSpike" transform="rotate(15) scale(1.15)"/>
        </g>
      </g>

      <!-- floppy sun hat -->
      <path d="M2,120 C -6,116 -4,106 6,102 C 20,96 70,96 84,102 C 94,106 96,116 88,120
               C 72,112 18,112 2,120 Z" fill="url(#hatGrad)" stroke="#8A6220" stroke-width="2"/>
      <path d="M14,106 C 10,84 22,66 45,66 C 68,66 80,84 76,106
               C 64,98 26,98 14,106 Z" fill="url(#hatGrad)" stroke="#8A6220" stroke-width="2"/>
      <path d="M18,102 C 32,98 58,98 72,102" stroke="#8B5A2B" stroke-width="4" fill="none" stroke-linecap="round"/>
      <path d="M60,90 C 66,86 74,88 76,94 C 70,94 64,96 60,98 Z" fill="#6F8F52"/>
    </svg>`;

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

      <!-- black cat, sitting beside the pumpkins, tail curled around its paws -->
      <path d="M116,334 C 126,320 123,300 108,291 C 119,297 126,312 121,329 Z" fill="#17151C"/>
      <path d="M96,398 C 84,398 77,382 81,362 C 85,343 100,331 116,331
               C 129,331 131,346 126,357 C 122,350 111,346 103,352
               C 95,358 93,371 97,383 C 100,391 100,396 96,398 Z"
            fill="url(#catGrad)" stroke="#0D0C10" stroke-width="1.5"/>
      <circle cx="90" cy="325" r="19" fill="url(#catGrad)" stroke="#0D0C10" stroke-width="1.5"/>
      <path d="M76,313 L72,296 L87,309 Z" fill="url(#catGrad)" stroke="#0D0C10" stroke-width="1.5"/>
      <path d="M100,311 L109,295 L111,313 Z" fill="url(#catGrad)" stroke="#0D0C10" stroke-width="1.5"/>
      <ellipse cx="84" cy="324" rx="3" ry="4.5" fill="#C8E36B"/>
      <ellipse cx="97" cy="323" rx="3" ry="4.5" fill="#C8E36B"/>
      <path d="M89,330 L93,330 L91,333 Z" fill="#C46B7A"/>
      <g stroke="#5A5765" stroke-width="0.8" opacity=".7">
        <path d="M78,329 L64,326 M78,332 L64,333"/>
        <path d="M102,329 L114,326 M102,331 L114,332"/>
      </g>

      <!-- two jack-o'-lanterns resting at the base, carved and glowing -->
      <g>
        <ellipse cx="62" cy="396" rx="30" ry="22" fill="url(#jackGrad)" stroke="#7C3B0C" stroke-width="2"/>
        <g stroke="#7C3B0C" stroke-width="1.3" fill="none" opacity=".5">
          <path d="M42,378 Q50,396 42,414"/>
          <path d="M52,375 Q58,396 52,417"/>
          <path d="M62,374 Q62,396 62,418"/>
          <path d="M72,375 Q66,396 72,417"/>
          <path d="M82,378 Q74,396 82,414"/>
        </g>
        <rect x="58" y="366" width="7" height="11" rx="2.5" fill="#5B4A1E" transform="rotate(-5 62 371)"/>
        <path d="M63,364 C 68,358 74,358 76,362 C 71,362 67,364 65,368 Z" fill="#4C7A3E"/>
        <g fill="#FFD98A" opacity=".92">
          <path d="M50,388 L56,382 L58,392 Z"/>
          <path d="M74,388 L68,382 L66,392 Z"/>
          <path d="M50,402 L56,398 L60,403 L64,398 L70,402 L64,407 L60,404 L56,407 Z"/>
        </g>

        <ellipse cx="20" cy="404" rx="21" ry="16" fill="url(#jackGrad)" stroke="#7C3B0C" stroke-width="1.8"/>
        <g stroke="#7C3B0C" stroke-width="1.1" fill="none" opacity=".5">
          <path d="M6,390 Q11,404 6,418"/>
          <path d="M13,388 Q17,404 13,420"/>
          <path d="M20,387 Q20,404 20,421"/>
          <path d="M27,388 Q23,404 27,420"/>
          <path d="M34,390 Q29,404 34,418"/>
        </g>
        <rect x="17" y="378" width="5.5" height="9" rx="2" fill="#5B4A1E" transform="rotate(5 20 382)"/>
        <g fill="#FFD98A" opacity=".92">
          <path d="M11,398 L16,393 L17,401 Z"/>
          <path d="M29,398 L24,393 L23,401 Z"/>
          <path d="M12,409 L16,406 L20,410 L24,406 L28,409 L23,413 L20,411 L17,413 Z"/>
        </g>
      </g>
    </svg>`;

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

  // Halloween uses two different scenes (scarecrow / cat + pumpkins) rather
  // than the same mirrored art on both sides; every other decorated theme
  // mirrors one piece of art across both corners.
  function cornerArtFor(themeId, side) {
    if (themeId === 'fall') return cornSVG;
    if (themeId === 'winter') return snowmanSVG;
    if (themeId === 'halloween') return side === 'left' ? scarecrowSVG : catPumpkinsSVG;
    if (themeId === 'thanksgiving') return turkeySVG;
    if (themeId === 'christmas') return side === 'left' ? christmasTreeSVG : nativitySVG;
    return '';
  }

  const DECORATED_THEMES = ['fall', 'halloween', 'thanksgiving', 'winter', 'christmas'];

  // Settings/calendar refreshes re-call render() every few minutes with the
  // same theme id (see app.js's refreshThemeAndDisplaySettings). Skip the
  // rebuild in that case so the falling particles and twinkling lights
  // don't visibly restart mid-animation on every routine refresh.
  let lastThemeId;

  function render(themeId) {
    const layer = document.getElementById('decoration');
    if (!layer) return;
    if (themeId === lastThemeId) return;
    lastThemeId = themeId;
    layer.innerHTML = '';

    if (!DECORATED_THEMES.includes(themeId)) return;

    // Thanksgiving has no falling particles at all — just the turkey scene.
    const count = themeId === 'thanksgiving' ? 0 : PARTICLE_COUNT;

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
      }
      layer.appendChild(p);
    }

    ['left', 'right'].forEach((side) => {
      const html = cornerArtFor(themeId, side);
      if (!html) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = html.trim();
      const svg = wrap.firstElementChild;
      svg.classList.add(side);
      svg.style.opacity = CORNER_OPACITY;
      layer.appendChild(svg);
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
