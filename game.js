window.addEventListener("error", (e) => {
  const d = document.createElement("div");
  d.style.cssText =
    "position:fixed;bottom:8px;left:8px;right:8px;background:#a33;color:#fff;padding:8px;font:12px monospace;z-index:99;border-radius:4px;";
  d.textContent = "JS Error: " + (e.message || e.error);
  document.body.appendChild(d);
});

(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const goalEl = document.getElementById("goal");
  const stateEl = document.getElementById("state");
  const overlay = document.getElementById("overlay");
  const overTitle = document.getElementById("overTitle");
  const overSub = document.getElementById("overSub");
  const startBtn = document.getElementById("startBtn");
  const scorePanel = scoreEl.parentElement;
  const goalPanel = goalEl.parentElement;
  const bestPanel = bestEl.parentElement;

  // ----- Responsive canvas -----
  function fitCanvas() {
    const maxW = Math.min(window.innerWidth - 40, 920);
    const maxH = Math.min(window.innerHeight - 40, 720);
    const aspect = 4 / 3;
    let w = maxW,
      h = w / aspect;
    if (h > maxH) {
      h = maxH;
      w = h * aspect;
    }
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = Math.round(w * devicePixelRatio);
    canvas.height = Math.round(h * devicePixelRatio);
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  }
  window.addEventListener("resize", fitCanvas);
  fitCanvas();

  // ----- Sprite / asset loader -----
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
      src: "assets/Badger_Neutral.png",
      anchor: { x: 0.5, y: 1.0 },
    },
    head_turning: {
      src: "assets/Badger_alert.png",
      anchor: { x: 0.5, y: 1.0 },
    },
    head_watching: {
      src: "assets/Badger_lockedOn.png",
      anchor: { x: 0.5, y: 1.0 },
    },
    head_biting: {
      src: "assets/Badger_Pounce.png",
      anchor: { x: 0.5, y: 1.0 },
    },
    head_jumpscare: {
      src: "assets/Badger_Jumpscare.png",
      anchor: { x: 0.5, y: 1.0 },
    },
    comb: { src: "assets/Comb_angle.png", anchor: { x: 0.82, y: 0.88 } },
    background: {
      src: "assets/background_painted.png",
      anchor: { x: 0.5, y: 0.5 },
    },
  };
  const sprites = {}; // slot -> HTMLImageElement once loaded
  function loadSprites() {
    for (const [slot, def] of Object.entries(SPRITE_SLOTS)) {
      const img = new Image();
      img.onload = () => {
        sprites[slot] = img;
      };
      img.onerror = () => {
        console.warn(`Missing sprite: ${def.src}`);
      };
      img.src = def.src;
    }
  }

  const jumpscareSfx = new Audio("assets/JumpScare.mp3");
  jumpscareSfx.preload = "auto";
  jumpscareSfx.volume = 0.9;
  function playJumpscareSfx() {
    try {
      jumpscareSfx.currentTime = 0;
      jumpscareSfx.play();
    } catch (_) {}
  }
  // Helper for drawing a sprite at (x, y) with optional width/rotation.
  function drawSprite(
    slot,
    x,
    y,
    width,
    rotation = 0,
    flipX = false,
    scaleX = 1,
    scaleY = 1,
    alpha = 1,
  ) {
    const img = sprites[slot];
    if (!img) return false;
    const def = SPRITE_SLOTS[slot];
    const aspect = img.naturalHeight / img.naturalWidth;
    const w = width;
    const h = width * aspect;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha *= alpha;
    if (rotation) ctx.rotate(rotation);
    ctx.scale(flipX ? -scaleX : scaleX, scaleY);
    // Optional mask — hides rectangular photo backgrounds.
    if (def.clip === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(0, 0, w * 0.48, h * 0.42, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, -w * def.anchor.x, -h * def.anchor.y, w, h);
    } else if (def.clip === "circle") {
      const r = Math.min(w, h) * 0.45;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, -w * def.anchor.x, -h * def.anchor.y, w, h);
    } else if (def.clip === "soft") {
      // Soft radial fade: draw image, then mask with a radial gradient alpha.
      // Uses an offscreen buffer so the mask doesn't bleed into the main canvas.
      const buf = getSoftBuffer(w, h);
      const bctx = buf.getContext("2d");
      bctx.clearRect(0, 0, buf.width, buf.height);
      bctx.drawImage(img, 0, 0, buf.width, buf.height);
      bctx.globalCompositeOperation = "destination-in";
      const cx = buf.width * def.anchor.x,
        cy = buf.height * def.anchor.y;
      const rMax = Math.min(buf.width, buf.height) * 0.5;
      const grad = bctx.createRadialGradient(
        cx,
        cy,
        rMax * 0.4,
        cx,
        cy,
        rMax * 0.98,
      );
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(0.7, "rgba(0,0,0,1)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      bctx.fillStyle = grad;
      bctx.fillRect(0, 0, buf.width, buf.height);
      bctx.globalCompositeOperation = "source-over";
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
    const buf = document.createElement("canvas");
    buf.width = tw;
    buf.height = th;
    _softBuffers.push(buf);
    return buf;
  }

  const particles = [];
  const combGhosts = [];

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function kickShake(amount) {
    game.shake = Math.max(game.shake, amount);
  }

  function triggerFreeze(ms) {
    game.freezeTimer = Math.max(game.freezeTimer, ms);
  }

  function emitParticles(x, y, count, options = {}) {
    const {
      color = "255,230,170",
      speedMin = 30,
      speedMax = 120,
      sizeMin = 3,
      sizeMax = 8,
      lifeMin = 180,
      lifeMax = 420,
      spread = Math.PI,
      angle = -Math.PI / 2,
      gravity = 0,
      drag = 0.92,
      shape = "circle",
    } = options;

    for (let i = 0; i < count; i++) {
      const theta = angle + (Math.random() - 0.5) * spread;
      const speed = speedMin + Math.random() * (speedMax - speedMin);
      const life = lifeMin + Math.random() * (lifeMax - lifeMin);
      particles.push({
        x,
        y,
        vx: Math.cos(theta) * speed,
        vy: Math.sin(theta) * speed,
        life,
        maxLife: life,
        size: sizeMin + Math.random() * (sizeMax - sizeMin),
        gravity,
        drag,
        color,
        shape,
      });
    }
  }

  function spawnBrushBurst(x, y, intensity) {
    // Only shed fur strands — no cream/tan spark debris. The previous layers
    // read as energy sparks against the savanna; fur-only reads as "the
    // badger is losing hair where I'm stroking."
    const furColors = ["215,215,210", "168,165,158", "90,82,72", "240,238,228"];
    const furCount = 3 + Math.floor(intensity * 3);
    for (let i = 0; i < furCount; i++) {
      emitParticles(x, y, 1, {
        color: furColors[(Math.random() * furColors.length) | 0],
        speedMin: 12,
        speedMax: 34,
        sizeMin: 1.6,
        sizeMax: 2.8,
        lifeMin: 520,
        lifeMax: 880,
        spread: Math.PI * 0.85,
        angle: -Math.PI / 2,
        gravity: 28,
        drag: 0.93,
        shape: "fur",
      });
    }
  }

  function spawnImpactBurst(x, y, mode) {
    if (mode === "win") {
      emitParticles(x, y, 20, {
        color: "255,223,120",
        speedMin: 40,
        speedMax: 200,
        sizeMin: 3,
        sizeMax: 9,
        lifeMin: 260,
        lifeMax: 650,
        spread: Math.PI * 2,
        angle: 0,
        gravity: -10,
        drag: 0.94,
        shape: "spark",
      });
      return;
    }
    emitParticles(x, y, 18, {
      color: "255,180,120",
      speedMin: 45,
      speedMax: 210,
      sizeMin: 3,
      sizeMax: 9,
      lifeMin: 180,
      lifeMax: 420,
      spread: Math.PI * 2,
      angle: 0,
      gravity: 28,
      drag: 0.9,
      shape: "spark",
    });
  }

  function pushCombGhost(x, y, angle, size, strength) {
    combGhosts.push({
      x,
      y,
      angle,
      size,
      life: 60 + strength * 90,
      maxLife: 60 + strength * 90,
      scale: 0.92 + strength * 0.18,
    });
    while (combGhosts.length > 10) combGhosts.shift();
  }

  function updateTransientLists(rawDt) {
    const sec = rawDt / 1000;

    for (let i = combGhosts.length - 1; i >= 0; i--) {
      const ghost = combGhosts[i];
      ghost.life -= rawDt;
      ghost.scale *= 0.995;
      if (ghost.life <= 0) combGhosts.splice(i, 1);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= rawDt;
      if (p.life <= 0) {
        particles.splice(i, 1);
        continue;
      }
      p.vx *= Math.pow(p.drag, sec * 60);
      p.vy = p.vy * Math.pow(p.drag, sec * 60) + p.gravity * sec;
      p.x += p.vx * sec;
      p.y += p.vy * sec;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const t = p.life / p.maxLife;
      ctx.save();
      // Single alpha control: stay fully opaque for the first ~33% of life,
      // then fade out linearly. Previously globalAlpha AND fillStyle alpha
      // were both multiplied by t, which double-attenuated the opacity and
      // made particles almost invisible past the first few frames.
      ctx.globalAlpha = clamp(t * 1.5, 0, 1);
      ctx.fillStyle = `rgba(${p.color},1)`;
      ctx.strokeStyle = `rgba(${p.color},1)`;
      if (p.shape === "spark") {
        ctx.lineWidth = Math.max(1.4, p.size * 0.28);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
        ctx.stroke();
      } else if (p.shape === "fur") {
        const rot = Math.atan2(p.vy, p.vx);
        const len = Math.max(3, p.size * 1.6);
        ctx.translate(p.x, p.y);
        ctx.rotate(rot);
        ctx.lineWidth = Math.max(1.4, p.size * 0.55);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(-len * 0.5, 0);
        ctx.lineTo(len * 0.5, 0);
        ctx.stroke();
      } else {
        // Keep particles at 75-100% of their authored size across their life
        // so they stay readable instead of shrinking to nothing.
        ctx.beginPath();
        ctx.arc(
          p.x,
          p.y,
          Math.max(1, p.size * (0.75 + t * 0.25)),
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function updateHudFeel() {
    scorePanel.style.transform = `translateY(${-game.scorePulse * 6}px) scale(${1 + game.scorePulse * 0.16})`;
    scorePanel.style.filter = `brightness(${1 + game.scorePulse * 0.35})`;

    goalPanel.style.transform = `translateY(${-game.goalPulse * 4}px) scale(${1 + game.goalPulse * 0.12})`;
    goalPanel.style.filter = `brightness(${1 + game.goalPulse * 0.18})`;

    bestPanel.style.transform = `translateY(${-game.flash * 2}px) scale(${1 + game.flash * 0.06})`;

    const danger = game.dangerPulse;
    stateEl.style.transform = `translateX(-50%) scale(${1 + game.statePulse * 0.18 + danger * 0.06})`;
    stateEl.style.opacity = String(
      0.45 + game.statePulse * 0.22 + danger * 0.24,
    );
    stateEl.style.letterSpacing = `${danger * 0.08}em`;
    stateEl.style.color =
      danger > 0.08
        ? `rgba(255, ${Math.round(232 - danger * 64)}, ${Math.round(220 - danger * 124)}, 1)`
        : "rgba(255,255,255,0.82)";
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
    } catch (e) {
      audio = null;
    }
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
      curve[i] =
        ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
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
    hp.type = "highpass";
    hp.frequency.value = 3200;
    const bp1 = actx.createBiquadFilter();
    bp1.type = "bandpass";
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
    tremolo.type = "sine";
    tremolo.frequency.value = 8 + Math.random() * 4;
    const tremGain = actx.createGain();
    tremGain.gain.value = 0.25;
    tremolo.connect(tremGain).connect(g1.gain);

    n1.connect(hp).connect(bp1).connect(g1).connect(master);

    // Layer 2: throat body (mid-low rasp)
    const n2 = actx.createBufferSource();
    n2.buffer = noiseBuffer(actx, dur + 0.1);
    const bp2 = actx.createBiquadFilter();
    bp2.type = "bandpass";
    bp2.frequency.value = 900;
    bp2.Q.value = 4;
    const g2 = actx.createGain();
    g2.gain.setValueAtTime(0, now);
    g2.gain.linearRampToValueAtTime(0.18, now + 0.06);
    g2.gain.exponentialRampToValueAtTime(0.001, now + dur);
    n2.connect(bp2).connect(g2).connect(master);

    // Layer 3: slight voiced rumble under the hiss — irritation, not pure breath.
    const rumble = actx.createOscillator();
    rumble.type = "sawtooth";
    rumble.frequency.setValueAtTime(110, now);
    rumble.frequency.linearRampToValueAtTime(95, now + dur);
    const rLP = actx.createBiquadFilter();
    rLP.type = "lowpass";
    rLP.frequency.value = 400;
    const rg = actx.createGain();
    rg.gain.setValueAtTime(0, now);
    rg.gain.linearRampToValueAtTime(0.08, now + 0.1);
    rg.gain.exponentialRampToValueAtTime(0.001, now + dur);
    rumble.connect(rLP).connect(rg).connect(master);

    n1.start(now);
    n2.start(now);
    rumble.start(now);
    tremolo.start(now);
    n1.stop(now + dur);
    n2.stop(now + dur);
    rumble.stop(now + dur);
    tremolo.stop(now + dur);
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
    osc1.type = osc2.type = "sawtooth";
    osc1.frequency.setValueAtTime(78, now);
    osc1.frequency.linearRampToValueAtTime(62, now + dur);
    osc2.frequency.setValueAtTime(83, now); // slight detune
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
    shaper.oversample = "4x";

    // Formant-ish bandpass cluster for throat character.
    const f1 = actx.createBiquadFilter();
    f1.type = "bandpass";
    f1.frequency.value = 320;
    f1.Q.value = 4;
    const f2 = actx.createBiquadFilter();
    f2.type = "bandpass";
    f2.frequency.value = 1100;
    f2.Q.value = 3;
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
    constSrc.buffer = constBuf;
    constSrc.loop = true;
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
    shaper.connect(f1);
    shaper.connect(f2);
    f1.connect(formantSum);
    f2.connect(formantSum);
    formantSum.connect(amTarget).connect(envG).connect(master);

    // Teeth / grit: high-band noise.
    const grit = actx.createBufferSource();
    grit.buffer = noiseBuffer(actx, dur);
    const gritBP = actx.createBiquadFilter();
    gritBP.type = "bandpass";
    gritBP.frequency.value = 2400;
    gritBP.Q.value = 1.5;
    const gritG = actx.createGain();
    gritG.gain.setValueAtTime(0, now);
    gritG.gain.linearRampToValueAtTime(0.12, now + 0.08);
    gritG.gain.exponentialRampToValueAtTime(0.001, now + dur);
    grit.connect(gritBP).connect(gritG).connect(master);

    osc1.start(now);
    osc2.start(now);
    vib.start(now);
    am.start(now);
    constSrc.start(now);
    grit.start(now);
    const end = now + dur + 0.05;
    osc1.stop(end);
    osc2.stop(end);
    vib.stop(end);
    am.stop(end);
    constSrc.stop(end);
    grit.stop(end);
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
    snapHP.type = "highpass";
    snapHP.frequency.value = 3000;
    const snapG = actx.createGain();
    snapG.gain.setValueAtTime(0.9, now);
    snapG.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
    snap.connect(snapHP).connect(snapG).connect(master);
    snap.start(now);
    snap.stop(now + 0.04);

    // 2. Body thump (low).
    const thump = actx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(150, now);
    thump.frequency.exponentialRampToValueAtTime(38, now + 0.2);
    const tg = actx.createGain();
    tg.gain.setValueAtTime(0.7, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
    thump.connect(tg).connect(master);
    thump.start(now);
    thump.stop(now + 0.25);

    // 3. Aggressive shriek — two detuned saws with pitch drop + distortion.
    const shriek1 = actx.createOscillator();
    const shriek2 = actx.createOscillator();
    shriek1.type = "sawtooth";
    shriek2.type = "square";
    shriek1.frequency.setValueAtTime(820, now + 0.01);
    shriek1.frequency.exponentialRampToValueAtTime(220, now + 0.38);
    shriek2.frequency.setValueAtTime(840, now + 0.01);
    shriek2.frequency.exponentialRampToValueAtTime(230, now + 0.38);
    const shShaper = actx.createWaveShaper();
    shShaper.curve = makeDistCurve(35);
    const shBP = actx.createBiquadFilter();
    shBP.type = "bandpass";
    shBP.frequency.value = 1400;
    shBP.Q.value = 1.2;
    const sg = actx.createGain();
    sg.gain.setValueAtTime(0, now);
    sg.gain.linearRampToValueAtTime(0.45, now + 0.04);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    const shMerge = actx.createGain();
    shMerge.gain.value = 0.5;
    shriek1.connect(shMerge);
    shriek2.connect(shMerge);
    shMerge.connect(shShaper).connect(shBP).connect(sg).connect(master);
    shriek1.start(now);
    shriek2.start(now);
    shriek1.stop(now + 0.42);
    shriek2.stop(now + 0.42);

    // 4. Crunch — mid-band noise burst layered under.
    const n = actx.createBufferSource();
    n.buffer = noiseBuffer(actx, 0.25);
    const bp = actx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1700;
    bp.Q.value = 1.5;
    const ng = actx.createGain();
    ng.gain.setValueAtTime(0.55, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    n.connect(bp).connect(ng).connect(master);
    n.start(now);
    n.stop(now + 0.25);
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
      osc.type = "triangle";
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
    bp.type = "bandpass";
    bp.frequency.value = 2200 + v * 1600 + (Math.random() * 400 - 200);
    bp.Q.value = 1.5;
    const hp = actx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1500;
    const g = actx.createGain();
    const peak = 0.08 + v * 0.12;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
    n.connect(hp).connect(bp).connect(g).connect(master);
    n.start(now);
    n.stop(now + dur + 0.02);
  }

  // ----- Game state -----
  const STATE = {
    SAFE: "SAFE",
    TURNING: "TURNING",
    WATCHING: "WATCHING",
    BITING: "BITING",
    WON: "WON",
    IDLE: "IDLE",
  };

  function loadBest() {
    try {
      return Number(localStorage.getItem("tamebadger.best") || 0);
    } catch (e) {
      return 0;
    }
  }
  function saveBest(v) {
    try {
      localStorage.setItem("tamebadger.best", String(v));
    } catch (e) {}
  }

  // ------------------------------------------------------------------
  // Difficulty presets + live-tunable config
  // ------------------------------------------------------------------
  // Every gameplay-feel number that a designer might tune lives on `config`.
  // A preset (EASY / NORMAL / HARD / DEV) seeds `config`; localStorage knob
  // overrides layer on top. Call-sites read `config.FOO` every frame so
  // slider changes take effect instantly — no caching, no game restart.
  //
  // To add a new preset: spread from an existing one and override the keys
  // that should differ, then extend PRESET_ORDER. See README.
  const PRESET_ORDER = ["EASY", "NORMAL", "HARD", "DEV"];

  const DIFFICULTY_PRESETS = {
    // NORMAL = the default player experience. Formerly the "EASY" tuning:
    // forgiving ramp, modest goal, lax scoring. Becomes the new baseline
    // because shipping NORMAL tested too punishing for first-time players.
    NORMAL: {
      AFK_TIMEOUT_MS: 22000,
      AFK_WARN_MS: 5000,
      SCORE_COEFF: 0.032,
      BRUSH_DELTA_CAP: 22,
      COHERENCE_MIN: 0.5,
      WIN_SCORE_MIN: 180,
      WIN_SCORE_MAX: 300,
      SAFE_COMPRESS: 0.35,
      TURN_COMPRESS: 0.35,
      BITING_HOLD_MS: 1800,
      GLANCE_PROB: 0.25,
      SAFE_ARCHETYPES: [
        { cumW: 0.15, base: 1000, rand: 500  },
        { cumW: 0.70, base: 1800, rand: 1400 },
        { cumW: 1.00, base: 3400, rand: 1800 },
      ],
      WATCHING_ARCHETYPES: [
        { cumW: 0.30, base: 500,  rand: 300 },
        { cumW: 0.90, base: 1100, rand: 600 },
        { cumW: 1.00, base: 1900, rand: 700 },
      ],
      // Group B: per-knob-only. Same for every preset, editable via sliders.
      COMB_SIZE: 140,
      KICK_BITE: 1.5,
      FX_FLASH_MS: 280,
      FX_BLACK_DIV: 1780,
      FX_VIG_DIV: 420,
      FUR_BASE_COUNT: 3,
      JUMPSCARE_VOL: 0.9,
      _debug: false,
    },
  };
  // EASY — genuinely chill. For anyone who wants to vibe-brush without
  // worrying about danger. Score ramps fast, goal is tiny, safe windows
  // are long, danger compression is minimal, fewer fake-outs, stares are
  // short, bite hold is short. Even AFK leniency doubles up.
  DIFFICULTY_PRESETS.EASY = {
    ...DIFFICULTY_PRESETS.NORMAL,
    AFK_TIMEOUT_MS: 30000,
    SCORE_COEFF: 0.045,
    BRUSH_DELTA_CAP: 28,
    COHERENCE_MIN: 0.75,
    WIN_SCORE_MIN: 120,
    WIN_SCORE_MAX: 200,
    SAFE_COMPRESS: 0.2,
    TURN_COMPRESS: 0.2,
    BITING_HOLD_MS: 1500,
    GLANCE_PROB: 0.15,
    SAFE_ARCHETYPES: [
      { cumW: 0.10, base: 1400, rand: 600  },
      { cumW: 0.55, base: 2400, rand: 1600 },
      { cumW: 1.00, base: 4200, rand: 2000 },
    ],
    WATCHING_ARCHETYPES: [
      { cumW: 0.40, base: 450,  rand: 300 }, // lots of fake-outs
      { cumW: 0.90, base: 900,  rand: 500 }, // short real stares
      { cumW: 1.00, base: 1500, rand: 500 },
    ],
  };
  // HARD — formerly NORMAL (shipping tuning). The tight, punishing loop
  // that rewards brush discipline and reading the tell. Archetype rolls
  // weighted toward shorter safe windows and longer stares.
  DIFFICULTY_PRESETS.HARD = {
    ...DIFFICULTY_PRESETS.NORMAL,
    AFK_TIMEOUT_MS: 15000,
    SCORE_COEFF: 0.022,
    BRUSH_DELTA_CAP: 18,
    COHERENCE_MIN: 0.35,
    WIN_SCORE_MIN: 260,
    WIN_SCORE_MAX: 440,
    SAFE_COMPRESS: 0.55,
    TURN_COMPRESS: 0.6,
    BITING_HOLD_MS: 2400,
    GLANCE_PROB: 0.45,
    SAFE_ARCHETYPES: [
      { cumW: 0.25, base: 700,  rand: 500  },
      { cumW: 0.80, base: 1400, rand: 1200 },
      { cumW: 1.00, base: 2800, rand: 1600 },
    ],
    WATCHING_ARCHETYPES: [
      { cumW: 0.20, base: 350,  rand: 300 },
      { cumW: 0.85, base: 900,  rand: 700 },
      { cumW: 1.00, base: 1800, rand: 900 },
    ],
  };
  // Fast-iteration: EASY feel + huge AFK + tiny goal + _debug readout.
  DIFFICULTY_PRESETS.DEV = {
    ...DIFFICULTY_PRESETS.EASY,
    AFK_TIMEOUT_MS: 600000,
    WIN_SCORE_MAX: 60,
    WIN_SCORE_MIN: 30,
    _debug: true,
  };

  // Slider bounds for the debug panel. Only scalar numeric knobs listed;
  // SAFE_ARCHETYPES / WATCHING_ARCHETYPES render as a separate grid.
  const SLIDER_SPEC = {
    AFK_TIMEOUT_MS: { min: 3000, max: 600000, step: 500 },
    AFK_WARN_MS: { min: 1000, max: 20000, step: 250 },
    SCORE_COEFF: { min: 0.005, max: 0.08, step: 0.001 },
    BRUSH_DELTA_CAP: { min: 4, max: 40, step: 1 },
    COHERENCE_MIN: { min: 0, max: 1, step: 0.05 },
    WIN_SCORE_MIN: { min: 40, max: 800, step: 10 },
    WIN_SCORE_MAX: { min: 60, max: 1000, step: 10 },
    SAFE_COMPRESS: { min: 0, max: 1, step: 0.05 },
    TURN_COMPRESS: { min: 0, max: 1, step: 0.05 },
    BITING_HOLD_MS: { min: 400, max: 5000, step: 50 },
    GLANCE_PROB: { min: 0, max: 1, step: 0.05 },
    COMB_SIZE: { min: 40, max: 400, step: 2 },
    KICK_BITE: { min: 0, max: 3, step: 0.05 },
    FX_FLASH_MS: { min: 0, max: 1000, step: 20 },
    FX_BLACK_DIV: { min: 400, max: 4000, step: 20 },
    FX_VIG_DIV: { min: 100, max: 2000, step: 20 },
    FUR_BASE_COUNT: { min: 0, max: 12, step: 1 },
    JUMPSCARE_VOL: { min: 0, max: 1, step: 0.05 },
  };

  const LS_KEYS = {
    difficulty: "tamebadger.difficulty",
    knobs: "tamebadger.knobs",
    telemetry: "tamebadger.telemetry",
    telemetryFlag: "tamebadger.telemetry.enabled",
  };

  // `config` is a plain mutable object. Readers dereference every frame, so
  // in-place mutation by applyPreset / slider oninput is enough — no rebuild.
  const config = {};

  function deepCloneArchetypes(arr) {
    return arr.map((a) => ({ ...a }));
  }

  function applyPreset(name) {
    const preset = DIFFICULTY_PRESETS[name] || DIFFICULTY_PRESETS.NORMAL;
    // Copy every key; deep-copy the archetype arrays so panel edits don't
    // mutate the preset literal.
    for (const [k, v] of Object.entries(preset)) {
      config[k] =
        k === "SAFE_ARCHETYPES" || k === "WATCHING_ARCHETYPES"
          ? deepCloneArchetypes(v)
          : v;
    }
    config._presetName = name in DIFFICULTY_PRESETS ? name : "NORMAL";
  }

  function loadKnobOverrides() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEYS.knobs) || "{}") || {};
    } catch (e) {
      return {};
    }
  }

  function applyKnobOverrides() {
    const overrides = loadKnobOverrides();
    for (const [k, v] of Object.entries(overrides)) {
      if (k in config) config[k] = v;
    }
  }

  function parseRuntimeFlags() {
    const p = new URLSearchParams(location.search);
    const urlDiff = (p.get("difficulty") || "").toUpperCase();
    const difficulty =
      urlDiff in DIFFICULTY_PRESETS
        ? urlDiff
        : localStorage.getItem(LS_KEYS.difficulty) || "NORMAL";
    const telemetryEnabled =
      p.get("telemetry") === "1" ||
      localStorage.getItem(LS_KEYS.telemetryFlag) === "1";
    return { difficulty, telemetryEnabled };
  }

  const RUNTIME_FLAGS = parseRuntimeFlags();
  applyPreset(RUNTIME_FLAGS.difficulty);
  applyKnobOverrides();

  // ------------------------------------------------------------------
  // Player-facing difficulty picker (Settings menu in the start overlay).
  // DEV preset stays dev-only: still reachable via ?difficulty=DEV, but
  // hidden from the in-game picker so casual players don't stumble in.
  // ------------------------------------------------------------------
  const PLAYER_FACING_PRESETS = ['EASY', 'NORMAL', 'HARD'];

  function setDifficulty(name) {
    if (!(name in DIFFICULTY_PRESETS)) return;
    applyPreset(name);
    try { localStorage.setItem(LS_KEYS.difficulty, name); } catch (e) {}
    // Knob overrides are cleared on explicit difficulty change so the
    // picked preset reflects its authored feel, not a stale hand-tune.
    try { localStorage.removeItem(LS_KEYS.knobs); } catch (e) {}
    syncDifficultyUI();
  }

  function syncDifficultyUI() {
    const opts = document.querySelectorAll('#difficultyOptions .diff-opt');
    opts.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.preset === config._presetName);
      btn.setAttribute('aria-checked', btn.dataset.preset === config._presetName ? 'true' : 'false');
    });
  }

  function buildSettingsMenu() {
    const btn = document.getElementById('settingsBtn');
    const panel = document.getElementById('settingsPanel');
    const options = document.getElementById('difficultyOptions');
    if (!btn || !panel || !options) return;

    // Populate the picker buttons once. Skip DEV from the public UI.
    options.innerHTML = '';
    const startBtnEl = document.getElementById('startBtn');
    for (const name of PLAYER_FACING_PRESETS) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'diff-opt';
      opt.dataset.preset = name;
      opt.setAttribute('role', 'radio');
      opt.textContent = name.charAt(0) + name.slice(1).toLowerCase();
      // Clicking a difficulty applies the preset AND starts the run —
      // players expect picking difficulty to be the terminal action.
      opt.addEventListener('click', () => {
        setDifficulty(name);
        panel.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        if (startBtnEl) startBtnEl.click();
      });
      options.appendChild(opt);
    }
    syncDifficultyUI();

    btn.addEventListener('click', () => {
      const expanded = !panel.hidden;
      panel.hidden = expanded;
      btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildSettingsMenu);
  } else {
    buildSettingsMenu();
  }

  const game = {
    state: STATE.IDLE,
    stateTimer: 0,
    score: 0,
    best: loadBest(),
    running: false,
    shake: 0,
    freezeTimer: 0,
    flash: 0,
    scorePulse: 0,
    goalPulse: 0,
    statePulse: 0,
    dangerPulse: 0,
    brushGlow: 0,
    badgerKick: 0,
    bgShiftX: 0,
    bgShiftY: 0,
    ghostCooldown: 0,
    brushBurstCooldown: 0,
    afkTimer: 0,
    endReason: null, // 'bite' | 'afk' | 'win'
    winTarget: 0,
    // Fake glance — decorative mid-SAFE head twitch. Does NOT make the badger watching.
    glance: { active: false, at: 0, dur: 0, peak: 0 },
    // Smooth return to "facing away" when SAFE begins after a real watch.
    returnAnim: { active: false, t: 0, dur: 350, from: 0.9 },
    // Rolling stroke-direction memory for coherence scoring.
    strokeDirX: 0,
    strokeDirY: 0,
  };

  // Timing profile — unpredictable so players can't count seconds.
  // Mixes short/medium/long safe windows + fake-out quick glances.
  function getTimings(score) {
    const t = Math.min(1, score / 400);

    // Safe window: weighted roll over the configured archetypes (short /
    // medium / long). Preset controls the cumulative-weight boundaries +
    // base/rand per archetype. See DIFFICULTY_PRESETS.NORMAL.SAFE_ARCHETYPES.
    const roll = Math.random();
    let safeBase = 0;
    for (const a of config.SAFE_ARCHETYPES) {
      if (roll < a.cumW) {
        safeBase = a.base + Math.random() * a.rand;
        break;
      }
    }
    // Compress with score: up to SAFE_COMPRESS×100% reduction at max difficulty.
    const safe = Math.max(450, safeBase * (1 - config.SAFE_COMPRESS * t));

    // Turning wind-up — the visible tell. Variable; sometimes snap-quick.
    const turnBase = 220 + Math.random() * 360; // 220–580ms
    const turning = Math.max(100, turnBase * (1 - config.TURN_COMPRESS * t));

    // Watching: preset-configured fake-out / normal / long-stare archetypes.
    const stareRoll = Math.random();
    let watching = 0;
    for (const a of config.WATCHING_ARCHETYPES) {
      if (stareRoll < a.cumW) {
        watching = a.base + Math.random() * a.rand;
        break;
      }
    }

    return { safe, turning, watching };
  }

  let nextTimings = getTimings(0);

  function setState(s) {
    const prev = game.state;
    game.state = s;
    game.stateTimer = 0;
    game.statePulse = Math.max(game.statePulse, 0.45);
    if (s === STATE.SAFE) {
      nextTimings = getTimings(game.score);
      scheduleGlance(nextTimings.safe);
      game.goalPulse = Math.max(game.goalPulse, 0.14);
      // If coming back from a real look, animate the head swinging away.
      if (prev === STATE.WATCHING || prev === STATE.TURNING) {
        game.returnAnim.active = true;
        game.returnAnim.t = 0;
        game.returnAnim.dur = 280 + Math.random() * 160;
        game.returnAnim.from = 0.9;
        kickShake(0.14);
      }
    }
    if (s === STATE.TURNING) {
      playHiss();
      game.dangerPulse = Math.max(game.dangerPulse, 0.45);
      game.badgerKick = Math.max(game.badgerKick, 0.14);
      kickShake(0.18);
    }
    if (s === STATE.WATCHING) {
      playSnarl();
      game.dangerPulse = 1;
      game.flash = Math.max(game.flash, 0.16);
      kickShake(0.26);
      const b = badger();
      spawnImpactBurst(b.cx + b.bodyRx * 0.38, b.cy - b.bodyRy * 0.08, "watch");
    }
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
    x: 0,
    y: 0,
    lastX: 0,
    lastY: 0,
    brushDelta: 0, // pixels moved this frame while held
    moveVX: 0,
    moveVY: 0, // smoothed recent movement for comb rotation
  };

  function canvasPos(e) {
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches && e.touches[0];
    const cx = touch ? touch.clientX : e.clientX;
    const cy = touch ? touch.clientY : e.clientY;
    return {
      x: cx - rect.left,
      y: cy - rect.top,
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

  canvas.addEventListener("mousedown", onDown);
  canvas.addEventListener("mouseenter", () => {
    input.onCanvas = true;
  });
  canvas.addEventListener("mouseleave", () => {
    input.onCanvas = false;
  });
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  canvas.addEventListener(
    "touchstart",
    (e) => {
      input.onCanvas = true;
      onDown(e);
    },
    { passive: false },
  );
  window.addEventListener("touchmove", onMove, { passive: false });
  window.addEventListener("touchend", (e) => {
    onUp(e);
    input.onCanvas = false;
  });
  window.addEventListener("touchcancel", (e) => {
    onUp(e);
    input.onCanvas = false;
  });

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
    if (nx * nx + ny * ny <= 1.28) return true;
    // Give the sprite art a more forgiving front-half hit region.
    const hx = b.cx + b.bodyRx * 0.7;
    const hy = b.cy - b.bodyRy * 0.22;
    if (Math.hypot(x - hx, y - hy) <= b.headR * 1.35) return true;
    const shoulderX = b.cx + b.bodyRx * 0.25;
    const shoulderY = b.cy - b.bodyRy * 0.1;
    return Math.hypot(x - shoulderX, y - shoulderY) <= b.headR * 1.1;
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

  function update(rawDt) {
    const sec = rawDt / 1000;
    const { w, h } = logical();
    const brushSpeed = Math.hypot(input.moveVX, input.moveVY);
    const pointerX = input.onCanvas ? (input.x - w / 2) / w : 0;
    const pointerY = input.onCanvas ? (input.y - h * 0.58) / h : 0;

    updateTransientLists(rawDt);

    if (game.freezeTimer > 0)
      game.freezeTimer = Math.max(0, game.freezeTimer - rawDt);
    if (game.ghostCooldown > 0) game.ghostCooldown -= rawDt;
    if (game.brushBurstCooldown > 0) game.brushBurstCooldown -= rawDt;

    game.flash = Math.max(0, game.flash - sec * 2.8);
    game.scorePulse = Math.max(0, game.scorePulse - sec * 4.4);
    game.goalPulse = Math.max(0, game.goalPulse - sec * 2.6);
    game.statePulse = Math.max(0, game.statePulse - sec * 2.4);
    game.brushGlow = Math.max(0, game.brushGlow - sec * 3.6);
    game.badgerKick = Math.max(0, game.badgerKick - sec * 3.2);

    const dangerTarget =
      game.state === STATE.WATCHING
        ? 1
        : game.state === STATE.TURNING
          ? 0.46
          : 0;
    game.dangerPulse = lerp(
      game.dangerPulse,
      dangerTarget,
      clamp(sec * 7.5, 0, 1),
    );
    game.bgShiftX = lerp(game.bgShiftX, pointerX * 26, clamp(sec * 4.2, 0, 1));
    game.bgShiftY = lerp(
      game.bgShiftY,
      pointerY * 16 - game.dangerPulse * 6,
      clamp(sec * 4.2, 0, 1),
    );

    if (input.onCanvas && brushSpeed > 1.2 && game.ghostCooldown <= 0) {
      const angle = Math.max(-0.6, Math.min(0.6, input.moveVX * 0.04));
      const strength = clamp(brushSpeed / 14, 0, 1);
      pushCombGhost(input.x, input.y, angle, 140 + strength * 21, strength);
      game.ghostCooldown = input.down ? 18 : 34;
    }

    updateHudFeel();

    if (!game.running) {
      input.brushDelta = 0;
      stateEl.textContent = "";
      return;
    }

    const dt = game.freezeTimer > 0 ? 0 : rawDt;
    game.stateTimer += dt;
    if (game.returnAnim.active) game.returnAnim.t += dt;

    // Brushing detection: only count strokes while pointer held, moving, and on the body.
    const brushing =
      input.down && input.brushDelta > 0.5 && overBody(input.x, input.y);

    // Effective brush amount: capped per-frame + weighted by stroke coherence.
    // Coherence is how aligned current motion is with recent motion — rewards steady
    // strokes, penalizes rapid back-and-forth wiggle spam.
    let effectiveBrush = 0;
    if (brushing) {
      const capped = Math.min(input.brushDelta, config.BRUSH_DELTA_CAP);
      const dx = input.x - input.lastX;
      const dy = input.y - input.lastY;
      const mag = Math.hypot(dx, dy);
      let coherence = 1;
      if (mag > 0.1) {
        const nx = dx / mag,
          ny = dy / mag;
        const prevMag = Math.hypot(game.strokeDirX, game.strokeDirY);
        if (prevMag > 0.01) {
          const pdx = game.strokeDirX / prevMag,
            pdy = game.strokeDirY / prevMag;
          // dot product: 1 = same direction, -1 = reversal
          const dot = nx * pdx + ny * pdy;
          coherence = Math.max(config.COHERENCE_MIN, (dot + 1) / 2); // map [-1,1] -> [0,1]
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

    if (brushing) {
      const brushFeel = clamp((effectiveBrush + brushSpeed) / 24, 0, 1);
      game.brushGlow = Math.min(1.25, game.brushGlow + brushFeel * 0.42);
      game.badgerKick = Math.min(1, game.badgerKick + brushFeel * 0.34);
      if (game.brushBurstCooldown <= 0) {
        spawnBrushBurst(input.x, input.y + 8, brushFeel);
        game.brushBurstCooldown = 18 + (1 - brushFeel) * 38;
      }
    }

    // AFK watchdog: any active frame without real stroking increments the timer.
    // Real strokes reset it. BITING / WON states excluded (run already ending).
    if (game.state !== STATE.BITING && game.state !== STATE.WON) {
      if (brushing) {
        game.afkTimer = 0;
      } else {
        game.afkTimer += dt;
        if (game.afkTimer >= config.AFK_TIMEOUT_MS) {
          endRun("afk");
          return;
        }
      }
    }

    // TB2 fork: score is monotonically non-decreasing. No passive decay.
    // Stalling is still discouraged by the AFK watchdog (15s no-brush → run ends).

    switch (game.state) {
      case STATE.SAFE: {
        const gain = brushing ? effectiveBrush * config.SCORE_COEFF : 0;
        game.score = game.score + gain;
        scoreEl.textContent = Math.floor(game.score);
        if (gain > 0) {
          game.scorePulse = Math.min(
            1.3,
            game.scorePulse + clamp(gain * 0.16, 0.05, 0.22),
          );
          game.goalPulse = Math.min(
            0.8,
            game.goalPulse + clamp(gain * 0.07, 0.02, 0.08),
          );
        }
        if (game.score >= game.winTarget) {
          winRun();
          break;
        }
        if (game.stateTimer >= nextTimings.safe) setState(STATE.TURNING);
        break;
      }
      case STATE.TURNING: {
        // Brushing during the wind-up is still valid and risky-but-safe.
        const gain = brushing ? effectiveBrush * config.SCORE_COEFF : 0;
        game.score = Math.max(0, game.score + gain);
        scoreEl.textContent = Math.floor(game.score);
        if (gain > 0) {
          game.scorePulse = Math.min(
            1.2,
            game.scorePulse + clamp(gain * 0.14, 0.04, 0.18),
          );
          game.goalPulse = Math.min(
            0.7,
            game.goalPulse + clamp(gain * 0.06, 0.02, 0.07),
          );
        }
        if (game.score >= game.winTarget) {
          winRun();
          break;
        }
        if (game.stateTimer >= nextTimings.turning) setState(STATE.WATCHING);
        break;
      }
      case STATE.WATCHING:
        // Freezing here is the CORRECT move — score is held steady.
        if (brushing) {
          bite();
          break;
        }
        if (game.stateTimer >= nextTimings.watching) setState(STATE.SAFE);
        break;
      case STATE.BITING:
        if (game.stateTimer >= 2400) endRun();
        break;
      case STATE.WON:
        // Brief celebration pause before the overlay.
        if (game.stateTimer >= 1400) endRun();
        break;
    }

    const progress =
      game.winTarget > 0 ? clamp(game.score / game.winTarget, 0, 1) : 0;
    if (progress > 0.72) {
      game.goalPulse = Math.max(game.goalPulse, (progress - 0.72) * 0.7);
    }

    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 0.02);
    input.brushDelta = 0;
    stateEl.textContent = game.state;
  }

  function bite() {
    setState(STATE.BITING);
    kickShake(1.5);
    triggerFreeze(70);
    game.flash = 0.8;
    game.statePulse = 1;
    game.endReason = "bite";
    const b = badger();
    spawnImpactBurst(b.cx + b.bodyRx * 0.42, b.cy - b.bodyRy * 0.12, "bite");
    playBite();
    playJumpscareSfx();
  }

  function winRun() {
    if (game.state === STATE.WON) return;
    setState(STATE.WON);
    game.endReason = "win";
    kickShake(0.55);
    triggerFreeze(55);
    game.flash = 0.45;
    game.scorePulse = 1;
    game.goalPulse = 0.9;
    spawnImpactBurst(
      input.onCanvas ? input.x : badger().cx,
      input.onCanvas ? input.y : badger().cy - 20,
      "win",
    );
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
    if (game.endReason === "win") {
      overTitle.textContent = "Tamed!";
      overSub.textContent = `The badger trusts you.  Score: ${finalScore}  •  Best: ${game.best}`;
    } else if (game.endReason === "afk") {
      overTitle.textContent = "Badger got bored";
      overSub.textContent = `No brushing for 15s.  Score: ${finalScore}  •  Best: ${game.best}`;
    } else {
      overTitle.textContent = "You messed with baMauled!";
      overSub.textContent = `Score: ${finalScore}  •  Best: ${game.best}`;
    }
    startBtn.textContent = "Try Again";
    overlay.classList.add("show");
    overlay.classList.toggle("bitten", game.endReason === "bite");
    stateEl.textContent = "";
  }

  function startRun() {
    const a = initAudio();
    if (a && a.actx.state === "suspended") a.actx.resume();
    game.score = 0;
    game.afkTimer = 0;
    game.endReason = null;
    game.winTarget =
      config.WIN_SCORE_MIN +
      Math.random() * (config.WIN_SCORE_MAX - config.WIN_SCORE_MIN);
    game.strokeDirX = 0;
    game.strokeDirY = 0;
    scoreEl.textContent = "0";
    goalEl.textContent = String(Math.ceil(game.winTarget));
    bestEl.textContent = game.best;
    game.freezeTimer = 0;
    game.flash = 0;
    game.scorePulse = 0.3;
    game.goalPulse = 0.35;
    game.statePulse = 0.45;
    game.dangerPulse = 0;
    game.brushGlow = 0;
    game.badgerKick = 0;
    particles.length = 0;
    combGhosts.length = 0;
    game.running = true;
    overlay.classList.remove("show", "bitten");
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
    ctx.fillStyle = "#7a6440"; // dusty savanna
    ctx.fillRect(0, 0, w, h);
    if (
      !drawSprite(
        "background",
        w / 2 + game.bgShiftX,
        h / 2 + game.bgShiftY,
        w * 1.08,
      )
    ) {
      // No photo — draw the placeholder scene instead.
      ctx.fillStyle = "#2a3d2a";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#4a3a28";
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.78, w * 0.42, h * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    drawBadger();
    drawParticles();
    if (game.flash > 0.01) {
      ctx.save();
      ctx.fillStyle = `rgba(255, ${Math.round(212 - game.flash * 60)}, ${Math.round(170 - game.flash * 110)}, ${game.flash * 0.18})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
    ctx.restore();

    drawComb();
    drawAfkWarning();
  }

  function drawAfkWarning() {
    if (!game.running || game.state === STATE.BITING) return;
    const remaining = config.AFK_TIMEOUT_MS - game.afkTimer;
    if (remaining > config.AFK_WARN_MS) return;
    const { w, h } = logical();
    const secs = Math.max(0, remaining / 1000);
    // Pulse faster as it nears zero.
    const pulse =
      0.5 + 0.5 * Math.sin(performance.now() * (0.006 + (1 - secs / 5) * 0.02));
    ctx.save();
    ctx.globalAlpha = 0.75 + pulse * 0.25;
    ctx.fillStyle = secs < 2 ? "#e23" : "#e8b34a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 22px -apple-system, Segoe UI, Roboto, sans-serif";
    ctx.fillText(`Keep brushing! ${secs.toFixed(1)}s`, w / 2, h * 0.12);
    ctx.restore();
  }

  function drawComb() {
    if (!input.onCanvas) return;
    const x = input.x,
      y = input.y;
    const speed = Math.hypot(input.moveVX, input.moveVY);
    const tilt = Math.max(-0.6, Math.min(0.6, input.moveVX * 0.04));
    const angle = tilt + (input.down ? input.moveVY * 0.008 : 0);
    const scaleX = 1 + clamp(speed / 42, 0, 0.22) + game.brushGlow * 0.05;
    const scaleY = (input.down ? 0.92 : 1) + game.brushGlow * 0.03;

    for (const ghost of combGhosts) {
      const alpha = clamp(ghost.life / ghost.maxLife, 0, 1) * 0.2;
      drawSprite(
        "comb",
        ghost.x,
        ghost.y,
        ghost.size,
        ghost.angle,
        true,
        ghost.scale,
        ghost.scale,
        alpha,
      );
    }

    if (game.brushGlow > 0.04) {
      ctx.save();
      const glow = 22 + game.brushGlow * 32;
      const grad = ctx.createRadialGradient(x, y, 6, x, y, glow);
      grad.addColorStop(
        0,
        `rgba(255, 226, 170, ${0.16 + game.brushGlow * 0.1})`,
      );
      grad.addColorStop(1, "rgba(255, 226, 170, 0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, glow, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (drawSprite("comb", x, y, 140, angle, true, scaleX, scaleY)) {
      return;
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    const combW = 64,
      combH = 14;
    const bristleLen = 10;

    // Handle
    ctx.fillStyle = "#7a4a1e";
    roundRect(ctx, -combW / 2, -combH / 2, combW, combH, 4);
    ctx.fill();
    // Handle highlight
    ctx.fillStyle = "#a76a36";
    roundRect(ctx, -combW / 2 + 3, -combH / 2 + 2, combW - 6, 3, 2);
    ctx.fill();

    // Bristles
    ctx.fillStyle = "#e0d9c0";
    ctx.strokeStyle = "#3d2a14";
    ctx.lineWidth = 1;
    const count = 14;
    const pad = 4;
    const usable = combW - pad * 2;
    for (let i = 0; i < count; i++) {
      const bx = -combW / 2 + pad + (usable / (count - 1)) * i;
      ctx.beginPath();
      ctx.moveTo(bx - 1, combH / 2);
      ctx.lineTo(bx - 1, combH / 2 + bristleLen);
      ctx.lineTo(bx + 1, combH / 2 + bristleLen);
      ctx.lineTo(bx + 1, combH / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // If actively brushing, show motion lines from the bristles.
    if (input.down) {
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const bx = -combW / 2 + 8 + (combW - 16) * (i / 2);
        ctx.beginPath();
        ctx.moveTo(bx, combH / 2 + bristleLen + 2);
        ctx.lineTo(bx, combH / 2 + bristleLen + 8);
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
      const now = performance.now() * 0.001;
      const biteT =
        state === STATE.BITING ? Math.min(1, game.stateTimer / 400) : 0;
      const turnT =
        state === STATE.TURNING
          ? Math.min(1, game.stateTimer / Math.max(1, nextTimings.turning))
          : 0;
      const breathe =
        state === STATE.SAFE
          ? Math.sin(now * 3.4) * 4
          : state === STATE.WATCHING
            ? Math.sin(now * 7.8) * 2.6
            : 0;
      let spriteW =
        b.bodyRx *
        (state === STATE.BITING
          ? 2.46
          : state === STATE.WATCHING
            ? 2.56
            : state === STATE.TURNING
              ? 2.7
              : 2.78);
      spriteW *= 1 + biteT * 0.04 + game.badgerKick * 0.04;
      let spriteX = b.cx;
      let spriteY = b.cy + b.bodyRy * 1.08 + breathe + game.badgerKick * 5;
      let rotation = -game.badgerKick * 0.035;
      let scaleX = 1 + game.badgerKick * 0.045;
      let scaleY = 1 - game.badgerKick * 0.03;
      let spriteSlot = "body";
      if (state === STATE.TURNING) spriteSlot = "head_turning";
      else if (state === STATE.WATCHING) spriteSlot = "head_watching";
      else if (state === STATE.BITING)
        spriteSlot = biteT < 0.55 ? "head_biting" : "head_jumpscare";

      if (state === STATE.TURNING) {
        spriteX += turnT * 6;
        spriteY += turnT * 2;
        rotation += turnT * 0.045;
        scaleX += turnT * 0.02;
      } else if (state === STATE.WATCHING) {
        spriteX += 2;
        spriteY += 8;
        rotation += Math.sin(now * 9.5) * 0.009;
        scaleY += Math.sin(now * 9.5) * 0.012;
      } else if (state === STATE.BITING) {
        spriteX += 6 * biteT;
        spriteY += 2 - biteT * 4;
        rotation -= 0.04 + biteT * 0.025;
        scaleX += biteT * 0.035;
        scaleY -= biteT * 0.025;
      } else if (state === STATE.WON) {
        spriteY -= Math.sin(Math.min(1, game.stateTimer / 700) * Math.PI) * 10;
        rotation += Math.sin(now * 12) * 0.02;
        scaleX += 0.04;
        scaleY += 0.03;
      }

      ctx.save();
      ctx.globalAlpha = 0.18 + game.dangerPulse * 0.08;
      ctx.fillStyle = "#1a0f08";
      ctx.beginPath();
      ctx.ellipse(
        spriteX,
        b.cy + b.bodyRy * 1.1,
        spriteW * 0.28,
        b.bodyRy * (0.34 - biteT * 0.08),
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();

      drawSprite(
        spriteSlot,
        spriteX,
        spriteY,
        spriteW,
        rotation,
        false,
        scaleX,
        scaleY,
      );

      // State tint overlays
      const { w, h } = logical();
      if (state === STATE.TURNING) {
        ctx.save();
        ctx.fillStyle = `rgba(255, 206, 120, ${0.05 + turnT * 0.06})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      if (state === STATE.WATCHING) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.012);
        ctx.save();
        ctx.fillStyle = `rgba(226, 50, 50, ${0.12 + pulse * 0.1})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      } else if (state === STATE.BITING) {
        ctx.save();
        // 1) Short red "damage" flash at the moment of contact (0-280ms).
        const flashT = Math.max(0, 1 - game.stateTimer / 280);
        if (flashT > 0) {
          ctx.fillStyle = `rgba(220, 30, 30, ${0.55 * flashT})`;
          ctx.fillRect(0, 0, w, h);
        }
        // 2) Slow fade to full black (320ms → ~2100ms). Canvas is basically
        //    black by the time endRun() fires at 2400ms and reveals the overlay.
        const blackT = clamp((game.stateTimer - 320) / 1780, 0, 1);
        if (blackT > 0) {
          ctx.fillStyle = `rgba(0, 0, 0, ${blackT})`;
          ctx.fillRect(0, 0, w, h);
        }
        // 3) Red edge vignette — drawn LAST so it stays visible through the
        //    black fade, giving the screen a "wounded" glow that persists.
        const vigT = clamp(game.stateTimer / 420, 0, 1);
        const vignette = ctx.createRadialGradient(
          w / 2,
          h / 2,
          Math.min(w, h) * 0.22,
          w / 2,
          h / 2,
          Math.max(w, h) * 0.72,
        );
        vignette.addColorStop(0, "rgba(180, 20, 20, 0)");
        vignette.addColorStop(0.55, `rgba(180, 20, 20, ${0.2 * vigT})`);
        vignette.addColorStop(1, `rgba(220, 40, 40, ${0.72 * vigT})`);
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      } else if (state === STATE.WON) {
        const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.015);
        ctx.save();
        ctx.fillStyle = `rgba(255, 221, 120, ${0.1 + pulse * 0.08})`;
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
      if (
        gl.active &&
        game.stateTimer >= gl.at &&
        game.stateTimer <= gl.at + gl.dur
      ) {
        const gt = (game.stateTimer - gl.at) / gl.dur;
        const shape = Math.sin(gt * Math.PI);
        headSide = -1 + shape * (gl.peak + 1);
        headOffsetY = -b.bodyRy * (0.25 + shape * 0.12);
      }
    }

    // Body shape
    {
      ctx.save();
      ctx.fillStyle = "#1a1a1a";
      ctx.beginPath();
      ctx.ellipse(b.cx, b.cy, b.bodyRx, b.bodyRy, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#c8c2b0";
      ctx.beginPath();
      ctx.ellipse(
        b.cx,
        b.cy - b.bodyRy * 0.45,
        b.bodyRx * 0.92,
        b.bodyRy * 0.55,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.strokeStyle = "#0d0d0d";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(
        b.cx,
        b.cy - b.bodyRy * 0.15,
        b.bodyRx * 0.98,
        b.bodyRy * 0.55,
        0,
        Math.PI,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.restore();
    }

    // Head shape
    const hx = b.cx + headSide * b.bodyRx * 0.75;
    const hy = b.cy + headOffsetY;
    ctx.save();
    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(hx, hy, b.headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#c8c2b0";
    ctx.beginPath();
    ctx.arc(hx, hy - b.headR * 0.3, b.headR * 0.85, Math.PI, 0);
    ctx.fill();

    if (headSide > 0.3) {
      const eyeOffset = b.headR * 0.35;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(hx - eyeOffset, hy, b.headR * 0.18, 0, Math.PI * 2);
      ctx.arc(hx + eyeOffset, hy, b.headR * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = state === STATE.BITING ? "#e23" : "#000";
      ctx.beginPath();
      ctx.arc(hx - eyeOffset, hy, b.headR * 0.09, 0, Math.PI * 2);
      ctx.arc(hx + eyeOffset, hy, b.headR * 0.09, 0, Math.PI * 2);
      ctx.fill();
      if (state === STATE.WATCHING || state === STATE.BITING) {
        ctx.fillStyle = "#fff";
        const mouthY = hy + b.headR * 0.45;
        const mw = b.headR * 0.5;
        const mh = state === STATE.BITING ? b.headR * 0.35 : b.headR * 0.18;
        ctx.fillRect(hx - mw / 2, mouthY, mw, mh);
        ctx.beginPath();
        ctx.moveTo(hx - mw / 2 + 4, mouthY);
        ctx.lineTo(hx - mw / 2 + 8, mouthY + mh);
        ctx.lineTo(hx - mw / 2 + 12, mouthY);
        ctx.moveTo(hx + mw / 2 - 4, mouthY);
        ctx.lineTo(hx + mw / 2 - 8, mouthY + mh);
        ctx.lineTo(hx + mw / 2 - 12, mouthY);
        ctx.fillStyle = "#fff";
        ctx.fill();
      }
    } else {
      ctx.fillStyle = "#0d0d0d";
      ctx.beginPath();
      ctx.arc(
        hx - b.headR * 0.4,
        hy - b.headR * 0.7,
        b.headR * 0.15,
        0,
        Math.PI * 2,
      );
      ctx.arc(
        hx + b.headR * 0.4,
        hy - b.headR * 0.7,
        b.headR * 0.15,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.restore();

    // Tail shape
    ctx.save();
    ctx.strokeStyle = "#1a1a1a";
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(b.cx + b.bodyRx * 0.95, b.cy);
    ctx.quadraticCurveTo(
      b.cx + b.bodyRx * 1.2,
      b.cy - b.bodyRy * 0.3,
      b.cx + b.bodyRx * 1.3,
      b.cy + b.bodyRy * 0.1,
    );
    ctx.stroke();
    ctx.restore();

    // Danger indicator: red tint overlay when WATCHING
    if (state === STATE.WATCHING) {
      ctx.save();
      ctx.fillStyle = "rgba(226, 50, 50, 0.08)";
      const { w, h } = logical();
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  // ----- Start wiring -----
  loadSprites();
  overTitle.textContent = "Honey Badger Don't Brush";
  overSub.textContent = "Brush gently. Stop when he looks at you.";
  startBtn.addEventListener("click", startRun);
  bestEl.textContent = game.best;
  overlay.classList.add("show");

  requestAnimationFrame(frame);
})();
