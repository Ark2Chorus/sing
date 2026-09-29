
// ===========================================================================
// A recorded human voice, singing in the browser, with no render step.
//
// The formant singer next door synthesises a voice from oscillators and
// filters: tiny, instant, and audibly synthetic. This one plays back an actual
// person. It stitches recorded phoneme units together and re-pitches them to
// the score -- the same concatenative method the Python engine uses offline,
// and the same one UTAU and OpenUtau play in real time.
//
// WHY THIS CAN RUN IN A PAGE AT ALL. The bank as distributed is 459 MB, which
// obviously cannot ship. But the singer needs one sample set per pitch region,
// and a set is 588 seconds of audio -- about 4.6 MB once compressed. What
// makes it fast enough is that the expensive half of the algorithm is analysis
// (finding each recording's own pitch, then its glottal pulse instants), and
// that analysis describes the RECORDING, not the note. tools/make_voicepack.py
// does the pitch estimation once, offline. All that is left here is copying
// windowed grains, which costs a note about a millisecond.
//
// The catch is memory: decoding every recording would cost ~200 MB of
// Float32. So recordings are decoded on demand, and a score pre-warms the ones
// its own words need while the loading overlay is already up.
// ===========================================================================

// --------------------------------------------------------------- PSOLA ---

// Two-pole lowpass. Pitch marks are picked from the waveform's low band so
// that formant ripple does not pull a mark off the true glottal pulse.
function vbLowpass(x, sr, cutoff) {
  const out = new Float32Array(x.length);
  const c = Math.tan(Math.PI * Math.min(0.49, cutoff / sr));
  const a = 1 / (1 + Math.SQRT2 * c + c * c);
  const b1 = 2 * a * (c * c - 1);
  const b2 = a * (1 - Math.SQRT2 * c + c * c);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    const y = a * (v + 2 * x1 + x2) - b1 * y1 - b2 * y2;
    x2 = x1; x1 = v; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

// One mark per period, each on the local energy peak. Grains anchored to the
// waveform's own peaks line up in phase when they overlap; grains on a fixed
// grid partially cancel, which reads as a hollow, phasey tone rather than a
// voice.
function vbPitchMarks(x, sr, f0) {
  if (!(f0 > 20)) return new Int32Array(0);
  const low = vbLowpass(x, sr, 900);
  const period = sr / f0;
  const marks = [];
  let pos = 0;
  const n = x.length;
  while (pos < n - 2) {
    const lo = Math.max(0, Math.floor(pos - period / 3));
    const hi = Math.min(n, Math.floor(pos + period / 3) + 1);
    if (hi - lo < 3) break;
    let best = lo, bv = -Infinity;
    for (let i = lo; i < hi; i++) {
      if (low[i] > bv) { bv = low[i]; best = i; }
    }
    marks.push(best);
    pos = best + period;
  }
  return Int32Array.from(marks);
}

// The spacing between marks is the true period. Deriving it from the F0
// estimate instead inherits that estimator's bias, which in the Python engine
// landed every shift about 70 cents sharp. Marks sit on whole samples though,
// so consecutive spacings jitter by a sample; a running median removes that
// without smearing real pitch movement.
function vbLocalPeriod(marks) {
  const n = marks.length;
  if (n < 2) return Float32Array.from([200]);
  const d = new Float32Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = marks[i + 1] - marks[i];
  d[n - 1] = d[n - 2] || 200;
  const smooth = 5, pad = smooth >> 1;
  const out = new Float32Array(n);
  const w = new Float32Array(smooth);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < smooth; k++) {
      let j = i - pad + k;
      if (j < 0) j = -j;
      if (j >= n) j = n - 1 - (j - (n - 1));
      w[k] = d[Math.max(0, Math.min(n - 1, j))];
    }
    const s = Array.prototype.slice.call(w).sort((a, b) => a - b);
    out[i] = s[pad];
  }
  return out;
}

// Re-pitch and re-time, keeping the formants where they are. pitchRatio 2
// raises an octave; timeRatio 2 makes it twice as long. That the two are
// independent is the whole point -- a plain sampler can only trade one
// against the other, which is why a stretched sample sounds like a chipmunk.
// `mod`, if given, returns a pitch multiplier for a position through the
// output (0..1). Vibrato is not decoration: a note held at one exact frequency
// is the loudest signal that nobody is singing it. Real sustained notes move
// by 20-40 cents at 5-6 Hz, and the ear reads that motion as a person.
function vbPsola(x, sr, marks, pitchRatio, timeRatio, mod,
                 jitter, shimmer) {
  const outLen = Math.max(8, Math.round(x.length * timeRatio));
  if (marks.length < 3) return new Float32Array(outLen);

  const spacing = vbLocalPeriod(marks);
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  const first = marks[0], last = marks[marks.length - 1];

  // tIdeal advances exactly; tOut is where the grain actually lands. Jitter
  // has to be an offset from the ideal, never added to the step -- perturbing
  // the step makes the error a random walk, and a held note wanders off pitch
  // by the end of it.
  let tIdeal = first;
  let guard = 0;
  while (guard++ < 200000) {
    const tIn = (tIdeal - first) / timeRatio + first;
    if (tIn >= last) break;

    // Where to read from. Marching straight through is right at ordinary
    // stretch ratios, but a held note can ask for 17x, and then tIn crawls:
    // the same two or three periods are re-laid for two seconds and the vowel
    // freezes into a buzz. Past 3x, sweep back and forth across the unit
    // instead, so the timbre keeps moving the way a held vowel actually does.
    let readAt = tIn;
    if (timeRatio > 3 && last > first) {
      const span = last - first;
      const swept = (tIn - first) * Math.min(timeRatio, 8) / 3;
      const cycle = swept % (2 * span);
      readAt = first + (cycle <= span ? cycle : 2 * span - cycle);
    }
    let k = 1;
    while (k < marks.length - 2 && marks[k] < readAt) k++;
    const centre = marks[k];
    const half = Math.max(Math.round(spacing[k]), 8);

    const wobble = jitter ? (Math.random() * 2 - 1) * jitter * half * 2 : 0;
    const tOut = tIdeal + wobble;
    const gain = shimmer ? 1 + (Math.random() * 2 - 1) * shimmer : 1;

    const a0 = Math.max(0, centre - half);
    const a1 = Math.min(x.length, centre + half);
    if (a1 - a0 >= 4) {
      const len = a1 - a0;
      let o0 = Math.round(tOut) - (centre - a0);
      let g0 = 0;
      if (o0 < 0) { g0 = -o0; o0 = 0; }
      const count = Math.min(len - g0, outLen - o0);
      for (let i = 0; i < count; i++) {
        // Hann over the whole grain, not the copied slice, so a clipped grain
        // keeps its true taper instead of ending on a step
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (g0 + i) / len);
        out[o0 + i] += x[a0 + g0 + i] * w * gain;
        norm[o0 + i] += w;
      }
    }
    const r = mod ? pitchRatio * mod(tIdeal / outLen) : pitchRatio;
    tIdeal += spacing[k] / r;
  }

  for (let i = 0; i < outLen; i++) {
    out[i] = norm[i] < 0.2 ? out[i] : out[i] / norm[i];
  }
  return out;
}

// -------------------------------------------------------- pitch check ---
// A lightweight autocorrelation pitch reader, used only to verify what a
// rendered unit actually came out at -- not a general-purpose tracker, so
// it doesn't need to be fast for arbitrary input, just for a couple
// thousand samples at a time.
function vbMeasurePitch(buf, sr) {
  const SIZE = buf.length;
  if (SIZE < 256) return -1;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1; // silence/near-silence -- nothing to measure
  const minLag = Math.floor(sr / 800);
  const maxLag = Math.min(Math.floor(sr / 60), SIZE - 1);
  let bestLag = -1, bestCorr = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < SIZE - lag; i++) corr += buf[i] * buf[i + lag];
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  if (bestLag <= 0) return -1;
  return sr / bestLag;
}

// Nudges a buffer's pitch by resampling it, the same math a playback-rate
// change uses. ratio > 1 raises the pitch (and shortens the buffer
// slightly); ratio < 1 lowers it. Only meant for small corrections -- see
// the clamp where this is called.
function vbResampleRatio(x, ratio) {
  const outLen = Math.max(1, Math.round(x.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const i0 = Math.floor(srcPos);
    const frac = srcPos - i0;
    const s0 = i0 < x.length ? x[i0] : 0;
    const s1 = (i0 + 1) < x.length ? x[i0 + 1] : s0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}


// marks. PSOLA cannot touch it: it needs periods to re-lay, and an "s" or a
// "t" has none, so asking it to try returns silence. That single detail was
// deleting every unvoiced consonant in the language -- "praise" arrived as
// "ray", and the holes read as a gappy, stuttering singer.
//
// Overlapping grains at a fixed size is the right tool instead. Noise has no
// phase to preserve, so grain alignment does not matter here the way it does
// for a vowel.
function vbStretchUnvoiced(x, timeRatio) {
  const outLen = Math.max(8, Math.round(x.length * timeRatio));
  const out = new Float32Array(outLen);
  if (timeRatio <= 1.0) {
    out.set(x.subarray(0, outLen));
    return out;
  }
  const grain = Math.min(x.length, 1024);
  const hop = Math.max(1, Math.floor(grain / 2));
  const norm = new Float32Array(outLen);
  let inPos = 0;
  for (let o = 0; o < outLen; o += hop) {
    const n = Math.min(grain, outLen - o, x.length - Math.floor(inPos));
    if (n < 8) break;
    const base = Math.floor(inPos);
    for (let i = 0; i < n; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / grain);
      out[o + i] += x[base + i] * w;
      norm[o + i] += w;
    }
    inPos += hop / timeRatio;
    if (inPos + grain > x.length) inPos = Math.max(0, x.length - grain);
  }
  for (let i = 0; i < outLen; i++) if (norm[i] > 0.2) out[i] /= norm[i];
  return out;
}

// ------------------------------------------------------------ the pack ---

class VoicePackRuntime {
  constructor(data) {
    this.data = data;
    this.name = data.name;
    this.buffers = new Array(data.files.length).fill(null);
    this.pending = new Map();
    this.markCache = new Map();

    // (prev, cur) -> units, plus a by-phoneme fallback, mirroring the
    // lookup order the Python bank uses
    this.index = new Map();
    this.byCur = new Map();
    data.units.forEach((u, i) => {
      const key = u.p + ' ' + u.c;
      if (!this.index.has(key)) this.index.set(key, []);
      this.index.get(key).push(i);
      if (!this.byCur.has(u.c)) this.byCur.set(u.c, []);
      this.byCur.get(u.c).push(i);
    });
  }

  // Best unit for singing `cur` after `prev`. The exact diphone carries the
  // transition, which is where most of the intelligibility lives; failing
  // that, the unit that starts from silence at least has the right vowel, and
  // a wrong transition damages a word far less than a wrong vowel does.
  find(prev, cur, nearF0) {
    cur = (cur || '').toLowerCase();
    prev = (prev || '-').toLowerCase();
    let list = this.index.get(prev + ' ' + cur)
            || this.index.get('- ' + cur)
            || this.byCur.get(cur);
    if (!list || !list.length) return -1;
    if (!nearF0 || list.length === 1) return list[0];
    // several pitches of the same unit: take the one recorded closest to the
    // note, so the shift is small and the voice stays itself
    let best = list[0], bestD = Infinity;
    for (const i of list) {
      const f = this.data.files[this.data.units[i].f].f0 || 1;
      const d = Math.abs(Math.log2(nearF0 / f));
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // The unit lists find() would consider, in the order it considers them.
  candidates(prev, cur) {
    cur = (cur || '').toLowerCase();
    prev = (prev || '-').toLowerCase();
    const out = [];
    const exact = this.index.get(prev + ' ' + cur);
    if (exact) out.push(exact);
    const fromSil = this.index.get('- ' + cur);
    if (fromSil) out.push(fromSil);
    if (!out.length) {
      const any = this.byCur.get(cur);
      if (any) out.push(any);
    }
    return out;
  }

  async decodeFile(ctx, fileIndex) {
    if (this.buffers[fileIndex]) return this.buffers[fileIndex];
    if (this.pending.has(fileIndex)) return this.pending.get(fileIndex);
    const entry = this.data.files[fileIndex];
    const p = (async () => {
      const bin = atob(entry.audio);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const buf = await ctx.decodeAudioData(bytes.buffer);
      this.buffers[fileIndex] = buf;
      this.pending.delete(fileIndex);
      return buf;
    })();
    this.pending.set(fileIndex, p);
    return p;
  }

  // Samples of a unit's usable region. cutoff is negative for a length from
  // the offset and positive for a distance from the tail -- a genuinely
  // confusing convention, and the source of most bad UTAU renders.
  slice(unitIndex) {
    const u = this.data.units[unitIndex];
    const buf = this.buffers[u.f];
    if (!buf) return null;
    const sr = buf.sampleRate;
    const all = buf.getChannelData(0);
    const start = Math.max(0, Math.round(u.o * sr / 1000));
    const end = u.t < 0
      ? Math.min(all.length, start + Math.round(-u.t * sr / 1000))
      : Math.min(all.length, all.length - Math.round(u.t * sr / 1000));
    if (end - start < 64) return null;
    return { x: all.subarray(start, end), sr, f0: this.data.files[u.f].f0,
             consonant: Math.max(0, Math.round(u.k * sr / 1000)),
             pre: Math.round(u.r * sr / 1000),
             overlap: Math.max(0, Math.round(u.v * sr / 1000)) };
  }

  marks(unitIndex) {
    if (this.markCache.has(unitIndex)) return this.markCache.get(unitIndex);
    const s = this.slice(unitIndex);
    if (!s) return null;
    const m = vbPitchMarks(s.x, s.sr, s.f0);
    this.markCache.set(unitIndex, m);
    return m;
  }
}

let VOICEPACK_RUNTIME = null;
function voicePack() {
  if (!VOICEPACK_RUNTIME && typeof VOICEPACK !== 'undefined') {
    VOICEPACK_RUNTIME = new VoicePackRuntime(VOICEPACK);
  }
  return VOICEPACK_RUNTIME;
}

// Decode everything a set of phoneme pairs will need. Called while the score
// is loading and the overlay is already up, so the cost is invisible and
// playback never waits on a decode.
async function voicePackWarm(ctx, pairs, onProgress) {
  const pack = voicePack();
  if (!pack) return;
  const files = new Set();
  for (const [prev, cur] of pairs) {
    // EVERY candidate, not just the default one. At playback each note picks
    // the pitch recorded closest to it, which is usually a different file
    // from the one a pitchless lookup returns -- warm only that and most
    // notes find their recording still undecoded and drop out silently.
    for (const list of pack.candidates(prev, cur)) {
      for (const i of list) files.add(pack.data.units[i].f);
    }
  }
  let done = 0;
  for (const f of files) {
    await pack.decodeFile(ctx, f);
    if (onProgress) onProgress(++done, files.size);
  }
}

// -------------------------------------------------------------- a voice ---

// How a held note moves. Delayed onset because singers start straight and let
// vibrato in as the note settles; starting it immediately sounds like a wobble
// rather than a voice.
const VB_VIBRATO = { rate: 5.4, cents: 24, delay: 0.28, ramp: 0.35 };
const VB_XFADE = 0.035;          // seconds each unit shares with the next
                                  // (was 0.022 -- widened to give the join
                                  // a real equal-power taper instead of a
                                  // clipped one; short consonants are still
                                  // protected from over-fading by the
                                  // 1/3-of-unit-length cap in _unitAudio,
                                  // so this only lengthens the fade where
                                  // there's actually room for it. Revert to
                                  // 0.022 if this makes anything sound worse.

// Tone shaping on the way out. Measured against the publisher's recording of
// the same piece -- both full SATB-plus-piano mixes, so like for like -- this
// engine came out mid-heavy and short of air: 48% of its energy in 500-2000 Hz
// against 27%, and 7% above 5 kHz against 22%. That reads as muffled, boxy,
// and further from a real choir than the voice itself actually is.
//
// The bank is not the problem: JYOZE's own recordings carry plenty of top, and
// re-encoding them at 64k loses none of it (measured 39.2% against 38.9% in
// 2-5 kHz). The dulling happens in the grain overlap-add, which averages
// adjacent grains and so smears exactly the highest partials.
const VB_AIR_HZ = 4800;          // shelf frequency for the air that is lost
const VB_AIR_DB = 5.5;
const VB_BOX_HZ = 900;           // gentle scoop where the mix piles up
const VB_BOX_DB = -2.5;
const VB_GLIDE = 0.055;          // seconds to slide into a new pitch

// Jitter and shimmer: the cycle-to-cycle wobble every real larynx has and no
// algorithm does. PSOLA lays grains at exactly computed instants, so its
// output repeats more perfectly than any human can -- measured periodicity
// 0.977 against 0.85-0.93 for a real voice, and that mechanical regularity is
// most of what the ear calls synthetic. Putting the irregularity back is the
// cheapest way to close the gap.
//
// Real voices run about 0.5-1% jitter in period and 3-6% shimmer in
// amplitude; these sit inside that range. Larger values do not sound more
// human, they sound unwell.
// Slow pitch drift, which is the half that actually matters. Per-cycle
// jitter is a bounded offset around an exact grid, so autocorrelation still
// finds the grid and periodicity barely moves -- measured 0.999 to 0.990.
// A real larynx also wanders a few cents over tenths of a second, and that
// wander is what stops a held note correlating with itself. Three slow sines
// at unrelated rates give a wander with no audible period of its own.
const VB_DRIFT = { cents: 11, rates: [0.61, 1.37, 2.83] };
const VB_JITTER = 0.010;         // period wobble, as a fraction of a period
const VB_SHIMMER = 0.045;        // amplitude wobble, cycle to cycle
const VB_LEGATO_GAP = 0.09;      // notes closer than this belong to one line

// The vowels a melisma can be held on. A note whose only phoneme is one of
// these, following a note on the same one, is the same syllable still being
// sung -- not a new attack.
const VB_VOWELS = new Set(['AA','AE','AH','AO','AW','AY','EH','ER','EY',
                           'IH','IY','OW','OY','UH','UW']);

// The pitch a note follows, as a multiplier on its nominal ratio.
//
// Two things live here. A glide, because when one note runs into the next a
// singer slides rather than steps -- the step is what makes a sampler sound
// typed in. And vibrato, delayed, because singers start straight and let it in
// as the note settles.
//
// The glide is exponential, which is linear in cents, so it sounds even rather
// than rushing at one end.
// Two clocks, deliberately. The glide belongs to THIS note -- it happens in
// the first few tens of milliseconds after the pitch changes. The vibrato
// belongs to the SYLLABLE, and on a melisma the syllable runs across several
// notes; restarting its phase at each one makes a held vowel pulse in time
// with the noteheads, which is the opposite of legato. Sharing one clock
// forces a choice between the two, and neither answer is right.
function vbPitchEnvelope(fromFreq, toFreq, span, syllableAt) {
  const glideOK = fromFreq && toFreq && fromFreq > 20 && toFreq > 20
    && Math.abs(Math.log2(fromFreq / toFreq)) < 1.2;
  // fixed per note, so the drift is smooth rather than re-rolled per grain
  const ph = [Math.random() * 6.283, Math.random() * 6.283, Math.random() * 6.283];
  return (u) => {
    const tNote = u * span;                       // into this note
    const tSyll = (syllableAt || 0) + tNote;      // into the held syllable
    let mult = 1;
    if (glideOK && tNote < VB_GLIDE) {
      const g = Math.max(0, tNote) / VB_GLIDE;
      mult = Math.pow(fromFreq / toFreq, 1 - g);
    }
    let drift = 0;
    for (let i = 0; i < VB_DRIFT.rates.length; i++) {
      drift += Math.sin(2 * Math.PI * VB_DRIFT.rates[i] * tSyll + ph[i]);
    }
    mult *= Math.pow(2, (drift / VB_DRIFT.rates.length) * VB_DRIFT.cents / 1200);

    const on = Math.max(0, Math.min(1,
      (tSyll - VB_VIBRATO.delay) / VB_VIBRATO.ramp));
    if (on > 0) {
      const c = VB_VIBRATO.cents * on
        * Math.sin(2 * Math.PI * VB_VIBRATO.rate * tSyll);
      mult *= Math.pow(2, c / 1200);
    }
    return mult;
  };
}

class SampledSingerVoice {
  constructor(voiceType) {
    const ctx = Tone.getContext();
    this.ctx = ctx;

    // grains land on `in`, the mixer takes `out`, and the tone shaping sits
    // between them
    this.in = ctx.createGain();
    this.in.gain.value = 0.9;
    this.box = ctx.createBiquadFilter();
    this.box.type = 'peaking';
    this.box.frequency.value = VB_BOX_HZ;
    this.box.Q.value = 0.9;
    this.box.gain.value = VB_BOX_DB;
    this.air = ctx.createBiquadFilter();
    this.air.type = 'highshelf';
    this.air.frequency.value = VB_AIR_HZ;
    this.air.gain.value = VB_AIR_DB;
    this.out = ctx.createGain();
    this.in.connect(this.box);
    this.box.connect(this.air);
    this.air.connect(this.out);
    this.voiceType = voiceType || 'tenor';
    // Without this the scheduler drops the lyrics and every note is
    // sung as 'ah' -- convincingly, and completely wordlessly.
    this.wantsPhonemes = true;
    this.disposed = false;
    this.prevPh = null;
    this.lastNote = null;
    this.sources = [];
    // When true, _unitAudio still runs (and caches its result) but _play
    // skips actually scheduling audio. Used by prerenderRealVoice() to walk
    // a whole score ahead of playback and warm the cache without making
    // any sound or touching the transport.
    this._dry = false;
  }

  connect(dest) {
    const target = (dest && dest.input) ? dest.input : dest;
    try { this.out.connect(target); }
    catch (err) {
      console.error('SampledSingerVoice: could not connect to the mixer', err);
    }
    return this;
  }

  triggerAttackRelease(freq, dur, time, phones) {
    if (this.disposed) return this;
    const pack = voicePack();
    if (!pack) return this;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    time = Math.max(time, now + 0.002);
    dur = Math.max(0.05, dur);

    const list = (phones && phones.length) ? phones : ['AH'];
    const [onsets, nucleus, codas] =
      (typeof singerSplitPhones === 'function')
        ? singerSplitPhones(list)
        : [[], list[0], []];

    // Is this note the same syllable still being sung? A melisma arrives as a
    // run of notes each carrying only the held vowel. Re-attacking the vowel on
    // every one of them is the difference between a phrase and a list of notes.
    const prev = this.lastNote;
    const gap = prev ? time - prev.end : Infinity;
    const touching = prev && gap < VB_LEGATO_GAP && gap > -0.25;
    const continuing = touching && list.length === 1
      && VB_VOWELS.has(list[0]) && prev.nucleus === list[0];
    const fromFreq = touching ? prev.freq : 0;

    const syllableAt = continuing ? (prev.syllableAt + prev.dur) : 0;
    this.lastNote = { end: time + dur, freq, nucleus, syllableAt, dur };

    if (continuing) {
      // One unbroken vowel: no consonants, no attack, just the sustain moving
      // to the new pitch. It starts a crossfade early so it overlaps the note
      // still sounding rather than following a gap.
      this._play(this._unitAudio(nucleus, freq, dur, syllableAt,
                                 { fromFreq, noAttack: true }),
                 time - VB_XFADE);
      return this;
    }

    // Consonants are sung ahead of the beat so the vowel lands on it. That is
    // what singers do, and putting the consonant on the beat instead is the
    // single most obvious tell of a synthetic performance.
    const seq = [];
    let consTotal = 0;
    onsets.forEach(p => {
      const d = (typeof singerConsonantDur === 'function')
        ? singerConsonantDur(p) : 0.06;
      consTotal += d;
      seq.push({ ph: p, dur: d });
    });
    const codaTotal = codas.length * 0.07;
    seq.push({ ph: nucleus, dur: Math.max(0.08, dur - codaTotal) });
    codas.forEach(p => seq.push({ ph: p, dur: 0.07 }));

    // One scheduled source per unit. Rendering the whole syllable into a
    // single buffer and levelling its seams was tried and measured worse --
    // 1.4 dips a second became 3.4 -- because it moves the seam from between
    // phonemes to between notes, where nothing crossfades at all. _renderNote
    // is kept below for whoever picks this up next.
    let t = time - consTotal;
    let elapsed = 0;
    for (const step of seq) {
      const opts = {};
      if (step.ph === nucleus && fromFreq) opts.fromFreq = fromFreq;
      this._play(this._unitAudio(step.ph, freq, step.dur, elapsed, opts), t);
      t += step.dur;
      elapsed += step.dur;
    }
    return this;
  }

  // Render one unit and hand it back. Scheduling is the caller's job now,
  // because the units of a note have to be summed into one buffer before
  // any of them is played -- see _renderNote.
  //
  // Cached by (prevPh, ph, freq, dur, fromFreq, noAttack, sinceNoteStart):
  // the same diphone at the same pitch and duration produces the same
  // PSOLA render, so repeats (and a pre-render pass done before playback
  // starts) don't pay the resynthesis cost twice. This is what makes
  // pre-rendering actually speed up playback -- see prerenderRealVoice().
  _unitAudio(ph, freq, dur, sinceNoteStart, opts) {
    const pack = voicePack();
    const d = SampledSingerVoice.drops;
    d.calls++;
    const prevPh = this.prevPh;
    const fromFreq = opts && opts.fromFreq;
    const noAttack = !!(opts && opts.noAttack);
    const key = [prevPh || '', ph, freq.toFixed(4), dur.toFixed(4),
                 (fromFreq || 0).toFixed(4), noAttack ? 1 : 0,
                 (sinceNoteStart || 0).toFixed(4)].join('|');
    const cached = SampledSingerVoice._cache.get(key);
    if (cached) {
      this.prevPh = ph;
      d.played++;
      return cached;
    }

    const idx = pack.find(this.prevPh, ph, freq);
    this.prevPh = ph;
    if (idx < 0) { d.noUnit++; d.missing[ph] = (d.missing[ph] || 0) + 1; return; }

    const s = pack.slice(idx);
    if (!s) {
      // Not decoded yet -- the warm-up missed it, or the score changed under
      // us. Start the decode so the next note that wants this sound has it,
      // rather than dropping every occurrence for the rest of the piece.
      d.notDecoded++;
      pack.decodeFile(this.ctx, pack.data.units[idx].f).catch(() => {});
      return;
    }
    const ratio = Math.min(2.6, Math.max(0.4, freq / (s.f0 || freq)));

    // The attack plays at its natural speed and only the vowel after it
    // stretches. Stretching a consonant turns it to mush.
    // render the crossfade overlap on top of the note's own length, so the
    // extra belongs to the join rather than being stolen from the vowel
    const wantLen = Math.max(64, Math.round((dur + VB_XFADE) * s.sr));

    // Vibrato, positioned by where this unit sits inside the note so a long
    // vowel keeps one continuous sweep instead of restarting per unit.
    const noteAt = sinceNoteStart || 0;
    const span = wantLen / s.sr;
    const vib = vbPitchEnvelope(opts && opts.fromFreq, freq, span, noteAt);
    // A continued vowel takes only the sustain. Replaying the unit's attack
    // would put a fresh consonant burst in the middle of a held syllable.
    const cut = (opts && opts.noAttack)
      ? Math.min(s.consonant, s.x.length)
      : 0;
    const head = (opts && opts.noAttack)
      ? s.x.subarray(0, 0)
      : s.x.subarray(0, Math.min(s.consonant, s.x.length));
    const tail = s.x.subarray(Math.max(cut, Math.min(s.consonant, s.x.length)));
    // Voiced material is re-pitched; unvoiced material is passed through,
    // because it has no pitch to move and PSOLA returns silence for it.
    const pieces = [];
    if (head.length >= 64) {
      const hm = vbPitchMarks(head, s.sr, s.f0);
      pieces.push(hm.length >= 3
        ? vbPsola(head, s.sr, hm, ratio, 1)
        : Float32Array.from(head));
    }
    const headLen = pieces.reduce((a, p) => a + p.length, 0);
    const tailWant = Math.max(8, wantLen - headLen);
    if (tail.length >= 64) {
      const tm = vbPitchMarks(tail, s.sr, s.f0);
      // The sustain carries the wobble; the attack does not. A consonant is
      // too short for cycle-to-cycle variation to read as anything but noise,
      // and unvoiced material is already irregular by nature.
      pieces.push(tm.length >= 3
        ? vbPsola(tail, s.sr, tm, ratio, tailWant / tail.length, vib,
                  VB_JITTER, VB_SHIMMER)
        : vbStretchUnvoiced(tail, tailWant / tail.length));
    }
    if (!pieces.length) { d.tooShort++; return; }

    let total = pieces.reduce((a, p) => a + p.length, 0);
    let y = new Float32Array(total);
    let at = 0;
    for (const p of pieces) { y.set(p, at); at += p.length; }

    // Closed-loop pitch check: measure what the sustained portion of this
    // unit actually came out at and nudge it if it's off-target -- catches
    // drift whether the root cause is the recording's stored f0 or the
    // resample itself, rather than only trusting the computed ratio.
    // Skipped when there's no sustained region to measure (pure
    // consonants), and clamped to a modest range so a bad reading (e.g. an
    // octave-off measurement on noisy material) can't send it further out
    // of tune instead of closer.
    if (freq > 0 && y.length - headLen >= 512) {
      const measureLen = Math.min(2400, y.length - headLen);
      const measured = vbMeasurePitch(y.subarray(headLen, headLen + measureLen), s.sr);
      if (measured > 0) {
        const cents = 1200 * Math.log2(measured / freq);
        if (Math.abs(cents) > 15 && Math.abs(cents) < 150) {
          y = vbResampleRatio(y, freq / measured);
        }
      }
    }

    // Equal-power crossfade over the region this unit shares with its
    // neighbour. Butt-joined units each faded to zero leave a notch at every
    // join -- measured at 2.9% of frames, heard as a bumpy, stuttering line.
    // Overlapping them and using sin/cos tapers makes the pair sum to constant
    // power, so the vowel runs through the join instead of dipping at it.
    //
    // The offline renderer fades over the whole overlap the bank declares,
    // which reaches 50 ms, because there it writes into one continuous buffer
    // and neighbouring fades sum back to unity. Here every unit is its own
    // scheduled source laid end to end, so nothing sums: a 60 ms consonant
    // faded 50 ms in and 50 ms out is a triangle, and the word all but
    // disappears. Same number, opposite effect, because the surrounding
    // architecture is not the same.
    const fade = Math.max(4, Math.min(Math.round(VB_XFADE * s.sr),
                                      Math.floor(y.length / 3)));
    for (let i = 0; i < fade; i++) {
      // sin/cos rather than linear: two overlapping tapers then sum to
      // constant power, where linear ones dip in the middle of every join
      const g = Math.sin(0.5 * Math.PI * (i / fade));
      y[i] *= g;
      y[y.length - 1 - i] *= g;
    }

    // Units were recorded at different moments and sit at different levels;
    // laid end to end that reads as a singer lurching. Pull each one toward a
    // common loudness, but gently -- clamping keeps a genuinely quiet
    // consonant from being winched up to vowel level.
    let acc = 0;
    for (let i = 0; i < y.length; i += 3) acc += y[i] * y[i];
    const rms = Math.sqrt(acc / Math.max(1, y.length / 3));
    if (rms > 1e-4) {
      const g = Math.min(1.8, Math.max(0.6, 0.14 / rms));
      for (let i = 0; i < y.length; i++) y[i] *= g;
    }

    d.played++;
    const result = { y, sr: s.sr, lead: (s.pre || 0) / s.sr };
    SampledSingerVoice._cache.set(key, result);
    return result;
  }


  // Sum a note's units into one buffer, then flatten the level error where
  // they meet.
  //
  // Two different recordings crossfaded together do not sum to a constant.
  // Their phases are unrelated -- measured cross-correlation across a seam is
  // 0.07 to 0.29 -- so where they overlap the level jumps by 30 to 60%, five
  // times a second. Aligning them does not help, because there is no alignment
  // that makes unrelated waveforms agree; that was measured and abandoned.
  //
  // What does work is to stop hoping and simply correct the result. Once the
  // units live in one buffer, the summed envelope can be compared with what it
  // should have been and the difference divided out. The correction is applied
  // only around the seams and is bounded, so a real attack is left alone.
  _renderNote(seq, freq, fromFreq, nucleus, noAttack) {
    const parts = [];
    let elapsed = 0, sr = 0;
    for (const step of seq) {
      const opts = {};
      if (step.ph === nucleus && fromFreq) opts.fromFreq = fromFreq;
      if (noAttack) opts.noAttack = true;
      const u = this._unitAudio(step.ph, freq, step.dur, elapsed, opts);
      if (u) { parts.push({ u, at: elapsed }); sr = u.sr; }
      elapsed += step.dur;
    }
    if (!parts.length) return null;

    const total = Math.ceil((elapsed + VB_XFADE) * sr) + 8;
    const out = new Float32Array(total);
    const want = new Float32Array(total);   // what the level should have been
    const seams = [];
    for (const { u, at } of parts) {
      const off = Math.round(at * sr);
      if (off > 0) seams.push(off);
      for (let i = 0; i < u.y.length && off + i < total; i++) {
        const v = u.y[i];
        out[off + i] += v;
        // the louder contributor, not the sum: this is the level a listener
        // should hear through the join
        const a = Math.abs(v);
        if (a > want[off + i]) want[off + i] = a;
      }
    }

    // envelope-match around each seam, bounded so attacks survive
    const half = Math.round(VB_XFADE * sr);
    const w = Math.max(16, Math.round(0.004 * sr));
    for (const seam of seams) {
      const lo = Math.max(0, seam - half), hi = Math.min(total, seam + half);
      for (let o = lo; o < hi; o += w) {
        let got = 0, aim = 0, n = 0;
        for (let k = o; k < Math.min(o + w, hi); k++) {
          got += out[k] * out[k]; aim += want[k] * want[k]; n++;
        }
        if (!n) continue;
        got = Math.sqrt(got / n); aim = Math.sqrt(aim / n);
        if (got < 1e-5 || aim < 1e-5) continue;
        const g = Math.min(1.6, Math.max(0.55, aim / got));
        for (let k = o; k < Math.min(o + w, hi); k++) out[k] *= g;
      }
    }
    return { y: out, sr, lead: parts[0].u.lead };
  }


  _play(rendered, when) {
    if (!rendered) return;
    if (this._dry) return; // prerender pass: _unitAudio already cached it
    const buf = ctx_buffer(this.ctx, rendered.y, rendered.sr);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.in);
    const startAt = Math.max(this.ctx.currentTime + 0.001, when - (rendered.lead || 0));
    try { src.start(startAt); } catch (err) { return; }
    this.sources.push(src);
    if (this.sources.length > 64) this.sources.splice(0, 32);
  }

  releaseAll() {
    this.sources.forEach(s => { try { s.stop(); } catch (e) {} });
    this.sources = [];
    this.prevPh = null;
    this.lastNote = null;
  }

  dispose() {
    this.disposed = true;
    this.releaseAll();
    try { this.out.disconnect(); } catch (e) {}
  }
}

function ctx_buffer(ctx, samples, sr) {
  const buf = ctx.createBuffer(1, samples.length, sr);
  buf.getChannelData(0).set(samples);
  return buf;
}

SampledSingerVoice.drops = {calls:0, noUnit:0, notDecoded:0, tooShort:0, played:0, missing:{}};
// Rendered units keyed by (prevPh, ph, freq, dur, fromFreq, noAttack,
// sinceNoteStart) -- see _unitAudio. Shared across every SampledSingerVoice
// instance so a phrase repeated in a different voice/part still benefits.
// Cleared whenever a new score loads, since units are specific to that
// piece's actual notes (see clearPrerenderCache below).
SampledSingerVoice._cache = new Map();
window.voicePack = voicePack;
window.voicePackWarm = voicePackWarm;
window.SampledSingerVoice = SampledSingerVoice;

