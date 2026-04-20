window.addEventListener('error', (e) => {
  const d = document.createElement('div');
  d.style.cssText = 'position:fixed;bottom:8px;left:8px;right:8px;background:#a33;color:#fff;padding:8px;font:12px monospace;z-index:99;border-radius:4px;';
  d.textContent = 'JS Error: ' + (e.message || e.error);
  document.body.appendChild(d);
});

(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const goalEl = document.getElementById('goal');
  const stateEl = document.getElementById('state');
  const overlay = document.getElementById('overlay');
  const overTitle = document.getElementById('overTitle');
  const overSub = document.getElementById('overSub');
  const startBtn = document.getElementById('startBtn');

  // ----- Responsive canvas -----
  function fitCanvas() {
    const maxW = Math.min(window.innerWidth - 40, 920);
    const maxH = Math.min(window.innerHeight - 40, 720);
    const aspect = 4 / 3;
    let w = maxW, h = w / aspect;
    if (h > maxH) { h = maxH; w = h * aspect; }
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * devicePixelRatio);
    canvas.height = Math.round(h * devicePixelRatio);
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  window.addEventListener('resize', fitCanvas);
  fitCanvas();

  // ----- Sprite / asset loader (art-upgrade scaffold) -----
  // Drop PNGs with these filenames into /assets and they'll replace the placeholder shapes.
  // Each slot is optional — missing slots fall back to the shape renderer. Until any sprite
  // loads, everything renders exactly as before.
  //
  // Anchors are normalized (0..1) within each sprite, describing where the sprite's
  // logical pivot sits. Body anchor should be its visual center; head anchor should be
  // where it attaches to the body; comb anchor should be the grip point on the handle.
  const SPRITE_SLOTS = {
    // Real honey badger photos from Wikimedia Commons (CC-licensed).
    // Legacy slot names retained so the generated full-body state art can drop
    // into the existing renderer without disturbing the shape fallback.
    body: {
      src: 'assets/badger_sprite_safe.png',
      anchor: { x: 0.5, y: 1.0 },
    },
    head_turning:  { src: 'assets/badger_sprite_turning.png',  anchor: { x: 0.5, y: 1.0 } },
    head_watching: { src: 'assets/badger_sprite_watching.png', anchor: { x: 0.5, y: 1.0 } },
    head_biting:   { src: 'assets/badger_sprite_biting.png',   anchor: { x: 0.5, y: 1.0 } },
    comb:          { src: 'assets/brush_sprite.png',           anchor: { x: 0.5, y: 0.5 } },
    background:    { src: 'assets/background_painted.png',     anchor: { x: 0.5, y: 0.5 } },
  };
  const sprites = {}; // slot -> HTMLImageElement once loaded
  function loadSprites() {
    for (const [slot, def] of Object.entries(SPRITE_SLOTS)) {
      const img = new Image();
      img.onload = () => { sprites[slot] = img; };
      img.onerror = () => { console.warn(`Missing sprite: ${def.src}`); };
      img.src = def.src;
    }
  }
  // Helper for drawing a sprite at (x, y) with optional width/rotation.
  function drawSprite(slot, x, y, width, rotation = 0, flipX = false) {
    const img = sprites[slot];
    if (!img) return false;
    const def = SPRITE_SLOTS[slot];
    const aspect = img.naturalHeight / img.naturalWidth;
    const w = width;
    const h = width * aspect;
    ctx.save();
    ctx.translate(x, y);
    if (rotation) ctx.rotate(rotation);
    if (flipX) ctx.scale(-1, 1);
    // Optional mask — hides rectangular photo backgrounds.
    if (def.clip === 'ellipse') {
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.48, h * 0.42, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, -w * def.anchor.x, -h * def.anchor.y, w, h);
    } else if (def.clip === 'circle') {
      const r = Math.min(w, h) * 0.45;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, -w * def.anchor.x, -h * def.anchor.y, w, h);
    } else if (def.clip === 'soft') {
      // Soft radial fade: draw image, then mask with a radial gradient alpha.
      // Uses an offscreen buffer so the mask doesn't bleed into the main canvas.
      const buf = getSoftBuffer(w, h);
      const bctx = buf.getContext('2d');
      bctx.clearRect(0, 0, buf.width, buf.height);
      bctx.drawImage(img, 0, 0, buf.width, buf.height);
      bctx.globalCompositeOperation = 'destination-in';
      const cx = buf.width * def.anchor.x, cy = buf.height * def.anchor.y;
      const rMax = Math.min(buf.width, buf.height) * 0.5;
      const grad = bctx.createRadialGradient(cx, cy, rMax * 0.4, cx, cy, rMax * 0.98);
      grad.addColorStop(0, 'rgba(0,0,0,1)');
      grad.addColorStop(0.7, 'rgba(0,0,0,1)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      bctx.fillStyle = grad;
      bctx.fillRect(0, 0, buf.width, buf.height);
      bctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(buf, -w * def.anchor.x, -h * def.anchor.y, w, h);
    } else {
      ctx.drawImage(img, -w * def.anchor.x, -h * def.anchor.y, w, h);
    }
    ctx.restore();
    return true;
  }

  // Shared offscreen buffer pool for soft-clip rendering (reuse to avoid GC churn).
  const _softBuffers = [];
  function getSoftBuffer(w, h) {
    const tw = Math.max(64, Math.ceil(w));
    const th = Math.max(64, Math.ceil(h));
    for (const b of _softBuffers) {
      if (b.width === tw && b.height === th && !b._inUse) return b;
    }
    const buf = document.createElement('canvas');
    buf.width = tw; buf.height = th;
    _softBuffers.push(buf);
    return buf;
  }

  // ----- Audio (procedural, no assets) -----
  let audio = null;
  function initAudio() {
    if (audio) return audio;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const actx = new AC();
      const master = actx.createGain();
      master.gain.value = 0.7;
      // Gentle compressor so layered sounds punch without clipping.
      const comp = actx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 6;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.12;
      master.connect(comp).connect(actx.destination);
      audio = { actx, master };
    } catch (e) { audio = null; }
    return audio;
  }

  // ----- Noise buffer pool (reuse to avoid per-call GC) -----
  const noiseCache = new Map();
  function noiseBuffer(actx, seconds) {
    const key = Math.round(seconds * 100);
    let buf = noiseCache.get(key);
    if (buf) return buf;
    const len = Math.floor(actx.sampleRate * seconds);
    buf = actx.createBuffer(1, len, actx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    noiseCache.set(key, buf);
    return buf;
  }

  // Waveshaper curve for soft distortion — used to make snarls nastier.
  function makeDistCurve(amount) {
    const k = amount;
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = (3 + k) * x * 20 * (Math.PI / 180) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  // ===== HISS ===== airy, raspy, breath-modulated — like an agitated animal.
  function playHiss() {
    const a = initAudio();
    if (!a) return;
    const { actx, master } = a;
    const now = actx.currentTime;
    const dur = 0.55;

    // Layer 1: high sibilance (the "sssss" top end)
    const n1 = actx.createBufferSource();
    n1.buffer = noiseBuffer(actx, dur + 0.1);
    const hp = actx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3200;
    const bp1 = actx.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.frequency.setValueAtTime(5200, now);
    bp1.frequency.exponentialRampToValueAtTime(3800, now + dur);
    bp1.Q.value = 2.5;
    const g1 = actx.createGain();
    g1.gain.setValueAtTime(0, now);
    g1.gain.linearRampToValueAtTime(0.42, now + 0.04);
    g1.gain.setValueAtTime(0.42, now + dur * 0.6);
    g1.gain.exponentialRampToValueAtTime(0.001, now + dur);

    // Breath tremolo: mimics lung pulses.
    const tremolo = actx.createOscillator();
    tremolo.type = 'sine';
    tremolo.frequency.value = 8 + Math.random() * 4;
    const tremGain = actx.createGain();
    tremGain.gain.value = 0.25;
    tremolo.connect(tremGain).connect(g1.gain);

    n1.connect(hp).connect(bp1).connect(g1).connect(master);

    // Layer 2: throat body (mid-low rasp)
    const n2 = actx.createBufferSource();
    n2.buffer = noiseBuffer(actx, dur + 0.1);
    const bp2 = actx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 900;
    bp2.Q.value = 4;
    const g2 = actx.createGain();
    g2.gain.setValueAtTime(0, now);
    g2.gain.linearRampToValueAtTime(0.18, now + 0.06);
    g2.gain.exponentialRampToValueAtTime(0.001, now + dur);
    n2.connect(bp2).connect(g2).connect(master);

    // Layer 3: slight voiced rumble under the hiss — irritation, not pure breath.
    const rumble = actx.createOscillator();
    rumble.type = 'sawtooth';
    rumble.frequency.setValueAtTime(110, now);
    rumble.frequency.linearRampToValueAtTime(95, now + dur);
    const rLP = actx.createBiquadFilter();
    rLP.type = 'lowpass';
    rLP.frequency.value = 400;
    const rg = actx.createGain();
    rg.gain.setValueAtTime(0, now);
    rg.gain.linearRampToValueAtTime(0.08, now + 0.1);
    rg.gain.exponentialRampToValueAtTime(0.001, now + dur);
    rumble.connect(rLP).connect(rg).connect(master);

    n1.start(now); n2.start(now); rumble.start(now); tremolo.start(now);
    n1.stop(now + dur); n2.stop(now + dur); rumble.stop(now + dur); tremolo.stop(now + dur);
  }

  // ===== SNARL ===== angry growl: distorted sawtooth + irregular AM + teeth grit.
  function playSnarl() {
    const a = initAudio();
    if (!a) return;
    const { actx, master } = a;
    const now = actx.currentTime;
    const dur = 0.55;

    // Vocal cord sim: two detuned saws for chorus/nastiness.
    const osc1 = actx.createOscillator();
    const osc2 = actx.createOscillator();
    osc1.type = osc2.type = 'sawtooth';
    osc1.frequency.setValueAtTime(78, now);
    osc1.frequency.linearRampToValueAtTime(62, now + dur);
    osc2.frequency.setValueAtTime(83, now);  // slight detune
    osc2.frequency.linearRampToValueAtTime(65, now + dur);

    // Vibrato — irregular for animal feel.
    const vib = actx.createOscillator();
    vib.frequency.value = 16 + Math.random() * 6;
    const vibGain = actx.createGain();
    vibGain.gain.value = 10;
    vib.connect(vibGain);
    vibGain.connect(osc1.frequency);
    vibGain.connect(osc2.frequency);

    // Waveshaper distortion — the "mean" texture.
    const shaper = actx.createWaveShaper();
    shaper.curve = makeDistCurve(50);
    shaper.oversample = '4x';

    // Formant-ish bandpass cluster for throat character.
    const f1 = actx.createBiquadFilter();
    f1.type = 'bandpass'; f1.frequency.value = 320; f1.Q.value = 4;
    const f2 = actx.createBiquadFilter();
    f2.type = 'bandpass'; f2.frequency.value = 1100; f2.Q.value = 3;
    const formantSum = actx.createGain();
    formantSum.gain.value = 1;

    // Amplitude modulation — growl pulse.
    const am = actx.createOscillator();
    am.frequency.value = 28 + Math.random() * 8;
    const amDepth = actx.createGain();
    amDepth.gain.value = 0.4;
    const amOffset = actx.createGain();
    amOffset.gain.value = 0.6;
    am.connect(amDepth);
    // Node signal path summed with offset via a GainNode as modulator target.
    const amTarget = actx.createGain();
    amDepth.connect(amTarget.gain);
    amOffset.connect(amTarget.gain);
    // Constant source for offset
    const constBuf = actx.createBuffer(1, 2, actx.sampleRate);
    constBuf.getChannelData(0).set([1, 1]);
    const constSrc = actx.createBufferSource();
    constSrc.buffer = constBuf; constSrc.loop = true;
    constSrc.connect(amOffset);

    const envG = actx.createGain();
    envG.gain.setValueAtTime(0, now);
    envG.gain.linearRampToValueAtTime(0.35, now + 0.06);
    envG.gain.setValueAtTime(0.35, now + dur * 0.7);
    envG.gain.exponentialRampToValueAtTime(0.001, now + dur);

    // Wiring: oscs -> shaper -> parallel formants -> amTarget -> env -> master
    const merge = actx.createGain();
    merge.gain.value = 0.5;
    osc1.connect(merge);
    osc2.connect(merge);
    merge.connect(shaper);
    shaper.connect(f1); shaper.connect(f2);
    f1.connect(formantSum); f2.connect(formantSum);
    formantSum.connect(amTarget).connect(envG).connect(master);

    // Teeth / grit: high-band noise.
    const grit = actx.createBufferSource();
    grit.buffer = noiseBuffer(actx, dur);
    const gritBP = actx.createBiquadFilter();
    gritBP.type = 'bandpass'; gritBP.frequency.value = 2400; gritBP.Q.value = 1.5;
    const gritG = actx.createGain();
    gritG.gain.setValueAtTime(0, now);
    gritG.gain.linearRampToValueAtTime(0.12, now + 0.08);
    gritG.gain.exponentialRampToValueAtTime(0.001, now + dur);
    grit.connect(gritBP).connect(gritG).connect(master);

    osc1.start(now); osc2.start(now); vib.start(now);
    am.start(now); constSrc.start(now); grit.start(now);
    const end = now + dur + 0.05;
    osc1.stop(end); osc2.stop(end); vib.stop(end);
    am.stop(end); constSrc.stop(end); grit.stop(end);
  }

  // ===== BITE ===== snarl attack: teeth-snap click + angry shriek + body thump.
  function playBite() {
    const a = initAudio();
    if (!a) return;
    const { actx, master } = a;
    const now = actx.currentTime;

    // 1. Teeth snap — ultra-short click transient (~10ms).
    const snap = actx.createBufferSource();
    snap.buffer = noiseBuffer(actx, 0.03);
    const snapHP = actx.createBiquadFilter();
    snapHP.type = 'highpass'; snapHP.frequency.value = 3000;
    const snapG = actx.createGain();
    snapG.gain.setValueAtTime(0.9, now);
    snapG.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    snap.connect(snapHP).connect(snapG).connect(master);
    snap.start(now); snap.stop(now + 0.04);

    // 2. Body thump (low).
    const thump = actx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(150, now);
    thump.frequency.exponentialRampToValueAtTime(38, now + 0.2);
    const tg = actx.createGain();
    tg.gain.setValueAtTime(0.7, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    thump.connect(tg).connect(master);
    thump.start(now); thump.stop(now + 0.25);

    // 3. Aggressive shriek — two detuned saws with pitch drop + distortion.
    const shriek1 = actx.createOscillator();
    const shriek2 = actx.createOscillator();
    shriek1.type = 'sawtooth'; shriek2.type = 'square';
    shriek1.frequency.setValueAtTime(820, now + 0.01);
    shriek1.frequency.exponentialRampToValueAtTime(220, now + 0.38);
    shriek2.frequency.setValueAtTime(840, now + 0.01);
    shriek2.frequency.exponentialRampToValueAtTime(230, now + 0.38);
    const shShaper = actx.createWaveShaper();
    shShaper.curve = makeDistCurve(35);
    const shBP = actx.createBiquadFilter();
    shBP.type = 'bandpass'; shBP.frequency.value = 1400; shBP.Q.value = 1.2;
    const sg = actx.createGain();
    sg.gain.setValueAtTime(0, now);
    sg.gain.linearRampToValueAtTime(0.45, now + 0.04);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    const shMerge = actx.createGain();
    shMerge.gain.value = 0.5;
    shriek1.connect(shMerge); shriek2.connect(shMerge);
    shMerge.connect(shShaper).connect(shBP).connect(sg).connect(master);
    shriek1.start(now); shriek2.start(now);
    shriek1.stop(now + 0.42); shriek2.stop(now + 0.42);

    // 4. Crunch — mid-band noise burst layered under.
    const n = actx.createBufferSource();
    n.buffer = noiseBuffer(actx, 0.25);
    const bp = actx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 1.5;
    const ng = actx.createGain();
    ng.gain.setValueAtTime(0.55, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    n.connect(bp).connect(ng).connect(master);
    n.start(now); n.stop(now + 0.25);
  }

  // ===== WIN ===== ascending bright chime — three tones staggered.
  function playWin() {
    const a = initAudio();
    if (!a) return;
    const { actx, master } = a;
    const now = actx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((f, i) => {
      const t = now + i * 0.11;
      const osc = actx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const g = actx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.28, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
      osc.connect(g).connect(master);
      osc.start(t);
      osc.stop(t + 0.6);
    });
  }

  // ===== BRUSH ===== velocity-driven short noise bursts while comb moves on fur.
  let lastBrushAt = 0;
  function playBrushTick(velocity) {
    const a = initAudio();
    if (!a) return;
    const { actx, master } = a;
    const now = actx.currentTime;
    // Rate-limit ticks (~20/sec max).
    if (now - lastBrushAt < 0.05) return;
    lastBrushAt = now;

    const v = Math.min(1, velocity / 15);
    const dur = 0.08 + v * 0.05;

    const n = actx.createBufferSource();
    n.buffer = noiseBuffer(actx, dur + 0.02);
    // Bandpass around 2-4kHz for that fur/bristle shhh.
    const bp = actx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200 + v * 1600 + (Math.random() * 400 - 200);
    bp.Q.value = 1.5;
    const hp = actx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const g = actx.createGain();
    const peak = 0.08 + v * 0.12;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    n.connect(hp).connect(bp).connect(g).connect(master);
    n.start(now); n.stop(now + dur + 0.02);
  }

  // ----- Game state -----
  const STATE = { SAFE: 'SAFE', TURNING: 'TURNING', WATCHING: 'WATCHING', BITING: 'BITING', WON: 'WON', IDLE: 'IDLE' };

  function loadBest() {
    try { return Number(localStorage.getItem('tamebadger.best') || 0); }
    catch (e) { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('tamebadger.best', String(v)); } catch (e) {}
  }

  const AFK_TIMEOUT_MS = 15000;
  const AFK_WARN_MS = 5000; // show warning when this many ms remain

  // Scoring / anti-spam knobs
  const SCORE_COEFF = 0.022;          // per effective pixel
  const BRUSH_DELTA_CAP = 18;         // max px counted per frame (anti-wiggle)
  const COHERENCE_MIN = 0.35;         // minimum multiplier for chaotic motion

  // Win target — randomized each run so players don't know the exact finish line.
  const WIN_SCORE_MIN = 260;
  const WIN_SCORE_MAX = 440;

  const game = {
    state: STATE.IDLE,
    stateTimer: 0,
    score: 0,
    best: loadBest(),
    running: false,
    shake: 0,
    afkTimer: 0,
    endReason: null, // 'bite' | 'afk' | 'win'
    winTarget: 0,
    // Fake glance — decorative mid-SAFE head twitch. Does NOT make the badger watching.
    glance: { active: false, at: 0, dur: 0, peak: 0 },
    // Smooth return to "facing away" when SAFE begins after a real watch.
    returnAnim: { active: false, t: 0, dur: 350, from: 0.9 },
    // Rolling stroke-direction memory for coherence scoring.
    strokeDirX: 0, strokeDirY: 0,
  };

  // Timing profile — unpredictable so players can't count seconds.
  // Mixes short/medium/long safe windows + fake-out quick glances.
  function getTimings(score) {
    const t = Math.min(1, score / 400);

    // Safe window: weighted roll of three archetypes — short, medium, long.
    // Means a player sometimes gets barely a second, sometimes 4+ seconds.
    const roll = Math.random();
    let safeBase;
    if (roll < 0.25) {
      safeBase = 700 + Math.random() * 500;    // short:  0.7–1.2s
    } else if (roll < 0.80) {
      safeBase = 1400 + Math.random() * 1200;  // medium: 1.4–2.6s
    } else {
      safeBase = 2800 + Math.random() * 1600;  // long:   2.8–4.4s (lull)
    }
    // Compress with score: up to 55% reduction at max difficulty.
    const safe = Math.max(450, safeBase * (1 - 0.55 * t));

    // Turning wind-up — the visible tell. Variable; sometimes snap-quick.
    const turnBase = 220 + Math.random() * 360; // 220–580ms
    const turning = Math.max(100, turnBase * (1 - 0.6 * t));

    // Watching: sometimes a fake-out (short glance), sometimes a long stare.
    const stareRoll = Math.random();
    let watching;
    if (stareRoll < 0.20) {
      watching = 350 + Math.random() * 300;    // fake-out: 0.35–0.65s
    } else if (stareRoll < 0.85) {
      watching = 900 + Math.random() * 700;    // normal: 0.9–1.6s
    } else {
      watching = 1800 + Math.random() * 900;   // long stare: 1.8–2.7s
    }

    return { safe, turning, watching };
  }

  let nextTimings = getTimings(0);

  function setState(s) {
    const prev = game.state;
    game.state = s;
    game.stateTimer = 0;
    if (s === STATE.SAFE) {
      nextTimings = getTimings(game.score);
      scheduleGlance(nextTimings.safe);
      // If coming back from a real look, animate the head swinging away.
      if (prev === STATE.WATCHING || prev === STATE.TURNING) {
        game.returnAnim.active = true;
        game.returnAnim.t = 0;
        game.returnAnim.dur = 280 + Math.random() * 160;
        game.returnAnim.from = 0.9;
      }
    }
    if (s === STATE.TURNING) playHiss();
    if (s === STATE.WATCHING) playSnarl();
  }

  // Decide if/when a fake glance fires during this SAFE window.
  // Rules: only long enough windows get one; never within 500ms of the real turn.
  function scheduleGlance(safeDurMs) {
    game.glance.active = false;
    if (safeDurMs < 1200) return;
    if (Math.random() > 0.45) return; // ~45% of eligible windows have a glance
    const dur = 220 + Math.random() * 220; // 220–440ms
    const earliest = 300;
    const latest = safeDurMs - 500 - dur;
    if (latest <= earliest) return;
    game.glance.at = earliest + Math.random() * (latest - earliest);
    game.glance.dur = dur;
    game.glance.peak = 0.35 + Math.random() * 0.35; // 35–70% of the way to watching
    game.glance.active = true;
  }

  // ----- Input / brushing detection -----
  const input = {
    down: false,
    onCanvas: false,
    x: 0, y: 0,
    lastX: 0, lastY: 0,
    brushDelta: 0, // pixels moved this frame while held
    moveVX: 0, moveVY: 0, // smoothed recent movement for comb rotation
  };

  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches && e.touches[0];
    const cx = touch ? touch.clientX : e.clientX;
    const cy = touch ? touch.clientY : e.clientY;
    return {
      x: (cx - rect.left),
      y: (cy - rect.top),
    };
  }

  function onDown(e) {
    e.preventDefault();
    if (!game.running) return;
    const p = canvasPos(e);
    input.down = true;
    input.x = input.lastX = p.x;
    input.y = input.lastY = p.y;
  }
  function onMove(e) {
    const p = canvasPos(e);
    input.lastX = input.x;
    input.lastY = input.y;
    input.x = p.x;
    input.y = p.y;
    const dx = input.x - input.lastX;
    const dy = input.y - input.lastY;
    // Smooth recent velocity for comb rotation (low-pass).
    input.moveVX = input.moveVX * 0.7 + dx * 0.3;
    input.moveVY = input.moveVY * 0.7 + dy * 0.3;
    if (input.down) {
      e.preventDefault();
      input.brushDelta += Math.hypot(dx, dy);
    }
  }
  function onUp(e) {
    input.down = false;
  }

  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mouseenter', () => { input.onCanvas = true; });
  canvas.addEventListener('mouseleave', () => { input.onCanvas = false; });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('touchstart', (e) => { input.onCanvas = true; onDown(e); }, { passive: false });
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('touchend', (e) => { onUp(e); input.onCanvas = false; });
  window.addEventListener('touchcancel', (e) => { onUp(e); input.onCanvas = false; });

  // ----- Badger geometry (logical coords = canvas.style px) -----
  function logical() {
    return {
      w: canvas.width / devicePixelRatio,
      h: canvas.height / devicePixelRatio,
    };
  }
  function badger() {
    const { w, h } = logical();
    return {
      cx: w / 2,
      cy: h * 0.62,
      bodyRx: w * 0.28,
      bodyRy: h * 0.16,
      headR: h * 0.11,
    };
  }

  // Is cursor over the badger body? (used to require strokes actually land on it)
  function overBody(x, y) {
    const b = badger();
    // body ellipse hit-test
    const nx = (x - b.cx) / b.bodyRx;
    const ny = (y - b.cy) / b.bodyRy;
    if (nx * nx + ny * ny <= 1.1) return true;
    // head region (varies by state, but give generous hit)
    const hx = b.cx - b.bodyRx * 0.75;
    const hy = b.cy - b.bodyRy * 0.15;
    return Math.hypot(x - hx, y - hy) <= b.headR * 1.2;
  }

  // ----- Main loop -----
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - lastT);
    lastT = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  function update(dt) {
    if (!game.running) { input.brushDelta = 0; return; }

    game.stateTimer += dt;
    if (game.returnAnim.active) game.returnAnim.t += dt;

    // Brushing detection: only count strokes while pointer held, moving, and on the body.
    const brushing = input.down && input.brushDelta > 0.5 && overBody(input.x, input.y);

    // Effective brush amount: capped per-frame + weighted by stroke coherence.
    // Coherence is how aligned current motion is with recent motion — rewards steady
    // strokes, penalizes rapid back-and-forth wiggle spam.
    let effectiveBrush = 0;
    if (brushing) {
      const capped = Math.min(input.brushDelta, BRUSH_DELTA_CAP);
      const dx = input.x - input.lastX;
      const dy = input.y - input.lastY;
      const mag = Math.hypot(dx, dy);
      let coherence = 1;
      if (mag > 0.1) {
        const nx = dx / mag, ny = dy / mag;
        const prevMag = Math.hypot(game.strokeDirX, game.strokeDirY);
        if (prevMag > 0.01) {
          const pdx = game.strokeDirX / prevMag, pdy = game.strokeDirY / prevMag;
          // dot product: 1 = same direction, -1 = reversal
          const dot = nx * pdx + ny * pdy;
          coherence = Math.max(COHERENCE_MIN, (dot + 1) / 2); // map [-1,1] -> [0,1]
        }
        // Smooth the stored direction (low-pass).
        game.strokeDirX = game.strokeDirX * 0.6 + nx * 0.4;
        game.strokeDirY = game.strokeDirY * 0.6 + ny * 0.4;
      }
      effectiveBrush = capped * coherence;
    } else {
      // Decay stored direction when not stroking so a new stroke starts coherence-neutral.
      game.strokeDirX *= 0.85;
      game.strokeDirY *= 0.85;
    }

    // Brush sound: fires whenever the comb is actively stroking fur, regardless of state.
    // (A player who panics and brushes during WATCHING still gets the sound before the bite.)
    if (brushing) playBrushTick(input.brushDelta);

    // AFK watchdog: any active frame without real stroking increments the timer.
    // Real strokes reset it. BITING / WON states excluded (run already ending).
    if (game.state !== STATE.BITING && game.state !== STATE.WON) {
      if (brushing) {
        game.afkTimer = 0;
      } else {
        game.afkTimer += dt;
        if (game.afkTimer >= AFK_TIMEOUT_MS) {
          endRun('afk');
          return;
        }
      }
    }

    // TB2 fork: score is monotonically non-decreasing. No passive decay.
    // Stalling is still discouraged by the AFK watchdog (15s no-brush → run ends).

    switch (game.state) {
      case STATE.SAFE: {
        const gain = brushing ? effectiveBrush * SCORE_COEFF : 0;
        game.score = game.score + gain;
        scoreEl.textContent = Math.floor(game.score);
        if (game.score >= game.winTarget) { winRun(); break; }
        if (game.stateTimer >= nextTimings.safe) setState(STATE.TURNING);
        break;
      }
      case STATE.TURNING: {
        // Brushing during the wind-up is still valid and risky-but-safe.
        const gain = brushing ? effectiveBrush * SCORE_COEFF : 0;
        game.score = Math.max(0, game.score + gain);
        scoreEl.textContent = Math.floor(game.score);
        if (game.score >= game.winTarget) { winRun(); break; }
        if (game.stateTimer >= nextTimings.turning) setState(STATE.WATCHING);
        break;
      }
      case STATE.WATCHING:
        // Freezing here is the CORRECT move — score is held steady.
        if (brushing) { bite(); break; }
        if (game.stateTimer >= nextTimings.watching) setState(STATE.SAFE);
        break;
      case STATE.BITING:
        if (game.stateTimer >= 900) endRun();
        break;
      case STATE.WON:
        // Brief celebration pause before the overlay.
        if (game.stateTimer >= 1400) endRun();
        break;
    }

    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 0.02);
    input.brushDelta = 0;
    stateEl.textContent = game.state;
  }

  function bite() {
    setState(STATE.BITING);
    game.shake = 1;
    game.endReason = 'bite';
    playBite();
  }

  function winRun() {
    if (game.state === STATE.WON) return;
    setState(STATE.WON);
    game.endReason = 'win';
    playWin();
  }

  function endRun(reason) {
    if (reason) game.endReason = reason;
    game.running = false;
    const finalScore = Math.floor(game.score);
    if (finalScore > game.best) {
      game.best = finalScore;
      saveBest(game.best);
    }
    bestEl.textContent = game.best;
    if (game.endReason === 'win') {
      overTitle.textContent = 'Tamed!';
      overSub.textContent = `The badger trusts you.  Score: ${finalScore}  •  Best: ${game.best}`;
    } else if (game.endReason === 'afk') {
      overTitle.textContent = 'Badger got bored';
      overSub.textContent = `No brushing for 15s.  Score: ${finalScore}  •  Best: ${game.best}`;
    } else {
      overTitle.textContent = 'Bitten!';
      overSub.textContent = `Score: ${finalScore}  •  Best: ${game.best}`;
    }
    startBtn.textContent = 'Try Again';
    overlay.classList.add('show');
  }

  function startRun() {
    const a = initAudio();
    if (a && a.actx.state === 'suspended') a.actx.resume();
    game.score = 0;
    game.afkTimer = 0;
    game.endReason = null;
    game.winTarget = WIN_SCORE_MIN + Math.random() * (WIN_SCORE_MAX - WIN_SCORE_MIN);
    game.strokeDirX = 0;
    game.strokeDirY = 0;
    scoreEl.textContent = '0';
    goalEl.textContent = String(Math.ceil(game.winTarget));
    bestEl.textContent = game.best;
    game.running = true;
    overlay.classList.remove('show');
    setState(STATE.SAFE);
  }

  // ----- Rendering (placeholder shapes — swap for sprites later) -----
  function render() {
    const { w, h } = logical();
    ctx.save();
    if (game.shake > 0) {
      const s = game.shake * 12;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }

    // Background: always fill with a ground tone, then draw the photo over it
    // so letterbox strips (when photo aspect ≠ canvas aspect) match the scene.
    ctx.fillStyle = '#7a6440'; // dusty savanna
    ctx.fillRect(0, 0, w, h);
    if (!drawSprite('background', w / 2, h / 2, w)) {
      // No photo — draw the placeholder scene instead.
      ctx.fillStyle = '#2a3d2a';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#4a3a28';
      ctx.beginPath();
      ctx.ellipse(w/2, h * 0.78, w * 0.42, h * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    drawBadger();
    ctx.restore();

    drawComb();
    drawAfkWarning();
  }

  function drawAfkWarning() {
    if (!game.running || game.state === STATE.BITING) return;
    const remaining = AFK_TIMEOUT_MS - game.afkTimer;
    if (remaining > AFK_WARN_MS) return;
    const { w, h } = logical();
    const secs = Math.max(0, remaining / 1000);
    // Pulse faster as it nears zero.
    const pulse = 0.5 + 0.5 * Math.sin(performance.now() * (0.006 + (1 - secs / 5) * 0.02));
    ctx.save();
    ctx.globalAlpha = 0.75 + pulse * 0.25;
    ctx.fillStyle = secs < 2 ? '#e23' : '#e8b34a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '600 22px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(`Keep brushing! ${secs.toFixed(1)}s`, w / 2, h * 0.12);
    ctx.restore();
  }

  function drawComb() {
    if (!input.onCanvas) return;
    const x = input.x, y = input.y;
    // Rotation based on recent horizontal motion; bias down so bristles face the badger.
    const vx = input.moveVX;
    const tilt = Math.max(-0.5, Math.min(0.5, vx * 0.04));
    const angle = tilt;

    // Comb sprite takes over entirely when provided.
    if (drawSprite('comb', x, y, 80, angle)) return;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    const combW = 64, combH = 14;
    const bristleLen = 10;

    // Handle
    ctx.fillStyle = '#7a4a1e';
    roundRect(ctx, -combW/2, -combH/2, combW, combH, 4);
    ctx.fill();
    // Handle highlight
    ctx.fillStyle = '#a76a36';
    roundRect(ctx, -combW/2 + 3, -combH/2 + 2, combW - 6, 3, 2);
    ctx.fill();

    // Bristles
    ctx.fillStyle = '#e0d9c0';
    ctx.strokeStyle = '#3d2a14';
    ctx.lineWidth = 1;
    const count = 14;
    const pad = 4;
    const usable = combW - pad * 2;
    for (let i = 0; i < count; i++) {
      const bx = -combW/2 + pad + (usable / (count - 1)) * i;
      ctx.beginPath();
      ctx.moveTo(bx - 1, combH/2);
      ctx.lineTo(bx - 1, combH/2 + bristleLen);
      ctx.lineTo(bx + 1, combH/2 + bristleLen);
      ctx.lineTo(bx + 1, combH/2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // If actively brushing, show motion lines from the bristles.
    if (input.down) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const bx = -combW/2 + 8 + (combW - 16) * (i / 2);
        ctx.beginPath();
        ctx.moveTo(bx, combH/2 + bristleLen + 2);
        ctx.lineTo(bx, combH/2 + bristleLen + 8);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawBadger() {
    const b = badger();
    const state = game.state;

    // ---- PHOTO PATH: body photo loaded — draw body + optional head overlay. ----
    if (sprites.body) {
      const biteT = state === STATE.BITING ? Math.min(1, game.stateTimer / 400) : 0;
      const zoom = 1 + biteT * 0.12;
      const spriteW = b.bodyRx * (state === STATE.BITING ? 3.15 : 3.0) * zoom;
      const spriteY = b.cy + b.bodyRy * 1.06;
      let spriteSlot = 'body';
      if (state === STATE.TURNING) spriteSlot = 'head_turning';
      else if (state === STATE.WATCHING) spriteSlot = 'head_watching';
      else if (state === STATE.BITING) spriteSlot = 'head_biting';

      drawSprite(spriteSlot, b.cx, spriteY, spriteW);

      // State tint overlays
      const { w, h } = logical();
      if (state === STATE.WATCHING) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.012);
        ctx.save();
        ctx.fillStyle = `rgba(226, 50, 50, ${0.10 + pulse * 0.08})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      } else if (state === STATE.BITING) {
        const fade = Math.max(0, 1 - game.stateTimer / 700);
        ctx.save();
        ctx.fillStyle = `rgba(220, 30, 30, ${0.35 * fade})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      return;
    }

    // ---- SHAPE PATH: no photos loaded — run the original placeholder renderer. ----
    // Head position shifts based on state: away (left) in SAFE, turned toward player (down/front) in WATCHING.
    const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
    const easeInOutSine = (x) => -(Math.cos(Math.PI * x) - 1) / 2;

    let headSide = -1;
    let headOffsetY = -b.bodyRy * 0.25;
    if (state === STATE.TURNING) {
      const t = Math.min(1, game.stateTimer / Math.max(1, nextTimings.turning));
      const eased = easeOutCubic(t);
      headSide = -1 + eased * 1.9;
      headOffsetY = -b.bodyRy * (0.25 + eased * 0.15);
    } else if (state === STATE.WATCHING || state === STATE.BITING) {
      headSide = 0.9;
      headOffsetY = -b.bodyRy * 0.4;
    } else if (state === STATE.SAFE) {
      if (game.returnAnim.active) {
        const rt = Math.min(1, game.returnAnim.t / game.returnAnim.dur);
        const eased = easeInOutSine(rt);
        headSide = game.returnAnim.from + (-1 - game.returnAnim.from) * eased;
        headOffsetY = -b.bodyRy * (0.4 - eased * 0.15);
        if (rt >= 1) game.returnAnim.active = false;
      }
      const gl = game.glance;
      if (gl.active && game.stateTimer >= gl.at && game.stateTimer <= gl.at + gl.dur) {
        const gt = (game.stateTimer - gl.at) / gl.dur;
        const shape = Math.sin(gt * Math.PI);
        headSide = -1 + shape * (gl.peak + 1);
        headOffsetY = -b.bodyRy * (0.25 + shape * 0.12);
      }
    }

    // Body shape
    {
      ctx.save();
      ctx.fillStyle = '#1a1a1a';
      ctx.beginPath();
      ctx.ellipse(b.cx, b.cy, b.bodyRx, b.bodyRy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c8c2b0';
      ctx.beginPath();
      ctx.ellipse(b.cx, b.cy - b.bodyRy * 0.45, b.bodyRx * 0.92, b.bodyRy * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0d0d0d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(b.cx, b.cy - b.bodyRy * 0.15, b.bodyRx * 0.98, b.bodyRy * 0.55, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Head shape
    const hx = b.cx + headSide * b.bodyRx * 0.75;
    const hy = b.cy + headOffsetY;
    ctx.save();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(hx, hy, b.headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c8c2b0';
    ctx.beginPath();
    ctx.arc(hx, hy - b.headR * 0.3, b.headR * 0.85, Math.PI, 0);
    ctx.fill();

    if (headSide > 0.3) {
      const eyeOffset = b.headR * 0.35;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(hx - eyeOffset, hy, b.headR * 0.18, 0, Math.PI * 2);
      ctx.arc(hx + eyeOffset, hy, b.headR * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = state === STATE.BITING ? '#e23' : '#000';
      ctx.beginPath();
      ctx.arc(hx - eyeOffset, hy, b.headR * 0.09, 0, Math.PI * 2);
      ctx.arc(hx + eyeOffset, hy, b.headR * 0.09, 0, Math.PI * 2);
      ctx.fill();
      if (state === STATE.WATCHING || state === STATE.BITING) {
        ctx.fillStyle = '#fff';
        const mouthY = hy + b.headR * 0.45;
        const mw = b.headR * 0.5;
        const mh = state === STATE.BITING ? b.headR * 0.35 : b.headR * 0.18;
        ctx.fillRect(hx - mw/2, mouthY, mw, mh);
        ctx.beginPath();
        ctx.moveTo(hx - mw/2 + 4, mouthY);
        ctx.lineTo(hx - mw/2 + 8, mouthY + mh);
        ctx.lineTo(hx - mw/2 + 12, mouthY);
        ctx.moveTo(hx + mw/2 - 4, mouthY);
        ctx.lineTo(hx + mw/2 - 8, mouthY + mh);
        ctx.lineTo(hx + mw/2 - 12, mouthY);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#0d0d0d';
      ctx.beginPath();
      ctx.arc(hx - b.headR * 0.4, hy - b.headR * 0.7, b.headR * 0.15, 0, Math.PI * 2);
      ctx.arc(hx + b.headR * 0.4, hy - b.headR * 0.7, b.headR * 0.15, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Tail shape
    ctx.save();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(b.cx + b.bodyRx * 0.95, b.cy);
    ctx.quadraticCurveTo(b.cx + b.bodyRx * 1.2, b.cy - b.bodyRy * 0.3, b.cx + b.bodyRx * 1.3, b.cy + b.bodyRy * 0.1);
    ctx.stroke();
    ctx.restore();

    // Danger indicator: red tint overlay when WATCHING
    if (state === STATE.WATCHING) {
      ctx.save();
      ctx.fillStyle = 'rgba(226, 50, 50, 0.08)';
      const { w, h } = logical();
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  // ----- Start wiring -----
  loadSprites();
  overTitle.textContent = 'Brush the Ratel';
  overSub.textContent = 'Brush gently. Stop when he looks at you.';
  startBtn.addEventListener('click', startRun);
  bestEl.textContent = game.best;
  overlay.classList.add('show');

  requestAnimationFrame(frame);
})();
