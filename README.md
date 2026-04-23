# Honey Badger Don't Brush

Static HTML5 canvas game. No build step — `index.html` + `game.js` + `assets/`.

## Run locally

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Deploy (Vercel)

Pushed to `main` → Vercel auto-deploys as a static site. No build step, no serverless functions; Vercel just serves the repo files as-is.

**One-time setup (Vercel dashboard):**

1. New Project → Import the GitHub repo
2. Framework Preset: **Other**
3. Root Directory: `./` (the repo root)
4. Build Command: *(leave empty)*
5. Output Directory: *(leave empty)*
6. Install Command: *(leave empty)*
7. Deploy

Every subsequent push to `main` redeploys within ~15 s. Preview deployments fire for every branch + PR automatically.

**Config:** [vercel.json](vercel.json) at the repo root pins a couple of sensible defaults — longer cache on `/assets/*` (PNGs and audio rarely change), shorter revalidation window on `sdk.js` (we want quick updates when the Vibecade SDK rebuilds). HTML + `game.js` inherit Vercel's default short-cache + revalidate.

## Difficulty presets

All gameplay-feel numbers live on a single `config` object driven by a preset. The preset is resolved on load, in priority order:

1. `?difficulty=HARD` URL param
2. `localStorage['tamebadger.difficulty']`
3. `NORMAL` (default — matches current shipping behavior)

| Preset | Feel | Goal | Key knobs |
|---|---|---|---|
| `EASY` | Vibe-brushing | **120–200** | `SCORE_COEFF 0.045`, `BRUSH_DELTA_CAP 28`, `COHERENCE_MIN 0.75`, `SAFE_COMPRESS 0.2`, `TURN_COMPRESS 0.2`, `BITING_HOLD_MS 1500`, `GLANCE_PROB 0.15`, `AFK_TIMEOUT_MS 30s`. Safe windows 1.4–6.2 s, lots of fake-out glances, short real stares. |
| `NORMAL` | Default | **180–300** | `SCORE_COEFF 0.032`, `BRUSH_DELTA_CAP 22`, `COHERENCE_MIN 0.5`, `SAFE_COMPRESS 0.35`, `TURN_COMPRESS 0.35`, `BITING_HOLD_MS 1800`, `GLANCE_PROB 0.25`, `AFK_TIMEOUT_MS 22s`. Forgiving-but-engaged — first-time players should get through a run. |
| `HARD` | Shipping-tight | **260–440** | `SCORE_COEFF 0.022`, `BRUSH_DELTA_CAP 18`, `COHERENCE_MIN 0.35`, `SAFE_COMPRESS 0.55`, `TURN_COMPRESS 0.6`, `BITING_HOLD_MS 2400`, `GLANCE_PROB 0.45`, `AFK_TIMEOUT_MS 15s`. Former default. Rewards brush discipline and reading the tell. |
| `DEV` | Fast iteration | **30–60** | Spreads from `EASY` + `AFK_TIMEOUT_MS 10 min`, `_debug: true` (on-canvas state readout + verbose `console.debug` telemetry mirror). |

Difficulty cascade (2026-04-20): the shipping `NORMAL` became `HARD`, the old `EASY` became `NORMAL`, and a new even-more-forgiving `EASY` was added. First-run players now default to something closer to a chill-mode.

## Runtime toggles

| Trigger | Effect |
|---|---|
| `?difficulty=HARD` | Load with HARD preset. Valid values: `EASY` / `NORMAL` / `HARD` / `DEV`. |
| `?telemetry=1` | Enable telemetry for this session. Also settable via `localStorage['tamebadger.telemetry.enabled'] = '1'`. |
| `?debug=1` | Auto-open the debug panel on load (handy for shared playtest links). |
| backtick (`` ` ``) | Toggle debug panel. |
| `]` | Cycle preset forward: EASY → NORMAL → HARD → DEV → EASY. Clears knob overrides. |
| `[` | Reset all knob overrides to the current preset's values. |

Preset + knob choices persist to `localStorage` so a refresh keeps you on the same setup.

## Debug panel

Backtick opens a hidden DOM overlay anchored to the game frame. Header shows the active preset + **cycle / reset / export JSON** buttons. Body shows:

- Scalar sliders for every preset-driven and per-knob param (18 sliders — see `SLIDER_SPEC` in `game.js`).
- Archetype number-grids for `SAFE_ARCHETYPES` and `WATCHING_ARCHETYPES` (three rows × `cumW` / `base` / `rand`).

Every slider change:

1. Mutates `config` in place — **takes effect on the next frame** (no reload).
2. Persists a **diff** against the active preset to `localStorage['tamebadger.knobs']`. Only keys that differ are written, so `[` reset wipes cleanly.
3. Emits a `knob_changed` telemetry event.

## Playtest telemetry

Gated — does nothing unless `?telemetry=1` or the localStorage flag is set.

**Session record shape:**
```json
{
  "sessionId": "1738542xxx-a3f9bx",
  "startedAt": 1738542xxx,
  "difficulty": "NORMAL",
  "activeConfig": { /* structuredClone(config) at run_start */ },
  "events": [
    { "event_type": "run_start", "ts_ms": ..., "session_id": "...", "props": { "winTarget": 341 } }
  ],
  "outcome": "win" | "bite" | "afk" | null,
  "endedAt": ...
}
```

**Events recorded:**

| `event_type` | When | `props` |
|---|---|---|
| `run_start` | `startRun()` | `{ winTarget }` |
| `run_end` | `endRun(reason)` | `{ reason, score, duration_ms }` |
| `bite_triggered` | `bite()` | `{ score, stateTimer }` |
| `preset_changed` | `cyclePreset(...)` | `{ preset }` |
| `knob_changed` | slider `input` | `{ key, value }` |

**Storage:** ring buffer (max 20 sessions, 500 events/session) mirrored to `localStorage['tamebadger.telemetry']` on every `endSession` and on `visibilitychange → hidden`. Writes are skipped with a `console.warn` if the serialized buffer exceeds 2 MB.

**Export:** the "export JSON" button in the debug panel downloads the full buffer (plus the in-progress session, if any) as `tamebadger-telemetry-<ts>.json`.

**Swap for a backend:** gameplay code only calls `telemetry.send(event_type, props)`. Replace the body of `send` in `game.js` with:

```js
send(event_type, props = {}) {
  if (!this.enabled) return;
  fetch('/telemetry', {
    method: 'POST',
    body: JSON.stringify({ event_type, props, session_id: this.sessionId, ts_ms: Date.now() }),
  }).catch((e) => { this.emit(event_type, props); console.warn(e); });
},
```

No other call site changes.

## Adding a new difficulty preset

1. In `game.js`, inside `DIFFICULTY_PRESETS`, append a new key. Spread from an existing preset and override only what differs:

```js
EXTREME: {
  ...DIFFICULTY_PRESETS.HARD,
  SCORE_COEFF: 0.010,
  WIN_SCORE_MAX: 700,
  SAFE_COMPRESS: 0.85,
  BITING_HOLD_MS: 3200,
  GLANCE_PROB: 0.85,
  SAFE_ARCHETYPES: [
    { cumW: 0.40, base: 450,  rand: 300 },
    { cumW: 0.90, base: 900,  rand: 700 },
    { cumW: 1.00, base: 1600, rand: 900 },
  ],
},
```

2. Add the name to `PRESET_ORDER`:

```js
const PRESET_ORDER = ['EASY', 'NORMAL', 'HARD', 'DEV', 'EXTREME'];
```

That's the whole change — no call sites edit, no panel edit (sliders generate from `config` keys + `SLIDER_SPEC`). `]` will cycle through the new preset.

## Adding a new tuning parameter

1. Add the key to `DIFFICULTY_PRESETS.NORMAL` (and any other preset that should differ).
2. If you want it live-editable in the debug panel, add an entry to `SLIDER_SPEC` with `{ min, max, step }`. Archetype arrays render automatically if the key name matches `*_ARCHETYPES` and the shape is `[{ cumW, base, rand }, ...]`.
3. Replace the literal at the call site with `config.YOUR_KEY`.
4. If the value needs friendly formatting in the panel (e.g. ms or fixed-decimal), add a case to `formatKnobValue` in `game.js`.

## Vibecade backend (score tracking + telemetry)

[index.html](index.html) loads three scripts in order: the Supabase UMD bundle (via jsdelivr), a self-hosted `./sdk.js`, and an inline init block that exposes `window.vc` to the game. [game.js](game.js) fires `submitScore` on `endRun` and `trackEvent('run_start'|'run_end', ...)` in the matching flow points — all calls are `window.vc?.`-guarded so they silently skip if the SDK hasn't loaded (missing `sdk.js`, placeholder anon key, offline, whatever).

### Required one-time setup

**1. Build and drop in `sdk.js`.** Not yet published to npm/CDN — from the vibecade repo:

```bash
pnpm install
pnpm -F @vibecade/sdk build
cp packages/sdk/dist/sdk.js /path/to/honey-badger-dont-brush/sdk.js
```

Commit the artifact alongside `index.html`. Vercel serves it as-is on the next push.

**2. Paste the prod anon key** into `index.html`. Find `ANON_KEY = '<PASTE_PROD_ANON_KEY>'` and replace with the real value from:

- Vercel → Project → Settings → Environment Variables → `VITE_SUPABASE_ANON_KEY`, **or**
- Supabase → Dashboard → Project Settings → API → anon public key

Safe to commit — Supabase RLS + JWT are the real access control.

### Verify end-to-end

Open the game with `?vc_smoke=1` on the URL (e.g. `https://<your-vercel-project>.vercel.app/?vc_smoke=1`). The inline init block fires `trackEvent('smoke-test')`, `submitScore({score: 1})`, and `getLeaderboard({limit: 5})` once on page load. Console should show:

```
[vibecade] init ok; player = { ... }
[vibecade] smoke score submitted, rank = 1
[vibecade] leaderboard top-5 [ ... ]
```

Network tab: three `*.supabase.co` requests to `/auth/v1/signup`, `/functions/v1/submit-score`, `/functions/v1/track-events`, all 200.

Drop `?vc_smoke=1` afterward — regular play submits real scores on `endRun` without the leaderboard-polluting score-of-1 calls.

### Events emitted during normal play

| Event | Fires in | Props |
|---|---|---|
| `run_start` | `startRun()` after overlay dismiss | `{ skin, preset, winTarget }` |
| `run_end` | `endRun()` after any ending | `{ reason: 'bite'\|'afk', score, duration_ms, skin }` |
| `submitScore` | `endRun()` (not `trackEvent` — calls the `/submit-score` Edge Function) | `{ score }` |

### Rotating the API key

`pk_dev_honeybadger_a1b2c3d4e5f6g7h8` is a throwaway dev key committed inline. Before any competitive launch, rotate to a fresh random and inject at build time (or move the constant out of `index.html` into a non-committed config). Flip the row's `requires_play_token` flag to `true` at the same time to opt into `startPlay()` anti-cheat.
