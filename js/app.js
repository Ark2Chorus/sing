(function(){
  const COLORS = ['--c1','--c2','--c3','--c4','--c5','--c6'];

  
  let samplesReady = false;
  let loadGeneration = 0; // bumped on every load; stale async callbacks check this before touching shared state

  // Real piano samples load with the page (PIANO_DATA_URIS and CHOIR_DATA_URIS
  // come from data/piano-samples.js and data/choir-samples.js, which the
  // service worker saves for offline), so the recorded grand piano sound is
  // always available instantly, online or offline — no network probe needed.
  // Instrument registry: each entry knows how to build a Tone instrument for a
  // staff. 'piano' and 'choir' use real embedded recordings (offline-ready);
  // 'synth' is a lightweight synthesized fallback with no sample data at all.
  const INSTRUMENTS = {
    piano: { label: '🎹 Grand Piano', short: '🎹', kind: 'sampler', urls: () => PIANO_DATA_URIS },
    choir: { label: '🎤 Choir Voice', short: '🎤', kind: 'sampler', urls: () => CHOIR_DATA_URIS },
    vocal: { label: '🗣️ Singing Synth', short: '🗣️', kind: 'vocalsynth' },
    singer: { label: '🎙️ AI Singer', short: '🎙️', kind: 'aisinger' },
    // Two entries for the same underlying voice, differing only in when the
    // PSOLA synthesis runs: "pre" walks the score and renders every unit
    // before playback starts (smooth, but a short wait up front); "live"
    // computes each unit on the fly as the transport reaches it (no wait,
    // but can stutter on dense/multi-voice passages -- see prerenderRealVoice).
    // inMenu: false -- kept working (Synth is also the fallback when a
    // sampler fails to load) but no longer offered in a part's list.
    realvoicepre: { label: '🎤 Real Voice', short: '🎤', kind: 'realvoice',
                     optionLabel: 'Real Voice (Pre-rendered)', renderMode: 'pre', inMenu: false },
    realvoicelive: { label: '🎤 Real Voice (Live)', short: '🎤', kind: 'realvoice',
                      optionLabel: 'Real Voice (Live)', renderMode: 'live', inMenu: false },
    synth: { label: '🎛️ Synth', short: '🎛️', kind: 'synth', inMenu: false },
    // A part's own recording ("Song - Alto.mp3" next to the score on Drive,
    // made with "Record for Ark2" in the singer demo). Offered only on parts
    // that have one.
    recording: { label: '🎙️ Rendered', short: '', kind: 'recording', optionLabel: 'Rendered' }
  };
  const DEFAULT_INSTRUMENT = 'piano';

  // ---------- Recordings ----------
  // Every recording has beat 1 of the score exactly RECORDING_PREROLL
  // seconds in, and follows the score's tempo map at 100%. The player is
  // tied to the transport, so play, pause, seek and stop move it along with
  // the notes; nothing is triggered per note.
  const RECORDING_PREROLL = 1.0;
  // A render follows the tempo slider without changing pitch: Ark2 stretches
  // it itself (WSOLA, below) to the tempo, once per tempo, and plays the
  // stretched copy as a Tone.Player tied to the transport -- the same exact
  // scheduling as the other instruments, so it can't drift at any speed. (The
  // browser's own pitch-keeping speed control was tried first: it reports a
  // position its hidden buffer runs ahead of, by an amount that grows with
  // speed and differs per device -- up to half a beat off at the extremes.)
  // Stretched by f, the file's beat 1 moves to RECORDING_PREROLL / f, and
  // file time and transport time then run together.
  // The tempo slider keeps within RECORDING_TEMPO_RANGE while one plays.
  const RECORDING_TEMPO_RANGE = [0.7, 1.3];
  // WSOLA time-stretch in a worker (no pause in the page): 40 ms Hann frames
  // at 50% overlap, each placed where it best continues the previous one
  // (within 8 ms), so pitch and tone stay put. f > 1 is faster.
  // The search for each frame's best fit runs on a copy reduced to ~8 kHz
  // (renders hold nothing higher that matters for lining up waves), then is
  // refined at full rate; the frames themselves are full quality. A 4-minute
  // part decoded at 48 kHz: well under a second.
  const STRETCH_WORKER_SRC = `onmessage = (e) => {
    const { id, x, sr, f } = e.data;
    let N = Math.round(0.04 * sr); N -= N % 2;
    const Hs = N / 2, tol = Math.round(0.008 * sr);
    const D = Math.max(1, Math.round(sr / 8000));      // search copy: every D samples, averaged
    const xd = new Float32Array(Math.floor(x.length / D));
    for (let i = 0; i < xd.length; i++){ let t = 0; for (let k = 0; k < D; k++) t += x[i * D + k]; xd[i] = t / D; }
    const Nd = Math.floor(N / D), tolD = Math.ceil(tol / D);
    const outLen = Math.ceil(x.length / f) + N;
    const y = new Float32Array(outLen), wsum = new Float32Array(outLen);
    const w = new Float32Array(N);
    for (let j = 0; j < N; j++) w[j] = 0.5 - 0.5 * Math.cos(2 * Math.PI * j / N);
    let prev = -1;
    for (let out = 0; ; out += Hs){
      const nominal = Math.round(out * f);
      if (nominal + N + tol + D >= x.length) break;
      let best = nominal;
      if (prev >= 0){
        const nat = prev + Hs, natD = Math.round(nat / D), nomD = Math.round(nominal / D);
        let bc = -Infinity, bestD = nomD;
        for (let d = -tolD; d <= tolD; d++){
          const c0 = nomD + d;
          if (c0 < 0 || c0 + Nd >= xd.length || natD + Nd >= xd.length) continue;
          let c = 0;
          for (let j = 0; j < Nd; j += 2) c += xd[natD + j] * xd[c0 + j];
          if (c > bc){ bc = c; bestD = c0; }
        }
        // refine around it at full rate
        bc = -Infinity; best = bestD * D;
        for (let d = -D; d <= D; d++){
          const c0 = bestD * D + d;
          if (c0 < 0 || c0 + N >= x.length) continue;
          let c = 0;
          for (let j = 0; j < N; j += 8) c += x[nat + j] * x[c0 + j];
          if (c > bc){ bc = c; best = c0; }
        }
      }
      for (let j = 0; j < N; j++){ y[out + j] += x[best + j] * w[j]; wsum[out + j] += w[j]; }
      prev = best;
    }
    for (let i = 0; i < outLen; i++) if (wsum[i] > 1e-3) y[i] /= wsum[i];
    postMessage({ id, y }, [y.buffer]);
  };`;
  // A few workers side by side (up to 4, leaving a core for the page), so the
  // four parts of a choir are stretched at the same time.
  let stretchWorkers = null, stretchSeq = 0;
  const stretchWaiting = new Map();
  // Stretch samples x (at rate sr) by f in a worker -> ToneAudioBuffer.
  function stretchSamples(x, sr, f){
    if (!stretchWorkers){
      const n = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
      const url = URL.createObjectURL(new Blob([STRETCH_WORKER_SRC], { type: 'text/javascript' }));
      stretchWorkers = Array.from({ length: n }, () => {
        const w = new Worker(url);
        w.onmessage = (e) => { const done = stretchWaiting.get(e.data.id); stretchWaiting.delete(e.data.id); if (done) done(e.data.y); };
        return w;
      });
    }
    const id = ++stretchSeq;
    const stretchWorker = stretchWorkers[id % stretchWorkers.length];
    // Renders hold nothing above ~11 kHz (Windows voices stop at 8), but the
    // browser decodes them at its own rate, often 48 kHz: halve that first,
    // for half the work, by averaging pairs of samples.
    if (sr >= 44100){
      const h = new Float32Array(x.length >> 1);
      for (let i = 0; i < h.length; i++) h[i] = 0.5 * (x[2 * i] + x[2 * i + 1]);
      x = h; sr = sr / 2;
    } else x = x.slice();
    return new Promise(res => {
      stretchWaiting.set(id, (y) => {
        const out = Tone.getContext().rawContext.createBuffer(1, y.length, sr);
        out.copyToChannel(y, 0);
        res(new Tone.ToneAudioBuffer(out));
      });
      stretchWorker.postMessage({ id, x, sr, f }, [x.buffer]);
    });
  }
  // A new tempo is stretched a piece at a time, starting where the music is,
  // so a render comes in within moments rather than after the whole part
  // (seconds for a long song, more on a phone). Each piece is a Tone.Player
  // on the transport, fading into the next over RENDER_XF; players added
  // while the music runs start at the right spot on their own.
  const RENDER_CHUNK = 12;      // s of the render per piece
  const RENDER_PAD = 0.1;       // s of extra render each side, so pieces overlap
  const RENDER_XF = 0.04;       // s crossfade between pieces
  class RecordingVoice {
    constructor(buffer){
      this.buffer = buffer;
      this.pieces = new Map();                       // tempo factor -> Map(piece index -> stretched piece)
      this.out = new Tone.Gain(1);
      this.players = [];
      this.factor = null;
      this.ready = false;                            // the piece at the playhead is in place
      this.run = 0;
      RecordingVoice.live.add(this);
      this.sync();
    }
    connect(node){ this.out.connect(node); return this; }
    triggerAttackRelease(){}
    releaseAll(){}
    clearPlayers(){
      this.players.forEach(p => { try{ p.unsync(); }catch(err){ /* ignore */ } p.dispose(); });
      this.players = [];
    }
    // Put a stretched piece on the transport. It holds the render from
    // a - pad on; it plays the render's a..b (plus the crossfades).
    place(buf, a, b, pad, f){
      const at = (src) => (src - RECORDING_PREROLL) / f;   // render time -> transport time
      const t0 = Math.max(0, at(a) - (a > 0 ? RENDER_XF / 2 : 0));
      const t1 = at(b) + RENDER_XF / 2;
      if (t1 <= t0) return;                          // all of it before beat 1
      const offset = (RECORDING_PREROLL + t0 * f - (a - pad)) / f;
      const p = new Tone.Player(buf).connect(this.out);
      p.fadeIn = a > 0 ? RENDER_XF : 0;
      p.fadeOut = RENDER_XF;
      p.sync().start(t0, Math.max(0, offset), t1 - t0);
      this.players.push(p);
    }
    async sync(){
      // the exact tempo: rounding it (110/120 = 0.9167 to 0.92) made the
      // render run 0.4% fast and drift a third of a second off by bar 40
      const f = Math.round(tempoFactor * 100000) / 100000;
      if (this.factor === f || this.disposed) return;
      this.factor = f;
      const run = ++this.run;
      this.clearPlayers();
      this.ready = false;
      if (Math.abs(f - 1) < 1e-4){                   // the song's own tempo: the render as it is
        const p = new Tone.Player(this.buffer).connect(this.out);
        p.sync().start(0, RECORDING_PREROLL);
        this.players.push(p);
        this.ready = true;
        return;
      }
      const src = this.buffer.get(), sr = src.sampleRate, data = src.getChannelData(0);
      const dur = src.duration, n = Math.ceil(dur / RENDER_CHUNK);
      const heard = Math.max(0, Tone.Transport.getSecondsAtTime(Tone.getContext().rawContext.currentTime));
      const first = Math.min(n - 1, Math.floor((RECORDING_PREROLL + heard * f) / RENDER_CHUNK));
      const order = [];
      for (let i = first; i < n; i++) order.push(i);
      for (let i = first - 1; i >= 0; i--) order.push(i);
      let cache = this.pieces.get(f);
      if (!cache) this.pieces.set(f, cache = new Map());
      for (const i of order){
        const a = i * RENDER_CHUNK, b = Math.min(dur, a + RENDER_CHUNK), pad = Math.min(RENDER_PAD, a);
        let buf = cache.get(i);
        if (!buf){
          const s0 = Math.floor((a - pad) * sr), s1 = Math.min(data.length, Math.ceil((b + RENDER_PAD) * sr));
          buf = await stretchSamples(data.subarray(s0, s1), sr, f);
          cache.set(i, buf);
        }
        if (this.disposed || run !== this.run) return;   // tempo moved on meanwhile
        this.place(buf, a, b, pad, f);
        if (i === first) this.ready = true;
      }
    }
    dispose(){
      this.disposed = true;
      RecordingVoice.live.delete(this);
      this.clearPlayers();
      this.out.dispose();
    }
    static syncAll(){ RecordingVoice.live.forEach(v => v.sync()); }
  }
  RecordingVoice.live = new Set();
  const RENDER_CLOUD = '☁️';   // a render only on Google Drive (see singerEmoji)
  // "Soprano", "SOPRANO 1", "Soprano." -> "soprano", "soprano1": how a part's
  // name and the end of a recording's file name are compared.
  const recKey = (label) => String(label || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  // Recording files that go with a score: same folder, named
  // "<score file name> - <part>.<audio ext>". -> [{ label, item }]
  function recordingsFor(scoreItem, audioItems){
    const base = scoreItem.name.replace(/\.[^.]+$/, '').toLowerCase() + ' - ';
    return audioItems
      .filter(a => (a.rel || '') === (scoreItem.rel || '') && a.name.toLowerCase().startsWith(base))
      .map(a => ({ label: a.name.slice(base.length).replace(/\.[^.]+$/, ''), item: a }));
  }
  // The "// Rendered Songs" folders of config.ark2 hold part recordings for
  // any score, found by name: "<score name> - <part>.<audio ext>". Listed
  // again each time a score opens (one small request per folder), so renders
  // uploaded while Ark2 is open show up; a listing under a minute old is
  // reused. Offline, nothing is found.
  let renderedListP = null, renderedListAt = 0;
  // Why the last render lookup / download failed, in words the pop-up can show
  // ("Couldn't render soprano voice" + this). The console keeps the raw error
  // as `Render:`. step: 'list' (the folder), 'download' (the file), 'decode'.
  let renderProblem = null;
  function noteRenderProblem(step, err){
    console.warn('Render:', step, err);
    const st = err && err.status, msg = (err && err.message) || String(err || '');
    let text;
    if (!navigator.onLine) text = "This device is offline.";
    else if (step === 'decode') text = "The render downloaded, but this device couldn't read the audio file (" + msg + "). It may need to be rendered again.";
    else if (step === 'config') text = "Couldn't read config.ark2, which lists the Rendered Songs folders (" + (msg || 'not reachable') + ").";
    else if (step === 'timeout') text = "Google Drive didn't answer within 15 seconds. The internet is up, so Drive itself is slow or blocked; try again in a minute.";
    else if (st === 404) text = "The " + (step === 'list' ? 'Rendered Songs folder' : 'render file') + " wasn't found on Google Drive (HTTP 404). Check it is still shared as Anyone with the link.";
    else if (st === 429 || (st === 403 && step === 'download')) text = "Google Drive refused the download (HTTP " + st + "). Drive limits repeated downloads: wait a few minutes and try again.";
    else if (st === 400 || st === 403) text = "Google Drive refused the request (HTTP " + st + "). Check the API key in config.ark2.";
    else if (st) text = "Google Drive answered with an error (HTTP " + st + ") while " + (step === 'list' ? 'listing the folder' : 'downloading the render') + ".";
    else text = "Couldn't reach Google Drive (" + msg + "). The internet is up, so something is blocking Drive requests: a VPN, firewall, or ad-blocker.";
    renderProblem = { step, text };
  }
  // -> the audio files in all Rendered Songs folders, or null when a folder
  // couldn't be read (offline, not shared). `fresh` lists again right now.
  function renderedList(fresh){
    if (fresh || !renderedListP || Date.now() - renderedListAt > 60000){
      renderedListAt = Date.now();
      renderedListP = (async () => {
        await getCloudConfig();
        if (!cloudCfg.reachable){ noteRenderProblem('config', null); return null; }
        const out = [];
        for (const f of cloudCfg.recordings || []){
          try{ out.push(...await driveList(f.id, AUDIO_EXT)); }catch(err){ noteRenderProblem('list', err); return null; }
        }
        return out;
      })();
      // a failed or empty listing is tried again next time
      renderedListP.then(l => { if (!l || !l.length) renderedListP = null; });
    }
    return renderedListP;
  }
  // -> [{ label, item }] for a score named `scoreName` (its file name, with or
  // without the extension); null when the folders couldn't be checked
  async function renderedFor(scoreName, fresh){
    if (!navigator.onLine) return null;
    const base = String(scoreName || '').replace(/\.(musicxml|xml|mxl)$/i, '').toLowerCase().trim() + ' - ';
    const list = await Promise.race([renderedList(fresh), new Promise(res => setTimeout(() => { noteRenderProblem('timeout', null); res(null); }, 15000))]);
    if (!list) return null;
    return list.filter(a => a.name.toLowerCase().startsWith(base))
      .map(a => ({ label: a.name.slice(base.length).replace(/\.[^.]+$/, ''), item: a }));
  }

  // The pop-up when a part's render can't be used:
  //   missing: "Alto render voice is not available" -- no file for it in the
  //            Rendered Songs folder
  //   offline: "Couldn't render alto voice. Check the connection and try again."
  // OK, Esc or a tap outside closes it.
  function showRenderFail(part, why, text, onClose){
    const box = el('render-fail'), ok = el('render-fail-ok');
    const name = String(part || 'this');
    if (why === 'note'){
      el('render-fail-title').textContent = name;
      el('render-fail-text').textContent = text || '';
      el('render-fail-text').hidden = !text;
    } else if (why === 'missing'){
      el('render-fail-title').textContent = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() + ' render voice is not available';
      el('render-fail-text').textContent = 'Please select other option from the list.';
      el('render-fail-text').hidden = false;
    } else {
      // Drive / network trouble (refused, not found, slow, unreachable) gets
      // one plain message, the exact cause staying in the console (`Render:`,
      // see noteRenderProblem). Offline, an unreadable file and a missing
      // config.ark2 keep their own wording.
      const own = renderProblem && (renderProblem.step === 'decode' || renderProblem.step === 'config' || !navigator.onLine);
      if (own){
        el('render-fail-title').textContent = "Couldn't render " + name.toLowerCase() + ' voice';
        el('render-fail-text').textContent = renderProblem.text;
      } else {
        el('render-fail-title').textContent = 'Render ' + name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() + ' not available';
        el('render-fail-text').textContent = 'Your internet might be slow or the server is not responding to your request. Please select any other voice from the list.';
      }
      el('render-fail-text').hidden = false;
    }
    // Notes ("Choose a song", "File is not available") sit by the player bar
    // rather than dimming the whole screen.
    box.classList.toggle('side', why === 'note');
    if (why === 'note'){
      const head = document.querySelector('#sheet-viewer .sv-head');
      box.style.setProperty('--top', (head ? head.getBoundingClientRect().bottom + 10 : 80) + 'px');
    }
    const close = () => {
      box.hidden = true;
      if (onClose) onClose();
      ok.removeEventListener('click', close);
      box.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
    };
    const onBackdrop = (e) => { if (e.target === box) close(); };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter'){ e.preventDefault(); close(); } };
    ok.addEventListener('click', close);
    box.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    box.hidden = false;
    ok.focus();
  }

  // Download one part's render from the Rendered Songs folder: it becomes the
  // part's recording ("Rendered") and joins the score's saved copy.
  // -> 'ok', 'missing' (no render of this part in the folder) or 'offline'
  // (couldn't check or download).
  async function downloadRender(track){
    const tab = scoreTabs.find(t => t.id === activeTabId);
    if (!tab) return 'offline';
    renderProblem = null;
    const opt = document.querySelector(`.staff-card[data-track-id="${track.id}"] .sc-instrument option[value="recording"]`);
    const reset = () => { if (opt) opt.textContent = RENDER_CLOUD + ' Render'; };   // not downloaded: still "Render"
    if (opt) opt.textContent = RENDER_CLOUD + ' Looking\u2026';
    if (!track.renderFile){
      const found = await renderedFor(tab.name, true);     // uploaded just now counts too
      if (!found){ reset(); return 'offline'; }
      track.renderFile = found.find(r => recKey(r.label) === recKey(track.label)) || null;
      if (!track.renderFile){ reset(); return 'missing'; }
    }
    if (opt) opt.textContent = RENDER_CLOUD + ' Downloading\u2026';
    const got = await fetchRecordings([track.renderFile]);
    const buffers = got.length ? await decodeRecordings(got) : new Map();
    const buf = buffers.get(recKey(track.label));
    if (!buf){ reset(); if (!renderProblem) noteRenderProblem('download', new Error('no file came back')); return 'offline'; }
    track.recording = buf;
    track.renderFile = null;
    tab.recordings = (tab.recordings || []).filter(r => recKey(r.label) !== recKey(got[0].label)).concat(got);
    if (opt) opt.textContent = 'Rendered';          // the singing mic beside the dropdown marks it
    saveRecordingsOffline(tab);
    return 'ok';
  }
  // If the open score is saved on this device, keep its recordings in that
  // saved copy too, so they're there next time -- offline as well.
  async function saveRecordingsOffline(tab){
    if (!tab || !tab.offlineKey || !(tab.recordings || []).length) return;
    try{
      const rec = (await offlineAll()).find(r => r.key === tab.offlineKey);
      if (!rec) return;
      // the tab's renders win: new parts are added, updated ones replace
      const mine = new Map(tab.recordings.map(r => [recKey(r.label), r]));
      const kept = (rec.recordings || []).filter(r => !mine.has(recKey(r.label)));
      const next = kept.concat(tab.recordings);
      const same = next.length === (rec.recordings || []).length
        && next.every(r => (rec.recordings || []).includes(r));
      if (same) return;
      rec.recordings = next;
      await offlinePut(rec);
    }catch(err){ /* the score plays anyway; only the saved copy misses it */ }
  }

  // A tab's recordings ([{ label, blob }]) -> Map(recKey(label) -> buffer).
  async function decodeRecordings(list){
    const out = new Map();
    for (const r of list || []){
      try{
        const buf = await Tone.getContext().rawContext.decodeAudioData(await r.blob.arrayBuffer());
        const tb = new Tone.ToneAudioBuffer(buf);
        tb._blob = r.blob;                                   // RecordingVoice plays the file itself
        out.set(recKey(r.label), tb);
      }catch(err){ noteRenderProblem('decode', err); /* not audio we can read: that part keeps its instrument */ }
    }
    return out;
  }
  // A recording plays at the speed it was sung: the tempo slider would slide
  // the notes away from it, so it rests at the score's tempo while any part
  // plays its recording.
  function updateTempoLock(){
    const locked = staffTracks.some(t => t.instrument === 'recording');
    const s = el('tempo-slider');
    s.disabled = false;
    s.title = locked ? 'With rendered voices: ' + Math.round(RECORDING_TEMPO_RANGE[0] * 100) + '\u2013' + Math.round(RECORDING_TEMPO_RANGE[1] * 100) + '% of the song\u2019s tempo' : '';
    const f = Math.max(RECORDING_TEMPO_RANGE[0], Math.min(RECORDING_TEMPO_RANGE[1], tempoFactor));
    if (locked && f !== tempoFactor){
      const beat = currentBeat();
      tempoFactor = f;
      if (staffTracks.length){
        scheduledParts.forEach(p => p.dispose());
        scheduledParts = [];
        buildSchedule();
        Tone.Transport.seconds = beatsToSeconds(beat);
      }
      tempoFollow(beat);
    }
  }

  // A synthesized singing voice: no samples at all, built instead from a buzzy
  // sawtooth source (standing in for vocal-cord buzz) pushed through three
  // parallel bandpass filters tuned to roughly an "ah" vowel's formants (the
  // resonant frequencies that give a voice its vowel color), then a touch of
  // vibrato for a natural sung character. It's a different, more expressive
  // texture than the recorded choir pad, and — like the plain synth — needs
  // zero loading time since there's no audio data to fetch or decode.
  class SingingSynthVoice{
    constructor(){
      // A little portamento gives consecutive close-together notes a slight
      // vocal glide instead of always hard-retriggering, like a real legato line.
      this.core = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sawtooth' },
        envelope: { attack: 0.08, decay: 0.12, sustain: 0.78, release: 0.65 },
        portamento: 0.025
      });

      // Formant bandpass filters approximating an "ah" vowel — the resonant
      // bands that give a voice its vowel color.
      this.formants = [
        new Tone.Filter({ type: 'bandpass', frequency: 700, Q: 6 }),
        new Tone.Filter({ type: 'bandpass', frequency: 1220, Q: 8 }),
        new Tone.Filter({ type: 'bandpass', frequency: 2600, Q: 10 })
      ];
      this.formantBus = new Tone.Gain(0.85);

      // A small amount of unfiltered signal keeps very low or very high notes
      // from sounding thin when their harmonics don't line up neatly with the
      // fixed formant bands — real voices don't lose body at pitch extremes.
      this.dryGain = new Tone.Gain(0.16);

      // Soft breath noise, gated in time with each note, adds the subtle air
      // a purely tonal oscillator can't produce on its own.
      this.breath = new Tone.Noise('pink');
      this.breathFilter = new Tone.Filter({ type: 'bandpass', frequency: 3000, Q: 0.6 });
      this.breathEnv = new Tone.AmplitudeEnvelope({ attack: 0.08, decay: 0.3, sustain: 0.12, release: 0.3 });
      this.breath.connect(this.breathFilter);
      this.breathFilter.connect(this.breathEnv);
      this.breath.start();

      // Vibrato depth starts at 0 and is ramped in per-note (see
      // triggerAttackRelease) rather than being constantly on — real sustained
      // singing settles into vibrato a beat or two into a held note, not from
      // the very first instant, which is what made the earlier version feel
      // like a synth pad rather than a voice.
      this.vibrato = new Tone.Vibrato({ frequency: 5.4, depth: 0, wet: 1 });

      // A touch of chorus adds width/movement so the voice doesn't sound like
      // a single flat, static oscillator.
      this.chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 3.2, depth: 0.35, wet: 0.25 }).start();
      this.outBus = new Tone.Gain(1);

      this.core.connect(this.dryGain);
      this.formants.forEach(f => { this.core.connect(f); f.connect(this.formantBus); });
      this.dryGain.connect(this.vibrato);
      this.formantBus.connect(this.vibrato);
      this.breathEnv.connect(this.vibrato);
      this.vibrato.connect(this.chorus);
      this.chorus.connect(this.outBus);

      // Slow, gentle drift of the second formant mimics the natural, subtle
      // vowel movement a held voice has instead of sitting perfectly static.
      this._vowelToggle = false;
      this._vowelDriftTimer = setInterval(() => {
        this._vowelToggle = !this._vowelToggle;
        try{ this.formants[1].frequency.rampTo(this._vowelToggle ? 1320 : 1120, 2.5); }catch(err){ /* ignore */ }
      }, 3000);
    }
    connect(dest){ this.outBus.connect(dest); return this; }
    triggerAttackRelease(freq, dur, time){
      this.core.triggerAttackRelease(freq, dur, time);
      try{ this.breathEnv.triggerAttackRelease(dur, time); }catch(err){ /* ignore */ }
      try{
        this.vibrato.depth.cancelScheduledValues(time);
        this.vibrato.depth.setValueAtTime(0, time);
        this.vibrato.depth.linearRampToValueAtTime(0.16, time + 0.32);
      }catch(err){ /* ignore */ }
      return this;
    }
    dispose(){
      clearInterval(this._vowelDriftTimer);
      [this.core, ...this.formants, this.formantBus, this.dryGain,
       this.breath, this.breathFilter, this.breathEnv, this.vibrato, this.chorus, this.outBus]
        .forEach(node => { try{ node.dispose(); }catch(err){ /* ignore */ } });
    }
  }

  // Cast an SATB score automatically: a staff called "Soprano" gets the
  // soprano voice, and so on down. Anything unrecognised sings as a tenor.
  function singerVoiceForLabel(label){
    const l = (label || '').toLowerCase();
    if (l.includes('sopran')) return 'soprano';
    if (l.includes('mezzo')) return 'mezzo';
    if (l.includes('countertenor')) return 'countertenor';
    if (l.includes('alto') || l.includes('contralto')) return 'alto';
    if (l.includes('tenor')) return 'tenor';
    if (l.includes('bariton')) return 'baritone';
    if (l.includes('bass')) return 'bass';
    if (l.includes('treble') || l.includes('child')) return 'child';
    return 'tenor';
  }

  // Decoded samples, one set per sampled instrument, kept for the session.
  // Plain AudioBuffers are handed out, not ToneAudioBuffers: a Sampler frees
  // the ToneAudioBuffers it holds when it's disposed, which would empty the
  // cache the first time a score was closed.
  const SAMPLE_CACHE = new Map();     // instrument key -> Promise<{ note: AudioBuffer }>
  function sampleBuffers(key, def){
    if (!SAMPLE_CACHE.has(key)){
      const urls = def.urls();
      const one = (note) => new Promise(res => {
        const b = new Tone.ToneAudioBuffer(urls[note], () => res([note, b.get()]), () => res(null));
      });
      const p = Promise.all(Object.keys(urls).map(one)).then(list => {
        const out = {};
        list.forEach(x => { if (x && x[1]) out[x[0]] = x[1]; });
        if (!Object.keys(out).length) SAMPLE_CACHE.delete(key);   // nothing decoded: try again next time
        return out;
      });
      SAMPLE_CACHE.set(key, p);
    }
    return SAMPLE_CACHE.get(key);
  }

  function createInstrumentVoice(instrumentKey, loadPromises, onProgress, label, recording){
    const def = INSTRUMENTS[instrumentKey] || INSTRUMENTS.piano;
    if (def.kind === 'recording'){
      if (recording){
        if (onProgress) onProgress();
        return new RecordingVoice(recording);
      }
      return createInstrumentVoice(DEFAULT_INSTRUMENT, loadPromises, onProgress, label);
    }
    if (def.kind === 'realvoice'){
      if (onProgress) onProgress();
      const voice = new SampledSingerVoice(singerVoiceForLabel(label));
      // Tag it with which mode its track picked ('pre' or 'live') so
      // prerenderRealVoice knows which tracks to warm before playback.
      voice._renderMode = def.renderMode || 'live';
      return voice;
    }
    if (def.kind === 'aisinger'){
      if (onProgress) onProgress();
      return new FormantSingerVoice(singerVoiceForLabel(label), 'choral');
    }
    if (def.kind === 'vocalsynth'){
      if (onProgress) onProgress();
      return new SingingSynthVoice();
    }
    if (def.kind === 'sampler'){
      let resolveLoad;
      loadPromises.push(new Promise(res => { resolveLoad = res; }));
      const markDone = () => { resolveLoad(); if (onProgress) onProgress(); };
      try{
        const sampler = new Tone.Sampler({
          release: instrumentKey === 'choir' ? 1.4 : 1,
          attack: instrumentKey === 'choir' ? 0.06 : 0
        });
        // The samples are decoded once per instrument and shared, so opening
        // or switching to a score no longer decodes them again for every staff.
        sampleBuffers(instrumentKey, def).then(buffers => {
          if (!sampler.disposed){
            for (const note in buffers){ try{ sampler.add(note, buffers[note]); }catch(err){ /* skip that sample */ } }
          }
          markDone();
        }, markDone);
        return sampler;
      }catch(err){
        markDone();
        return createInstrumentVoice('synth', loadPromises, onProgress);
      }
    }
    if (onProgress) onProgress();
    // Synthesized fallback: a struck/plucked-string-style voice. A bright filter
    // sweep on note-on mimics a hammer transient, then a slow, low-sustain
    // amplitude decay mimics how a real instrument continuously loses energy.
    return new Tone.PolySynth(Tone.MonoSynth, {
      oscillator: { type: 'triangle' },
      filter: { type: 'lowpass', rolloff: -12, Q: 1 },
      envelope: { attack: 0.004, decay: 1.6, sustain: 0.08, release: 1.0 },
      filterEnvelope: { attack: 0.004, decay: 0.45, sustain: 0.12, release: 1.0, baseFrequency: 280, octaves: 4.2 }
    });
  }

  // Swap a single staff's instrument live. Tone.Part's callback reads track.synth
  // dynamically each time it fires, so this never needs to touch playback state —
  // if the transport is running, it keeps running straight through the swap and
  // that one staff simply starts sounding different from its next note onward.
  // Other staves, and the global play/pause state, are completely unaffected.
  async function switchStaffInstrument(track, newInstrument){
    if (!INSTRUMENTS[newInstrument] || newInstrument === track.instrument) return;
    if (newInstrument === 'recording' && !track.recording){
      const sel = document.querySelector(`.staff-card[data-track-id="${track.id}"] .sc-instrument`);
      const got = await downloadRender(track);
      if (got !== 'ok'){
        if (sel) sel.value = track.instrument;              // stays on what it had
        showRenderFail(track.label, got);
        return;
      }
    }
    track.instrument = newInstrument;
    const mySwapGen = (track.swapGen = (track.swapGen || 0) + 1);

    const card = document.querySelector(`.staff-card[data-track-id="${track.id}"] .sc-instrument`);
    if (card) card.disabled = true;

    const loadPromises = [];
    const oldSynth = track.synth;
    const newSynth = createInstrumentVoice(newInstrument, loadPromises, null, track.label, track.recording).connect(track.panner);

    const loadTimeout = new Promise(res => setTimeout(res, 12000));
    await Promise.race([Promise.all(loadPromises), loadTimeout]);

    if (track.swapGen !== mySwapGen){
      // A newer swap for this same staff started before this one finished loading —
      // discard this now-stale result instead of clobbering the newer instrument.
      try{ newSynth.dispose(); }catch(err){ /* ignore */ }
      return;
    }

    track.synth = newSynth;
    // A recording leaving or joining mid-song: stop the old one at once (it
    // isn't driven by notes); a new one lines itself up with the current spot.
    if (oldSynth instanceof RecordingVoice) try{ oldSynth.dispose(); }catch(err){ /* ignore */ }
    else if (oldSynth) setTimeout(() => { try{ oldSynth.dispose(); }catch(err){ /* ignore */ } }, 1200);
    if (card) card.disabled = false;
    updateTempoLock();
    RecordingVoice.syncAll();
  }

  let osmd = null;
  let staffTracks = [];   // {id, label, events:[{time,dur,midi}], color, synth, gain, panner, muted, soloed, volume}
  let totalDuration = 0;
  let baseTempo = 100;
  let scheduledParts = [];
  let isPlaying = false;
  let measureStarts = [];   // beats where each bar starts, from parseMusicXML
  // Tempo changes through the piece ({ beat, bpm }, from beat 0), and the
  // listener's speed-up/slow-down applied evenly to all of them: dragging
  // the slider from 115 to 100 in a 115 section scales every section by
  // 100/115, so the piece keeps its shape.
  let tempoMap = [{ beat: 0, bpm: 120 }];
  let tempoFactor = 1;
  let metronomeOn = false;  // click on every beat, accented on the downbeat
  let rafId = null;
  let cursorTimeline = [];  // beat positions (quarter notes) the OSMD cursor can land on
  let cursorRects = [];     // parallel array: on-screen rect of the cursor at each step, relative to #score-paper's content
  let cursorIndex = -1;

  // ---------- Session persistence (IndexedDB) ----------
  // Stores each open tab's actual score content locally in the browser so the
  // session can be restored next time the app is opened — works fully offline,
  // no server or account needed.
  const DB_NAME = 'music-stand-db';
  const DB_VERSION = 1;
  let dbPromise = null;

  function openDB(){
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined'){ reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('tabs')) db.createObjectStore('tabs', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function dbSaveTab(tab){
    try{
      const db = await openDB();
      await new Promise((resolve) => {
        const tx = db.transaction('tabs', 'readwrite');
        tx.objectStore('tabs').put(tab);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    }catch(err){ /* persistence is a nice-to-have, never block the app */ }
  }

  async function dbDeleteTab(id){
    try{
      const db = await openDB();
      await new Promise((resolve) => {
        const tx = db.transaction('tabs', 'readwrite');
        tx.objectStore('tabs').delete(id);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    }catch(err){ /* ignore */ }
  }

  async function dbLoadAllTabs(){
    try{
      const db = await openDB();
      return await new Promise((resolve) => {
        const tx = db.transaction('tabs', 'readonly');
        const req = tx.objectStore('tabs').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => resolve([]);
      });
    }catch(err){ return []; }
  }

  async function dbSaveMeta(key, value){
    try{
      const db = await openDB();
      await new Promise((resolve) => {
        const tx = db.transaction('meta', 'readwrite');
        tx.objectStore('meta').put({ key, value });
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
    }catch(err){ /* ignore */ }
  }

  async function dbLoadMeta(key){
    try{
      const db = await openDB();
      return await new Promise((resolve) => {
        const tx = db.transaction('meta', 'readonly');
        const req = tx.objectStore('meta').get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => resolve(null);
      });
    }catch(err){ return null; }
  }

  // ---------- Tabs ----------
  let scoreTabs = []; // {id, name, xmlText}
  let activeTabId = null;
  let tabCounter = 0;

  function renderTabsBar(){
    const row = el('tabs-row');
    Array.from(row.querySelectorAll('.tab-btn')).forEach(b => b.remove());
    scoreTabs.forEach(tab => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn' + (tab.id === activeTabId ? ' active' : '');
      btn.dataset.tabId = tab.id;
      btn.innerHTML = `<span class="tab-label">${escapeHtml(tab.name)}</span><span class="tab-close" title="Close tab">×</span>`;
      btn.addEventListener('click', (e) => {
        if (e.target.classList.contains('tab-close')){
          e.stopPropagation();
          closeTab(tab.id);
        } else {
          switchTab(tab.id);
        }
      });
      row.insertBefore(btn, el('tab-add-btn'));
    });
  }

  async function addTab(xmlText, name, recordings, offlineKey, renderFiles){
    // The same score opened again goes to the tab it's already in rather
    // than opening a second copy.
    const same = scoreTabs.find(t => t.name === (name || 'Untitled') && t.xmlText === xmlText);
    if (same){
      if (recordings && recordings.length && !(same.recordings || []).length) same.recordings = recordings;
      const note = el('lib-note');
      if (note && /^Opening /.test(note.textContent)) note.textContent = '';
      return switchTab(same.id);
    }
    const id = 'tab-' + (++tabCounter);
    // recordings: [{ label, blob }] found next to the score. Kept for this
    // session only; opening the score again fetches them again.
    const tab = { id, name: name || 'Untitled', xmlText, recordings: recordings || [], offlineKey: offlineKey || null,
                  renderFiles: renderFiles || [] };
    scoreTabs.push(tab);
    activeTabId = id;
    renderTabsBar();
    dbSaveTab({ id, name: tab.name, xmlText, order: scoreTabs.length - 1 });
    dbSaveMeta('activeTabId', id);
    await loadScoreFromText(xmlText, name);
  }

  async function switchTab(id){
    if (id === activeTabId){ showWorkspace(); return; }
    const tab = scoreTabs.find(t => t.id === id);
    if (!tab) return;
    activeTabId = id;
    renderTabsBar();
    dbSaveMeta('activeTabId', id);
    await loadScoreFromText(tab.xmlText, tab.name, { quick: true });
  }

  function closeTab(id){
    const idx = scoreTabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const wasActive = id === activeTabId;
    scoreTabs.splice(idx, 1);
    dbDeleteTab(id);

    if (scoreTabs.length === 0){
      activeTabId = null;
      dbSaveMeta('activeTabId', null);
      stopPlayback();
      disposeStaffTracks();
      cursorTimeline = [];
      document.body.classList.remove('workspace-active');
      workspace.classList.remove('active');
      dropzone.style.display = 'block';
      fitAudioShelfSoon();
      el('transport-controls').style.display = 'none';
      clearError();
      renderTabsBar();
      return;
    }

    if (wasActive){
      const next = scoreTabs[idx] || scoreTabs[idx - 1];
      activeTabId = next.id;
      renderTabsBar();
      dbSaveMeta('activeTabId', next.id);
      loadScoreFromText(next.xmlText, next.name);
    } else {
      renderTabsBar();
    }
  }

  async function restoreSession(){
    const savedTabs = await dbLoadAllTabs();
    if (!savedTabs || savedTabs.length === 0) return;
    // Phones and tablets start fresh on the home screen: the scores open
    // last time are closed, not reopened. Computers pick up where they left off.
    const mobile = window.matchMedia('(pointer: coarse), (max-width: 768px)').matches;
    if (mobile){
      savedTabs.forEach(t => dbDeleteTab(t.id));
      dbSaveMeta('activeTabId', null);
      return;
    }
    savedTabs.sort((a, b) => (a.order || 0) - (b.order || 0));

    scoreTabs = savedTabs.map(t => ({ id: t.id, name: t.name, xmlText: t.xmlText }));
    tabCounter = savedTabs.reduce((max, t) => {
      const num = parseInt(String(t.id).replace('tab-', ''), 10);
      return isNaN(num) ? max : Math.max(max, num);
    }, 0);

    const savedActiveId = await dbLoadMeta('activeTabId');
    const target = scoreTabs.find(t => t.id === savedActiveId) || scoreTabs[0];
    activeTabId = target.id;
    renderTabsBar();
    await loadScoreFromText(target.xmlText, target.name);
  }

  // Beats <-> seconds through the tempo map (with the listener's factor).
  // The bpm argument older call sites pass is no longer needed: the map is
  // the single source of timing.
  // The written tempo at a beat (a held fermata's entry keeps it as `base`).
  function tempoAt(beat){
    let bpm = tempoMap[0].base || tempoMap[0].bpm;
    for (const t of tempoMap){ if (t.beat <= beat + 1e-9) bpm = t.base || t.bpm; else break; }
    return bpm;
  }
  function beatFromSeconds(seconds){
    let acc = 0;
    for (let i = 0; i < tempoMap.length; i++){
      const a = tempoMap[i].beat;
      const b = i + 1 < tempoMap.length ? tempoMap[i + 1].beat : Infinity;
      const bps = tempoMap[i].bpm * tempoFactor / 60;
      const segSec = (b - a) / bps;
      if (seconds <= acc + segSec) return a + (seconds - acc) * bps;
      acc += segSec;
    }
    return 0;
  }

  function paperRelativeRect(domRect){
    const paper = el('score-paper');
    const pRect = paper.getBoundingClientRect();
    return {
      left: domRect.left - pRect.left + paper.scrollLeft,
      top: domRect.top - pRect.top + paper.scrollTop,
      width: domRect.width,
      height: domRect.height
    };
  }

  function buildCursorTimeline(){
    cursorTimeline = [];
    cursorRects = [];
    try{
      if (!osmd || !osmd.cursor) return;
      osmd.cursor.reset();
      osmd.cursor.show();
      const it = osmd.cursor.iterator;
      // Where the cursor sits at each step. Measuring it on screen every step
      // made the browser lay the page out again per note -- seconds on a big
      // score. OSMD writes the cursor's position into its style, so it's
      // measured once and the rest are read from there.
      let dx = null, dy = null;
      while (!it.EndReached){
        cursorTimeline.push(it.currentTimeStamp.RealValue * 4); // whole notes -> quarter-note beats
        const cursorEl = osmd.cursor.cursorElement || document.querySelector('#osmd-container img[id^="cursorImg"]');
        let rect = null;
        if (cursorEl){
          const x = parseFloat(cursorEl.style.left), y = parseFloat(cursorEl.style.top);
          if (dx === null || !isFinite(x) || !isFinite(y)){
            rect = paperRelativeRect(cursorEl.getBoundingClientRect());
            if (isFinite(x) && isFinite(y) && rect.height > 0){ dx = rect.left - x; dy = rect.top - y; }
          } else {
            rect = { left: x + dx, top: y + dy, width: cursorEl.width || 0, height: cursorEl.height || 0 };
          }
        }
        cursorRects.push(rect);
        osmd.cursor.next(); // advances both the logical iterator and the visual position
      }
      osmd.cursor.reset();
      osmd.cursor.hide();
    }catch(err){ cursorTimeline = []; cursorRects = []; }
    // After reset(), the physical cursor is already sitting AT step 0 (not "before" it) —
    // tracking that as -1 caused advanceCursorTo() to immediately fast-forward it to step 1
    // the instant playback started, one note ahead of what was actually sounding.
    cursorIndex = cursorTimeline.length > 0 ? 0 : -1;
  }

  function nearestBeatForPoint(x, y){
    let bestIdx = -1, bestDist = Infinity;
    cursorRects.forEach((r, i) => {
      if (!r) return;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = x - cx;
      const dy = (y - cy) * 3; // weight vertical distance more so we don't jump between staff systems
      const dist = dx * dx + dy * dy;
      if (dist < bestDist){ bestDist = dist; bestIdx = i; }
    });
    return bestIdx === -1 ? null : cursorTimeline[bestIdx];
  }

  function advanceCursorTo(targetBeat){
    try{
      if (!osmd || !osmd.cursor || cursorTimeline.length === 0) return;
      const before = cursorIndex;
      while (cursorIndex < cursorTimeline.length - 1 && cursorTimeline[cursorIndex + 1] <= targetBeat){
        osmd.cursor.next();
        cursorIndex++;
      }
      if (cursorIndex !== before) scrollToCursor();
    }catch(err){ /* cursor highlight is a nice-to-have, never break playback */ }
  }

  function resetCursorTo(targetBeat){
    try{
      if (!osmd || !osmd.cursor) return;
      osmd.cursor.reset();
      cursorIndex = cursorTimeline.length > 0 ? 0 : -1; // reset() already places the cursor at step 0
      osmd.cursor.show();
      advanceCursorTo(targetBeat);
      scrollToCursor();
    }catch(err){ /* ignore */ }
  }

  // Keep the currently-playing staff in view, without fighting a fixed top/bottom bar.
  function scrollToCursor(){
    try{
      const cursorEl = document.querySelector('#osmd-container img[id^="cursorImg"]');
      if (!cursorEl) return;
      const topBar = el('top-bar');
      const bottomBar = el('bottom-mixer');
      const topBound = (topBar ? topBar.offsetHeight : 0) + 24;
      const bottomBound = window.innerHeight - (bottomBar ? bottomBar.offsetHeight : 0) - 24;
      const rect = cursorEl.getBoundingClientRect();
      if (rect.top < topBound || rect.bottom > bottomBound){
        const viewCenter = topBound + (bottomBound - topBound) / 2;
        const delta = (rect.top + rect.height / 2) - viewCenter;
        window.scrollTo({ top: Math.max(0, window.scrollY + delta), behavior: 'smooth' });
      }
    }catch(err){ /* ignore */ }
  }

  const el = (id) => document.getElementById(id);
  const dropzone = el('dropzone');
  const workspace = el('workspace');
  const errorBox = el('error-box');

  function showError(msg){
    errorBox.textContent = msg;
    errorBox.style.display = 'block';
  }
  function clearError(){ errorBox.style.display = 'none'; }

  let currentLoadingPercent = 0;
  let loadingTrickleTimer = null;

  function updateLoadingPercent(pct){
    const clamped = Math.round(Math.min(100, Math.max(0, pct)));
    if (clamped < currentLoadingPercent) return; // never visibly move backwards
    currentLoadingPercent = clamped;
    const p = document.getElementById('loading-percent');
    if (p) p.textContent = currentLoadingPercent + '%';
  }

  // Real per-instrument progress can arrive in one big burst near the end (all
  // staves often finish decoding at nearly the same moment, since they're doing
  // similar work in parallel) rather than smoothly — which looks like it's stuck.
  // This trickle guarantees continuous visible forward motion regardless, while
  // updateLoadingPercent's monotonic guard means real progress can still jump
  // ahead of it whenever it actually arrives.
  function startLoadingTrickle(){
    stopLoadingTrickle();
    loadingTrickleTimer = setInterval(() => {
      if (currentLoadingPercent < 90) updateLoadingPercent(currentLoadingPercent + 3);
    }, 180);
  }
  function stopLoadingTrickle(){
    if (loadingTrickleTimer){ clearInterval(loadingTrickleTimer); loadingTrickleTimer = null; }
  }

  // ---------- File loading ----------
  el('tab-add-btn').addEventListener('click', () => el('file-input').click());
  el('file-input').addEventListener('change', (e) => {
    openFiles(e.target.files);
    e.target.value = '';
  });

  ['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, (e)=>{
    e.preventDefault(); dropzone.classList.add('drag');
  }));
  ['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, (e)=>{
    e.preventDefault(); dropzone.classList.remove('drag');
  }));
  dropzone.addEventListener('drop', (e) => {
    e.stopPropagation();                                 // handled here, not by the window below
    openFiles(e.dataTransfer.files);
  });
  // With a score open the drop area is hidden: files dropped anywhere on the
  // page land here instead -- a new score, and/or its parts' recordings.
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    if (!workspace.classList.contains('active')){ e.preventDefault(); return; }   // not on the score: ignore
    e.preventDefault();
    openFiles(e.dataTransfer.files);
  });

  // Scores and recordings, picked or dropped together or on their own.
  // A recording's part is the end of its name: "Praise - Soprano.mp3" (or
  // just "Soprano.mp3") belongs to the part called Soprano. With a score in
  // the same drop they go with it; on their own they join the open score.
  function openFiles(fileList){
    const files = [...(fileList || [])];
    const isAudio = (f) => AUDIO_EXT.some(x => f.name.toLowerCase().endsWith(x));
    const scores = files.filter(f => !isAudio(f));
    const recordings = files.filter(isAudio).map(f => ({
      label: f.name.replace(/\.[^.]+$/, '').split(' - ').pop(),
      blob: f
    }));
    if (scores.length){
      handleFile(scores[0], recordings);
      return;
    }
    if (!recordings.length) return;
    const tab = scoreTabs.find(t => t.id === activeTabId);
    if (!tab){ showError('Open the score first, then add its recordings.'); return; }
    const parts = new Set(staffTracks.map(t => recKey(t.label)));
    const matched = recordings.filter(r => parts.has(recKey(r.label)));
    if (!matched.length){
      showError('None of these recordings matches a part of this score. Name them after the part, e.g. "' +
        tab.name + ' - ' + (staffTracks[0] ? staffTracks[0].label : 'Soprano') + '.mp3".');
      return;
    }
    const keep = (tab.recordings || []).filter(r => !matched.some(m => recKey(m.label) === recKey(r.label)));
    tab.recordings = keep.concat(matched);
    loadScoreFromText(tab.xmlText, tab.name);             // rebuild the parts with them
  }

  function handleFile(file, recordings, offlineKey, renderFiles){
    clearError();
    const name = file.name.toLowerCase();
    if (name.endsWith('.mxl')){
      const reader = new FileReader();
      reader.onload = async (e) => {
        try{
          const zip = await JSZip.loadAsync(e.target.result);
          let target = null;
          const container = zip.file('META-INF/container.xml');
          if (container){
            const containerText = await container.async('text');
            const match = containerText.match(/full-path="([^"]+)"/);
            if (match) target = zip.file(match[1]);
          }
          if (!target){
            const candidates = Object.keys(zip.files).filter(n => (n.endsWith('.xml') || n.endsWith('.musicxml')) && !n.includes('META-INF'));
            if (candidates.length) target = zip.file(candidates[0]);
          }
          if (!target) throw new Error('No score file found inside the .mxl archive.');
          const xmlText = await target.async('text');
          addTab(xmlText, file.name.replace(/\.[^.]+$/, ''), recordings, offlineKey, renderFiles);
        }catch(err){
          showError('Could not read that .mxl file: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => addTab(e.target.result, file.name.replace(/\.[^.]+$/, ''), recordings, offlineKey, renderFiles);
      reader.onerror = () => showError('Could not read that file.');
      reader.readAsText(file);
    }
  }

  // ---------- Core: load, render, parse ----------
  async function loadScoreFromText(xmlText, fallbackName, opts){
    const quick = !!(opts && opts.quick);   // switching tabs: no lingering on the loading screen
    const myGen = ++loadGeneration; // any tab-switch/new-load after this point invalidates us
    clearError();
    stopPlayback();
    disposeStaffTracks();
    cursorTimeline = [];
    const loadingStart = Date.now();
    el('loading-overlay').style.display = 'flex';
    document.body.style.cursor = 'wait';
    currentLoadingPercent = 0;
    updateLoadingPercent(0);
    startLoadingTrickle();

    try{

    if (!osmd){
      osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay('osmd-container', {
        autoResize: false,
        drawTitle: false,
        drawPartNames: true,
        drawingParameters: 'compacttight',
        cursorsOptions: [{ type: 0, color: '#6cc7ff', alpha: 0.32, follow: true }]
      });
    }

    try{
      await osmd.load(xmlText);
      if (myGen !== loadGeneration) return; // a newer tab load started while this was in flight

      // Critical ordering fix: #workspace (and the score container inside it) has
      // display:none until this point. OSMD needs to actually measure the
      // container's width to lay out staves — while it's hidden, that width is
      // zero, and every render silently produces nothing no matter how many times
      // or how patiently we retry. Make it visible BEFORE the first render call,
      // not after.
      dropzone.style.display = 'none';
      fitAudioShelfSoon();
      document.body.classList.add('workspace-active');
      workspace.classList.add('active');
      el('transport-controls').style.display = 'flex';

      // Applied AFTER load(), not before: OSMD resets zoom to its own default as
      // part of loading a new score, so setting it any earlier gets silently
      // overwritten and the score renders at 100% regardless of this value.
      osmd.zoom = zoom;
      osmd.render();
      // Defensive follow-up passes: on some complex multi-part scores OSMD's first
      // render can lay out blank before font metrics/layout fully settle. Rather than
      // guessing at fixed delays, actually check whether the score rendered visible
      // content and keep retrying (with backoff) until it does or we give up. This is
      // now AWAITED (not fire-and-forget) so the loading overlay stays visible for the
      // whole retry window instead of hiding early and leaving a blank score behind.
      const scoreLooksRendered = () => {
        try{
          const svg = document.querySelector('#osmd-container svg');
          if (!svg) return false;
          const rect = svg.getBoundingClientRect();
          // Broad on purpose: different scores/OSMD versions can lean on different SVG
          // element types for glyphs (path, g, text, use...). Counting everything avoids
          // false negatives that gave up before the score had actually finished painting.
          // Both thresholds here were set for a multi-staff score and reject
          // small ones. Measured: a single staff draws about 41px, not 60, and
          // an empty starting measure -- clef, time signature, one rest -- is
          // 18 elements, not 20. Either alone was enough to put a paragraph
          // saying the notation is missing directly above the visible
          // notation. What is actually being ruled out is a render that drew
          // nothing into a collapsed box, and four elements is well under any
          // real staff while still being more than an empty <svg> holds.
          return rect.height > 20 && svg.querySelectorAll('*').length > 4;
        }catch(err){ return true; } // if we can't check, don't loop forever over this
      };
      if (document.fonts && document.fonts.ready){
        try{ await document.fonts.ready; }catch(err){ /* ignore */ }
        if (myGen !== loadGeneration) return;
      }
      const rerenderDelays = [150, 350, 600, 1000, 1500, 2500];
      let lastRenderErr = null;
      for (let attempt = 0; attempt <= rerenderDelays.length; attempt++){
        if (myGen !== loadGeneration) return;
        try{
          // The render just above usually worked: drawing a big score again
          // straight away only doubled the wait. Redraw only when it didn't.
          if (attempt > 0 || !scoreLooksRendered()) osmd.render();
          // (The cursor map is built once, after the parts, below: walking
          // the whole score here as well cost a large score about 2 s.)
          lastRenderErr = null;
        }catch(err){ lastRenderErr = err; /* a later retry may still succeed */ }
        if (scoreLooksRendered() || attempt === rerenderDelays.length) break;
        await new Promise(res => setTimeout(res, rerenderDelays[attempt]));
      }
      if (!scoreLooksRendered()){
        console.error('Music Stand: score did not render after all retries.', lastRenderErr);
        showError(
          "The score loaded but the notation isn't displaying \u2014 this looks like a rendering " +
          "issue with this specific file rather than a loading delay. Open your browser's DevTools " +
          "console (F12) for the technical error, and share it if you're reporting this." +
          (lastRenderErr ? ' Error: ' + (lastRenderErr.message || lastRenderErr) : '')
        );
      }
    }catch(err){
      if (myGen !== loadGeneration) return;
      showError('This file could not be rendered as sheet music: ' + (err.message || err));
      return;
    }

    let xmlDoc;
    updateLoadingPercent(15);
    try{
      xmlDoc = new DOMParser().parseFromString(xmlText, 'application/xml');
      if (xmlDoc.querySelector('parsererror')) throw new Error('Invalid XML.');
    }catch(err){
      showError('The score rendered, but note data could not be parsed for playback: ' + err.message);
      xmlDoc = null;
    }

    const titleEl = xmlDoc && xmlDoc.querySelector('work-title, movement-title');
    const embeddedTitle = titleEl && titleEl.textContent.trim();
    // Some exporters (MuseScore included) stamp a literal placeholder like
    // "Untitled score" into the file instead of leaving the title empty --
    // treat that the same as no title at all, so the real file name shows
    // instead of the tool's placeholder text.
    const isPlaceholderTitle = embeddedTitle
      && /^untitled(\s+score)?$/i.test(embeddedTitle);
    el('piece-name').textContent =
      fallbackName || (!isPlaceholderTitle && embeddedTitle) || 'Untitled score';

    if (xmlDoc){
      try{
        const parsed = parseMusicXML(xmlDoc);
        await buildStaffTracks(parsed, myGen);
      }catch(err){
        showError('Score rendered, but I ran into trouble parsing playback data: ' + (err.message || err));
      }
    }
    // Click-to-select and follow-the-cursor positions, from the final layout.
    if (myGen === loadGeneration) buildCursorTimeline();

    } finally {
      stopLoadingTrickle();
      if (myGen === loadGeneration){
        // The library's "Opening <score>…" line has done its job.
        const note = el('lib-note');
        if (note && /^Opening /.test(note.textContent)) note.textContent = '';
        // Belt-and-suspenders: whatever path got us here, make sure the display
        // actually reaches 100 — and then give it a real, guaranteed moment to be
        // seen, rather than setting it and hiding the overlay in the same instant
        // (which happened whenever the minimum-visible-time floor below had
        // already elapsed by this point, making "100%" flash for a few
        // milliseconds — technically correct, invisible to a human).
        updateLoadingPercent(100);
        if (!quick){
          const elapsed = Date.now() - loadingStart;
          const minVisibleMs = 550; // guarantees the spin is actually perceptible even on fast local loads
          if (elapsed < minVisibleMs){
            await new Promise(res => setTimeout(res, minVisibleMs - elapsed));
          }
          await new Promise(res => setTimeout(res, 350)); // guaranteed visible time specifically at 100%
        }
        if (myGen === loadGeneration){
          el('loading-overlay').style.display = 'none';
          document.body.style.cursor = '';
        }
      }
    }
  }

  // ---------- MusicXML -> beat-time events ----------
  const STEP_SEMITONE = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};

  function midiFromPitch(step, alter, octave){
    return (octave + 1) * 12 + STEP_SEMITONE[step] + (alter || 0);
  }

  // Tempo of a <direction> or <sound>, in quarter notes per minute.
  // <sound tempo> is the playback value and always wins; failing that, the
  // printed metronome mark ("\u2669 = 72", or a half/dotted-quarter = N).
  function tempoOfNode(node){
    const snd = node.tagName === 'sound' ? node : node.querySelector('sound[tempo]');
    if (snd && snd.hasAttribute('tempo')){
      const v = parseFloat(snd.getAttribute('tempo'));
      if (v > 0) return v;
    }
    if (node.tagName !== 'direction') return null;
    const pm = node.querySelector('metronome per-minute');
    if (!pm) return null;
    const per = parseFloat(pm.textContent);
    if (!(per > 0)) return null;
    const unitEl = node.querySelector('metronome beat-unit');
    const unit = unitEl ? unitEl.textContent.trim() : 'quarter';
    const q = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[unit] || 1;
    return per * q * (node.querySelector('metronome beat-unit-dot') ? 1.5 : 1);
  }
  // Sorted, de-duplicated tempo changes starting at beat 0. The same mark
  // repeated on every part collapses into one; repeats of the current
  // tempo are dropped.
  function buildTempoMap(marks, fallback){
    const map = [];
    marks.slice().sort((a, b) => a.beat - b.beat).forEach(m => {
      const bpm = Math.max(20, Math.min(300, m.bpm));
      const last = map[map.length - 1];
      if (last && Math.abs(last.beat - m.beat) < 1e-6){ last.bpm = bpm; return; }
      if (last && last.bpm === bpm) return;
      map.push({ beat: m.beat, bpm });
    });
    if (!map.length) map.push({ beat: 0, bpm: fallback });
    else if (map[0].beat > 1e-6) map.unshift({ beat: 0, bpm: map[0].bpm });
    return map;
  }

  // Fermatas are held: over each note (or rest) marked with one, the tempo
  // map runs at 1/FERMATA_HOLD speed, so it lasts that many times longer.
  // Everything timed from the map -- the player, the metronome, rendered
  // voices, MIDI export -- then holds it by the same amount, and the notes'
  // beats (and so the score cursor) don't move. Held entries keep the
  // written tempo as `base`, which the tempo slider shows and scales from.
  const FERMATA_HOLD = 2;
  function holdFermatas(map, spans){
    if (!spans.length) return map;
    const merged = [];                       // the same fermata on every part is one hold
    spans.slice().sort((a, b) => a[0] - b[0]).forEach(([a, b]) => {
      const last = merged[merged.length - 1];
      if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
      else merged.push([a, b]);
    });
    const written = (beat) => {
      let bpm = map[0].bpm;
      for (const t of map){ if (t.beat <= beat + 1e-9) bpm = t.bpm; else break; }
      return bpm;
    };
    const cuts = [...new Set(map.map(t => t.beat).concat(...merged))].sort((x, y) => x - y);
    const out = [];
    cuts.forEach(beat => {
      const base = written(beat);
      const held = merged.some(([a, b]) => beat >= a - 1e-9 && beat < b - 1e-9);
      const bpm = held ? base / FERMATA_HOLD : base;
      const last = out[out.length - 1];
      if (last && last.bpm === bpm && !!last.fermata === held) return;
      out.push(held ? { beat, bpm, base, fermata: true } : { beat, bpm });
    });
    return out;
  }

  function parseMusicXML(xmlDoc){
    const partList = {};
    xmlDoc.querySelectorAll('part-list score-part').forEach(sp => {
      const id = sp.getAttribute('id');
      const nameEl = sp.querySelector('part-name');
      partList[id] = (nameEl && nameEl.textContent.trim()) || id;
    });

    const tracks = {}; // key: partId::staffNum -> {label, events:[]}
    let firstTempo = null;
    const measureStarts = []; // beat each bar begins at (first part only) -- drives the metronome accent and bar skipping
    const tempoMarks = [];    // { beat, bpm } for every tempo mark in any part
    const fermataSpans = [];  // [start, end] beats of every note or rest with a fermata

    const partEls = xmlDoc.querySelectorAll('part');

    partEls.forEach((partEl, partIdx) => {
      const partId = partEl.getAttribute('id');
      const partName = partList[partId] || partId;
      let divisions = 1;
      let measureStartBeat = 0;
      const ties = {}; // key -> event object reference

      partEl.querySelectorAll('measure').forEach(measure => {
        if (partIdx === 0) measureStarts.push(measureStartBeat);
        let cursor = measureStartBeat;
        let maxReached = measureStartBeat;
        let prevStartBeat = measureStartBeat;

        Array.from(measure.children).forEach(node => {
          const tag = node.tagName;

          if (tag === 'attributes'){
            const divEl = node.querySelector('divisions');
            if (divEl) divisions = parseFloat(divEl.textContent) || divisions;
          }
          else if (tag === 'direction' || tag === 'sound'){
            // Every tempo mark, not just the first: the piece is played
            // section by section at its own speed (see tempoMap).
            const bpm = tempoOfNode(node);
            if (bpm){
              if (firstTempo === null) firstTempo = bpm;
              tempoMarks.push({ beat: cursor, bpm });
            }
          }
          else if (tag === 'backup'){
            const durEl = node.querySelector('duration');
            const beats = durEl ? (parseFloat(durEl.textContent) / divisions) : 0;
            cursor -= beats;
          }
          else if (tag === 'forward'){
            const durEl = node.querySelector('duration');
            const beats = durEl ? (parseFloat(durEl.textContent) / divisions) : 0;
            cursor += beats;
            maxReached = Math.max(maxReached, cursor);
          }
          else if (tag === 'note'){
            const isGrace = !!node.querySelector('grace');
            const isChord = !!node.querySelector('chord');
            const isRest = !!node.querySelector('rest');
            const durEl = node.querySelector('duration');
            const durBeats = (!isGrace && durEl) ? (parseFloat(durEl.textContent) / divisions) : 0;
            const staffEl = node.querySelector('staff');
            const staffNum = staffEl ? staffEl.textContent.trim() : '1';
            const voiceEl = node.querySelector('voice');
            const voiceNum = voiceEl ? voiceEl.textContent.trim() : '1';
            const trackKey = partId + '::' + staffNum;

            if (!tracks[trackKey]){
              tracks[trackKey] = { label: partName, staffNum, events: [] };
            }

            const startBeat = isChord ? prevStartBeat : cursor;
            if (!isGrace && durBeats > 0 && node.querySelector('fermata')) fermataSpans.push([startBeat, startBeat + durBeats]);

            if (!isRest && !isGrace){
              const pitchEl = node.querySelector('pitch');
              if (pitchEl){
                const step = pitchEl.querySelector('step').textContent.trim();
                const alterEl = pitchEl.querySelector('alter');
                const alter = alterEl ? parseFloat(alterEl.textContent) : 0;
                const octave = parseInt(pitchEl.querySelector('octave').textContent.trim(), 10);
                const midi = midiFromPitch(step, alter, octave);

                const tieStop = Array.from(node.querySelectorAll('tie')).some(t => t.getAttribute('type') === 'stop');
                const tieStart = Array.from(node.querySelectorAll('tie')).some(t => t.getAttribute('type') === 'start');
                const tieKey = trackKey + '::v' + voiceNum + '::p' + midi;

                if (tieStop && ties[tieKey]){
                  ties[tieKey].dur += durBeats;
                  if (!tieStart) delete ties[tieKey];
                } else {
                  // Capture the lyric so the AI Singer can sing words rather
                  // than vowels. Other instruments simply ignore these fields.
                  let lyricText = null, syllabic = null;
                  const lyricEl = node.querySelector('lyric');
                  if (lyricEl){
                    const txt = Array.from(lyricEl.querySelectorAll('text'))
                      .map(t => t.textContent || '').join(' ').trim();
                    if (txt) lyricText = txt;
                    const syEl = lyricEl.querySelector('syllabic');
                    if (syEl) syllabic = (syEl.textContent || '').trim();
                    if (lyricEl.querySelector('extend')) syllabic = syllabic || 'extend';
                  }
                  const evt = { time: startBeat, dur: durBeats, midi,
                                lyric: lyricText, syllabic };
                  tracks[trackKey].events.push(evt);
                  if (tieStart) ties[tieKey] = evt;
                }
              }
            }

            if (!isChord && !isGrace){
              cursor += durBeats;
              maxReached = Math.max(maxReached, cursor);
            }
            prevStartBeat = startBeat;
          }
        });

        measureStartBeat = maxReached;
      });
    });

    Object.keys(tracks).forEach(k => assignPhonemes(tracks[k].events));

    warmVoicePack(tracks);
    return { tracks, tempo: firstTempo || 120, measureStarts, tempoMap: holdFermatas(buildTempoMap(tempoMarks, firstTempo || 120), fermataSpans) };
  }

  // Turn each track's lyric syllables into per-note phonemes. Words split
  // across notes ("for-ev-er") are rejoined before conversion and split back
  // by vowel nucleus, and notes with no lyric of their own sustain the vowel
  // of the syllable they extend.

  // The Real Voice plays recordings, and a recording has to be decoded
  // before it can play. Doing that here, while the score is still loading,
  // keeps the first note of every sound on time instead of arriving late.
  function warmVoicePack(tracks){
    if (typeof voicePackWarm !== 'function' || !voicePack()) return;
    const pairs = [];
    Object.keys(tracks).forEach(k => {
      let prev = null;
      (tracks[k].events || []).forEach(ev => {
        (ev.ph || ['AH']).forEach(p => { pairs.push([prev, p]); prev = p; });
      });
    });
    if (!pairs.length) return;
    Promise.resolve(voicePackWarm(Tone.getContext(), pairs))
      .catch(err => console.error('voice pack warm-up failed', err));
  }

  function assignPhonemes(events){
    if (!events || !events.length) return;
    if (typeof singerLyricToPhonemes !== 'function') return;
    if (!events.some(e => e.lyric)) return;

    events.sort((a, b) => a.time - b.time);

    // chord members share one syllable: only the first note at a time carries it
    const heads = [];
    let lastTime = null;
    events.forEach(e => {
      if (lastTime === null || Math.abs(e.time - lastTime) > 1e-6){
        heads.push([e]);
        lastTime = e.time;
      } else {
        heads[heads.length - 1].push(e);
      }
    });

    // Engraving robustness, matching singing/align.py: a stray "end" mid-word
    // ("Al-le" + "lu-ia") is rejoined, and a "single" that follows a word left
    // open by a "begin" completes it ("ac" + "cord"). A rest still ends a word.
    const groups = [];
    let current = [];
    let restSince = false;
    let prevEnd = null;
    heads.forEach(chord => {
      const e = chord[0];
      if (prevEnd !== null && (e.time - prevEnd) > 0.75) restSince = true;
      prevEnd = Math.max.apply(null, chord.map(x => x.time + x.dur));
      if (e.lyric){
        const syl = (e.syllabic || 'single').toLowerCase();
        if (syl === 'begin' && current.length){
          groups.push(current); current = [];
        } else if (syl === 'single' && current.length && restSince){
          groups.push(current); current = [];
        } else if (syl === 'single' && current.length){
          // fall through: finish the word this syllable belongs to
        } else if ((syl === 'middle' || syl === 'end') && !current.length
                   && groups.length && !restSince){
          current = groups.pop();
        }
        current.push(chord);
        restSince = false;
        if (syl === 'single' || syl === 'end'){ groups.push(current); current = []; }
      } else if (current.length){
        current.push(chord);
      } else if (groups.length){
        groups[groups.length - 1].push(chord);
      }
    });
    if (current.length) groups.push(current);

    groups.forEach(group => {
      const withLyric = group.filter(c => c[0].lyric);
      if (!withLyric.length){
        group.forEach(c => c.forEach(e => { e.ph = ['AH']; }));
        return;
      }
      const per = singerLyricToPhonemes(withLyric.map(c => c[0].lyric));
      const map = new Map();
      withLyric.forEach((c, i) => map.set(c, (per[i] && per[i].length) ? per[i] : ['AH']));

      let last = null;
      group.forEach(chord => {
        let ph;
        if (map.has(chord)){
          ph = map.get(chord);
          last = ph;
        } else {
          // melisma: hold the vowel of the syllable being extended
          let vowel = 'AH';
          if (last){
            for (let i = last.length - 1; i >= 0; i--){
              if (SINGER_DATA.VOWELS[last[i]]){ vowel = last[i]; break; }
            }
          }
          ph = [vowel];
        }
        chord.forEach(e => { e.ph = ph; });
      });
    });
  }

  // ---------- Build UI + Tone.js chains ----------
  function disposeStaffTracks(){
    lyricsClose(); // its voice belongs to the score being replaced
    staffTracks.forEach(t => {
      if (t.synth) t.synth.dispose();
      if (t.panner) t.panner.dispose();
      if (t.gain) t.gain.dispose();
    });
    scheduledParts.forEach(p => p.dispose());
    scheduledParts = [];
    staffTracks = [];
    el('staff-list').innerHTML = '';
    clearPrerenderCache();
  }

  async function buildStaffTracks(parsed, myGen){
    measureStarts = parsed.measureStarts || [];
    tempoMap = parsed.tempoMap || [{ beat: 0, bpm: parsed.tempo }];
    tempoFactor = 1;
    baseTempo = Math.max(30, Math.min(220, Math.round(tempoMap[0].base || tempoMap[0].bpm))); // the opening tempo
    el('tempo-slider').value = baseTempo;
    tempoPaint();
    el('tempo-val').innerHTML = baseTempo + '<small> bpm</small>';

    const keys = Object.keys(parsed.tracks);
    if (keys.length === 0){
      el('staff-list').innerHTML = '<div class="empty-note">No playable notes were found in this file.</div>';
      totalDuration = 0;
      updateTimeReadout();
      samplesReady = true;
      setLoadingState(false);
      updateLoadingPercent(100);
      return;
    }

    // Group staves by their MusicXML <part>, so a multi-staff instrument (like a
    // piano's treble+bass grand staff) gets ONE mixer channel instead of one per
    // staff — they're the same instrument, just notated across two staves. The
    // score itself still renders every staff exactly as before; this only
    // affects mixing/playback grouping.
    const partOrder = [];
    const partGroups = {}; // partId -> { label, events: [] }
    keys.forEach(key => {
      const t = parsed.tracks[key];
      const partId = key.split('::')[0];
      if (!partGroups[partId]){
        partGroups[partId] = { label: t.label, events: [] };
        partOrder.push(partId);
      }
      partGroups[partId].events = partGroups[partId].events.concat(t.events);
    });

    const listEl = el('staff-list');
    listEl.innerHTML = '';
    let maxBeat = 0;
    samplesReady = false;
    setLoadingState(true);

    const tab = scoreTabs.find(t => t.id === activeTabId);
    // Parts without a recording of their own look in the Rendered Songs
    // folders (once per tab).
    // Which parts have a render in a Rendered Songs folder (or next to the
    // score on Drive): only listed here. A part downloads its own render
    // when "Render" is chosen for it, so nothing is fetched that isn't used.
    if (tab && !tab.renderedChecked){
      tab.renderedChecked = true;
      try{
        const all = (await renderedFor(tab.name, true)) || [];   // fresh: a render just re-uploaded counts
        // A render already on this device is replaced, without asking, when
        // Drive has a newer one (re-rendered): a different file, or a later
        // change date. One downloaded before versions were kept is refreshed
        // once. Offline the check finds nothing, and the device copy plays.
        const onDevice = new Map((tab.recordings || []).map(r => [recKey(r.label), r]));
        const newer = all.filter(f => {
          const r = onDevice.get(recKey(f.label));
          return r && (!r.modifiedTime || r.driveId !== f.item.driveId
                       || (f.item.modifiedTime && f.item.modifiedTime > r.modifiedTime));
        });
        if (newer.length){
          const got = await fetchRecordings(newer);
          if (got.length){
            const fresh = new Set(got.map(g => recKey(g.label)));
            tab.recordings = tab.recordings.filter(r => !fresh.has(recKey(r.label))).concat(got);
            saveRecordingsOffline(tab);
          }
        }
        const known = new Set((tab.renderFiles || []).map(r => recKey(r.label)));
        const found = all.filter(r => !known.has(recKey(r.label)));
        tab.renderFiles = (tab.renderFiles || []).concat(found);
      }catch(err){ /* none offered then */ }
      if (myGen !== loadGeneration) return;
    }
    const recordings = tab && tab.recordings && tab.recordings.length ? await decodeRecordings(tab.recordings) : new Map();
    if (myGen !== loadGeneration) return;

    const loadPromises = [];
    let loadedCount = 0;
    const totalToLoad = partOrder.length; // known before any async work starts — one instrument per staff group
    const onInstrumentProgress = () => {
      loadedCount++;
      if (totalToLoad > 0) updateLoadingPercent(20 + Math.round((loadedCount / totalToLoad) * 80));
    };

    partOrder.forEach((partId, i) => {
      const group = partGroups[partId];
      const colorVar = COLORS[i % COLORS.length];
      const pan = partOrder.length > 1 ? (-0.4 + (i / (partOrder.length - 1)) * 0.8) : 0;
      const gain = new Tone.Gain(0.8).toDestination();
      const panner = new Tone.Panner(pan).connect(gain);
      // a part whose render is on this device starts on it; one only on
      // Drive is offered as "Render"
      const recording = recordings.get(recKey(group.label)) || null;
      const renderFile = recording ? null
        : ((tab && tab.renderFiles) || []).find(r => recKey(r.label) === recKey(group.label)) || null;
      const instrument = recording ? 'recording' : DEFAULT_INSTRUMENT;
      const synth = createInstrumentVoice(instrument, loadPromises, onInstrumentProgress, group.label, recording).connect(panner);

      group.events.forEach(e => { maxBeat = Math.max(maxBeat, e.time + e.dur); });

      const track = {
        id: partId,
        label: group.label,
        events: group.events,
        colorVar,
        synth, gain, panner, instrument, recording, renderFile,
        muted: false, soloed: false, volume: 80
      };
      staffTracks.push(track);
      listEl.appendChild(renderStaffCard(track));
    });

    if (INSTRUMENTS[DEFAULT_INSTRUMENT] && INSTRUMENTS[DEFAULT_INSTRUMENT].kind === 'sampler'){
      updateLoadingPercent(20);
      const loadTimeout = new Promise(res => setTimeout(res, 12000));
      await Promise.race([Promise.all(loadPromises), loadTimeout]);
      if (myGen === loadGeneration){ // a newer tab/load may have since taken over — don't touch its state
        samplesReady = true;
        setLoadingState(false);
        updateLoadingPercent(100);
      }
    } else {
      samplesReady = true; // synth voices are ready instantly, no loading needed
      setLoadingState(false);
      updateLoadingPercent(100);
    }

    totalDuration = beatsToSeconds(maxBeat, baseTempo);
    updateTimeReadout();
    updateTempoLock();
  }

  function setLoadingState(loading){
    const btn = el('play-btn');
    btn.disabled = loading;
    btn.title = loading ? 'Loading instrument…' : 'Play / Pause (space)';
    btn.textContent = loading ? '…' : (isPlaying ? '⏸' : '▶');
  }

  function beatsToSeconds(beats){
    let sec = 0;
    for (let i = 0; i < tempoMap.length; i++){
      const a = tempoMap[i].beat;
      if (beats <= a) break;
      const b = i + 1 < tempoMap.length ? tempoMap[i + 1].beat : Infinity;
      sec += (Math.min(beats, b) - a) * 60 / (tempoMap[i].bpm * tempoFactor);
    }
    return sec;
  }
  // Seconds a note lasts -- across a tempo change it's not just dur * 60/bpm.
  const noteSeconds = (e) => beatsToSeconds(e.time + e.dur) - beatsToSeconds(e.time);

  function renderStaffCard(track){
    const card = document.createElement('div');
    card.className = 'staff-card';
    card.style.setProperty('--stc', `var(${track.colorVar})`);
    card.style.setProperty('--vu-level', track.volume + '%');
    card.dataset.trackId = track.id;
    // Every sung part (one with lyrics) offers its render: "Rendered" when
    // it's on this device, "Render" otherwise (choosing it looks in the
    // Rendered Songs folder and downloads it, or says there is none). A
    // piano or other instrument part isn't offered one.
    const sung = track.events.some(e => e.lyric);
    const pianoOnly = !sung && track.instrument === 'piano';   // the piano part has just the one voice
    const instrumentOptions = Object.keys(INSTRUMENTS)
      .filter(key => pianoOnly ? key === 'piano' : (INSTRUMENTS[key].inMenu !== false || key === track.instrument))
      .filter(key => key !== 'recording' || sung || track.recording).map(key => {
      const def = INSTRUMENTS[key];
      if (key === 'recording' && !track.recording){
        return `<option value="${key}"${key === track.instrument ? ' selected' : ''}>${RENDER_CLOUD} Render</option>`;   // "Rendered" only once it's on this device
      }
      const text = def.optionLabel || (key.charAt(0).toUpperCase() + key.slice(1));
      return `<option value="${key}"${key === track.instrument ? ' selected' : ''}>${def.short && !pianoOnly ? def.short + ' ' : ''}${escapeHtml(text)}</option>`;
    }).join('');

    card.innerHTML = `
      <div class="sc-led"></div>
      <div class="sc-show">
        <button class="sc-eye" type="button" aria-pressed="false" title="Show this staff (tap more eyes to show several; hidden staves still sing)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle class="eye-pupil" cx="8" cy="8" r="2"/><path class="eye-slash" d="M2.5 2.5l11 11"/></svg>
        </button>
        <span class="sc-name">${escapeHtml(track.label)}</span>
      </div>
      <div class="sc-inst-wrap${pianoOnly ? ' piano' : ''}">
        ${pianoOnly ? '<span class="sc-piano-ico" aria-hidden="true"><svg viewBox="0 0 16 16"><rect class="k k1" x="1" y="4" width="3.4" height="9" rx=".8"/><rect class="k k2" x="4.6" y="4" width="3.4" height="9" rx=".8"/><rect class="k k3" x="8.2" y="4" width="3.4" height="9" rx=".8"/><rect class="k k4" x="11.8" y="4" width="3.4" height="9" rx=".8"/><rect class="b" x="3.2" y="3" width="2.4" height="5.6" rx=".6"/><rect class="b" x="6.8" y="3" width="2.4" height="5.6" rx=".6"/><rect class="b" x="10.4" y="3" width="2.4" height="5.6" rx=".6"/></svg></span>' : ''}
        <span class="sc-inst-ico" aria-hidden="true" hidden>
          <svg viewBox="0 0 16 16"><rect class="m" x="3.6" y="1.5" width="4.8" height="8" rx="2.4"/><path class="s" d="M1.6 7.2a4.4 4.4 0 0 0 8.8 0M6 11.6v2.9M3.9 14.5h4.2"/><path class="w w1" d="M11.4 3.6a3.4 3.4 0 0 1 0 4.4"/><path class="w w2" d="M13.3 2.1a5.8 5.8 0 0 1 0 7.4"/></svg>
        </span>
        <select class="sc-instrument${pianoOnly ? ' single' : ''}" title="Instrument for this staff">${instrumentOptions}</select>
      </div>
      <div class="sc-toggles">
        <button class="toggle-pill solo-btn" title="Hear only the soloed parts">Solo</button>
      </div>
      <div class="ch-fader-row">
        <div class="vu-meter"><div class="vu-fill"></div></div>
        <div class="fader-wrap">
          <input type="range" min="0" max="100" value="80" class="vol-slider">
        </div>
      </div>
      <span class="sc-value vol-val">80</span>
    `;
    card.querySelector('.sc-eye').addEventListener('click', () => focusStaff(track));
    requestAnimationFrame(() => { paintStaffEyes(); paintFaders(); paintSoloButtons(); });
    card.querySelector('.sc-instrument').addEventListener('change', (e) => {
      renderOptFace(e.target, false);
      Promise.resolve(switchStaffInstrument(track, e.target.value)).finally(() => paintInstIcon(track));
    });
    // In the open list Rendered wears its mic like the others wear theirs;
    // closed, the singing mic beside the dropdown shows it instead.
    ['pointerdown', 'keydown'].forEach(ev => card.querySelector('.sc-instrument')
      .addEventListener(ev, (e) => renderOptFace(e.currentTarget, true)));
    card.querySelector('.sc-instrument').addEventListener('blur', (e) => renderOptFace(e.currentTarget, false));
    requestAnimationFrame(() => { paintInstIcon(track); offerRender(track); });
    card.querySelector('.solo-btn').addEventListener('click', () => {
      if (lyricsTrack){
        if (track.id === lyricsTrack.id) return;              // the lead keeps singing
        if (accompaniment().includes(track)){                 // the piano follows the Piano switch
          const pb = el('lyrics-piano');
          pb.checked = !pb.checked;
          pb.dispatchEvent(new Event('change', { bubbles: true }));
          return;
        }
        if (lyricsExtra.has(track.id)) lyricsExtra.delete(track.id); else lyricsExtra.add(track.id);
        lyricsSetFocus();
        applyMixState();
        return;
      }
      track.soloed = !track.soloed;
      card.querySelector('.solo-btn').classList.toggle('on-solo', track.soloed);
      applyMixState();
    });
    card.querySelector('.vol-slider').addEventListener('input', (e) => {
      const v = parseInt(e.target.value, 10);
      // In the lyrics view the fader sets that view's level, not the mixer's.
      if (lyricsFocus && lyricsFocus.has(track.id)) lyricsSetLevel(track, v);
      else track.volume = v;
      applyMixState();
    });
    return card;
  }

  // ---------- Score library ----------
  // ---------- Shared library (Google Drive, from config.ark2) ----------
  // config.ark2 sits next to index.html. Lines read "Name - value"; a line
  // starting // opens a section ("Audio" or "Music Notes"). The API key
  // line is "APIKey - ...", and each folder line is a Google Drive folder
  // link shared as "Anyone with the link". Those folders show up in the
  // folder pickers of both players and are read with the Drive API --
  // listing, then downloading a score / streaming a song on demand.
  var _cloudCfgP = null;                                  // var: may be asked for before this line runs
  var cloudCfg = { key: '', notes: [], audio: [], sheets: [], recordings: [] };
  function parseCloudConfig(txt){
    const cfg = { key: '', notes: [], audio: [], sheets: [], recordings: [], pin: '' };
    let section = null;
    (txt || '').split(/\r?\n/).forEach(raw => {
      const line = raw.trim();
      if (!line) return;
      if (line.startsWith('//')){
        const h = line.toLowerCase();
        section = /\bpin\b|passcode|access code/.test(h) ? 'pin'
          : /render/.test(h) ? 'recordings'          // "// Rendered Songs": part recordings
          : /sheet|pdf/.test(h) ? 'sheets'
          : /audio|song|record/.test(h) ? 'audio'
          : /note|score|music/.test(h) ? 'notes' : null;
        return;
      }
      // The access PIN: the first line under a "// ... pin ..." heading,
      // either on its own ("1234") or as "PIN - 1234".
      if (section === 'pin'){
        if (!cfg.pin){
          const pm = line.match(/^(?:pin|code|passcode)\s*[-\u2013:=]\s*(\S+)\s*$/i);
          cfg.pin = (pm ? pm[1] : line).trim();
        }
        return;
      }
      const m = line.match(/^(.+?)\s*[-\u2013:=]\s*(\S+)\s*$/);
      if (!m) return;
      const name = m[1].trim(), val = m[2];
      if (/^api\s*key$/i.test(name)){ cfg.key = val; return; }
      const id = (val.match(/\/folders\/([A-Za-z0-9_-]+)/) || val.match(/[?&]id=([A-Za-z0-9_-]+)/) || [])[1];
      if (id && section) cfg[section].push({ name, id });
    });
    if (!cfg.key){ cfg.notes = []; cfg.audio = []; cfg.sheets = []; cfg.recordings = []; }  // nothing can be read without the key
    return cfg;
  }
  function getCloudConfig(){
    if (!_cloudCfgP){
      // A connection that's up but not getting through (weak signal, Wi-Fi
      // with no internet) can leave a request hanging for minutes. Give up
      // after 8 s and carry on without the shared folders; they're added
      // when the connection comes back (cloudConfigRetry).
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      _cloudCfgP = fetch('config.ark2', { cache: 'no-store', signal: ctl.signal })
        .then(r => r.ok ? r.text() : null)
        .catch(() => null)
        .then(txt => {
          clearTimeout(timer);
          cloudCfg = parseCloudConfig(txt || '');
          cloudCfg.reachable = txt !== null;   // false when offline / file missing
          return cloudCfg;
        });
    }
    return _cloudCfgP;
  }
  const driveMediaUrl = (id) =>
    'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media&key=' + encodeURIComponent(cloudCfg.key);

  // Every file under a shared folder (and its sub-folders, a few deep)
  // whose name ends in one of `exts`. Titles come from file names, so
  // nothing is downloaded just to fill the shelf.
  async function driveList(folderId, exts, rel = '', depth = 0, out = []){
    let pageToken = '';
    do {
      const q = encodeURIComponent("'" + folderId + "' in parents and trashed=false");
      const url = 'https://www.googleapis.com/drive/v3/files?q=' + q +
        '&fields=nextPageToken,files(id,name,mimeType,modifiedTime,size)&pageSize=1000&key=' + encodeURIComponent(cloudCfg.key) +
        (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
      const res = await fetch(url);
      const j = await res.json().catch(() => ({}));
      if (!res.ok){
        const e = new Error((j.error && j.error.message) || ('HTTP ' + res.status));
        e.status = res.status;
        throw e;
      }
      for (const f of (j.files || [])){
        if (f.mimeType === 'application/vnd.google-apps.folder'){
          if (depth < 3) await driveList(f.id, exts, rel + f.name + '/', depth + 1, out);
        } else if (exts.some(x => f.name.toLowerCase().endsWith(x))){
          out.push({ driveId: f.id, name: f.name, rel, modifiedTime: f.modifiedTime || '', size: +f.size || 0 });
        }
      }
      pageToken = j.nextPageToken || '';
    } while (pageToken);
    return out;
  }
  function driveErrorText(err){
    // The note below is all the viewer sees; the console keeps the real cause.
    console.warn('Shared folder:', err);
    if (!navigator.onLine) return "You're offline — shared folders need an internet connection.";
    if (err && (err.status === 403 || err.status === 400))
      return "Couldn't open the shared folder — check the API key in config.ark2.";
    if (err && err.status === 404)
      return "Shared folder not found — make sure it's shared as \u201CAnyone with the link\u201D.";
    return "Couldn't reach the shared folder. Check your connection and tap Scan to try again.";
  }

  // Which source a picker should start on: the viewer's last choice if it
  // still exists, otherwise the first shared folder, otherwise this device.
  function sourcePref(storageKey, drives){
    let saved = '';
    try{ saved = localStorage.getItem(storageKey) || ''; }catch(err){ /* ignore */ }
    if (saved === 'local') return 'local';
    if (saved.startsWith('drive:') && drives.some(d => 'drive:' + d.id === saved)) return saved;
    return drives.length ? 'drive:' + drives[0].id : 'local';
  }
  // Start-up choice when nothing is saved on the device: a folder on this
  // device if that was in use, otherwise no selection at all.
  function startPref(storageKey){
    let saved = '';
    try{ saved = localStorage.getItem(storageKey) || ''; }catch(err){ /* ignore */ }
    return saved === 'local' ? 'local' : '';
  }
  function saveSourcePref(storageKey, v){
    try{ localStorage.setItem(storageKey, v); }catch(err){ /* ignore */ }
  }
  // Rebuilds one picker: shared folders, then this device.
  function fillSourceSelect(sel, drives, localName, current, placeholder, offline = []){
    sel.innerHTML = '';
    // A blank first entry, shown while nothing is chosen -- the picker only
    // lands on a folder by itself when copies are saved on this device.
    const ph = new Option(drives.length || localName || offline.length ? 'Select a folder…' : placeholder, '');
    ph.disabled = true;
    sel.add(ph);
    if (drives.length){
      const g = document.createElement('optgroup');
      g.label = 'Shared (Google Drive)';
      drives.forEach(d => g.appendChild(new Option('\u2601 ' + d.name, 'drive:' + d.id)));
      sel.appendChild(g);
    }
    const lg = document.createElement('optgroup');
    lg.label = 'On this device';
    offline.forEach(o => lg.appendChild(new Option('\uD83D\uDCE5 ' + o.folderName, 'offline:' + o.folderId)));
    if (localName) lg.appendChild(new Option('\uD83D\uDCC1 ' + localName, 'local'));
    lg.appendChild(new Option('Choose a folder\u2026', 'browse'));
    sel.appendChild(lg);
    sel.value = [...sel.options].some(o => o.value === current) ? current : '';
  }

  const LIB_EXT = ['.musicxml', '.xml', '.mxl'];

  // ---------- Offline copies of shared scores ----------
  // Scores downloaded from a shared folder are kept in their own IndexedDB
  // store on this device, one record per file: the bytes, where it came
  // from, when it was saved, and Drive's modifiedTime at that moment (so a
  // later change on Drive shows as "update available"). The picker lists
  // each folder that has saved scores as "📥 <folder name>".
  var _offDbP = null;
  function offlineDb(){
    if (!_offDbP){
      _offDbP = new Promise((res, rej) => {
        // v2 adds 'songs' (Audio Player) beside 'scores' (Note Player).
        const r = indexedDB.open('ark2-offline', 3);                // v3: + 'sheets' (Music Sheet PDFs)
        r.onupgradeneeded = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains('scores')) db.createObjectStore('scores', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('sheets')) db.createObjectStore('sheets', { keyPath: 'key' });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return _offDbP;
  }
  const idbDone = (req) => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
  async function offlineAll(store = 'scores'){
    try{ return await idbDone((await offlineDb()).transaction(store).objectStore(store).getAll()); }
    catch(err){ return []; }
  }
  async function offlinePut(rec, store = 'scores'){
    return idbDone((await offlineDb()).transaction(store, 'readwrite').objectStore(store).put(rec));
  }
  async function offlineDelete(key, store = 'scores'){
    return idbDone((await offlineDb()).transaction(store, 'readwrite').objectStore(store).delete(key));
  }
  // One entry per folder that has anything saved, in config order where known.
  async function offlineFolders(store = 'scores'){
    const recs = await offlineAll(store);
    const by = new Map();
    recs.forEach(r => {
      const f = by.get(r.folderId) || { folderId: r.folderId, folderName: r.folderName, count: 0 };
      f.count++;
      by.set(r.folderId, f);
    });
    const order = (store === 'songs' ? cloudCfg.audio : store === 'sheets' ? cloudCfg.sheets : cloudCfg.notes).map(n => n.id);
    return [...by.values()].sort((a, b) => {
      const ia = order.indexOf(a.folderId), ib = order.indexOf(b.folderId);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.folderName.localeCompare(b.folderName);
    });
  }
  // "Sep 24" this year, "Sep 24, 2025" for older saves -- short enough for a phone row.
  const savedDate = (t) => {
    const d = new Date(t);
    return d.toLocaleDateString(undefined, d.getFullYear() === new Date().getFullYear()
      ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // Score library source: '' until known, 'drive:<folderId>',
  // 'offline:<folderId>' (saved copies), or 'local'.
  let libSource = '', libLocalName = '', libOffline = [];
  function libFillSource(){
    fillSourceSelect(el('lib-path'), cloudCfg.notes, libLocalName, libSource,
                     'No folder chosen — pick one to build your library', libOffline);
    libUpdateDownloadAll();
  }
  async function libRefreshOffline(){
    libOffline = await offlineFolders();
    libFillSource();
  }

  async function libLoadOffline(folderId){
    const recs = (await offlineAll()).filter(r => r.folderId === folderId);
    if (libSource !== 'offline:' + folderId) return;
    if (!recs.length){ libNote('Nothing saved from this folder yet.'); el('lib-shelf').innerHTML = ''; return; }
    libItems = recs.map(r => ({
      name: r.name, rel: r.rel || '', title: r.title,
      file: new File([r.blob], r.name),
      recordings: r.recordings || [],
      offlineKey: r.key,
      subText: 'Saved ' + savedDate(r.savedAt)
    }));
    libItems.sort((a, b) => (a.rel + a.name).localeCompare(b.rel + b.name));
    await libRender(libItems);
    libNote(recs.length + (recs.length === 1 ? ' score' : ' scores') + ' saved on this device');
  }

  // Download one shared score into the offline store.
  async function libSaveOffline(item){
    const folderId = libSource.slice(6);
    const folder = cloudCfg.notes.find(f => f.id === folderId);
    await getCloudConfig();
    const res = await fetch(driveMediaUrl(item.driveId));
    if (!res.ok){ const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    const rec = {
      key: folderId + ':' + item.driveId, folderId,
      folderName: folder ? folder.name : 'Shared scores',
      driveId: item.driveId, name: item.name, rel: item.rel || '',
      title: item.title || item.name.replace(/\.[^.]+$/, ''),
      blob: await res.blob(), savedAt: Date.now(), modifiedTime: item.modifiedTime || '',
      // renders already downloaded into an earlier saved copy stay; others
      // are downloaded part by part when chosen ("Render")
      recordings: ((await offlineAll()).find(r => r.key === folderId + ':' + item.driveId) || {}).recordings || []
    };
    await offlinePut(rec);
    item.saved = { savedAt: rec.savedAt, modifiedTime: rec.modifiedTime };
    // Ask the browser not to clear these when space runs low.
    try{ if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(err){ /* ignore */ }
  }
  const libNeedsDownload = (item) => !item.saved || (item.modifiedTime && item.saved.modifiedTime !== item.modifiedTime);

  function libUpdateDownloadAll(){
    const b = el('lib-dl-all');
    if (!libSource.startsWith('drive:') || !libItems.length || !libItems[0].driveId){ b.hidden = true; return; }
    b.hidden = false;
    const todo = libItems.filter(libNeedsDownload).length;
    b.disabled = todo === 0;
    b.querySelector('span').textContent = todo === 0 ? 'All saved on this device'
      : (todo === libItems.length ? 'Download all (' + todo + ')' : 'Download ' + todo + ' more');
  }
  let libDownloading = false;
  el('lib-dl-all').addEventListener('click', async () => {
    if (libDownloading) return;
    const src = libSource;
    const todo = libItems.filter(libNeedsDownload);
    if (!todo.length) return;
    libDownloading = true;
    el('lib-dl-all').disabled = true;
    let done = 0, failed = 0;
    for (const item of todo){
      if (libSource !== src) break;                       // switched folder: stop
      libNote('Downloading ' + (done + 1) + ' of ' + todo.length + '\u2026');
      try{ await libSaveOffline(item); }catch(err){ failed++; }
      done++;
    }
    libDownloading = false;
    await libRefreshOffline();
    if (libSource === src) await libRender(libItems);
    libNote(failed ? (done - failed) + ' saved, ' + failed + " couldn't be downloaded — tap Download again to retry."
                   : 'Saved ' + done + (done === 1 ? ' score' : ' scores') + ' on this device.');
  });
  // A folder on this device was opened (Browse/Scan/Android): name it in the
  // picker and make it the current source.
  function libSourceLocal(name, select = true){
    libLocalName = name || '';
    if (select){ libSource = 'local'; saveSourcePref('libSource', 'local'); }
    libFillSource();
  }
  async function libLoadDrive(id){
    await getCloudConfig();
    const f = cloudCfg.notes.find(x => x.id === id);
    libNote('Loading ' + (f ? f.name : 'shared folder') + '\u2026');
    try{
      const all = await driveList(id, LIB_EXT.concat(AUDIO_EXT));
      if (libSource !== 'drive:' + id) return;             // switched away while loading
      // recordings ("Song - Alto.mp3") ride along with their score
      const audio = all.filter(x => !libIsScore(x.name));
      const found = all.filter(x => libIsScore(x.name));
      found.forEach(x => { x.recFiles = recordingsFor(x, audio); });
      const saved = new Map((await offlineAll()).filter(r => r.folderId === id).map(r => [r.driveId, r]));
      libItems = found.map(x => Object.assign(x, {
        file: null, title: x.name.replace(/\.[^.]+$/, ''),
        saved: saved.has(x.driveId) ? { savedAt: saved.get(x.driveId).savedAt, modifiedTime: saved.get(x.driveId).modifiedTime } : null
      }));
      libItems.sort((a, b) => (a.rel + a.name).localeCompare(b.rel + b.name));
      await libRender(libItems);
    }catch(err){ libNote(driveErrorText(err)); }
  }
  // A score's recordings from Drive -> [{ label, blob }]. One that can't be
  // fetched is left out; its part plays its usual instrument.
  async function fetchRecordings(recFiles){
    const out = [];
    for (const r of recFiles || []){
      try{
        const res = await fetch(driveMediaUrl(r.item.driveId));
        // which Drive file and version this is, so a newer render there can
        // replace it later (see the Rendered Songs check in buildStaffTracks)
        if (res.ok) out.push({ label: r.label, blob: await res.blob(),
                               driveId: r.item.driveId, modifiedTime: r.item.modifiedTime || '' });
        else { const e = new Error('HTTP ' + res.status); e.status = res.status; noteRenderProblem('download', e); }
      }catch(err){ noteRenderProblem('download', err); /* skip it */ }
    }
    return out;
  }
  async function openDriveScore(item){
    try{
      await getCloudConfig();
      const res = await fetch(driveMediaUrl(item.driveId));
      if (!res.ok){ const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
      const blob = await res.blob();
      // a score also saved on this device: renders downloaded now join that
      // copy; its saved renders are on the device already
      const saved = item.saved && libSource.startsWith('drive:') ? libSource.slice(6) + ':' + item.driveId : null;
      let onDevice = [];
      if (saved){
        try{ onDevice = ((await offlineAll()).find(r => r.key === saved) || {}).recordings || []; }catch(err){ /* none */ }
      }
      handleFile(new File([blob], item.name), onDevice, saved, item.recFiles);
    }catch(err){ libNote(driveErrorText(err)); }
  }
  el('lib-path').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'browse'){ libFillSource(); libraryBrowse(); return; }
    libSource = v;
    saveSourcePref('libSource', v);
    libUpdateDownloadAll();
    if (v === 'local') libraryScan();
    else if (v.startsWith('drive:')) libLoadDrive(v.slice(6));
    else if (v.startsWith('offline:')) libLoadOffline(v.slice(8));
  });
  let libDirHandle = null;    // set when the browser can give us a real handle
  let libItems = [];          // {file, name, rel}

  const libIsScore = (name) => LIB_EXT.some(e => name.toLowerCase().endsWith(e));
  const libNote = (msg) => { el('lib-note').textContent = msg || ''; };

  // Set only inside the Android app. A WebView has neither showDirectoryPicker
  // nor webkitdirectory, so without a host to ask, the shelf on a phone would
  // have no way to ever be filled. The host opens the system folder picker and
  // calls __androidLibrary below with what it found.
  const ANDROID = window.AndroidHost || null;

  // The title as a person would write it. MuseScore stamps "Untitled score" into
  // the work-title of every export, so that tag alone names half a library the
  // same thing; the printed credit is what a singer would actually recognise.
  function libTitleFrom(text, fileName){
    const pick = (re) => { const m = text.match(re); return m ? m[1].trim() : ''; };
    let t = pick(/<movement-title>([\s\S]*?)<\/movement-title>/);
    if (!t){
      const w = pick(/<work-title>([\s\S]*?)<\/work-title>/);
      if (w && w.toLowerCase() !== 'untitled score') t = w;
    }
    if (!t) t = pick(/<credit-words[^>]*>([\s\S]*?)<\/credit-words>/);
    t = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
         .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
         .replace(/\s+/g, ' ').trim();
    return t || fileName.replace(/\.[^.]+$/, '');
  }

  // Only the head of each file is read. The title lives in the first few
  // kilobytes, and pulling whole scores through just to label them would turn a
  // fifty-piece folder into tens of megabytes of reading for nothing. An .mxl is
  // a zip, so its head says nothing readable -- that one keeps its file name.
  async function libTitleOf(item){
    if (item.title) return item.title;   // the Android host already read it
    if (item.name.toLowerCase().endsWith('.mxl')){
      return item.name.replace(/\.[^.]+$/, '');
    }
    try{
      return libTitleFrom(await item.file.slice(0, 65536).text(), item.name);
    }catch(err){
      return item.name.replace(/\.[^.]+$/, '');
    }
  }

  async function libWalk(dir, prefix, out, depth){
    if (depth > 4) return;                    // deeper than this is someone's backup
    for await (const [name, handle] of dir.entries()){
      if (handle.kind === 'directory'){
        await libWalk(handle, prefix + name + '/', out, depth + 1);
      } else if (libIsScore(name)){
        out.push({ handle, name, rel: prefix });
      }
    }
  }

  // ---------- File icons (list rows) ----------
  // A small paper page with a folded corner, a picture of what's inside,
  // and a coloured type label -- sheet music for MusicXML scores, a sound
  // wave for recordings, printed music for PDFs.
  function fileIconSvg(kind, name){
    const ext = ((name.match(/\.([a-z0-9]+)$/i) || [])[1] || '').toUpperCase().slice(0, 4);
    const label = kind === 'score' ? (ext === 'MXL' ? 'MXL' : 'XML') : kind === 'pdf' ? 'PDF' : (ext || 'AUD');
    const band = kind === 'score' ? '#b07d2b' : kind === 'pdf' ? '#d9302c' : '#2f7fe0';
    let art = '';
    if (kind === 'score' || kind === 'pdf'){
      // two staves of music
      const staff = (y) => [0, 1.6, 3.2, 4.8, 6.4].map(d => '<path d="M6.5 ' + (y + d) + 'H24" stroke="#a39d90" stroke-width=".55"/>').join('');
      art = staff(8.2) + staff(18);
      if (kind === 'score'){
        art += '<g fill="#23262c"><ellipse cx="10" cy="13" rx="1.45" ry="1.05" transform="rotate(-20 10 13)"/>' +
               '<ellipse cx="15.2" cy="11.4" rx="1.45" ry="1.05" transform="rotate(-20 15.2 11.4)"/>' +
               '<ellipse cx="20" cy="12.2" rx="1.45" ry="1.05" transform="rotate(-20 20 12.2)"/></g>' +
               '<path d="M11.3 12.6V7.2M16.5 11V5.6M21.3 11.8V6.4" stroke="#23262c" stroke-width=".7"/>' +
               '<path d="M16.5 5.6l4.8.8" stroke="#23262c" stroke-width="1.1"/>';
      } else {
        art += '<g fill="#4a4d55"><ellipse cx="9.5" cy="12" rx="1.2" ry=".9"/><ellipse cx="14" cy="10.4" rx="1.2" ry=".9"/>' +
               '<ellipse cx="18.5" cy="21.6" rx="1.2" ry=".9"/><ellipse cx="22" cy="20" rx="1.2" ry=".9"/></g>';
      }
    } else {
      // a sound wave with a music note over it
      const bars = [3, 6, 10, 7, 12, 8, 5, 9, 4];
      art = bars.map((h, i) => '<rect x="' + (5.2 + i * 2.2) + '" y="' + (19 - h / 2) + '" width="1.3" height="' + h + '" rx=".6" fill="#2f7fe0" opacity="' + (0.45 + (h / 12) * 0.5) + '"/>').join('') +
            '<g fill="#1d2a44"><ellipse cx="11.5" cy="12" rx="2.3" ry="1.7" transform="rotate(-20 11.5 12)"/>' +
            '<ellipse cx="19.5" cy="10.5" rx="2.3" ry="1.7" transform="rotate(-20 19.5 10.5)"/></g>' +
            '<path d="M13.6 11.5V4.4l8-1.5v7.1" fill="none" stroke="#1d2a44" stroke-width="1.2" stroke-linejoin="round"/>';
    }
    return '<svg class="file-ico" viewBox="0 0 30 38" aria-hidden="true">' +
      '<path d="M4 .8h17.2l7.3 7.3v27.6a1.6 1.6 0 0 1-1.6 1.6H4a1.6 1.6 0 0 1-1.6-1.6V2.4A1.6 1.6 0 0 1 4 .8z" fill="#fbfaf6" stroke="#c9c3b6" stroke-width=".8"/>' +
      '<path d="M21.2.8v5.7a1.6 1.6 0 0 0 1.6 1.6h5.7" fill="#e3ddcf" stroke="#c9c3b6" stroke-width=".8" stroke-linejoin="round"/>' +
      art +
      '<rect x="2.4" y="27.6" width="26.1" height="8.6" rx="1.2" fill="' + band + '"/>' +
      '<text x="15.45" y="34.1" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="6.2" font-weight="700" fill="#fff" letter-spacing=".3">' + label + '</text>' +
      '</svg>';
  }
  function addFileIcon(card, kind, name){
    const cover = card.querySelector('.lib-cover');
    cover.classList.add('has-ico');
    cover.insertAdjacentHTML('afterbegin', fileIconSvg(kind, name));
  }

  async function libRender(items){
    const shelf = el('lib-shelf');
    shelf.innerHTML = '';
    const statusSpots = [];
    const myShelf = ++libShelfGen;
    libUpdateDownloadAll();
    if (!items.length){ libNote('No scores in that folder.'); return; }
    libNote(items.length + (items.length === 1 ? ' score' : ' scores'));
    for (const item of items){
      const title = await libTitleOf(item);
      const card = document.createElement('div');
      card.className = 'lib-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.title = item.rel + item.name;
      card.innerHTML = '<span class="lib-cover"><span></span></span>' +
                       '<span class="lib-name"></span><span class="lib-sub"></span>' +
                       '<span class="pl-actions"></span>';
      card.querySelector('.lib-cover span').textContent = title;
      addFileIcon(card, 'score', item.name);
      card.querySelector('.lib-name').textContent = title;
      // Two scores can share a title -- the four parts of one anthem do, and so
      // does an excerpt cut from it. When that happens the file name is the only
      // thing telling them apart on the shelf, so it wins the second line; where
      // the title already says it the folder is more use, and at the top of the
      // chosen folder there is nothing left worth printing. Saved copies say
      // when they were saved instead -- the record of the download.
      const stem = item.name.replace(/\.[^.]+$/, '');
      const sub = item.subText || (stem.toLowerCase() !== title.toLowerCase()
        ? stem : item.rel.replace(/\/$/, ''));
      card.querySelector('.lib-sub').textContent = sub;
      const acts = card.querySelector('.pl-actions');
      const rstat = document.createElement('span');
      rstat.className = 'lib-rstat';
      rstat.hidden = true;                                 // until it's known
      rstat.addEventListener('click', (e) => { e.stopPropagation(); showRenderParts(title, rstat._parts || [], rstat._done || [], item, rstat._dev || [], rstat._cloud || []); });
      statusSpots.push({ item, spot: rstat });
      const act = (cls, label, svg, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'pl-act ' + cls; b.title = label;
        b.setAttribute('aria-label', label + ': ' + title);
        b.innerHTML = svg;
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
        acts.appendChild(b);
        return b;
      };
      if (item.driveId){
        const refresh = () => {
          const b = acts.firstChild;
          const stale = item.saved && libNeedsDownload(item);
          b.className = 'pl-act ' + (!item.saved ? 'lib-dl' : stale ? 'lib-update' : 'lib-saved');
          b.title = !item.saved ? 'Save on this device'
            : stale ? 'Changed on Drive since you saved it — tap to update'
            : 'Saved on this device ' + savedDate(item.saved.savedAt) + ' — tap to save again';
          b.innerHTML = item.saved && !stale
            ? '<svg viewBox="0 0 16 16"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>'
            : '<svg viewBox="0 0 16 16"><path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10"/></svg>';
        };
        act('lib-dl', 'Save on this device', '', async (b) => {
          if (b.classList.contains('lib-busy')) return;
          b.classList.add('lib-busy');
          libNote('Saving ' + title + '\u2026');
          try{
            await libSaveOffline(item);
            libNote('Saved ' + title + ' on this device.');
            await libRefreshOffline();
          }catch(err){ libNote(driveErrorText(err)); }
          b.classList.remove('lib-busy');
          refresh();
          libUpdateDownloadAll();
        });
        refresh();
      } else if (item.offlineKey){
        act('pl-remove', 'Remove from this device',
            '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
            async () => {
              await offlineDelete(item.offlineKey);
              libNote('Removed ' + title + ' from this device.');
              await libRefreshOffline();
              if (libSource.startsWith('offline:')){
                if (libOffline.some(o => 'offline:' + o.folderId === libSource)) libLoadOffline(libSource.slice(8));
                else { el('lib-shelf').innerHTML = ''; libNote('Nothing saved from this folder any more.'); }
              }
            });
      }
      // after the buttons (their code takes the first one as the download
      // button); shown first by the stylesheet's order
      acts.appendChild(rstat);
      const open = () => {
        // Name the card, not just the piece: "Opening Praise the Lord of Love"
        // is a puzzle when four of the shelf's covers say exactly that.
        libNote('Opening ' + (sub && !item.subText ? title + ' — ' + sub : title) + '\u2026');
        // A card from the Android host carries a content:// uri rather than a
        // File -- a WebView cannot hand JavaScript a real File out of the
        // storage tree, so the host reads the bytes and calls back.
        if (item.uri) ANDROID.openScore(item.uri, item.name);
        else if (item.driveId) openDriveScore(item);
        else handleFile(item.file, item.recordings, item.offlineKey);
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => {
        if (e.target !== card) return;
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); }
      });
      shelf.appendChild(card);
    }
    libRenderStatus(statusSpots, myShelf);
  }

  // Pop-up: a score's sung parts, each marked rendered or not.
  function showRenderParts(title, parts, done, item, onDevice, onCloud){
    const devSet = new Set((onDevice || []).map(recKey));
    const cloudSet = new Set((onCloud || []).map(recKey));
    const box = el('render-parts'), ok = el('render-parts-ok'), list = el('render-parts-list');
    // "Delete all rendered voices on this device": shown when the score's
    // saved copies hold renders. Drive is only read, never changed, so its
    // renders stay there to download again ("Render").
    const del = el('render-parts-del'), delBox = el('render-parts-del-box');
    del.hidden = true;
    delBox.checked = false;
    let savedWith = [];
    if (item) (async () => {
      try{
        savedWith = (await offlineAll()).filter(r => r.name === item.name && (r.recordings || []).length);
      }catch(err){ savedWith = []; }
      if (!savedWith.length || box.hidden) return;
      const n = new Set(savedWith.flatMap(r => r.recordings.map(x => recKey(x.label)))).size;
      el('render-parts-del-text').textContent = 'Delete all rendered voices on this device (' + n + (n === 1 ? ' part)' : ' parts)');
      del.hidden = false;
    })();
    const got = new Set(done.map(recKey));
    el('render-parts-title').textContent = title;
    el('render-parts-sub').textContent = !parts.length ? 'Not rendered'
      : got.size >= parts.length ? 'Fully rendered'
      : got.size ? 'Partly rendered \u2014 ' + got.size + ' of ' + parts.length + ' parts'
      : 'Not rendered';
    list.innerHTML = '';
    parts.forEach(n => {
      const yes = got.has(recKey(n));
      const li = document.createElement('li');
      li.className = yes ? 'yes' : 'no';
      li.innerHTML = '<span class="mark"></span><span class="name"></span><span class="state"></span>';
      li.querySelector('.mark').textContent = yes ? '\u2713' : '\u2013';
      li.querySelector('.name').textContent = n;
      const k = recKey(n);
      li.querySelector('.state').textContent = !yes ? 'Not rendered'
        : devSet.has(k) && cloudSet.has(k) ? 'This device + Google Drive'
        : devSet.has(k) ? 'On this device' : 'On Google Drive';
      list.appendChild(li);
    });
    list.hidden = !parts.length;
    const close = () => {
      box.hidden = true;
      ok.removeEventListener('click', onOk);
      box.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKey);
    };
    // OK with the box ticked deletes; closing any other way doesn't
    const onOk = async () => {
      const wipe = !del.hidden && delBox.checked && savedWith.length;
      close();
      if (!wipe) return;
      try{
        for (const r of savedWith){ r.recordings = []; await offlinePut(r); }
        // an open tab of this score forgets them too
        scoreTabs.filter(t => item && t.name === item.name.replace(/\.[^.]+$/, '')).forEach(t => { t.recordings = []; });
        libNote('Deleted the rendered voices of ' + title + ' from this device.');
      }catch(err){
        libNote("Couldn't delete the rendered voices of " + title + '.');
      }
    };
    const onBackdrop = (e) => { if (e.target === box) close(); };
    const onKey = (e) => { if (e.key === 'Escape'){ e.preventDefault(); close(); } };
    ok.addEventListener('click', onOk);
    box.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKey);
    box.hidden = false;
    ok.focus();
  }

  // ---------- Render status on the shelf ----------
  // Beside each score: not rendered (empty circle), partly rendered (half)
  // or fully rendered (full) -- how many of its sung parts have a render in
  // the Rendered Songs folders (or in its saved copy). Knowing "all" needs
  // the score's sung parts, so each score is read once (they're small) and
  // the answer kept on the device until the file changes.
  let libShelfGen = 0;
  const SUNG_PARTS_KEY = 'ark2-sung-parts';
  function sungPartsCache(){
    try{ return JSON.parse(localStorage.getItem(SUNG_PARTS_KEY) || '{}'); }catch(err){ return {}; }
  }
  // The names of a score's parts that have lyrics.
  async function sungPartsOf(blob, name){
    let xml;
    if (name.toLowerCase().endsWith('.mxl')){
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      let target = null;
      const container = zip.file('META-INF/container.xml');
      if (container){
        const m = (await container.async('text')).match(/full-path="([^"]+)"/);
        if (m) target = zip.file(m[1]);
      }
      if (!target){
        const c = Object.keys(zip.files).filter(n => /\.(xml|musicxml)$/i.test(n) && !n.includes('META-INF'));
        if (c.length) target = zip.file(c[0]);
      }
      if (!target) return [];
      xml = await target.async('text');
    } else {
      xml = await blob.text();
    }
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const names = {};
    doc.querySelectorAll('part-list score-part').forEach(sp => {
      const n = sp.querySelector('part-name');
      names[sp.getAttribute('id')] = n ? n.textContent.trim() : sp.getAttribute('id');
    });
    return [...doc.querySelectorAll('part')].filter(pt => pt.querySelector('lyric'))
      .map(pt => names[pt.getAttribute('id')] || pt.getAttribute('id'));
  }
  async function libRenderStatus(spots, gen){
    if (!spots.length) return;
    const drive = await renderedList().catch(() => null);  // null: can't tell (offline)
    // Renders saved on this device, by score file name (saved copies keep them).
    const saved = new Map();
    try{
      (await offlineAll()).forEach(r => {
        if (!(r.recordings || []).length) return;
        if (!saved.has(r.name)) saved.set(r.name, new Set());
        r.recordings.forEach(x => saved.get(r.name).add(recKey(x.label)));
      });
    }catch(err){ /* none saved */ }
    if (gen !== libShelfGen) return;
    const cache = sungPartsCache();
    let changed = false;
    for (const { item, spot } of spots){
      if (gen !== libShelfGen) return;                   // the shelf was redrawn
      try{
        const base = item.name.replace(/\.[^.]+$/, '').toLowerCase().trim() + ' - ';
        // On this device: the saved copy's renders (or a folder on the device).
        const dev = new Set((item.recordings || []).map(r => recKey(r.label)));
        (saved.get(item.name) || []).forEach(k => dev.add(k));
        if (!item.driveId) (item.recFiles || []).forEach(r => dev.add(recKey(r.label)));
        // On Google Drive: renders beside the score in its shared folder.
        const cloud = new Set();
        if (item.driveId) (item.recFiles || []).forEach(r => cloud.add(recKey(r.label)));
        if (drive) drive.filter(a => a.name.toLowerCase().startsWith(base))
          .forEach(a => cloud.add(recKey(a.name.slice(base.length).replace(/\.[^.]+$/, ''))));
        const have = new Set([...dev, ...cloud]);
        if (!drive && !have.size) continue;              // offline and nothing known: no icon
        let parts = null;
        if (have.size){
          const key = (item.driveId || item.offlineKey || item.rel + item.name) + '|' + (item.modifiedTime || '');
          parts = cache[key];
          if (!parts){
            let blob = item.file || null;
            if (!blob && item.driveId){
              const res = await fetch(driveMediaUrl(item.driveId));
              if (res.ok) blob = await res.blob();
            }
            if (!blob) continue;
            parts = await sungPartsOf(blob, item.name);
            cache[key] = parts;
            changed = true;
          }
        }
        const done = (parts || []).filter(n => have.has(recKey(n)));
        const total = (parts || []).length;
        const state = !done.length ? 'none' : done.length >= total ? 'full' : 'partial';
        const onDev = done.filter(n => dev.has(recKey(n)));
        const onCloud = done.filter(n => cloud.has(recKey(n)));
        const where = !done.length ? '' : (onDev.length && onCloud.length) ? 'both' : onDev.length ? 'device' : 'cloud';
        spot.dataset.state = state;
        spot.dataset.where = where;
        spot.title = (state === 'none' ? 'Not rendered'
          : state === 'full' ? 'Fully rendered \u2014 all ' + total + ' parts'
          : 'Partly rendered \u2014 ' + done.length + ' of ' + total + ' parts (' + done.join(', ') + ')') +
          (where === 'device' ? ' \u00b7 saved on this device'
            : where === 'cloud' ? ' \u00b7 on Google Drive (needs internet)'
            : where === 'both' ? ' \u00b7 on Google Drive, ' + (onDev.length >= done.length ? 'and all saved on this device'
                : onDev.length + ' of ' + done.length + ' saved on this device') : '');
        spot.setAttribute('aria-label', spot.title);
        spot._parts = parts || [];
        spot._done = done;
        spot._dev = onDev;
        spot._cloud = onCloud;
        // A studio microphone in front (head filled to show how much is
        // rendered), and behind it where the renders are: a cloud for Google
        // Drive, a hard drive for this device, both when they're in both.
        const CLOUD = (x, y, k) => '<path class="bg-cloud" transform="translate(' + x + ' ' + y + ') scale(' + k + ')" d="M5 15h11.5a4 4 0 0 0 .6-7.95A5.6 5.6 0 0 0 6.3 6.1 4.5 4.5 0 0 0 5 15z"/>';
        // a floppy disk: clipped corner, metal shutter on top, label below
        const DISK = '<g transform="translate(1.2 9.6) scale(0.8)"><path class="bg-disk" d="M0 1.2A1.2 1.2 0 0 1 1.2 0H6l2 2v5.8A1.2 1.2 0 0 1 6.8 9H1.2A1.2 1.2 0 0 1 0 7.8z"/>' +
          '<rect class="bg-disk-led" x="1.6" y="0" width="4" height="2.6"/><rect class="bg-disk-led" x="1.4" y="5" width="5.2" height="4"/></g>';
        // the cloud (Google Drive) sits in the upper-left behind the mic; the disk (this device) in the same column, under it
        const back = where === 'cloud' ? CLOUD(-0.5, -2, 0.62)
          : where === 'device' ? DISK
          : where === 'both' ? CLOUD(-0.5, -2, 0.62) + DISK : '';
        const mic = (cls) => '<g class="' + cls + '">' +
          '<rect x="12" y="1.5" width="5" height="9" rx="2.5"/>' +
          '<path d="M9.8 7.6a4.7 4.7 0 0 0 9.4 0M14.5 12.3v3.4M11.9 15.7h5.2"/></g>';
        spot.innerHTML = '<svg viewBox="0 0 24 20" aria-hidden="true">' + back +
          mic('mic-halo') +
          (state === 'full' ? '<rect class="fill" x="12" y="1.5" width="5" height="9" rx="2.5"/>'
            : state === 'partial' ? '<path class="fill" d="M12 6h5v2a2.5 2.5 0 0 1-5 0z"/>' : '') +
          mic('mic') + '</svg>';
        spot.hidden = false;
      }catch(err){ /* leave it out */ }
    }
    if (changed){ try{ localStorage.setItem(SUNG_PARTS_KEY, JSON.stringify(cache)); }catch(err){ /* full: fine */ } }
  }

  // Called by the Android host once its folder picker returns. Titles arrive
  // already extracted: shipping 64 KB of every score across the JavaScript
  // bridge just to read a title would be megabytes of copying for nothing.
  window.__androidLibrary = async (json, folderName) => {
    try{
      libDirHandle = null;
      libItems = JSON.parse(json);
      libSourceLocal(folderName || 'chosen folder');
      await libRender(libItems);
    }catch(err){
      libNote(folderErrorText(err));
    }
  };

  // The host hands back raw bytes, base64'd, and they go through the very same
  // handleFile a dropped file does -- so .mxl unzipping, tab creation and error
  // reporting stay in one place instead of being written twice.
  window.__androidOpenScore = (name, b64) => {
    try{
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      handleFile(new File([bytes], name));
    }catch(err){
      libNote('Could not open that score: ' + err.message);
    }
  };

  window.__androidNote = (msg) => libNote(msg);

  // Turns a raw file-system error into something a singer can act on.
  function folderErrorText(err){
    const name = err && err.name, msg = (err && err.message) || '';
    if (name === 'SecurityError' || /user activation/i.test(msg))
      return 'The browser needs your OK to open that folder again — tap Scan.';
    if (name === 'NotAllowedError')
      return 'Access to that folder was not allowed. Tap Scan and choose Allow, or pick the folder again with Browse.';
    if (name === 'NotFoundError')
      return 'That folder could not be found — it may have been moved, renamed or deleted. Use Browse to choose it again.';
    if (name === 'NotReadableError')
      return 'That folder could not be read right now. Check the drive is connected, then tap Scan.';
    return 'Something went wrong opening that folder. Tap Scan to try again, or use Browse to pick it again.';
  }

  async function libraryScan(){
    // The host keeps the folder permission across launches, so Scan means
    // "walk it again" there rather than "re-render what is already loaded".
    if (ANDROID && ANDROID.rescan){ ANDROID.rescan(); return; }
    if (!libDirHandle){
      if (libItems.length && await folderMissing(null, libItems)) return libForgetFolder();
      if (libItems.length) return libRender(libItems);
      return libNote('Choose a folder first.');
    }
    libNote('Scanning…');
    try{
      // Permission can lapse between sessions; asking is what re-grants it.
      if (libDirHandle.queryPermission){
        let state = await libDirHandle.queryPermission({ mode: 'read' });
        if (state !== 'granted' && libDirHandle.requestPermission){
          state = await libDirHandle.requestPermission({ mode: 'read' });
        }
        if (state !== 'granted'){
          return libNote('Access to that folder was not allowed. Tap Scan and choose Allow, or pick the folder again with Browse.');
        }
      }
      const found = [];
      await libWalk(libDirHandle, '', found, 0);
      libItems = [];
      for (const f of found){
        try{
          libItems.push({ file: await f.handle.getFile(), name: f.name, rel: f.rel });
        }catch(err){ /* skip whatever will not open */ }
      }
      libItems.sort((a, b) => (a.rel + a.name).localeCompare(b.rel + b.name));
      libSourceLocal(libDirHandle.name);
      await libRender(libItems);
    }catch(err){
      if (err && err.name === 'NotFoundError') return libForgetFolder();
      libNote(folderErrorText(err));
    }
  }

  async function libraryBrowse(){
    if (ANDROID && ANDROID.pickFolder){ ANDROID.pickFolder(); return; }
    if (window.showDirectoryPicker){
      try{
        libDirHandle = await window.showDirectoryPicker({ id: 'ark2-scores', mode: 'read' });
        dbSaveMeta('libraryDir', libDirHandle);
        return libraryScan();
      }catch(err){
        if (err && err.name === 'AbortError') return;   // the user closed the picker
        // anything else: fall through to the input below
      }
    }
    // No picker -- this page was almost certainly opened from a file:// path. A
    // directory input reads the same folder; it just cannot be remembered.
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.webkitdirectory = true;
    inp.multiple = true;
    inp.addEventListener('change', async () => {
      libDirHandle = null;
      libItems = [...inp.files].filter(f => libIsScore(f.name)).map(f => {
        const parts = (f.webkitRelativePath || f.name).split('/');
        return {
          file: f, name: f.name,
          rel: parts.slice(1, -1).join('/') + (parts.length > 2 ? '/' : '')
        };
      });
      libItems.sort((a, b) => (a.rel + a.name).localeCompare(b.rel + b.name));
      const first = inp.files[0];
      libSourceLocal(first
        ? ((first.webkitRelativePath || '').split('/')[0] || 'chosen folder') : 'chosen folder');
      await libRender(libItems);
    });
    inp.click();
  }

  // Home, and back again. The score tabs stay loaded and OSMD's rendered staves
  // stay in the DOM, so returning is a class change rather than a re-render --
  // which matters, because rendering into a hidden container is exactly what
  // produces the blank score the loader above works so hard to avoid.
  function goHome(){
    lyricsClose();
    stopPlayback();
    document.body.classList.remove('workspace-active');
    workspace.classList.remove('active');
    dropzone.style.display = 'block';
    el('transport-controls').style.display = 'none';
    fitAudioShelfSoon();
  }

  function showWorkspace(){
    if (!scoreTabs.length) return;
    dropzone.style.display = 'none';
    document.body.classList.add('workspace-active');
    workspace.classList.add('active');
    el('transport-controls').style.display = 'flex';
    fitAudioShelfSoon();
  }

  // ---------- Home-screen encouragement ----------
  // Fifty short encouragements about singing, each paired with a verse
  // (KJV). One is picked at random on load, then a different one every 20s.
  const INSPIRE = [
    ["Lift your voice — every note is an offering.", "O come, let us sing unto the LORD: let us make a joyful noise to the rock of our salvation.", "Psalm 95:1"],
    ["Sing with your whole heart, not just your voice.", "I will praise thee, O LORD, with my whole heart; I will shew forth all thy marvellous works.", "Psalm 9:1"],
    ["Your song is a gift back to the Giver.", "O sing unto the LORD a new song: sing unto the LORD, all the earth.", "Psalm 96:1"],
    ["Praise is the melody of a grateful heart.", "Serve the LORD with gladness: come before his presence with singing.", "Psalm 100:2"],
    ["When words fall short, sing.", "Singing with grace in your hearts to the Lord.", "Colossians 3:16"],
    ["One choir, many voices, one Lord.", "That ye may with one mind and one mouth glorify God, even the Father of our Lord Jesus Christ.", "Romans 15:6"],
    ["Sing even at midnight — He hears you.", "And at midnight Paul and Silas prayed, and sang praises unto God: and the prisoners heard them.", "Acts 16:25"],
    ["Joy grows louder when it is shared in song.", "Make a joyful noise unto the LORD, all the earth: make a loud noise, and rejoice, and sing praise.", "Psalm 98:4"],
    ["Every breath is a reason to praise.", "Let every thing that hath breath praise the LORD. Praise ye the LORD.", "Psalm 150:6"],
    ["Practise faithfully — skill offered to God is worship.", "Sing unto him a new song; play skilfully with a loud noise.", "Psalm 33:3"],
    ["Before you sing to Him, remember: He sings over you.", "He will rest in his love, he will joy over thee with singing.", "Zephaniah 3:17"],
    ["Your strength and your song come from the same Source.", "The LORD is my strength and song, and he is become my salvation.", "Exodus 15:2"],
    ["Today is a good day for a new song.", "Sing unto the LORD a new song, and his praise from the end of the earth.", "Isaiah 42:10"],
    ["Let your harmony reflect His peace.", "Behold, how good and how pleasant it is for brethren to dwell together in unity!", "Psalm 133:1"],
    ["Many singers, one sound — that is a choir.", "The trumpeters and singers were as one, to make one sound to be heard in praising and thanking the LORD.", "2 Chronicles 5:13"],
    ["Sing for as long as you have breath.", "I will sing unto the LORD as long as I live: I will sing praise to my God while I have my being.", "Psalm 104:33"],
    ["Make melody in your heart before your lips.", "Singing and making melody in your heart to the Lord.", "Ephesians 5:19"],
    ["A morning song sets the tone for the whole day.", "I will sing of thy power; yea, I will sing aloud of thy mercy in the morning.", "Psalm 59:16"],
    ["Thanksgiving is the key every song is written in.", "Let us come before his presence with thanksgiving, and make a joyful noise unto him with psalms.", "Psalm 95:2"],
    ["Sing His faithfulness to the next generation.", "I will sing of the mercies of the LORD for ever: with my mouth will I make known thy faithfulness to all generations.", "Psalm 89:1"],
    ["Praise fills the sanctuary — and the heavens.", "Praise God in his sanctuary: praise him in the firmament of his power.", "Psalm 150:1"],
    ["Strings, voices and hearts — all together.", "Praise him with the timbrel and dance: praise him with stringed instruments and organs.", "Psalm 150:4"],
    ["A merry heart has a song to sing.", "Is any merry? let him sing psalms.", "James 5:13"],
    ["Sing in spirit and in truth.", "God is a Spirit: and they that worship him must worship him in spirit and in truth.", "John 4:24"],
    ["Sing because He is good.", "Praise the LORD; for the LORD is good: sing praises unto his name; for it is pleasant.", "Psalm 135:3"],
    ["Praise looks beautiful on the people of God.", "Rejoice in the LORD, O ye righteous: for praise is comely for the upright.", "Psalm 33:1"],
    ["If you have been redeemed, say so — sing so!", "Let the redeemed of the LORD say so, whom he hath redeemed from the hand of the enemy.", "Psalm 107:2"],
    ["Your song may be the reason someone trusts Him.", "He hath put a new song in my mouth, even praise unto our God: many shall see it, and fear, and shall trust in the LORD.", "Psalm 40:3"],
    ["In the dark seasons, He still gives songs.", "Where is God my maker, who giveth songs in the night.", "Job 35:10"],
    ["A steady heart sings a steady song.", "My heart is fixed, O God, my heart is fixed: I will sing and give praise.", "Psalm 57:7"],
    ["Clap, sing, rejoice — He is worthy!", "O clap your hands, all ye people; shout unto God with the voice of triumph.", "Psalm 47:1"],
    ["Know the words, mean the words.", "For God is the King of all the earth: sing ye praises with understanding.", "Psalm 47:7"],
    ["Every rehearsal is worship too.", "And whatsoever ye do, do it heartily, as to the Lord, and not unto men.", "Colossians 3:23"],
    ["Good order makes beautiful music.", "Let all things be done decently and in order.", "1 Corinthians 14:40"],
    ["Sing with your spirit — and with your mind.", "I will sing with the spirit, and I will sing with the understanding also.", "1 Corinthians 14:15"],
    ["Heaven is already singing. Join in.", "Worthy is the Lamb that was slain to receive power, and riches, and wisdom, and strength, and honour, and glory, and blessing.", "Revelation 5:12"],
    ["Holy, holy, holy — the oldest chorus of all.", "Holy, holy, holy, Lord God Almighty, which was, and is, and is to come.", "Revelation 4:8"],
    ["The angels sang first. We sing it still.", "Glory to God in the highest, and on earth peace, good will toward men.", "Luke 2:14"],
    ["Feeling weak? Sing anyway — His strength fills the gaps.", "My grace is sufficient for thee: for my strength is made perfect in weakness.", "2 Corinthians 12:9"],
    ["Enter His gates with a song.", "Enter into his gates with thanksgiving, and into his courts with praise: be thankful unto him, and bless his name.", "Psalm 100:4"],
    ["Sing of a love that never runs out.", "O give thanks unto the LORD; for he is good: for his mercy endureth for ever.", "Psalm 136:1"],
    ["Your praise is a sacrifice He treasures.", "Let us offer the sacrifice of praise to God continually, that is, the fruit of our lips giving thanks to his name.", "Hebrews 13:15"],
    ["Trust Him — then let your joy be heard.", "Let all those that put their trust in thee rejoice: let them ever shout for joy.", "Psalm 5:11"],
    ["There is always a reason to rejoice.", "Rejoice in the Lord alway: and again I say, Rejoice.", "Philippians 4:4"],
    ["After every winter comes a season of song.", "The flowers appear on the earth; the time of the singing of birds is come.", "Song of Solomon 2:12"],
    ["All creation is in the choir.", "The mountains and the hills shall break forth before you into singing, and all the trees of the field shall clap their hands.", "Isaiah 55:12"],
    ["Give Him the glory His name deserves.", "Give unto the LORD the glory due unto his name; worship the LORD in the beauty of holiness.", "Psalm 29:2"],
    ["Where praise rises, He is present.", "But thou art holy, O thou that inhabitest the praises of Israel.", "Psalm 22:3"],
    ["Sing out — God is your strength.", "Sing aloud unto God our strength: make a joyful noise unto the God of Jacob.", "Psalm 81:1"],
    ["Arise and sing for the glory of the LORD!", "Arise, shine; for thy light is come, and the glory of the LORD is risen upon thee.", "Isaiah 60:1"]
  ];
  let inspireIdx = -1;
  function showInspiration(){
    let i;
    do { i = Math.floor(Math.random() * INSPIRE.length); } while (i === inspireIdx);
    inspireIdx = i;
    const [msg, verse, ref] = INSPIRE[i];
    el('dz-msg').textContent = msg;
    el('dz-verse-text').textContent = '\u201C' + verse + '\u201D';
    el('dz-verse-ref').textContent = '\u2014 ' + ref;
  }
  showInspiration();
  setInterval(() => {
    if (document.hidden) return;
    const box = el('dz-inspire');
    box.classList.add('fading');
    setTimeout(() => { showInspiration(); box.classList.remove('fading'); }, 600);
  }, 20000);

  // ---------- Access PIN (once per device) ----------
  // If config.ark2 has a PIN, a device must enter it once; after that it's
  // remembered on the device (only a SHA-256 of the PIN is stored, never the
  // PIN itself). Changing the PIN in config.ark2 asks every device again.
  // With no PIN in the config there's no gate. If the config can't be
  // reached (offline) a device that was never unlocked is let in this once
  // rather than locked out of its offline copy; it's asked next time online.
  async function pinHash(pin){
    const data = new TextEncoder().encode('ark2-pin:' + pin);
    if (window.crypto && crypto.subtle){
      const buf = await crypto.subtle.digest('SHA-256', data);
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // No WebCrypto (non-secure origin): a simple fallback fingerprint.
    let h = 2166136261;
    for (const b of data){ h ^= b; h = Math.imul(h, 16777619); }
    return 'f' + (h >>> 0).toString(16);
  }
  function pinUnhide(){ document.documentElement.classList.remove('pin-pending'); }
  async function pinCheck(){
    const cfg = await getCloudConfig();
    let saved = null;
    try{ saved = localStorage.getItem('ark2PinOK'); }catch(err){ /* ignore */ }
    if (!cfg.pin){ pinUnhide(); return; }                 // no PIN set (or offline)
    const want = await pinHash(cfg.pin);
    if (saved === want){ pinUnhide(); return; }           // this device is already unlocked
    // Ask.
    const gate = el('pin-gate'), input = el('pin-input'), msg = el('pin-msg'), btn = el('pin-btn');
    const logo = document.querySelector('.topbar-brand-logo');
    if (logo) el('pin-logo').src = logo.src;
    gate.hidden = false;
    pinUnhide();                                         // the gate covers the app
    setTimeout(() => input.focus(), 50);
    let tries = 0, lockedUntil = 0;
    el('pin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const now = Date.now();
      if (now < lockedUntil){ msg.textContent = 'Too many tries — wait ' + Math.ceil((lockedUntil - now) / 1000) + ' s.'; return; }
      if ((await pinHash(input.value.trim())) === want){
        try{ localStorage.setItem('ark2PinOK', want); }catch(err){ /* ignore */ }
        gate.hidden = true;
        msg.textContent = '';
        return;
      }
      tries++;
      input.value = '';
      const card = el('pin-form');
      card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
      if (tries >= 5){
        lockedUntil = Date.now() + 30000;
        tries = 0;
        btn.disabled = true;
        msg.textContent = 'Too many wrong tries — wait 30 s.';
        setTimeout(() => { btn.disabled = false; msg.textContent = ''; input.focus(); }, 30000);
      } else {
        msg.textContent = 'Wrong PIN — try again.';
        input.focus();
      }
    });
  }
  pinCheck();

  // ---------- Player switcher (logo menu) ----------
  const appMenu = el('app-menu'), appMenuBtn = el('app-menu-btn');
  function appMenuOpen(open){
    appMenu.hidden = !open;
    appMenuBtn.setAttribute('aria-expanded', String(open));
    if (!open) return;
    const r = appMenuBtn.getBoundingClientRect();
    appMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - appMenu.offsetWidth - 8)) + 'px';
    appMenu.style.top = (r.bottom + 8) + 'px';
    (appMenu.querySelector('.app-menu-item.active') || appMenu.querySelector('.app-menu-item')).focus();
  }
  appMenuBtn.addEventListener('click', (e) => { e.stopPropagation(); appMenuOpen(appMenu.hidden); });
  // The logo itself is "home": straight back to the home screen, no menu.
  // (The name and the arrow beside it open the menu.)
  const brandLogo = appMenuBtn.querySelector('.topbar-brand-logo');
  if (brandLogo){
    brandLogo.title = 'Home';
    brandLogo.addEventListener('click', (e) => {
      e.stopPropagation();
      appMenuOpen(false);
      goHome();
    });
  }
  document.addEventListener('click', (e) => {
    if (!appMenu.hidden && !e.target.closest('#app-menu')) appMenuOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (appMenu.hidden) return;
    if (e.key === 'Escape'){ appMenuOpen(false); appMenuBtn.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      const items = [...appMenu.querySelectorAll('.app-menu-item')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    }
  });
  window.addEventListener('resize', () => appMenuOpen(false));
  // Picking a player always lands on its home screen -- from inside an open
  // score that means leaving it (it stays loaded in its tab above).
  appMenu.querySelectorAll('.app-menu-item').forEach(item => {
    item.addEventListener('click', () => {
      appMenuOpen(false);
      if (workspace.classList.contains('active')) goHome();
      appMenu.querySelectorAll('.app-menu-item').forEach(i =>
        i.setAttribute('aria-checked', String(i === item)));
      window.scrollTo(0, 0);
    });
  });

  // ---------- Note Player / Audio Player tabs ----------
  el('tab-note-player').addEventListener('click', () => {
    el('tab-note-player').classList.add('active');
    el('tab-audio-player').classList.remove('active');
    el('note-player-panel').classList.add('active');
    el('audio-player-panel').classList.remove('active');
  });
  el('tab-audio-player').addEventListener('click', fitAudioShelfSoon);
  el('tab-note-player').addEventListener('click', fitAudioShelfSoon);
  el('tab-audio-player').addEventListener('click', () => {
    el('tab-audio-player').classList.add('active');
    el('tab-note-player').classList.remove('active');
    el('audio-player-panel').classList.add('active');
    el('note-player-panel').classList.remove('active');
  });
  // Three players now: whichever menu item is picked shows its panel and
  // hides the other two.
  const PLAYER_PANELS = {
    'tab-note-player': 'note-player-panel',
    'tab-audio-player': 'audio-player-panel',
    'tab-sheet-player': 'sheet-player-panel'
  };
  Object.keys(PLAYER_PANELS).forEach(tid => el(tid).addEventListener('click', () => {
    Object.entries(PLAYER_PANELS).forEach(([t, pn]) => {
      el(t).classList.toggle('active', t === tid);
      el(pn).classList.toggle('active', t === tid);
    });
  }));
  el('tab-sheet-player').addEventListener('click', fitAudioShelfSoon);

  // ---------- Audio library (Browse / Scan / Playlist) ----------
  // Deliberately mirrors the score library above (libDirHandle, libItems,
  // libWalk, libRender, libraryScan, libraryBrowse) rather than inventing a
  // different pattern -- same folder-handle persistence, same directory
  // walk, same Thumbnails/List shelf. The only real differences are the
  // file extensions and what happens on click (play instead of open score).
  const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.webm'];

  // Music folder source: '' until known, 'drive:<folderId>', or 'local'.
  let audioSource = '', audioLocalName = '';
  let audioOffline = [];   // folders with songs saved on this device
  function audioFillSource(){
    fillSourceSelect(el('audio-path'), cloudCfg.audio, audioLocalName, audioSource,
                     'No folder chosen — pick one to build your playlist', audioOffline);
    audioUpdateDownloadAll();
  }
  async function audioRefreshOffline(){
    audioOffline = await offlineFolders('songs');
    audioFillSource();
  }

  // ---------- Songs saved for offline ----------
  // Same idea as saved scores: a song from a shared folder can be saved
  // into this device's own storage (IndexedDB 'songs'), and each folder
  // with saved songs appears in the picker as "📥 <folder name>". Saved
  // songs play without a connection, and playlists work with them too --
  // tracks are matched by file name.
  async function audioLoadOffline(folderId){
    const recs = (await offlineAll('songs')).filter(r => r.folderId === folderId);
    if (audioSource !== 'offline:' + folderId) return;
    audioItems = recs.map(r => ({
      name: r.name, rel: r.rel || '', file: new File([r.blob], r.name, { type: r.blob.type || 'audio/mpeg' }),
      offlineKey: r.key, savedAt: r.savedAt
    }));
    audioItems.sort((a, b) => (a.rel + a.name).localeCompare(b.rel + b.name));
    audioNote(recs.length ? '' : 'Nothing saved from this folder yet.');
    audioRefreshView();
  }
  async function audioSaveOffline(item){
    const folderId = audioSource.slice(6);
    const folder = cloudCfg.audio.find(f => f.id === folderId);
    const res = await fetch(driveMediaUrl(item.driveId));
    if (!res.ok){ const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    const rec = {
      key: folderId + ':' + item.driveId, folderId,
      folderName: folder ? folder.name : 'Shared songs',
      driveId: item.driveId, name: item.name, rel: item.rel || '',
      blob: await res.blob(), savedAt: Date.now(), modifiedTime: item.modifiedTime || ''
    };
    await offlinePut(rec, 'songs');
    item.saved = { savedAt: rec.savedAt, modifiedTime: rec.modifiedTime };
    try{ if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(err){ /* ignore */ }
  }
  const audioNeedsDownload = (item) => !item.saved || (item.modifiedTime && item.saved.modifiedTime !== item.modifiedTime);
  function audioUpdateDownloadAll(){
    const b = el('audio-dl-all');
    if (!audioSource.startsWith('drive:') || !audioItems.length || !audioItems[0].driveId){ b.hidden = true; return; }
    b.hidden = false;
    const todo = audioItems.filter(audioNeedsDownload).length;
    b.classList.toggle('done', todo === 0);
    b.disabled = todo === 0;
    b.innerHTML = todo === 0 ? '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>'
      : '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10"/></svg>';
    b.title = todo === 0 ? 'Every song in this folder is saved on this device'
      : 'Save ' + (todo === audioItems.length ? 'all ' + todo : todo + ' more') + ' songs on this device';
  }
  // ---------- "Download all" data warning ----------
  // Saving a whole folder can be a lot of data, so ask first. Resolves true
  // to go ahead. (Single-file downloads don't ask.)
  function fmtBytes(n){
    if (n >= 1e9) return (n / 1e9).toFixed(1) + ' GB';
    if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + ' MB';
    return Math.max(1, Math.round(n / 1e3)) + ' KB';
  }
  function confirmDownloadAll(items, noun){
    return new Promise((resolve) => {
      const box = el('dl-warn'), ok = el('dl-warn-ok'), cancel = el('dl-warn-cancel');
      const bytes = items.reduce((t, x) => t + (x.size || 0), 0);
      const count = items.length + ' ' + noun + (items.length === 1 ? '' : 's');
      el('dl-warn-text').innerHTML = 'This will download <b>' + count + '</b>' +
        (bytes ? ' (about <b>' + fmtBytes(bytes) + '</b>)' : '') +
        ' to this device. Large files can use a lot of mobile data.';
      box.hidden = false;
      setTimeout(() => ok.focus(), 30);
      const done = (v) => {
        box.hidden = true;
        ok.removeEventListener('click', yes);
        cancel.removeEventListener('click', no);
        box.removeEventListener('click', outside);
        document.removeEventListener('keydown', key, true);
        resolve(v);
      };
      const yes = () => done(true), no = () => done(false);
      const outside = (e) => { if (e.target === box) done(false); };
      const key = (e) => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); done(false); } };
      ok.addEventListener('click', yes);
      cancel.addEventListener('click', no);
      box.addEventListener('click', outside);
      document.addEventListener('keydown', key, true);
    });
  }

  let audioDownloading = false;
  el('audio-dl-all').addEventListener('click', async () => {
    if (audioDownloading) return;
    const src = audioSource;
    const todo = audioItems.filter(audioNeedsDownload);
    if (!todo.length) return;
    if (!(await confirmDownloadAll(todo, 'song'))) return;
    if (audioDownloading || audioSource !== src) return;
    audioDownloading = true;
    el('audio-dl-all').classList.add('busy');
    let done = 0, failed = 0;
    for (const item of todo){
      if (audioSource !== src) break;
      audioNote('Saving song ' + (done + 1) + ' of ' + todo.length + ' for offline\u2026');
      try{ await audioSaveOffline(item); }catch(err){ failed++; }
      done++;
    }
    audioDownloading = false;
    el('audio-dl-all').classList.remove('busy');
    await audioRefreshOffline();
    if (audioSource === src) audioRefreshView();
    audioNote(failed ? (done - failed) + ' saved, ' + failed + " couldn't be downloaded — tap Save again to retry."
                     : 'Saved ' + done + (done === 1 ? ' song' : ' songs') + ' on this device.');
  });
  function audioSourceLocal(name, select = true){
    audioLocalName = name || '';
    if (select){ audioSource = 'local'; saveSourcePref('audioSource', 'local'); }
    audioFillSource();
  }
  async function audioLoadDrive(id){
    await getCloudConfig();
    const f = cloudCfg.audio.find(x => x.id === id);
    audioNote('Loading ' + (f ? f.name : 'shared folder') + '…');
    try{
      const found = await driveList(id, AUDIO_EXT);
      if (audioSource !== 'drive:' + id) return;
      const saved = new Map((await offlineAll('songs')).filter(r => r.folderId === id).map(r => [r.driveId, r]));
      audioItems = found.map(x => Object.assign(x, {
        file: null,
        saved: saved.has(x.driveId) ? { savedAt: saved.get(x.driveId).savedAt, modifiedTime: saved.get(x.driveId).modifiedTime } : null
      }));
      audioItems.sort((a, b) => (a.rel + a.name).localeCompare(b.rel + b.name));
      audioNote('');
      audioRefreshView();
    }catch(err){ audioNote(driveErrorText(err)); }
  }
  el('audio-path').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'browse'){ audioFillSource(); audioBrowse(); return; }
    audioSource = v;
    saveSourcePref('audioSource', v);
    audioUpdateDownloadAll();
    if (v === 'local') audioScan();
    else if (v.startsWith('drive:')) audioLoadDrive(v.slice(6));
    else if (v.startsWith('offline:')) audioLoadOffline(v.slice(8));
  });
  let audioDirHandle = null;
  let audioItems = [];      // {file, name, rel}
  let audioIndex = -1;      // index into the *shuffled* order below
  let audioCurrent = -1;    // index into audioItems of the loaded track
  let audioCurrentKey = ''; // ...and its folder path, which survives a rescan
  let audioOrder = [];      // playback order (identity, or shuffled)
  let audioShuffle = false;
  let audioRepeat = 'off';  // 'off' | 'all' | 'one'

  const audioIsFile = (name) => AUDIO_EXT.some(e => name.toLowerCase().endsWith(e));
  const audioNote = (msg) => { el('audio-note').textContent = msg || ''; fitAudioShelfSoon(); };

  // Phones: make the playlist its own scroll area filling the rest of the
  // screen, so the player never scrolls away. Measured rather than set in
  // CSS because what sits above the list (player, folder bar, messages,
  // the name box) varies, and phone browsers change the screen height as
  // their address bar shows and hides.
  const AUDIO_FIT_MQ = window.matchMedia('(max-width:560px)');
  function fitAudioShelf(){
    const sh = el('audio-shelf');
    const on = AUDIO_FIT_MQ.matches
      && el('audio-player-panel').classList.contains('active')
      && !document.body.classList.contains('workspace-active');
    document.body.classList.toggle('audio-fit', on);
    sh.style.maxHeight = on ? 'none' : '';
    if (!on) return;
    const top = sh.getBoundingClientRect().top + window.scrollY;
    const below = document.documentElement.scrollHeight - (top + sh.offsetHeight);
    const room = window.innerHeight - top - Math.max(0, below);
    sh.style.maxHeight = Math.max(160, Math.floor(room)) + 'px';
    if (window.scrollY) window.scrollTo(0, 0);
  }
  let audioFitQueued = false;
  function fitAudioShelfSoon(){
    if (audioFitQueued) return;
    audioFitQueued = true;
    requestAnimationFrame(() => { audioFitQueued = false; fitAudioShelf(); });
  }
  window.addEventListener('resize', fitAudioShelfSoon);
  if (AUDIO_FIT_MQ.addEventListener) AUDIO_FIT_MQ.addEventListener('change', fitAudioShelfSoon);

  async function audioWalk(dir, prefix, out, depth){
    if (depth > 4) return;
    for await (const [name, handle] of dir.entries()){
      if (handle.kind === 'directory'){
        await audioWalk(handle, prefix + name + '/', out, depth + 1);
      } else if (audioIsFile(name)){
        out.push({ handle, name, rel: prefix });
      }
    }
  }

  function audioTitleOf(item){
    return item.name.replace(/\.[^.]+$/, '');
  }

  // ---------- Custom playlists ----------
  // A playlist is a name plus an ordered list of track keys (the file's
  // path inside the chosen folder), so it survives rescans and reorders of
  // the folder. Tracks that have gone missing are skipped, not deleted, in
  // case the file comes back. '' as the active id means "All tracks".
  const PL_KEY = 'audioPlaylists', PL_ACTIVE_KEY = 'audioActivePlaylist';
  const trackKey = (item) => item.rel + item.name;
  let audioPlaylists = [];
  let audioActivePl = '';
  try{
    audioPlaylists = JSON.parse(localStorage.getItem(PL_KEY) || '[]');
    if (!Array.isArray(audioPlaylists)) audioPlaylists = [];
    audioActivePl = localStorage.getItem(PL_ACTIVE_KEY) || '';
  }catch(err){ audioPlaylists = []; }
  function plSave(){
    try{
      localStorage.setItem(PL_KEY, JSON.stringify(audioPlaylists));
      localStorage.setItem(PL_ACTIVE_KEY, audioActivePl);
    }catch(err){ /* storage full or blocked -- playlists last this session only */ }
  }
  const plActive = () => audioPlaylists.find(p => p.id === audioActivePl) || null;
  const plById = (id) => audioPlaylists.find(p => p.id === id) || null;

  // Indices into audioItems for whatever list is showing, in its order.
  function audioViewIndices(){
    const pl = plActive();
    if (!pl) return audioItems.map((_, i) => i);
    const byKey = new Map(audioItems.map((it, i) => [trackKey(it), i]));
    return pl.tracks.map(k => byKey.get(k)).filter(i => i !== undefined);
  }

  function plFillSelect(){
    const sel = el('audio-pl-select');
    sel.innerHTML = '';
    const all = new Option('All tracks' + (audioItems.length ? ' (' + audioItems.length + ')' : ''), '');
    sel.add(all);
    audioPlaylists.forEach(p => sel.add(new Option(p.name + ' (' + p.tracks.length + ')', p.id)));
    if (!plActive()) audioActivePl = '';
    sel.value = audioActivePl;
    el('audio-pl-delete').hidden = !audioActivePl;
    if (!audioActivePl) audioGapCancel();
    if (typeof audioGapPaint === 'function') audioGapPaint();
  }

  // Re-derive play order and redraw after the list or its contents change,
  // keeping whatever is playing as the current position.
  function audioRefreshView(){
    audioCurrent = audioCurrentKey
      ? audioItems.findIndex(it => trackKey(it) === audioCurrentKey) : -1;
    audioSetOrder();
    audioIndex = audioOrder.indexOf(audioCurrent);
    plFillSelect();
    audioRender();
  }

  function audioRender(){
    const shelf = el('audio-shelf');
    shelf.innerHTML = '';
    const pl = plActive();
    if (!audioItems.length){
      if (pl) audioNote('Choose your music folder with Browse to play this playlist.');
      else audioNote(audioDirHandle ? 'No audio files in that folder.' : '');
      return;
    }
    const view = audioViewIndices();
    if (pl){
      const missing = pl.tracks.length - view.length;
      if (!pl.tracks.length) audioNote('This playlist is empty. Switch to All tracks and tap + on a song to add it.');
      // The dropdown already shows the count, so the note line only speaks
      // up when something needs saying -- and otherwise collapses.
      else audioNote(missing ? missing + (missing === 1 ? ' song' : ' songs') + ' in this playlist not found in this folder.' : '');
    } else {
      audioNote('');
    }
    audioUpdateDownloadAll();
    view.forEach((itemIdx, pos) => {
      const item = audioItems[itemIdx];
      const title = audioTitleOf(item);
      const card = document.createElement('div');
      card.className = 'lib-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.title = item.rel + item.name;
      card.innerHTML = '<span class="lib-cover"><span></span></span>' +
                       '<span class="lib-name"></span><span class="lib-sub"></span>' +
                       '<span class="pl-actions"></span>';
      card.querySelector('.lib-cover span').textContent = title;
      addFileIcon(card, 'audio', item.name);
      card.querySelector('.lib-name').textContent = title;
      card.querySelector('.lib-sub').textContent = item.rel.replace(/\/$/, '');
      card.dataset.item = String(itemIdx);
      const acts = card.querySelector('.pl-actions');
      const act = (cls, label, svg, fn, disabled) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'pl-act ' + cls; b.title = label;
        b.setAttribute('aria-label', label + ': ' + title);
        b.innerHTML = svg; b.disabled = !!disabled;
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
        acts.appendChild(b);
        return b;
      };
      if (pl){
        act('pl-up', 'Move up', '<svg viewBox="0 0 16 16"><path d="M4 10l4-4 4 4"/></svg>',
            () => plMove(pl, trackKey(item), -1), pos === 0);
        act('pl-down', 'Move down', '<svg viewBox="0 0 16 16"><path d="M4 6l4 4 4-4"/></svg>',
            () => plMove(pl, trackKey(item), 1), pos === view.length - 1);
        act('pl-remove', 'Remove from playlist', '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
            () => plRemove(pl, trackKey(item)));
      } else {
        // Shared songs: save for offline (✓ once saved, amber if changed on Drive since).
        if (item.driveId){
          const stale = item.saved && audioNeedsDownload(item);
          const saveBtn = act(!item.saved ? 'lib-dl' : stale ? 'lib-update' : 'lib-saved',
            !item.saved ? 'Save on this device' : stale ? 'Changed on Drive — tap to update' : 'Saved on this device ' + savedDate(item.saved.savedAt),
            item.saved && !stale ? '<svg viewBox="0 0 16 16"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>'
                                 : '<svg viewBox="0 0 16 16"><path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10"/></svg>',
            async (b) => {
              if (b.classList.contains('lib-busy')) return;
              b.classList.add('lib-busy');
              audioNote('Saving ' + title + '\u2026');
              try{
                await audioSaveOffline(item);
                audioNote('Saved ' + title + ' on this device.');
                await audioRefreshOffline();
                audioRefreshView();
              }catch(err){ audioNote(driveErrorText(err)); b.classList.remove('lib-busy'); }
            });
          void saveBtn;
        }
        const inAny = audioPlaylists.some(p => p.tracks.includes(trackKey(item)));
        act('pl-add' + (inAny ? ' added' : ''), 'Add to a playlist',
            '<svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>',
            (b) => plOpenMenu(b, item));
        // Saved songs: remove from this device.
        if (item.offlineKey){
          act('pl-remove', 'Remove from this device',
              '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
              async () => {
                if (audioCurrentKey === trackKey(item) && !audioEl.paused) audioEl.pause();
                await offlineDelete(item.offlineKey, 'songs');
                audioNote('Removed ' + title + ' from this device.');
                await audioRefreshOffline();
                if (audioSource.startsWith('offline:')){
                  if (audioOffline.some(o => 'offline:' + o.folderId === audioSource)) audioLoadOffline(audioSource.slice(8));
                  else { audioItems = []; audioRefreshView(); audioNote('Nothing saved from this folder any more.'); }
                }
              });
        }
      }
      card.addEventListener('click', () => audioPlayIndex(itemIdx));
      card.addEventListener('keydown', (e) => {
        if (e.target !== card) return;
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); audioPlayIndex(itemIdx); }
      });
      shelf.appendChild(card);
    });
    audioMarkPlaying();
    fitAudioShelfSoon();
  }

  function plMove(pl, key, delta){
    // Move within the tracks that are actually present, so a missing file
    // hidden between two visible ones doesn't make a click look like it did nothing.
    const present = new Set(audioItems.map(trackKey));
    const visible = pl.tracks.filter(k => present.has(k));
    const i = visible.indexOf(key), j = i + delta;
    if (i < 0 || j < 0 || j >= visible.length) return;
    const a = pl.tracks.indexOf(visible[i]), b = pl.tracks.indexOf(visible[j]);
    [pl.tracks[a], pl.tracks[b]] = [pl.tracks[b], pl.tracks[a]];
    plSave(); audioRefreshView();
  }
  function plRemove(pl, key){
    pl.tracks = pl.tracks.filter(k => k !== key);
    plSave(); audioRefreshView();
  }
  function plAdd(pl, item){
    const key = trackKey(item);
    if (!pl.tracks.includes(key)) pl.tracks.push(key);
    plSave(); audioRefreshView();
    audioNote('Added \u201C' + audioTitleOf(item) + '\u201D to ' + pl.name + '.');
  }
  function plCreate(name){
    const pl = { id: 'pl' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                 name, tracks: [] };
    audioPlaylists.push(pl);
    return pl;
  }

  // Inline name box (used for New, and "New playlist..." from the + menu).
  let plNameDone = null;
  function plAskName(initial, done){
    const form = el('audio-pl-edit'), input = el('audio-pl-name');
    plNameDone = done;
    input.value = initial || '';
    form.hidden = false;
    fitAudioShelfSoon();
    input.focus(); input.select();
  }
  function plCloseName(){ el('audio-pl-edit').hidden = true; plNameDone = null; fitAudioShelfSoon(); }
  el('audio-pl-edit').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el('audio-pl-name').value.trim().replace(/\s+/g, ' ');
    if (!name){ el('audio-pl-name').focus(); return; }
    const done = plNameDone;
    plCloseName();
    if (done) done(name);
  });
  el('audio-pl-cancel').addEventListener('click', plCloseName);
  el('audio-pl-name').addEventListener('keydown', (e) => {
    if (e.key === 'Escape'){ e.stopPropagation(); plCloseName(); }
  });

  el('audio-pl-select').addEventListener('change', (e) => {
    audioActivePl = e.target.value;
    plCloseName(); plSave(); audioRefreshView();
  });
  el('audio-pl-new').addEventListener('click', () => {
    plAskName('', (name) => {
      const pl = plCreate(name);
      audioActivePl = pl.id;
      plSave(); audioRefreshView();
    });
  });
  el('audio-pl-delete').addEventListener('click', () => {
    const pl = plActive();
    if (!pl) return;
    if (!confirm('Delete the playlist \u201C' + pl.name + '\u201D? The songs themselves are not deleted.')) return;
    audioPlaylists = audioPlaylists.filter(p => p !== pl);
    audioActivePl = '';
    plSave(); audioRefreshView();
  });

  // The + menu on a track: every playlist (ticked where the song already
  // is -- tapping a ticked one takes it back out), then "New playlist...".
  function plOpenMenu(anchor, item){
    const menu = el('audio-pl-menu'), key = trackKey(item);
    menu.innerHTML = '<div class="pl-menu-title">Add to playlist</div>';
    audioPlaylists.forEach(pl => {
      const has = pl.tracks.includes(key);
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'menuitemcheckbox');
      b.setAttribute('aria-checked', String(has));
      b.innerHTML = '<span class="tick">' + (has ? '\u2713' : '') + '</span><span class="nm"></span><span class="cnt"></span>';
      b.querySelector('.nm').textContent = pl.name;
      b.querySelector('.cnt').textContent = pl.tracks.length;
      b.addEventListener('click', () => {
        plCloseMenu();
        if (has){ plRemove(pl, key); audioNote('Removed \u201C' + audioTitleOf(item) + '\u201D from ' + pl.name + '.'); }
        else plAdd(pl, item);
      });
      menu.appendChild(b);
    });
    const nb = document.createElement('button');
    nb.type = 'button'; nb.className = 'pl-menu-new'; nb.setAttribute('role', 'menuitem');
    nb.textContent = '+ New playlist\u2026';
    nb.addEventListener('click', () => {
      plCloseMenu();
      plAskName('', (name) => plAdd(plCreate(name), item));
    });
    menu.appendChild(nb);
    menu.hidden = false;
    // Place under the button, kept inside the viewport.
    const r = anchor.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = r.right - mw, top = r.bottom + 6;
    left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
    if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 6);
    menu.style.left = (left + window.scrollX) + 'px';
    menu.style.top = (top + window.scrollY) + 'px';
    (menu.querySelector('button') || menu).focus();
  }
  function plCloseMenu(){ el('audio-pl-menu').hidden = true; }
  document.body.appendChild(el('audio-pl-menu')); // positioned against the page, not the panel
  document.addEventListener('click', (e) => {
    if (!el('audio-pl-menu').hidden && !e.target.closest('#audio-pl-menu') && !e.target.closest('.pl-add')) plCloseMenu();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') plCloseMenu(); });
  window.addEventListener('resize', plCloseMenu);

  plFillSelect();

  // Green check on the playlist entry that's actually playing right now;
  // cleared as soon as playback pauses, stops or ends.
  function audioMarkPlaying(){
    const playing = !audioEl.paused && !audioEl.ended;
    const cur = playing ? audioCurrent : -1;
    el('audio-shelf').querySelectorAll('.lib-card').forEach(card => {
      card.classList.toggle('now-playing', +card.dataset.item === cur);
    });
  }

  async function audioScan(){
    if (!audioDirHandle){
      if (audioItems.length && await folderMissing(null, audioItems)) return audioForgetFolder();
      if (audioItems.length) return audioRefreshView();
      return audioNote('Choose a folder first.');
    }
    audioNote('Scanning…');
    try{
      if (audioDirHandle.queryPermission){
        let state = await audioDirHandle.queryPermission({ mode: 'read' });
        if (state !== 'granted' && audioDirHandle.requestPermission){
          state = await audioDirHandle.requestPermission({ mode: 'read' });
        }
        if (state !== 'granted') return audioNote('Access to that folder was not allowed. Tap Scan and choose Allow, or pick the folder again with Browse.');
      }
      const found = [];
      await audioWalk(audioDirHandle, '', found, 0);
      audioItems = [];
      for (const f of found){
        try{ audioItems.push({ file: await f.handle.getFile(), name: f.name, rel: f.rel }); }
        catch(err){ /* skip whatever will not open */ }
      }
      audioItems.sort((a, b) => (a.rel + a.name).localeCompare(b.rel + b.name));
      audioSourceLocal(audioDirHandle.name);
      audioRefreshView();
    }catch(err){
      if (err && err.name === 'NotFoundError') return audioForgetFolder();
      audioNote(folderErrorText(err));
    }
  }

  async function audioBrowse(){
    if (window.showDirectoryPicker){
      try{
        audioDirHandle = await window.showDirectoryPicker({ id: 'ark2-audio', mode: 'read' });
        dbSaveMeta('audioLibraryDir', audioDirHandle);
        return audioScan();
      }catch(err){
        if (err && err.name === 'AbortError') return;
      }
    }
    // No picker available -- fall back to a plain directory input.
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.webkitdirectory = true;
    inp.multiple = true;
    inp.addEventListener('change', () => {
      audioDirHandle = null;
      audioItems = [...inp.files].filter(f => audioIsFile(f.name))
        .map(f => ({ file: f, name: f.name, rel: (f.webkitRelativePath || '').replace(f.name, '') }));
      audioItems.sort((a, b) => (a.rel + a.name).localeCompare(b.rel + b.name));
      audioSourceLocal('Chosen folder');
      audioRefreshView();
    });
    inp.click();
  }

  el('audio-browse').addEventListener('click', audioBrowse);
  el('audio-scan').addEventListener('click', () => {
    if (audioSource.startsWith('drive:')) audioLoadDrive(audioSource.slice(6));
    else if (audioSource.startsWith('offline:')) audioLoadOffline(audioSource.slice(8));
    else audioScan();
  });

  (async () => {
    try{
      const saved = await dbLoadMeta('audioLibraryDir');
      if (!saved || !saved.name) return;
      if (await folderMissing(saved, null)){ dbSaveMeta('audioLibraryDir', null); return; }
      audioDirHandle = saved;
      const cfg = await getCloudConfig();
      audioSourceLocal(saved.name, false);
      if ((await offlineFolders('songs')).length || sourcePref('audioSource', cfg.audio) !== 'local') return;
      // Browsers only let a page ask for folder access in answer to a click,
      // so on load just check -- and if access has lapsed, point at Scan.
      const state = saved.queryPermission
        ? await saved.queryPermission({ mode: 'read' }) : 'prompt';
      if (state === 'granted') await audioScan();
      else audioNote('Your playlist folder is remembered — tap Scan to load it again.');
    }catch(err){ /* first run, or the browser cannot restore handles */ }
  })();

  // ---------- Audio playback / waveform / vinyl ----------
  const audioEl = el('audio-el');
  audioEl.crossOrigin = 'anonymous'; // Drive streams are cross-site; this keeps them readable by the visualizer

  function audioSetOrder(){
    audioOrder = audioViewIndices(); // the list on show: all tracks, or a playlist
    if (audioShuffle){
      for (let i = audioOrder.length - 1; i > 0; i--){
        const j = Math.floor(Math.random() * (i + 1));
        [audioOrder[i], audioOrder[j]] = [audioOrder[j], audioOrder[i]];
      }
    }
  }

  el('audio-shuffle').addEventListener('click', () => {
    audioShuffle = !audioShuffle;
    el('audio-shuffle').classList.toggle('active', audioShuffle);
    audioSetOrder();
    audioIndex = audioOrder.indexOf(audioCurrent);
  });
  el('audio-repeat').addEventListener('click', () => {
    audioRepeat = audioRepeat === 'off' ? 'all' : audioRepeat === 'all' ? 'one' : 'off';
    const btn = el('audio-repeat');
    btn.classList.toggle('active', audioRepeat !== 'off');
    btn.title = audioRepeat === 'one' ? 'Repeat one' : audioRepeat === 'all' ? 'Repeat all' : 'Repeat';
  });

  function audioPlayIndex(itemIndex){
    if (itemIndex < 0 || itemIndex >= audioItems.length) return;
    // Keep audioIndex pointing at this item's position within audioOrder so
    // next/prev continue correctly whether or not shuffle is on.
    audioIndex = audioOrder.indexOf(itemIndex);
    if (audioIndex < 0){ audioSetOrder(); audioIndex = audioOrder.indexOf(itemIndex); }
    audioGapCancel();
    const item = audioItems[itemIndex];
    audioCurrent = itemIndex;
    audioCurrentKey = trackKey(item);
    audioSetTitle(audioTitleOf(item));
    if (audioEl.src.startsWith('blob:')) URL.revokeObjectURL(audioEl.src);
    audioEl.src = item.driveId ? driveMediaUrl(item.driveId) : URL.createObjectURL(item.file);
    initAudioViz();
    audioEl.play().catch(() => { /* needs a user gesture on some browsers -- the click that got us here counts */ });
  }

  function audioStep(delta){
    if (!audioOrder.length) return;
    // Nothing from this list playing yet (e.g. just switched playlists):
    // start at its top.
    if (audioIndex < 0){ audioPlayIndex(audioOrder[0]); return; }
    let next = audioIndex + delta;
    if (next < 0) next = audioRepeat === 'all' ? audioOrder.length - 1 : 0;
    if (next >= audioOrder.length){
      if (audioRepeat === 'all') next = 0; else return; // stop at the end of the list
    }
    audioPlayIndex(audioOrder[next]);
  }
  el('audio-prev').addEventListener('click', () => audioStep(-1));
  el('audio-next').addEventListener('click', () => audioStep(1));

  // ---------- Pause between songs (personal playlists) ----------
  // With the toggle on, a playlist waits AUDIO_GAP seconds after each song
  // before starting the next -- time to breathe, reset, or find the page.
  // var, not const/let: the playlist picker can repaint the toggle while
  // the page is still starting, before these lines have run.
  var AUDIO_GAPS = [5, 10, 15, 20];
  var AUDIO_GAP = 15;                     // seconds; chosen in the dropdown beside the playlist
  var audioGapOn = false, audioGapTimer = null, audioGapLeft = 0;
  try{
    audioGapOn = localStorage.getItem('audioGap') === 'on';
    const sec = parseInt(localStorage.getItem('audioGapSec'), 10);
    if (AUDIO_GAPS.includes(sec)) AUDIO_GAP = sec;
  }catch(err){ /* ignore */ }
  function audioGapPaint(){
    const b = el('audio-gap');
    b.hidden = !plActive();
    b.parentElement.classList.toggle('with-gap', !b.hidden);
    const pick = el('audio-gap-sec');
    pick.hidden = b.hidden || !audioGapOn;
    pick.value = String(AUDIO_GAP || 15);
    b.classList.toggle('on', audioGapOn);
    b.classList.toggle('counting', !!audioGapTimer);
    b.setAttribute('aria-pressed', String(audioGapOn));
    el('audio-gap-label').textContent = (audioGapTimer ? audioGapLeft : (AUDIO_GAP || 15)) + 's';
    b.title = audioGapTimer ? 'Next song in ' + audioGapLeft + ' s (tap Play to start it now)'
      : 'Pause ' + (AUDIO_GAP || 15) + ' seconds between songs in this playlist: ' + (audioGapOn ? 'On' : 'Off');
  }
  function audioGapCancel(){
    if (!audioGapTimer) return;
    clearInterval(audioGapTimer);
    audioGapTimer = null;
    audioGapPaint();
  }
  // Start the next song now, ending any pause that's counting down.
  function audioGapSkip(){ audioGapCancel(); audioStep(1); }
  el('audio-gap-sec').addEventListener('change', (e) => {
    AUDIO_GAP = parseInt(e.target.value, 10) || 15;
    try{ localStorage.setItem('audioGapSec', String(AUDIO_GAP)); }catch(err){ /* ignore */ }
    if (audioGapTimer) audioGapLeft = Math.min(audioGapLeft, AUDIO_GAP);   // a shorter pause takes effect now
    audioGapPaint();
  });
  el('audio-gap').addEventListener('click', () => {
    audioGapOn = !audioGapOn;
    try{ localStorage.setItem('audioGap', audioGapOn ? 'on' : 'off'); }catch(err){ /* ignore */ }
    if (!audioGapOn && audioGapTimer) return audioGapSkip();   // switched off mid-pause: go on now
    audioGapPaint();
  });

  audioEl.addEventListener('ended', () => {
    if (audioRepeat === 'one'){ audioEl.currentTime = 0; audioEl.play(); return; }
    const last = audioIndex >= audioOrder.length - 1 && audioRepeat !== 'all';
    if (audioGapOn && plActive() && !last){
      audioGapLeft = AUDIO_GAP;
      audioGapTimer = setInterval(() => {
        if (--audioGapLeft <= 0) return audioGapSkip();
        audioGapPaint();
      }, 1000);
      audioGapPaint();
      return;
    }
    audioStep(1);
  });

  // ---------- Now-playing title (marquee when it overflows) ----------
  let audioTitle = '';
  function audioSetTitle(t){ audioTitle = t; audioUpdateTitle(); }
  function audioUpdateTitle(){
    const box = el('audio-nowplaying'), track = el('audio-np-track');
    box.classList.remove('marquee');
    track.textContent = audioTitle;
    const playing = !audioEl.paused && !audioEl.ended;
    const textW = track.getBoundingClientRect().width;
    const roomW = box.clientWidth - 24; // minus the side padding
    if (!playing || !audioTitle || textW <= roomW) return;
    track.textContent = '';
    for (let i = 0; i < 2; i++){
      const copy = document.createElement('span');
      copy.textContent = audioTitle;
      const gap = document.createElement('span');
      gap.className = 'np-gap';
      track.append(copy, gap);
    }
    // Constant reading speed (~40px/s) whatever the title's length.
    box.style.setProperty('--np-dur', ((textW + 48) / 40).toFixed(1) + 's');
    box.classList.add('marquee');
  }
  window.addEventListener('resize', () => { if (audioTitle) audioUpdateTitle(); });

  function audioSetPlayIcon(playing){
    el('audio-play-icon').style.display = playing ? 'none' : '';
    el('audio-pause-icon').style.display = playing ? '' : 'none';
    el('audio-playpause').classList.toggle('is-playing', playing);   // green face while playing
    el('vinyl-disc').classList.toggle('spinning', playing);
    el('vinyl-tonearm').classList.toggle('lifted', !playing);
    if (!playing) el('vinyl-tonearm').classList.remove('playing');   // LED off; it comes on in audioUpdateArm
    audioMarkPlaying();
    audioUpdateTitle();
  }
  audioEl.addEventListener('play', () => audioSetPlayIcon(true));
  audioEl.addEventListener('pause', () => audioSetPlayIcon(false));

  el('audio-playpause').addEventListener('click', () => {
    if (audioGapTimer) return audioGapSkip();
    if (!audioEl.src){ if (audioItems.length) audioPlayIndex(audioOrder[0] ?? 0); return; }
    if (audioEl.paused) audioEl.play(); else audioEl.pause();
  });

  // ---------- Live spectrum + volume fader/meter + seek bar ----------
  // One shared AudioContext routes the actual playback through:
  //   source -> gainNode (the fader) -> analyser (drives bars + LED meter) -> destination
  // so both the mini spectrum and the LED meter react to the real,
  // post-fader signal -- turning the volume down visibly quiets them too.
  let audioAnalysisCtx = null;
  function getAudioAnalysisCtx(){
    if (!audioAnalysisCtx){
      audioAnalysisCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioAnalysisCtx;
  }

  let audioAnalyser = null, audioFreqData = null, audioTimeData = null, audioGain = null;
  function initAudioViz(){
    if (audioAnalyser) return;
    try{
      const ctx = getAudioAnalysisCtx();
      const source = ctx.createMediaElementSource(audioEl);
      audioGain = ctx.createGain();
      audioAnalyser = ctx.createAnalyser();
      audioAnalyser.fftSize = 512;              // 256 bins -- fine enough for sharp, separate spikes
      audioAnalyser.smoothingTimeConstant = 0.6;
      source.connect(audioGain);
      audioGain.connect(audioAnalyser);
      audioAnalyser.connect(ctx.destination);   // must reconnect to destination, or captured audio goes silent
      audioFreqData = new Uint8Array(audioAnalyser.frequencyBinCount);
      audioTimeData = new Uint8Array(audioAnalyser.fftSize);
      // The fader now lives on the gain node; the element itself stays at
      // full so the two don't multiply.
      audioEl.volume = 1;
      audioApplyVolume();
    }catch(err){ /* createMediaElementSource can only run once per element -- already wired */ }
  }
  // Calling createMediaElementSource requires a user gesture in most
  // browsers; the first Play click both starts audio and wires the graph.
  el('audio-playpause').addEventListener('click', initAudioViz, { once: true });
  el('audio-shelf').addEventListener('click', initAudioViz, { once: true });

  // Spike colours sweep the whole rainbow left to right (red -> orange ->
  // yellow -> green -> cyan -> blue -> violet -> magenta), independent of
  // amplitude, like a neon hardware analyser.
  function audioBarColor(frac, alpha){
    const hue = frac * 300;
    return `hsla(${hue}, 100%, 60%, ${alpha})`;
  }

  // Many thin spikes rather than a few fat bars: sharp peaks read as the
  // individual tones in the music, and additive blending makes where they
  // crowd together glow.
  const BAR_COUNT = 76;
  let audioBarLevels = new Array(BAR_COUNT).fill(0); // smoothed, drives both draw + idle decay
  let audioIdleT = 0;
  let audioOrbSweep = 0;   // 0..1 across the width, driven by the idle animation
  let audioOrbAlpha = 1;   // fades the orb out while music plays, back in when it stops

  function audioPaintSpectrum(){
    const canvas = el('audio-spectrum');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 400, cssH = canvas.clientHeight || 160;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)){
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const playing = !audioEl.paused && !audioEl.ended;
    if (playing && audioAnalyser){
      audioAnalyser.getByteFrequencyData(audioFreqData);
      // Bins are spread on a log scale, the way pitch works -- a linear
      // spread would give the bass one spike and waste half the width on
      // near-silent treble.
      // Positions between two bins are interpolated, so the bass end doesn't
      // turn into a comb of identical spikes all reading the same bin.
      const lo = 2, hi = Math.floor(audioFreqData.length * 0.5);
      for (let i = 0; i < BAR_COUNT; i++){
        const pos = lo * Math.pow(hi / lo, i / (BAR_COUNT - 1));
        const b0 = Math.floor(pos), t = pos - b0;
        const raw = audioFreqData[b0] * (1 - t) + audioFreqData[Math.min(hi, b0 + 1)] * t;
        // Raised to a power so quiet bins sink and peaks stand out sharp.
        const v = Math.pow(raw / 255, 2.4);
        const k = v > audioBarLevels[i] ? 0.6 : 0.22; // fast attack, quick fall
        audioBarLevels[i] += (v - audioBarLevels[i]) * k;
      }
    } else {
      // Idle: a glowing orb glides back and forth along the floor line
      // (drawn below), over a low flicker of spikes that lift a little as
      // it passes. Whatever was playing falls away smoothly into it rather
      // than snapping to zero.
      audioIdleT += 0.016;
      audioOrbSweep = 0.5 - 0.5 * Math.cos(audioIdleT * 1.15); // eased 0..1..0
      const pos = audioOrbSweep * (BAR_COUNT - 1);
      const width = BAR_COUNT * 0.045;
      for (let i = 0; i < BAR_COUNT; i++){
        const flicker = 0.03 + 0.025 * Math.max(0, Math.sin(audioIdleT * 2.2 + i * 0.9) * Math.sin(i * 2.3));
        const d = (i - pos) / width;
        const lift = 0.16 * Math.exp(-d * d);
        audioBarLevels[i] += ((audioEl.paused ? flicker + lift : audioBarLevels[i]) - audioBarLevels[i]) * 0.3;
      }
    }

    // Spikes stand on a floor just above the title strip along the bottom
    // (~17px), so the song title never sits over the bars.
    const baseline = cssH - 27; // 8px of clear space between the floor and the title
    const maxH = baseline * 0.94;
    const step = cssW / BAR_COUNT;
    ctx.globalCompositeOperation = 'lighter'; // overlapping glow adds up, like light

    // Soft haze under the peaks' outline.
    const haze = ctx.createLinearGradient(0, 0, cssW, 0);
    for (let s = 0; s <= 6; s++) haze.addColorStop(s / 6, audioBarColor(s / 6, 0.16));
    ctx.beginPath();
    ctx.moveTo(0, baseline);
    for (let i = 0; i < BAR_COUNT; i++){
      ctx.lineTo((i + 0.5) * step, baseline - audioBarLevels[i] * maxH * 0.8);
    }
    ctx.lineTo(cssW, baseline);
    ctx.closePath();
    ctx.fillStyle = haze;
    ctx.fill();

    let bass = 0;
    const spike = (x, h, w, color) => {
      ctx.beginPath();
      ctx.moveTo(x - w, baseline);
      ctx.lineTo(x, baseline - h);
      ctx.lineTo(x + w, baseline);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };
    for (let i = 0; i < BAR_COUNT; i++){
      const frac = i / (BAR_COUNT - 1);
      const level = audioBarLevels[i];
      if (i < 10) bass += level;
      const h = Math.max(1.5, level * maxH);
      const x = (i + 0.5) * step;
      spike(x, h * 1.04, step * 1.6, audioBarColor(frac, 0.22)); // wide faint glow
      spike(x, h, Math.max(0.9, step * 0.45), audioBarColor(frac, 0.95)); // bright core

      // Mirrored reflection on the glassy floor, short and faint.
      const rh = h * 0.45;
      const refl = ctx.createLinearGradient(0, baseline, 0, baseline + rh);
      refl.addColorStop(0, audioBarColor(frac, 0.35));
      refl.addColorStop(1, audioBarColor(frac, 0));
      ctx.beginPath();
      ctx.moveTo(x - step * 0.6, baseline);
      ctx.lineTo(x, baseline + rh);
      ctx.lineTo(x + step * 0.6, baseline);
      ctx.closePath();
      ctx.fillStyle = refl;
      ctx.fill();
    }

    // Luminous floor line the spikes stand on.
    const floor = ctx.createLinearGradient(0, 0, cssW, 0);
    for (let s = 0; s <= 6; s++) floor.addColorStop(s / 6, audioBarColor(s / 6, 0.9));
    ctx.fillStyle = floor;
    ctx.fillRect(0, baseline - 0.75, cssW, 1.5);

    // The idle orb: a ball of light riding the floor line, coloured by
    // whatever part of the rainbow it's passing over.
    audioOrbAlpha += ((playing ? 0 : 1) - audioOrbAlpha) * 0.08;
    if (audioOrbAlpha > 0.02){
      const r = Math.max(4.5, cssH * 0.1);
      const pad = r * 2;
      const ox = pad + audioOrbSweep * (cssW - pad * 2);
      const frac = ox / cssW;
      const a = audioOrbAlpha;
      const halo = ctx.createRadialGradient(ox, baseline, 0, ox, baseline, r * 4.5);
      halo.addColorStop(0, audioBarColor(frac, 0.55 * a));
      halo.addColorStop(0.35, audioBarColor(frac, 0.18 * a));
      halo.addColorStop(1, audioBarColor(frac, 0));
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(ox, baseline, r * 4.5, 0, Math.PI * 2); ctx.fill();
      const core = ctx.createRadialGradient(ox - r * 0.3, baseline - r * 0.3, 0, ox, baseline, r);
      core.addColorStop(0, `rgba(255,255,255,${0.95 * a})`);
      core.addColorStop(0.45, audioBarColor(frac, 0.95 * a));
      core.addColorStop(1, audioBarColor(frac, 0.5 * a));
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(ox, baseline, r, 0, Math.PI * 2); ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';
    return bass / 10; // average bass energy 0..1, used for the vinyl's glow
  }

  // Inertia-driven rotation: velocity eases toward a target instead of
  // snapping between "spinning" and "stopped", so starting/stopping a
  // track feels like a real turntable winding up or coasting down.
  let vinylAngle = 0, vinylVelocity = 0;
  function audioAnimate(){
    const bass = audioPaintSpectrum();

    const playing = !audioEl.paused && !audioEl.ended;
    const targetVel = playing ? 2.6 : 0;
    vinylVelocity += (targetVel - vinylVelocity) * (playing ? 0.05 : 0.02);
    vinylAngle = (vinylAngle + vinylVelocity) % 360;
    el('vinyl-disc').style.transform = `rotate(${vinylAngle}deg)`;

    // Subtle glow ring pulsing with bass energy -- only while actually
    // playing, so a paused track doesn't sit there glowing at nothing.
    const glow = playing ? Math.min(1, bass * 1.6) : 0;
    el('vinyl-disc').style.boxShadow =
      `0 10px 26px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.05), ` +
      `inset 0 0 0 3px rgba(200,205,215,.35), ` +
      `0 0 ${18 + glow * 22}px ${glow * 6}px rgba(201,161,90,${0.15 + glow * 0.35})`;

    audioUpdateSeek();
    audioUpdateArm();
    audioUpdateMeter(playing);
    requestAnimationFrame(audioAnimate);
  }

  // ---------- Tonearm ----------
  // The arm pivots from the foot of its own box. For any groove radius r
  // there's one angle that puts the stylus exactly on it (law of cosines
  // below), as long as the arm can reach the inner groove at all. The
  // track's progress maps outer groove -> inner groove, the way a record
  // actually plays, and whenever it's paused or stopped the arm returns to
  // its rest, pointing straight up.
  const ARM_R_OUTER = 0.93, ARM_R_INNER = 0.5;  // groove radii as a fraction of the disc radius
  let armGeo = null;          // {px, py, cx, cy, R, d, base} in arm-column coordinates
  let armAngle = -180;        // current rotation (deg), eased toward the target each frame
  let armDragFrac = null;     // progress under the pointer while the arm is being dragged
  let armDragRest = false;    // ...and whether it is being carried back to its rest

  function audioMeasureArm(){
    // Measure the wrapper, not the disc: the disc is rotated while it spins,
    // and a rotated square's bounding box is up to 41% wider.
    const col = el('tt-arm-col'), arm = el('vinyl-tonearm'), disc = document.querySelector('.vinyl-wrap');
    if (!col.offsetWidth) return; // tab hidden -- measure again when shown
    const cr = col.getBoundingClientRect(), dr = disc.getBoundingClientRect();
    // Base sits near the foot of the box, leaving room below it for the
    // counterweight, which hangs behind the pivot while the arm is parked.
    const weightReach = -arm.querySelector('.tt-arm-weight').offsetTop;
    const plinthR = el('tt-pivot').offsetWidth / 2;
    const px = col.clientWidth / 2;
    const py = col.clientHeight - Math.max(weightReach, plinthR) - 8;
    arm.style.top = py + 'px';
    el('tt-pivot').style.top = py + 'px';
    el('tt-pivot-cap').style.top = py + 'px';
    const lever = el('tt-lever');
    lever.style.left = (px + plinthR - 1) + 'px';
    lever.style.top = (py - plinthR - lever.offsetHeight + 6) + 'px';
    const cx = dr.left + dr.width / 2 - cr.left, cy = dr.top + dr.height / 2 - cr.top;
    const R = dr.width / 2;
    const d = Math.hypot(cx - px, cy - py);
    // The box is only as tall as the record, so the arm is cut to fit it
    // standing upright -- but never so short it can't reach the inner groove.
    const L = Math.min(d, Math.max(py - 12, d - R * ARM_R_INNER + 6));
    armGeo = { px, py, cx, cy, R, d, L, base: Math.atan2(cy - py, cx - px) };
    arm.style.height = L + 'px';
    const rest = el('tt-arm-rest');
    rest.style.top = (py - L - 7) + 'px'; // centred under the parked stylus
  }
  if (typeof ResizeObserver !== 'undefined'){
    new ResizeObserver(audioMeasureArm).observe(el('audio-stage'));
  }
  window.addEventListener('resize', audioMeasureArm);
  el('tab-audio-player').addEventListener('click', () => requestAnimationFrame(audioMeasureArm));

  // Rotation (deg, CSS) that puts the stylus on the groove at `frac`
  // of the way through the record.
  function armAngleFor(frac){
    const g = armGeo;
    const r = g.R * (ARM_R_OUTER + (ARM_R_INNER - ARM_R_OUTER) * frac);
    // Law of cosines: the angle off the pivot->spindle line at which an arm
    // of length L puts its stylus exactly r from the spindle.
    const phi = Math.acos(Math.max(-1, Math.min(1, (g.L * g.L + g.d * g.d - r * r) / (2 * g.L * g.d))));
    // The arm is drawn hanging straight down (90deg); swing it to the
    // groove on the upper side of the pivot->spindle line, so it only has
    // to lean over from its upright rest rather than sweep across.
    return (g.base - phi) * 180 / Math.PI - 90;
  }

  function audioUpdateArm(){
    if (!armGeo) audioMeasureArm();
    if (!armGeo) return;
    let target = -180; // parked, pointing up -- whenever the record isn't playing
    const playing = !audioEl.paused && !audioEl.ended;
    if (armDragFrac !== null) target = armDragRest ? -180 : armAngleFor(armDragFrac);
    else if (playing && audioEl.duration) target = armAngleFor(audioEl.currentTime / audioEl.duration);
    // Faster while dragging so it sticks to the pointer; slow and weighty otherwise.
    armAngle += (target - armAngle) * (armDragFrac !== null ? 0.5 : 0.12);
    el('vinyl-tonearm').style.transform = `rotate(${armAngle}deg)`;
    // The headshell LED blinks only once the needle is down in the groove --
    // not while the arm is still swinging over, lifted, or being dragged.
    const onRecord = playing && !!audioEl.duration && armDragFrac === null && Math.abs(target - armAngle) < 1.5;
    el('vinyl-tonearm').classList.toggle('playing', onRecord);
  }

  // Progress (0..1) for a point, by its distance from the spindle --
  // i.e. which groove it is over. null when it's off the playing surface.
  function grooveFracAt(clientX, clientY){
    const dr = document.querySelector('.vinyl-wrap').getBoundingClientRect();
    const R = dr.width / 2;
    const r = Math.hypot(clientX - (dr.left + R), clientY - (dr.top + R)) / R;
    if (r > 1) return null;
    return Math.min(1, Math.max(0, (ARM_R_OUTER - r) / (ARM_R_OUTER - ARM_R_INNER)));
  }
  function audioSeekFrac(frac){
    if (audioEl.duration) audioEl.currentTime = frac * audioEl.duration;
  }

  // Drag the arm across the record to cue, like dropping the needle.
  const armEl = el('vinyl-tonearm');
  armEl.addEventListener('pointerdown', (e) => {
    if (!audioEl.src) return;
    e.preventDefault();
    armEl.setPointerCapture(e.pointerId);
    armEl.classList.add('dragging', 'lifted');
    armDragFrac = audioEl.duration ? audioEl.currentTime / audioEl.duration : 0;
    armDragRest = false;
  });
  // Near the rest: over the arm's own box (off the record), or close to the
  // rest post itself.
  function armNearRest(x, y){
    const c = el('tt-arm-col').getBoundingClientRect();
    if (x >= c.left && x <= c.right && y >= c.top && y <= c.bottom) return true;
    const r = el('tt-arm-rest').getBoundingClientRect();
    return Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) < 40;
  }
  armEl.addEventListener('pointermove', (e) => {
    if (armDragFrac === null) return;
    const f = grooveFracAt(e.clientX, e.clientY);
    if (f !== null){ armDragFrac = f; armDragRest = false; }
    else if (armNearRest(e.clientX, e.clientY)) armDragRest = true;
  });
  const armDrop = () => {
    if (armDragFrac === null) return;
    // Carried back to the rest: the record stops and goes back to the start,
    // like lifting the needle off and parking it.
    if (armDragRest){
      armDragFrac = null;
      armDragRest = false;
      armEl.classList.remove('dragging');
      audioEl.pause();
      audioEl.currentTime = 0;
      armEl.classList.add('lifted');
      return;
    }
    audioSeekFrac(armDragFrac);
    armDragFrac = null;
    armEl.classList.remove('dragging');
    // Dropping the needle on the record starts it playing -- otherwise the
    // arm would just swing straight back to its rest.
    if (audioEl.paused) audioEl.play().catch(() => {});
    armEl.classList.toggle('lifted', audioEl.paused);
  };
  armEl.addEventListener('pointerup', armDrop);
  armEl.addEventListener('pointercancel', armDrop);

  // Clicking the grooves drops the needle there directly.
  el('vinyl-disc').addEventListener('click', (e) => {
    if (!audioEl.src) return;
    const f = grooveFracAt(e.clientX, e.clientY);
    if (f !== null) audioSeekFrac(f);
  });

  // ---------- Volume box ----------
  // Fader position 0..100. The top of travel is +6 dB, unity (0 dB) sits
  // at 71%, matching the scale printed beside the slot.
  const AUDIO_UNITY = 71;
  let audioVolume = AUDIO_UNITY, audioMuted = false;
  try{
    const v = parseInt(localStorage.getItem('audioFader'), 10);
    if (!isNaN(v)) audioVolume = Math.max(0, Math.min(100, v));
  }catch(err){ /* ignore */ }

  function audioApplyVolume(){
    const level = audioMuted ? 0 : audioVolume / 100;
    // Squared so the fader feels even to the ear rather than bunching all
    // the audible change into the bottom inch; x2 gives +6 dB at the top
    // (2 * 0.71^2 = 1, unity).
    const gain = 2 * level * level;
    if (audioGain) audioGain.gain.setTargetAtTime(gain, getAudioAnalysisCtx().currentTime, 0.02);
    else audioEl.volume = Math.min(1, gain); // no gain node yet -- the element can't boost
    el('audio-vol-knob').style.bottom = audioVolume + '%';
    const val = el('audio-vol-val');
    val.textContent = audioMuted ? 'MUTE' : audioVolume + '%';
    val.classList.toggle('muted', audioMuted);
    el('audio-vol-track').setAttribute('aria-valuenow', String(audioVolume));
    el('audio-mute').classList.toggle('active', audioMuted);
    el('audio-mute-waves').style.display = audioMuted ? 'none' : '';
    el('audio-mute-x').style.display = audioMuted ? '' : 'none';
  }
  function audioSetVolume(v){
    audioVolume = Math.round(Math.max(0, Math.min(100, v)));
    if (audioVolume > 0) audioMuted = false;
    try{ localStorage.setItem('audioFader', String(audioVolume)); }catch(err){ /* ignore */ }
    audioApplyVolume();
  }
  function audioToggleMute(){ audioMuted = !audioMuted; audioApplyVolume(); }

  const volTrack = el('audio-vol-track');
  let volDragging = false;
  function volFromEvent(e){
    const r = volTrack.getBoundingClientRect();
    audioSetVolume((1 - (e.clientY - r.top) / r.height) * 100);
  }
  volTrack.addEventListener('pointerdown', (e) => {
    volDragging = true; volTrack.setPointerCapture(e.pointerId); volFromEvent(e);
  });
  volTrack.addEventListener('pointermove', (e) => { if (volDragging) volFromEvent(e); });
  volTrack.addEventListener('pointerup', () => { volDragging = false; });
  volTrack.addEventListener('pointercancel', () => { volDragging = false; });
  volTrack.addEventListener('wheel', (e) => {
    e.preventDefault(); audioSetVolume(audioVolume + (e.deltaY < 0 ? 5 : -5));
  }, { passive: false });
  volTrack.addEventListener('keydown', (e) => {
    const step = { ArrowUp: 5, ArrowRight: 5, ArrowDown: -5, ArrowLeft: -5, PageUp: 20, PageDown: -20 }[e.key];
    if (step){ e.preventDefault(); e.stopPropagation(); audioSetVolume(audioVolume + step); }
  });
  el('audio-mute').addEventListener('click', audioToggleMute);

  // LED ladder beside the fader, from the post-fader RMS level.
  const METER_LEDS = 14;
  const meterEl = el('audio-meter');
  for (let i = 0; i < METER_LEDS; i++){
    const led = document.createElement('i');
    if (i >= METER_LEDS - 1) led.className = 'red';
    else if (i >= METER_LEDS - 3) led.className = 'org';
    else if (i >= METER_LEDS - 5) led.className = 'yel';
    meterEl.appendChild(led);
  }
  const meterLeds = [...meterEl.children];
  let meterLevel = 0, meterLit = -1;
  function audioUpdateMeter(playing){
    let rms = 0;
    if (playing && audioAnalyser){
      audioAnalyser.getByteTimeDomainData(audioTimeData);
      let sum = 0;
      for (let i = 0; i < audioTimeData.length; i++){
        const s = (audioTimeData[i] - 128) / 128;
        sum += s * s;
      }
      rms = Math.sqrt(sum / audioTimeData.length);
    }
    const target = Math.min(1, rms * 2.8);
    meterLevel += (target - meterLevel) * (target > meterLevel ? 0.6 : 0.12); // fast rise, slow fall
    const lit = Math.round(meterLevel * METER_LEDS);
    if (lit === meterLit) return;
    meterLit = lit;
    meterLeds.forEach((led, i) => led.classList.toggle('on', i < lit));
  }
  audioApplyVolume();

  // ---------- Skip ----------
  function audioSkip(seconds){
    if (!audioEl.src || !audioEl.duration) return;
    audioEl.currentTime = Math.max(0, Math.min(audioEl.duration - 0.05, audioEl.currentTime + seconds));
  }
  el('audio-back10').addEventListener('click', () => audioSkip(-10));
  el('audio-fwd10').addEventListener('click', () => audioSkip(10));


  // Keyboard, while the Audio Player tab is the one on screen.
  document.addEventListener('keydown', (e) => {
    if (!el('audio-player-panel').classList.contains('active')) return;
    if (workspace.classList.contains('active')) return; // a score is open over it
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space'){
      if (tag === 'BUTTON') return; // let the focused button take its own Space press
      e.preventDefault(); el('audio-playpause').click();
    }
    else if (e.key === 'ArrowLeft'){ e.preventDefault(); audioSkip(-10); }
    else if (e.key === 'ArrowRight'){ e.preventDefault(); audioSkip(10); }
    else if (e.key === 'ArrowUp'){ e.preventDefault(); audioSetVolume(audioVolume + 5); }
    else if (e.key === 'ArrowDown'){ e.preventDefault(); audioSetVolume(audioVolume - 5); }
    else if (e.key === 'm' || e.key === 'M'){ audioToggleMute(); }
    else if (e.key === 'n' || e.key === 'N'){ audioStep(1); }
    else if (e.key === 'p' || e.key === 'P'){ audioStep(-1); }
  });
  requestAnimationFrame(audioAnimate);


  // ---------- Seek bar ----------
  function fmtTime(s){
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }
  function audioUpdateSeek(){
    const dur = audioEl.duration;
    const frac = dur ? audioEl.currentTime / dur : 0;
    if (!audioSeekDragging){
      el('audio-seek-fill').style.width = (frac * 100) + '%';
      el('audio-seek-knob').style.left = (frac * 100) + '%';
    }
    el('audio-time-cur').textContent = fmtTime(audioEl.currentTime);
    el('audio-time-dur').textContent = fmtTime(dur);
  }
  let audioSeekDragging = false;
  function audioSeekFromEvent(e){
    const track = el('audio-seek-track');
    const rect = track.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const frac = Math.min(1, Math.max(0, x / rect.width));
    el('audio-seek-fill').style.width = (frac * 100) + '%';
    el('audio-seek-knob').style.left = (frac * 100) + '%';
    return frac;
  }
  const seekTrack = el('audio-seek-track');
  seekTrack.addEventListener('pointerdown', (e) => {
    audioSeekDragging = true;
    seekTrack.classList.add('dragging');
    const frac = audioSeekFromEvent(e);
    if (audioEl.duration) audioEl.currentTime = frac * audioEl.duration;
    seekTrack.setPointerCapture(e.pointerId);
  });
  seekTrack.addEventListener('pointermove', (e) => {
    if (!audioSeekDragging) return;
    const frac = audioSeekFromEvent(e);
    if (audioEl.duration) audioEl.currentTime = frac * audioEl.duration;
  });
  const seekRelease = () => { audioSeekDragging = false; seekTrack.classList.remove('dragging'); };
  seekTrack.addEventListener('pointerup', seekRelease);
  seekTrack.addEventListener('pointercancel', seekRelease);

  // The vinyl label shows the same logo as the drop zone.
  (() => {
    const src = document.querySelector('.dz-logo');
    const label = el('vinyl-label-img');
    if (src && label) label.src = src.src;
  })();

  // ---------- Playlist view toggle (mirrors libSetView above) ----------
  function audioSetView(mode){
    const shelf = el('audio-shelf');
    shelf.classList.toggle('list-view', mode === 'list');
    el('audio-view-grid').classList.toggle('active', mode === 'grid');
    el('audio-view-list').classList.toggle('active', mode === 'list');
    try{ localStorage.setItem('audioView', mode); }catch(err){ /* ignore */ }
    fitAudioShelfSoon();
  }
  el('audio-view-grid').addEventListener('click', () => audioSetView('grid'));
  el('audio-view-list').addEventListener('click', () => audioSetView('list'));
  (() => {
    // List is the default. Stored under a new key so everyone starts on List
    // once, even if an older build remembered Thumbnails; after that, the
    // viewer's own choice sticks.
    let saved = 'list';
    try{ saved = localStorage.getItem('audioView') || 'list'; }catch(err){ /* ignore */ }
    audioSetView(saved === 'grid' ? 'grid' : 'list');
  })();

  el('lib-browse').addEventListener('click', libraryBrowse);
  // Scan re-reads whichever source is showing.
  el('lib-scan').addEventListener('click', () => {
    if (libSource.startsWith('drive:')) libLoadDrive(libSource.slice(6));
    else if (libSource.startsWith('offline:')) libLoadOffline(libSource.slice(8));
    else libraryScan();
  });

  // ---------- Library view toggle (thumbnails / list) ----------
  // A pure CSS-class switch: libRender() already builds the same .lib-card
  // markup either way, so changing view is just toggling a class on the
  // shelf and the two buttons, plus remembering the choice for next time.
  // APP_BUILD is baked into this page. When releasing, bump it together with
  // "build" in version.json and CACHE_VERSION in service-worker.js
  // (ark2-chorus-v<build>), then run `py tools/stamp.py` so every ?v= in
  // index.html and service-worker.js matches its file again -- the footer
  // compares this page's version with version.json fetched live, to tell a
  // fresh page from an old saved copy.
  // The number shown is V<APP_VERSION>.<build>.<patch>: APP_VERSION is the
  // major version, APP_BUILD goes up with each release (patch back to 0),
  // and APP_PATCH goes up with every code change in between. Keep all three
  // in step with "version", "build" and "patch" in version.json.
  const APP_VERSION = 1;
  const APP_BUILD = 109;
  const APP_PATCH = 40;
  const versionLabel = (v, b, p) => 'v' + v + '.' + b + '.' + p;
  const APP_LABEL = versionLabel(APP_VERSION, APP_BUILD, APP_PATCH);
  el('app-version').innerHTML = '<span class="av-name">Ark2 Chorus since 2007</span><span class="av-num"></span>';
  el('app-version').lastChild.textContent = APP_LABEL;
  el('app-version').lastChild.insertAdjacentHTML('beforeend',
    '<span class="ver-ok" id="ver-ok" title="Up to date" aria-label="Up to date" hidden>✓</span>');

  function updateStatus(cls, text){
    el('ver-ok').hidden = true; // only the up-to-date case shows the tick
    const box = el('app-update');
    box.className = 'app-update' + (cls ? ' ' + cls : '');
    box.textContent = text || '';
  }
  // Drops the service worker and the saved page, and loads the page fresh
  // from the site. Files saved under a ?v= hash stay for the new worker: it
  // keeps the ones whose hash hasn't changed (the voicebank, dictionary,
  // samples, libraries) instead of downloading them again. Everything else
  // goes now, so nothing can hand back the old page and ask to update again.
  async function forceFreshReload(latestBuild){
    updateStatus('', 'Updating…');
    try{
      if ('serviceWorker' in navigator){
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      }
      if (window.caches){
        for (const k of await caches.keys()){
          const cache = await caches.open(k);
          for (const req of await cache.keys()){
            if (!new URL(req.url).searchParams.has('v')) await cache.delete(req);
          }
        }
      }
    }catch(err){ /* reload anyway */ }
    // A new query string also steps around the browser's own HTTP cache.
    location.replace(location.pathname + '?build=' + (latestBuild || Date.now()));
  }
  // ---------- Offline readiness ----------
  // Asks the service worker, which owns the list of app files, how many are
  // saved on this device, and shows it beside the Wi-Fi mark.
  const offEl = el('off-status');
  let offState = 'checking', offInfo = null, offPoll = null, offTipTimer = null;
  const OFF_TEXT = {
    checking: 'Checking whether the app is saved on this device\u2026',
    saving: 'Saving the app on this device for offline use\u2026 Keep it open on Wi-Fi until this turns green.',
    ready: 'Ready offline: the app is saved on this device and opens without internet. (Songs and scores from \u2601 folders still need internet unless saved with \uD83D\uDCE5.)',
    missing: 'Not fully saved for offline yet. Tap to try again while online.',
    none: 'This browser can\u2019t save the app for offline use.'
  };
  function offShow(state){
    offState = state;
    offEl.dataset.state = state;
    const extra = state === 'missing' && offInfo ? ' (' + offInfo.have + ' of ' + offInfo.total + ' files saved)' : '';
    offEl.title = OFF_TEXT[state] + extra;
    offEl.setAttribute('aria-label', offEl.title);
    clearInterval(offPoll); offPoll = null;
    if (state === 'saving' || state === 'checking') offPoll = setInterval(offCheck, 2000);
  }
  function offAsk(worker, type){
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), type === 'cache-fill' ? 60000 : 5000);
      ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data); };
      try{ worker.postMessage({ type }, [ch.port2]); }catch(err){ clearTimeout(t); resolve(null); }
    });
  }
  let offBusy = false;
  async function offCheck(fill){
    if (offBusy) return;
    if (!('serviceWorker' in navigator)){ offShow('none'); return; }
    offBusy = true;
    try{
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg || reg.installing){ offShow('saving'); return; }   // first save still under way
      const w = reg.active || reg.waiting;
      if (!w){ offShow('saving'); return; }
      const st = await offAsk(w, fill ? 'cache-fill' : 'cache-status');
      if (!st){ offShow('checking'); return; }
      offInfo = st;
      offShow(st.have >= st.total ? 'ready' : 'missing');
    }catch(err){ offShow('missing'); }
    finally{ offBusy = false; }
    // Files the install couldn't save (a dropped connection) are fetched
    // again once per page load, without waiting for a tap on the mark.
    if (offState === 'missing' && !fill && !offAutoFilled && navigator.onLine){
      offAutoFilled = true;
      offShow('saving');
      offCheck(true);
    }
  }
  let offAutoFilled = false;
  function offTip(text){
    const tip = el('off-tip');
    tip.textContent = text;
    tip.hidden = false;
    clearTimeout(offTipTimer);
    offTipTimer = setTimeout(() => { tip.hidden = true; }, 4500);
  }
  offEl.addEventListener('click', async () => {
    if (offState === 'missing'){
      offShow('saving');
      offTip('Trying again\u2026');
      await offCheck(true);
    }
    offTip(offEl.title);
  });
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.addEventListener('controllerchange', () => setTimeout(offCheck, 500));
  }
  window.addEventListener('online', () => { if (offState !== 'ready') offCheck(true); });
  setTimeout(offCheck, 1500);

  // ---------- Internet indicator ----------
  // navigator.onLine only knows whether there's a network, not whether it
  // reaches the internet (a Wi-Fi with no connection still says "online"), so
  // when it claims to be online a tiny request to the site confirms it.
  const netEl = el('net-status');
  function netShow(online){
    if (online && cloudCfg.reachable === false) cloudConfigRetry();
    netEl.classList.remove('checking');
    netEl.classList.toggle('offline', !online);
    netEl.title = online ? 'Online' : 'Offline: showing saved songs and scores';
    netEl.setAttribute('aria-label', netEl.title);
  }
  let netBusy = false;
  async function netCheck(){
    if (!navigator.onLine){ netShow(false); return; }
    if (netBusy) return;
    netBusy = true;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    try{
      const r = await fetch('version.json?ping=' + Date.now(), { cache: 'no-store', signal: ctl.signal });
      netShow(r.ok || r.status < 500);
    }catch(err){ netShow(false); }
    finally{ clearTimeout(timer); netBusy = false; }
  }
  netEl.classList.add('checking');
  window.addEventListener('online', netCheck);
  window.addEventListener('offline', () => netShow(false));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) netCheck(); });
  setInterval(() => { if (!document.hidden) netCheck(); }, 30000);
  netCheck();

  async function checkForUpdate(){
    if (!navigator.onLine){
      updateStatus('offline', 'Offline — showing saved copy');
      return;
    }
    try{
      // version.json is not in the offline cache, and no-store skips the
      // HTTP cache, so this always reflects what's on the site right now.
      const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const latest = await res.json();
      const latestLabel = versionLabel(+latest.version || APP_VERSION, +latest.build, +latest.patch || 0);
      if (+latest.build > APP_BUILD || (+latest.build === APP_BUILD && (+latest.patch || 0) > APP_PATCH)){
        updateAsk(latestLabel);
        const box = el('app-update');
        el('ver-ok').hidden = true;
        box.className = 'app-update';
        box.textContent = '';
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = latestLabel + ' available — tap to update';
        b.addEventListener('click', () => forceFreshReload(latestLabel));
        box.appendChild(b);
      } else {
        updateStatus('', '');
        el('ver-ok').hidden = false;
      }
    }catch(err){
      updateStatus('offline', "Couldn't check for updates — showing saved copy");
    }
  }
  // A new build is on the site: ask once per build per session. "Later"
  // leaves the small "tap to update" line on the home screen.
  function updateAsk(label){
    let asked = '';
    try{ asked = sessionStorage.getItem('updAsked') || ''; }catch(err){ /* ignore */ }
    if (asked === label || !el('upd-pop').hidden) return;
    el('upd-pop-text').innerHTML = 'Ark2 Chorus <b>' + label + '</b> is ready (you have ' + APP_LABEL + '). Update now to get the latest changes.';
    el('upd-pop').hidden = false;
    setTimeout(() => el('upd-pop-ok').focus(), 30);
    const close = () => {
      el('upd-pop').hidden = true;
      try{ sessionStorage.setItem('updAsked', label); }catch(err){ /* ignore */ }
    };
    el('upd-pop-ok').onclick = () => { close(); forceFreshReload(label); };
    el('upd-pop-later').onclick = close;
    el('upd-pop').onclick = (e) => { if (e.target === el('upd-pop')) close(); };
  }
  checkForUpdate();
  // An installed app can stay open for days: look again on coming back to
  // it and every half hour.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
  setInterval(() => { if (!document.hidden) checkForUpdate(); }, 30 * 60 * 1000);
  window.addEventListener('online', checkForUpdate);
  window.addEventListener('offline', checkForUpdate);
  // Clean the ?build=… marker from the address bar after a fresh load.
  if (/[?&]build=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);

  function libSetView(mode){
    const shelf = el('lib-shelf');
    shelf.classList.toggle('list-view', mode === 'list');
    el('lib-view-grid').classList.toggle('active', mode === 'grid');
    el('lib-view-list').classList.toggle('active', mode === 'list');
    // 'libView', not the old 'libViewMode': that one was saved as 'grid' on every
    // device at start-up, so a new key is what lets List become the default.
    try{ localStorage.setItem('libView', mode); }catch(err){ /* private mode etc. */ }
  }
  el('lib-view-grid').addEventListener('click', () => libSetView('grid'));
  el('lib-view-list').addEventListener('click', () => libSetView('list'));
  (() => {
    let saved = 'list';
    try{ saved = localStorage.getItem('libView') || 'list'; }catch(err){ /* ignore */ }
    libSetView(saved === 'grid' ? 'grid' : 'list');
  })();

  (() => {
    const brand = document.querySelector('.topbar-brand');
    if (!brand) return;
    brand.style.cursor = 'pointer';
    brand.title = 'Back to the library';
    brand.addEventListener('click', goHome);
  })();

  // A folder chosen last time comes back on its own, when the browser kept the
  // permission. When it did not, the name still shows so Scan is one click.
  (async () => {
    try{
      const saved = await dbLoadMeta('libraryDir');
      if (!saved || !saved.name) return;
      if (await folderMissing(saved, null)){ dbSaveMeta('libraryDir', null); return; }
      libDirHandle = saved;
      // Remember the device folder in the picker, but only reopen it if it's
      // the source this viewer was last using.
      const cfg = await getCloudConfig();
      libSourceLocal(saved.name, false);
      if ((await offlineFolders()).length || sourcePref('libSource', cfg.notes) !== 'local') return;
      const state = saved.queryPermission
        ? await saved.queryPermission({ mode: 'read' }) : 'prompt';
      if (state === 'granted') await libraryScan();
      else libNote('Folder remembered — click Scan to open it again.');
    }catch(err){ /* nothing stored, or this browser cannot store handles */ }
  })();

  // ---------- Piano ----------
  // A0 to C8 -- the whole 88. A choir never leaves the middle five octaves, so
  // a cropped keyboard looked tidier; a MIDI keyboard plugged into the recorder
  // can send anything, and a note with no key to land on simply vanishes,
  // because pianoPaint finds no element and returns. Covering the full
  // instrument is what makes that impossible rather than merely unlikely.
  // Fixed, not trimmed to each score: the keyboard is also how you read where a
  // part sits, and a Bass line hugging the low end says something that the same
  // line centred in a cropped keyboard does not.
  const PIANO_LOW = 21, PIANO_HIGH = 108;
  const BLACK_IN_OCTAVE = new Set([1, 3, 6, 8, 10]);   // C# D# F# G# A#
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const pianoKeyEls = new Map();     // midi -> the big keyboard's element
  const pianoHeld = new Map();       // midi -> [colour, ...], one per voice holding it
  let pianoBuilt = false;

  const isBlackKey = (midi) => BLACK_IN_OCTAVE.has(((midi % 12) + 12) % 12);
  const noteName = (midi) => NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);

  // How many white keys lie below this one. White keys tile the row and black
  // keys are placed over the seam between two of them, so every position on
  // the keyboard derives from this one count.
  function whitesBelow(midi){
    let n = 0;
    for (let m = PIANO_LOW; m < midi; m++) if (!isBlackKey(m)) n++;
    return n;
  }

  function pianoTotalWhites(){
    let n = 0;
    for (let m = PIANO_LOW; m <= PIANO_HIGH; m++) if (!isBlackKey(m)) n++;
    return n;
  }

  /** Lay out one keyboard. `mini` builds the navigator strip, which is the
   *  same instrument with no labels and no interaction. */
  function pianoLayout(host, whiteW, mini){
    host.innerHTML = '';
    const frag = document.createDocumentFragment();
    const blacks = [];
    for (let midi = PIANO_LOW; midi <= PIANO_HIGH; midi++){
      const black = isBlackKey(midi);
      const k = document.createElement(mini ? 'div' : 'button');
      k.className = (mini ? 'pk ' : 'pkey ') + (black ? 'black' : 'white');
      if (!mini) k.type = 'button';
      if (black){
        // centred on the seam: the white key it follows ends there
        k.style.left = (whitesBelow(midi) * whiteW - whiteW * 0.31) + 'px';
        if (mini) k.style.width = (whiteW * 0.62) + 'px';
      } else {
        k.style.left = (whitesBelow(midi) * whiteW) + 'px';
        if (mini) k.style.width = whiteW + 'px';
        if (!mini){
          const label = document.createElement('span');
          label.className = 'pkey-label oct-' + (Math.floor(midi / 12) - 1);
          label.textContent = noteName(midi);
          k.appendChild(label);
        }
      }
      if (!mini){
        k.dataset.midi = String(midi);
        k.title = noteName(midi);
        pianoKeyEls.set(midi, k);
      }
      if (black) blacks.push(k); else frag.appendChild(k);
    }
    // Black keys last so they stack over the white ones without needing the
    // z-index to fight document order.
    blacks.forEach(b => frag.appendChild(b));
    host.appendChild(frag);
    host.style.width = (pianoTotalWhites() * whiteW) + 'px';
  }

  function pianoBuild(){
    if (pianoBuilt) return;
    const keys = el('piano-keys');
    const whiteW = parseFloat(
      getComputedStyle(el('piano-panel')).getPropertyValue('--kw')) || 34;
    pianoLayout(keys, whiteW, false);

    // The navigator has to fit its container exactly, so its key width falls
    // out of the available width rather than being chosen.
    const nav = el('piano-nav');
    const navW = nav.clientWidth || 900;
    // Hold the window aside first. pianoLayout clears its host, and the window
    // lives inside the navigator -- laying the mini keys out destroys it, and
    // putting back what is by then a null is how this failed the first time.
    const win = el('piano-nav-window');
    win.remove();
    pianoLayout(nav, navW / pianoTotalWhites(), true);
    nav.appendChild(win);

    const scroll = el('piano-scroll');
    scroll.addEventListener('scroll', pianoSyncWindow, { passive: true });
    window.addEventListener('resize', pianoSyncWindow);

    el('piano-left').addEventListener('click',
      () => scroll.scrollBy({ left: -whiteW * 7, behavior: 'smooth' }));
    el('piano-right').addEventListener('click',
      () => scroll.scrollBy({ left: whiteW * 7, behavior: 'smooth' }));

    // Drag or click the navigator to move the big keyboard.
    let dragging = false;
    const seek = (clientX) => {
      const r = nav.getBoundingClientRect();
      const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      scroll.scrollLeft = frac * scroll.scrollWidth - scroll.clientWidth / 2;
    };
    nav.addEventListener('pointerdown', (e) => {
      dragging = true; nav.setPointerCapture(e.pointerId); seek(e.clientX);
    });
    nav.addEventListener('pointermove', (e) => { if (dragging) seek(e.clientX); });
    nav.addEventListener('pointerup', () => { dragging = false; });
    nav.addEventListener('pointercancel', () => { dragging = false; });

    // Press and release, not click: a press has a length, and that length is
    // what makes it a note rather than an event. Routed through the very
    // midiKeyDown/midiKeyUp the hardware uses, so tapping these keys records
    // exactly as playing a plugged-in keyboard does.
    //
    // The old handler did neither. It looked for a staff to borrow a voice
    // from and gave up when there was none -- which is precisely the state a
    // blank MIDI take is in, so on a fresh take the keys were silent, unlit
    // and unrecorded, with nothing to say why.
    let pointerNote = null;
    keys.addEventListener('pointerdown', (e) => {
      const k = e.target.closest('.pkey');
      if (!k) return;
      e.preventDefault();
      if (pointerNote !== null) midiKeyUp(pointerNote);
      pointerNote = parseInt(k.dataset.midi, 10);
      try{ keys.setPointerCapture(e.pointerId); }catch(err){ /* ignore */ }
      midiKeyDown(pointerNote, 100);
    });
    // Only the note this pointer pressed is released -- lifting everything in
    // midiDown would cut off notes a plugged-in keyboard is still holding.
    const releasePointer = () => {
      if (pointerNote === null) return;
      midiKeyUp(pointerNote);
      pointerNote = null;
    };
    keys.addEventListener('pointerup', releasePointer);
    keys.addEventListener('pointercancel', releasePointer);
    keys.addEventListener('pointerleave', releasePointer);

    pianoBuilt = true;
    pianoSyncWindow();
  }

  function pianoSyncWindow(){
    const scroll = el('piano-scroll'), win = el('piano-nav-window');
    if (!scroll || !win || !scroll.scrollWidth) return;
    const frac = scroll.clientWidth / scroll.scrollWidth;
    win.style.left = (scroll.scrollLeft / scroll.scrollWidth * 100) + '%';
    win.style.width = (Math.min(1, frac) * 100) + '%';
  }

  /** Put the loaded score's range on screen. Opening at A0 would show the
   *  bottom of the instrument, which is almost never where the music is. */
  function pianoFocusScore(){
    const scroll = el('piano-scroll');
    if (!scroll || !staffTracks.length) return;
    let lo = Infinity, hi = -Infinity;
    staffTracks.forEach(t => t.events.forEach(e => {
      if (e.midi < lo) lo = e.midi;
      if (e.midi > hi) hi = e.midi;
    }));
    if (!isFinite(lo)) return;
    // A score can run past the keyboard; scrolling to a key that is not there
    // would park the view at one end for no reason.
    lo = Math.max(lo, PIANO_LOW);
    hi = Math.min(hi, PIANO_HIGH);
    const whiteW = parseFloat(
      getComputedStyle(el('piano-panel')).getPropertyValue('--kw')) || 34;
    const left = whitesBelow(lo) * whiteW;
    const right = whitesBelow(hi) * whiteW + whiteW;
    scroll.scrollLeft = (left + right) / 2 - scroll.clientWidth / 2;
    pianoSyncWindow();
  }

  // --- pressing keys -------------------------------------------------------

  function pianoPaint(midi){
    const k = pianoKeyEls.get(midi);
    if (!k) return;
    const held = pianoHeld.get(midi);
    if (held && held.length){
      // The newest voice wins the colour; the count is what keeps the key down.
      k.style.setProperty('--lit', held[held.length - 1]);
      k.classList.add('on');
    } else {
      k.classList.remove('on');
      k.style.removeProperty('--lit');
    }
  }

  function pianoNoteOn(midi, colour){
    if (!pianoHeld.has(midi)) pianoHeld.set(midi, []);
    pianoHeld.get(midi).push(colour);
    pianoPaint(midi);
  }

  function pianoNoteOff(midi, colour){
    const held = pianoHeld.get(midi);
    if (!held) return;
    // Drop this voice's own hold, not simply the last one, so unisons release
    // in the order they actually end.
    const i = held.lastIndexOf(colour);
    held.splice(i === -1 ? held.length - 1 : i, 1);
    if (!held.length) pianoHeld.delete(midi);
    pianoPaint(midi);
  }

  function pianoFlash(midi, colour){
    pianoNoteOn(midi, colour);
    setTimeout(() => pianoNoteOff(midi, colour), 320);
  }

  function pianoReleaseAll(){
    pianoHeld.clear();
    pianoKeyEls.forEach((k) => {
      k.classList.remove('on');
      k.style.removeProperty('--lit');
    });
  }

  /** Called from the schedule for every note. Silent voices stay dark: the
   *  keyboard should show what you are hearing, so muting a part stops its
   *  keys as well as its sound. */
  // Which staves light the keyboard: the ones you can hear, and -- when the
  // mixer's eyes pick staves -- only the ones shown.
  function pianoLights(track, anySolo){
    if (track.visible === false) return false;
    return anySolo ? !!track.soloed : !track.muted;
  }
  // Stopped or paused and moving through the notes: light the keys of every
  // note sounding at that beat.
  function pianoShowAt(beat){
    pianoReleaseAll();
    const anySolo = staffTracks.some(t => t.soloed);
    staffTracks.forEach(t => {
      if (!pianoLights(t, anySolo)) return;
      const colour = 'var(' + t.colorVar + ')';
      t.events.forEach(e => {
        if (e.time <= beat + 1e-6 && beat < e.time + e.dur - 1e-6) pianoNoteOn(e.midi, colour);
      });
    });
  }

  function pianoSchedule(track, midi, time, dur){
    // Scheduled whether or not the tab is open. Skipping it while hidden would
    // mean switching to the piano mid-song showed a dead keyboard until the
    // schedule was rebuilt; two deferred callbacks per note cost nothing, and
    // pianoPaint simply finds no element when the keys do not exist yet.
    if (!pianoLights(track, staffTracks.some(t => t.soloed))) return;
    const colour = 'var(' + track.colorVar + ')';
    try{
      Tone.Draw.schedule(() => pianoNoteOn(midi, colour), time);
      Tone.Draw.schedule(() => pianoNoteOff(midi, colour), time + dur);
    }catch(err){ /* a draw that cannot be scheduled is not worth failing over */ }
  }

  // --- the switch ----------------------------------------------------------

  function showMixerPanel(which){
    const piano = which === 'piano';
    el('tab-mixer').classList.toggle('active', !piano);
    el('tab-piano').classList.toggle('active', piano);
    el('staff-list').hidden = piano;
    el('piano-panel').hidden = !piano;
    const bar = document.querySelector('.mixer-bar');
    if (bar) bar.classList.toggle('on-piano', piano);
    // A menu left hanging over a panel that is no longer there.
    if (!piano && typeof exportMenu === 'function') exportMenu(false);
    if (piano){
      // Built on first sight, not at load: 88 keys are wasted work for anyone
      // who never opens this tab, and the navigator cannot measure itself
      // while its container is hidden anyway.
      pianoBuild();
      pianoSyncWindow();
      pianoFocusScore();
    }
  }

  el('tab-mixer').addEventListener('click', () => showMixerPanel('mixer'));
  el('tab-piano').addEventListener('click', () => showMixerPanel('piano'));

  // ---------- Lyrics view ----------
  // Lyrics ▾ lists the voices whose notes carry words. Picking one opens a
  // see-through panel over the score with that voice's words, the one being
  // sung lit up as the score plays. Its Play button plays only that voice;
  // Piano adds the accompaniment (every part without lyrics) back in.
  let lyricsTrack = null;
  let lyricsWords = [];   // [{ beat, el }] in time order
  let lyricsIdx = -2;
  let lyricsRaf = 0;
  let lyricsWithPiano = false;
  const lyricsExtra = new Set();   // other voices singing along in the lyrics view (their Solo buttons)
  let lyricsRests = [];        // [start, end] beats where the chosen voice is silent > 4 counts
  let lyricsSoloKey = null;    // what the "is singing" pill currently says

  // Stretches where a track makes no sound for longer than `minBeats`
  // (quarter-note counts), including before its first note.
  function longRests(track, minBeats){
    const out = [];
    let soundEnd = 0;
    track.events.slice().sort((a, b) => a.time - b.time).forEach(e => {
      if (e.time - soundEnd > minBeats + 1e-6) out.push([soundEnd, e.time]);
      soundEnd = Math.max(soundEnd, e.time + e.dur);
    });
    return out;
  }
  // Updates the pill for the current beat: during one of the chosen voice's
  // long rests, name the other lyric voices that have a note sounding now.
  function lyricsUpdateSolo(beat){
    const pill = el('lyrics-solo');
    let singers = [];
    if (lyricsRests.some(([a, b]) => beat >= a - 1e-6 && beat < b)){
      singers = lyricVoices().filter(t => t !== lyricsTrack &&
        t.events.some(e => beat >= e.time - 1e-6 && beat < e.time + e.dur));
    }
    const key = singers.map(t => t.id).join('|');
    if (key === lyricsSoloKey) return;
    lyricsSoloKey = key;
    if (!singers.length){ pill.hidden = true; return; }
    const names = singers.map(t => t.label);
    const list = names.length === 1 ? names[0]
      : names.slice(0, -1).join(', ') + ' & ' + names[names.length - 1];
    pill.innerHTML = '<span class="dots"></span><span class="txt"></span>';
    singers.forEach(t => {
      const d = document.createElement('span');
      d.className = 'dot';
      d.style.setProperty('--c', 'var(' + t.colorVar + ')');
      pill.firstChild.appendChild(d);
    });
    pill.lastChild.textContent = list + (names.length === 1 ? ' is singing' : ' are singing');
    pill.style.setProperty('--solo', 'var(' + singers[0].colorVar + ')');
    pill.hidden = false;
  }
  try{ lyricsWithPiano = localStorage.getItem('lyricsWithPiano') === '1'; }catch(err){ /* ignore */ }

  const lyricVoices = () => staffTracks.filter(t => t.events.some(e => e.lyric));
  const accompaniment = () => staffTracks.filter(t => !t.events.some(e => e.lyric));

  // Syllables -> words -> lines. A chord repeats its lyric on every note, so
  // only the first syllable at each onset counts. Hyphenated syllables
  // (begin/middle/end) join into one word; a line breaks after punctuation
  // or once it gets long.
  // Syllables -> words -> lines, laid out the way the music phrases them.
  //
  // Words: a chord repeats its lyric on every note, so only the first
  // syllable at each onset counts. Syllables join into one word when the
  // file says so (syllabic begin/middle/end) and also when it only shows it
  // with a hyphen ("to-" + "night"), which some notation programs export.
  // A capital that lands mid-word from a split ("na" + "Tion") is lowered.
  //
  // Lines: a new line starts where the voice actually rests, or after a
  // sentence ends. A comma or a short breath only breaks a line that's
  // already a few words long, and nothing runs past 12 words. A rest of a
  // bar or more also leaves a gap, which is usually a verse break.
  // Obvious typos in score files, corrected for display only (the file
  // itself is never changed). Deliberately a short list of unambiguous
  // misspellings -- anything that could be a real word, a name or an old
  // spelling (wondrous, Saviour, Emmanuel) is left alone. Keys are lower
  // case; the word's own capitals are kept.
  const LYRIC_TYPOS = {
    savvior: 'savior', saviuor: 'saviour', saivor: 'savior',
    virgln: 'virgin', vigin: 'virgin',
    sheldtered: 'sheltered', sheltred: 'sheltered',
    inword: 'inward',
    chirstmas: 'christmas', chrismas: 'christmas', christmass: 'christmas',
    hallelujiah: 'hallelujah', halleluja: 'hallelujah',
    recieve: 'receive', recieved: 'received', beleive: 'believe', beleived: 'believed',
    rejoyce: 'rejoice', diety: 'deity', heavan: 'heaven', heavanly: 'heavenly',
    glorius: 'glorious', desciples: 'disciples', wisemen: 'wise men',
    beleiver: 'believer', mercyful: 'merciful', holyness: 'holiness',
    salvaton: 'salvation', annointed: 'anointed', fourty: 'forty'
  };
  function fixLyricWord(text){
    // leading punctuation | the word | possessive | whatever follows
    const m = text.match(/^([^A-Za-z]*)([A-Za-z]+)((?:['\u2019]s)?)(.*)$/);
    if (!m) return text;
    let [, lead, core, poss, rest] = m;
    const fix = LYRIC_TYPOS[core.toLowerCase()];
    if (fix){
      core = core === core.toUpperCase() && core.length > 1 ? fix.toUpperCase()
           : core[0] === core[0].toUpperCase() ? fix[0].toUpperCase() + fix.slice(1)
           : fix;
    }
    // A stray apostrophe stuck on the end ("war'", "tender'") -- but not a
    // real dropped-g ending like "singin'".
    if (!poss && /^['\u2019](?![A-Za-z])/.test(rest) && !/in$/i.test(core)) rest = rest.slice(1);
    return lead + core + poss + rest;
  }

  function lyricLines(track){
    const notes = track.events.slice().sort((a, b) => a.time - b.time);
    const seen = new Set(), syl = [];
    notes.filter(e => e.lyric).forEach(e => {
      const k = e.time.toFixed(4);
      if (seen.has(k)) return;
      seen.add(k); syl.push(e);
    });

    const words = [];
    let cur = null;
    syl.forEach(e => {
      let t = (e.lyric || '').trim();
      const sy = e.syllabic || 'single';
      let joinPrev = sy === 'middle' || sy === 'end';
      let joinNext = sy === 'begin' || sy === 'middle';
      if (t.length > 1 && /-$/.test(t)){ t = t.replace(/-+$/, ''); joinNext = true; }
      if (t.length > 1 && /^-/.test(t)){ t = t.replace(/^-+/, ''); joinPrev = true; }
      if (!t || t === '-') return;                     // a bare hyphen marker, not a word
      // Repairs for files that mark syllables wrongly: never glue onto a
      // word that ends a phrase ("soul," + "Case"), and rejoin fragments
      // entered as separate words ("na" + "tion", "Christ" + "mas",
      // "to" + "night").
      const prevEndsPhrase = cur && /[.,;:!?]["'”’)]*$/.test(cur.text);
      const looseSuffix = cur && !prevEndsPhrase && /[a-z]$/i.test(cur.text) &&
        /^(tion|tions|sion|sions|ness|ment|ments|mas|ture|tures|ous|ing|ings|ful|less)\b/.test(t);
      const toWord = cur && /^to$/i.test(cur.text) && /^(night|day|morrow)\b/.test(t);
      if (cur && !prevEndsPhrase && (joinPrev || cur.open || looseSuffix || toWord)){
        if (/[a-z]$/.test(cur.text) && /^[A-Z][a-z]/.test(t)) t = t[0].toLowerCase() + t.slice(1);
        cur.text += t;
      } else {
        cur = { text: t, beat: e.time };
        words.push(cur);
      }
      cur.open = joinNext;
    });

    words.forEach(w => { w.text = fixLyricWord(w.text); });

    // Where the voice last stops sounding before a given beat (its own
    // notes, melismas included) -- the size of the rest before a word.
    const soundEndBefore = (t) => {
      let endAt = -Infinity;
      for (const n of notes){
        if (n.time >= t - 1e-6) break;
        endAt = Math.max(endAt, n.time + n.dur);
      }
      return endAt;
    };
    const eps = 1e-6;
    const lines = [];
    let line = [];
    words.forEach((w, i) => {
      line.push(w);
      const next = words[i + 1];
      if (!next) return;
      const rest = next.beat - soundEndBefore(next.beat);
      const n = line.length;
      const sentence = /[.!?;:]["'\u201D\u2019)]*$/.test(w.text);
      const comma = /,["'\u201D\u2019)]*$/.test(w.text);
      const brk = rest >= 1 - eps || sentence
        || (rest >= 0.5 - eps && n >= 4) || (comma && n >= 4) || n >= 12;
      if (brk){
        line.stanzaEnd = rest >= 4 - eps;
        lines.push(line);
        line = [];
      }
    });
    if (line.length) lines.push(line);
    return lines;
  }

  function lyricsPlace(){
    const v = el('lyrics-view');
    const topBar = el('top-bar').getBoundingClientRect();
    const mixer = el('bottom-mixer').getBoundingClientRect();
    v.style.top = (topBar.bottom + 8) + 'px';
    // End above the Hide/Show Controls tab, which sticks up ~24px from the mixer.
    v.style.bottom = Math.max(8, window.innerHeight - mixer.top + 30) + 'px';
  }

  function lyricsSetFocus(){
    if (!lyricsTrack){ lyricsFocus = null; return; }
    lyricsFocus = new Set([lyricsTrack.id]);
    if (lyricsWithPiano) accompaniment().forEach(t => lyricsFocus.add(t.id));
    lyricsExtra.forEach(id => { if (id !== lyricsTrack.id) lyricsFocus.add(id); });
  }

  function lyricsOpen(track){
    if (!lyricsTrack || lyricsTrack.id !== track.id) lyricsExtra.clear();   // a new lead voice starts on its own
    lyricsTrack = track;
    lyricsSetFocus();
    applyMixState();
    el('lyrics-voice').textContent = track.label;
    el('lyrics-dot').style.setProperty('--c', 'var(' + track.colorVar + ')');
    el('lyrics-view').style.setProperty('--voice', 'var(' + track.colorVar + ')');
    const pianoWrap = el('lyrics-piano-wrap');
    pianoWrap.hidden = accompaniment().length === 0;
    el('lyrics-piano').checked = lyricsWithPiano;

    const body = el('lyrics-body');
    body.innerHTML = '';
    lyricsWords = [];
    const lines = lyricLines(track);
    if (!lines.length){
      body.innerHTML = '<p class="lyrics-empty">No words found for this voice.</p>';
    }
    lines.forEach(line => {
      const p = document.createElement('p');
      p.className = 'lyrics-line' + (line.stanzaEnd ? ' stanza-end' : '');
      line.forEach((w, i) => {
        const sp = document.createElement('span');
        sp.className = 'lyrics-w';
        sp.textContent = w.text;
        // Tap a word to jump there.
        sp.addEventListener('click', () => {
          if (isPlaying) seekAndPlay(w.beat); else seekToBeat(w.beat);
        });
        p.appendChild(sp);
        if (i < line.length - 1) p.appendChild(document.createTextNode(' '));
        lyricsWords.push({ beat: w.beat, el: sp, line: p });
      });
      body.appendChild(p);
    });
    body.scrollTop = 0;
    lyricsIdx = -2;
    lyricsRests = longRests(track, 4);
    lyricsSoloKey = null;
    el('lyrics-solo').hidden = true;
    el('lyrics-view').hidden = false;
    el('tab-lyrics').classList.add('on');
    lyricsPlace();
    cancelAnimationFrame(lyricsRaf);
    lyricsRaf = requestAnimationFrame(lyricsTick);
  }

  function lyricsClose(){
    if (!lyricsTrack && el('lyrics-view').hidden) return;
    lyricsTrack = null;
    lyricsFocus = null;
    lyricsExtra.clear();
    el('lyrics-view').hidden = true;
    el('tab-lyrics').classList.remove('on');
    cancelAnimationFrame(lyricsRaf);
    if (staffTracks.length) applyMixState(); // back to the mixer's own settings
  }

  // Lights the word being sung, dims what's gone by, and keeps the current
  // line in view. Also keeps Play/Pause in step with the main transport.
  function lyricsTick(){
    if (!lyricsTrack) return;
    document.body.classList.toggle('notes-playing', !!isPlaying);
    lyricsPlace();
    const beat = beatFromSeconds(Tone.Transport.seconds, parseInt(el('tempo-slider').value, 10));
    let idx = -1;
    for (let i = 0; i < lyricsWords.length; i++){
      if (lyricsWords[i].beat <= beat + 1e-3) idx = i; else break;
    }
    if (!isPlaying && Tone.Transport.seconds === 0) idx = -1;
    if (idx !== lyricsIdx){
      lyricsIdx = idx;
      lyricsWords.forEach((w, i) => {
        w.el.classList.toggle('now', i === idx);
        w.el.classList.toggle('sung', i < idx);
      });
      if (idx >= 0){
        const body = el('lyrics-body'), line = lyricsWords[idx].line;
        const want = line.offsetTop - body.clientHeight * 0.3;
        if (Math.abs(body.scrollTop - want) > 4) body.scrollTo({ top: Math.max(0, want), behavior: 'smooth' });
      }
    }
    lyricsUpdateSolo(beat);
    el('lyrics-play-icon').style.display = isPlaying ? 'none' : '';
    el('lyrics-pause-icon').style.display = isPlaying ? '' : 'none';
    el('lyrics-play').title = isPlaying ? 'Pause' : 'Play this voice only';
    lyricsRaf = requestAnimationFrame(lyricsTick);
  }

  el('lyrics-play').addEventListener('click', () => {
    if (isPlaying){ pausePlayback(); return; }
    lyricsSetFocus();
    startPlayback(); // applies the focused mix as it starts
  });
  el('lyrics-piano').addEventListener('change', (e) => {
    lyricsWithPiano = e.target.checked;
    try{ localStorage.setItem('lyricsWithPiano', lyricsWithPiano ? '1' : '0'); }catch(err){ /* ignore */ }
    lyricsSetFocus();
    applyMixState();
  });
  el('lyrics-close').addEventListener('click', lyricsClose);

  // The voice picker, opening upward from the button.
  const lyricsMenu = el('lyrics-menu');
  function lyricsMenuOpen(open){
    lyricsMenu.hidden = !open;
    el('tab-lyrics').classList.toggle('open', open);
    el('tab-lyrics').setAttribute('aria-expanded', String(open));
    if (!open) return;
    lyricsMenu.innerHTML = '<div class="lyrics-menu-title">Show lyrics for</div>';
    const voices = lyricVoices();
    if (!voices.length){
      lyricsMenu.insertAdjacentHTML('beforeend', '<div class="empty">This score has no lyrics.</div>');
    }
    voices.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      if (lyricsTrack === t) b.className = 'current';
      b.innerHTML = '<span class="dot"></span><span></span>';
      b.querySelector('.dot').style.setProperty('--c', 'var(' + t.colorVar + ')');
      b.lastChild.textContent = t.label;
      b.addEventListener('click', () => { lyricsMenuOpen(false); lyricsOpen(t); });
      lyricsMenu.appendChild(b);
    });
    const r = el('tab-lyrics').getBoundingClientRect();
    const mw = lyricsMenu.offsetWidth, mh = lyricsMenu.offsetHeight;
    lyricsMenu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8)) + 'px';
    lyricsMenu.style.top = Math.max(8, r.top - mh - 6) + 'px';
    (lyricsMenu.querySelector('button') || lyricsMenu).focus();
  }
  el('tab-lyrics').addEventListener('click', (e) => {
    e.stopPropagation();
    lyricsMenuOpen(lyricsMenu.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!lyricsMenu.hidden && !e.target.closest('#lyrics-menu')) lyricsMenuOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!lyricsMenu.hidden) lyricsMenuOpen(false);
    else if (!el('lyrics-view').hidden) lyricsClose();
  });
  window.addEventListener('resize', () => { lyricsMenuOpen(false); if (lyricsTrack) lyricsPlace(); });

  // ---------- Show / hide a staff ----------
  // Purely visual. The events that feed the schedule live on the track, not in
  // OSMD, so a hidden staff carries on singing -- which is the point: see one
  // line, hear all of them. Silencing a part is what S (solo) or its fader is for.
  function applyStaffVisibility(){
    if (!osmd || !osmd.sheet || !osmd.sheet.Instruments) return;

    // Instrument.IdString is the MusicXML part id, and track.id is the same
    // string, so this survives OSMD listing its instruments in any order.
    const wanted = new Map(staffTracks.map(t => [t.id, t.visible !== false]));
    const visibleOf = (inst) =>
      wanted.has(inst.IdString) ? wanted.get(inst.IdString) : true;

    let changed = false;
    osmd.sheet.Instruments.forEach(inst => {
      const v = visibleOf(inst);
      if (inst.Visible !== v){ inst.Visible = v; changed = true; }
    });
    if (!changed) return;

    // A render invalidates every cursor position the old layout produced, so
    // the timeline has to be measured again or clicking a note seeks to where
    // that note used to be.
    osmd.render();
    buildCursorTimeline();
    if (isPlaying){
      const bpm = parseInt(el('tempo-slider').value, 10);
      resetCursorTo(beatFromSeconds(Tone.Transport.seconds, bpm));
      try{ osmd.cursor.show(); }catch(err){ /* nothing to show yet */ }
    } else if (pianoHeld.size){
      pianoShowAt(currentBeat());                        // the keyboard shows only the staves in view
    }
  }

  // A part singing its rendered voice: a singing mic at the left of its
  // instrument dropdown (the waves move while the music plays).
  // A sung part with a render on Drive (not yet on this device) is listed as
  // "Render"; choosing it downloads it, and then it reads "Rendered".
  function offerRender(track){
    if (track.recording || track.renderFile) return;
    const tab = scoreTabs.find(t => t.id === activeTabId);
    if (!tab) return;
    renderedFor(tab.name).then(found => {
      const f = found && found.find(r => recKey(r.label) === recKey(track.label));
      if (!f || track.recording || track.renderFile) return;
      track.renderFile = f;                           // found on Drive: stays "Render" until downloaded
    }).catch(() => {});
  }
  // A part's render in the instrument list: a cloud while it's only on Google
  // Drive ("Render" -- not ready yet), a singer once it's on this device
  // ("Rendered" -- ready): a woman singer for soprano, mezzo, alto and child
  // parts, a man singer for the rest.
  function singerEmoji(track){
    return ['soprano', 'mezzo', 'alto', 'child'].includes(singerVoiceForLabel(track && track.label))
      ? '\ud83d\udc69\u200d\ud83c\udfa4' : '\ud83d\udc68\u200d\ud83c\udfa4';
  }
  function renderOptFace(sel, open){
    const o = sel.querySelector('option[value="recording"]');
    if (!o || !/Rendered$/.test(o.textContent)) return;    // the "Render" download option stays as it is
    const card = sel.closest('.staff-card');
    const track = card && staffTracks.find(t => t.id === card.dataset.trackId);
    o.textContent = (open ? singerEmoji(track) + ' ' : '') + 'Rendered';
  }
  // The rendered mic's waves (and the lead singer's notes) move only while that part has a note sounding
  // (not through its rests, and not while paused).
  function micLoop(){
    const beat = isPlaying ? currentBeat() : -1;
    staffTracks.forEach(t => {
      const card = document.querySelector(`.staff-card[data-track-id="${t.id}"]`);
      if (!card) return;
      const on = beat >= 0 && (t.instrument === 'recording' || (lyricsTrack && t.id === lyricsTrack.id)) &&
        t.events.some(e => beat >= e.time - 1e-6 && beat < e.time + e.dur);
      if (card.classList.contains('singing-now') !== on) card.classList.toggle('singing-now', on);
    });
    requestAnimationFrame(micLoop);
  }
  requestAnimationFrame(micLoop);
  function paintInstIcon(track){
    const card = document.querySelector(`.staff-card[data-track-id="${track.id}"]`);
    if (!card) return;
    const on = track.instrument === 'recording';
    const ico = card.querySelector('.sc-inst-ico');
    if (ico) ico.hidden = !on;
    const wrap = card.querySelector('.sc-inst-wrap');
    if (wrap) wrap.classList.toggle('sung', on);
  }
  // Each eye picks a staff to show. The score shows every picked staff --
  // Soprano and Alto together, say -- or, with none picked, all of them.
  // The eye answers at once; the score (a full redraw) follows a moment
  // later, and several quick taps share one redraw.
  let staffRedrawTimer = null;
  function focusStaff(track){
    track.eyeOn = !track.eyeOn;
    const any = staffTracks.some(t => t.eyeOn);
    staffTracks.forEach(t => { t.visible = any ? !!t.eyeOn : true; });
    paintStaffEyes();
    el('score-paper').classList.add('score-updating');
    clearTimeout(staffRedrawTimer);
    staffRedrawTimer = setTimeout(() => {
      // Two frames: let the lit eye and the dimmed score paint first.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        try{ applyStaffVisibility(); }
        finally{ el('score-paper').classList.remove('score-updating'); }
      }));
    }, 220);
  }
  function paintStaffEyes(){
    staffTracks.forEach(t => {
      const card = document.querySelector(`.staff-card[data-track-id="${t.id}"]`);
      if (!card) return;
      const eye = card.querySelector('.sc-eye');
      card.classList.toggle('staff-hidden', t.visible === false);
      if (!eye) return;
      eye.classList.toggle('focused', !!t.eyeOn);
      eye.setAttribute('aria-pressed', String(!!t.eyeOn));
      eye.title = t.eyeOn ? 'Stop showing this staff on its own'
                          : 'Show this staff (tap more eyes to show several; hidden staves still sing)';
    });
  }

  // ---------- MIDI capture ----------
  const MIDI_DIV = 4;              // ticks per quarter note: a 16th is the grid
  const MIDI_PER_MEASURE = 16;     // 4/4
  // Note values a 16th grid can express, longest first. Anything played gets
  // snapped down to one of these so <duration> and <type> agree; a renderer
  // handed a duration with no matching type draws its own guess.
  const MIDI_VALUES = [16, 12, 8, 6, 4, 3, 2, 1];
  const MIDI_TYPES = {16:['whole',false], 12:['half',true], 8:['half',false],
                      6:['quarter',true], 4:['quarter',false],
                      3:['eighth',true], 2:['eighth',false], 1:['16th',false]};
  const MIDI_TAKE = 'Piano Roll';  // what a recording is called, everywhere
  const MIDI_SPLIT = 60;           // middle C: where the two hands divide
  const MIDI_STEP  = ['C','C','D','D','E','F','F','G','G','A','A','B'];
  const MIDI_ALTER = [0,1,0,1,0,0,1,0,1,0,1,0];

  let midiAccess = null;
  let midiInputs = [];
  let midiVoice = null;            // what you hear while playing
  let midiRecording = false;
  let midiStartMs = 0;
  let midiTakes = [];              // {midi, tick, dur} committed to the take
  let midiDown = new Map();        // midi -> {ms} still held
  let midiRenderTimer = null;
  let midiRendering = false;
  let midiDirty = false;           // notes arrived that are not on the staff yet
  let midiLastRender = 0;
  let midiRenderGap = 220;         // ms between renders, learned from the last one
  let midiTabId = null;
  const midiTakeTitle = () => { const t = scoreTabs.find(x => x.id === midiTabId); return t ? t.name : MIDI_TAKE; };

  const midiSnap = (t) => MIDI_VALUES.find(v => v <= t) || 1;

  // Element order inside <note> is fixed by the MusicXML schema: pitch,
  // duration, tie, voice, type, dot, staff, notations. Written out of order,
  // OSMD still reads the file and quietly drops whatever it could not place.
  //
  // A tie needs saying twice: <tie> is the sound, <tied> inside <notations> is
  // the printed curve. Emit only one and the note either plays joined and
  // prints separate, or the reverse.
  function midiNoteXml(midiNum, dur, chord, staff, tieStart, tieStop){
    const pc = ((midiNum % 12) + 12) % 12;
    const [type, dotted] = MIDI_TYPES[dur] || MIDI_TYPES[1];
    const alter = MIDI_ALTER[pc] ? '<alter>1</alter>' : '';
    const ties = (tieStop ? '<tie type="stop"/>' : '') +
                 (tieStart ? '<tie type="start"/>' : '');
    const tied = (tieStop ? '<tied type="stop"/>' : '') +
                 (tieStart ? '<tied type="start"/>' : '');
    return '<note>' + (chord ? '<chord/>' : '') +
      '<pitch><step>' + MIDI_STEP[pc] + '</step>' + alter +
      '<octave>' + (Math.floor(midiNum / 12) - 1) + '</octave></pitch>' +
      '<duration>' + dur + '</duration>' + ties +
      '<voice>' + staff + '</voice>' +
      '<type>' + type + '</type>' + (dotted ? '<dot/>' : '') +
      '<staff>' + staff + '</staff>' +
      (tied ? '<notations>' + tied + '</notations>' : '') + '</note>';
  }

  const midiRestXml = (dur, staff) => {
    const [type, dotted] = MIDI_TYPES[dur] || MIDI_TYPES[1];
    return '<note><rest/><duration>' + dur + '</duration>' +
           '<voice>' + staff + '</voice><type>' + type + '</type>' +
           (dotted ? '<dot/>' : '') + '<staff>' + staff + '</staff></note>';
  };

  /** Fill [from, to) with rests, never letting one cross a bar line. */
  function midiFillRests(items, from, to){
    let t = from;
    while (t < to){
      const barEnd = (Math.floor(t / MIDI_PER_MEASURE) + 1) * MIDI_PER_MEASURE;
      const dur = midiSnap(Math.min(to, barEnd) - t);
      items.push({ tick: t, dur, midis: null });
      t += dur;
    }
  }

  /** Break a held note into pieces that each fit inside one bar and onto one
   *  printable note value. Five sixteenths is not a note anyone can draw; a
   *  quarter tied to a sixteenth is. Every piece is consumed exactly, so the
   *  segments always add back up to the length that was played. */
  function midiSegments(startTick, dur){
    const out = [];
    let t = startTick, left = dur;
    while (left > 0){
      const barEnd = (Math.floor(t / MIDI_PER_MEASURE) + 1) * MIDI_PER_MEASURE;
      const d = midiSnap(Math.min(left, barEnd - t));
      out.push({ tick: t, dur: d });
      t += d;
      left -= d;
    }
    return out;
  }

  /** Chords, ties and rests for one staff, in order, with no gaps. */
  function midiItems(events){
    const byTick = new Map();
    events.forEach(e => {
      if (!byTick.has(e.tick)) byTick.set(e.tick, []);
      byTick.get(e.tick).push(e);
    });
    const ticks = [...byTick.keys()].sort((a, b) => a - b);

    const items = [];
    let cur = 0;
    ticks.forEach((t, i) => {
      const group = byTick.get(t);
      let want = Math.max(1, Math.min(...group.map(g => g.dur)));
      // A note still sounding when the next one starts is cut back to where
      // that one begins -- two overlapping durations are not something a
      // single voice on one staff can express. Clipping here, before the
      // note is split, is what keeps the segments consistent with it.
      const next = ticks[i + 1];
      if (next !== undefined) want = Math.max(1, Math.min(want, next - t));

      if (t > cur) midiFillRests(items, cur, t);
      const segs = midiSegments(t, want);
      segs.forEach((seg, n) => {
        items.push({
          tick: seg.tick, dur: seg.dur,
          midis: group.map(g => g.midi),
          tieStart: n < segs.length - 1,
          tieStop: n > 0
        });
      });
      cur = t + want;
    });
    return items;
  }

  const midiEndOf = (items) => items.length
    ? items[items.length - 1].tick + items[items.length - 1].dur : 0;

  function midiBuildXml(events, name){
    // A piano stave, divided at middle C: C4 and above go to the treble staff,
    // anything under it to the bass. Two staves are why each measure carries a
    // <backup> -- MusicXML writes a measure one staff at a time and then winds
    // the clock back to lay the other over the same beats.
    const treble = events.filter(e => e.midi >= MIDI_SPLIT);
    const bass = events.filter(e => e.midi < MIDI_SPLIT);

    const staves = [midiItems(treble), midiItems(bass)];

    // The score is as long as what was actually written, not as long as the
    // raw millisecond durations suggest. Taking it from the events instead
    // left a held note trailing empty measures behind it.
    const total = Math.max(MIDI_PER_MEASURE,
      Math.ceil(Math.max(midiEndOf(staves[0]), midiEndOf(staves[1])) /
                MIDI_PER_MEASURE) * MIDI_PER_MEASURE);
    // Both staves out to the same bar, or a hand that stopped early leaves the
    // bar lines out of step.
    staves.forEach(items => midiFillRests(items, midiEndOf(items), total));

    let xml = '<?xml version="1.0" encoding="UTF-8"?>' +
      '<score-partwise version="3.1">' +
      '<movement-title>' + midiEscape(name) + '</movement-title>' +
      '<part-list><score-part id="P1">' +
      '<part-name>Piano</part-name></score-part></part-list><part id="P1">';

    const measures = Math.max(1, total / MIDI_PER_MEASURE);
    for (let m = 0; m < measures; m++){
      xml += '<measure number="' + (m + 1) + '">';
      if (m === 0){
        xml += '<attributes><divisions>' + MIDI_DIV + '</divisions>' +
               '<key><fifths>0</fifths></key>' +
               '<time><beats>4</beats><beat-type>4</beat-type></time>' +
               '<staves>2</staves>' +
               '<clef number="1"><sign>G</sign><line>2</line></clef>' +
               '<clef number="2"><sign>F</sign><line>4</line></clef>' +
               '</attributes>';
      }
      const lo = m * MIDI_PER_MEASURE, hi = lo + MIDI_PER_MEASURE;
      staves.forEach((items, idx) => {
        const staff = idx + 1;
        if (staff === 2){
          xml += '<backup><duration>' + MIDI_PER_MEASURE + '</duration></backup>';
        }
        items.filter(it => it.tick >= lo && it.tick < hi).forEach(it => {
          if (!it.midis){ xml += midiRestXml(it.dur, staff); return; }
          it.midis.sort((a, b) => a - b).forEach((n, i) => {
            xml += midiNoteXml(n, it.dur, i > 0, staff, it.tieStart, it.tieStop);
          });
        });
      });
      xml += '</measure>';
    }
    return xml + '</part></score-partwise>';
  }

  const midiEscape = (s) => String(s).replace(/[&<>]/g,
    c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

  // --- devices -------------------------------------------------------------

  function midiRefreshDevices(){
    if (!midiAccess) return;
    midiInputs = [...midiAccess.inputs.values()];
    midiInputs.forEach(inp => { inp.onmidimessage = midiOnMessage; });
    midiShowCount();
  }

  /** The device, and while recording the number of notes captured so far.
   *  Deliberately independent of the staff: if capture works but the notation
   *  does not update, this still counts up, which says which of the two is
   *  broken instead of leaving one silent symptom to cover both. */
  function midiShowCount(){
    const dev = el('midi-dev');
    if (!dev) return;
    const connected = midiInputs.length > 0;

    // Connection shows on the record button itself (the "no" sign over the
    // plug goes away once a device is connected); the device's name is in
    // its tooltip. The only text left is the note count while recording --
    // the one sign that a take is actually capturing.
    const btn = el('midi-rec-btn');
    const names = midiInputs.map(i => i.name || 'MIDI device').join(', ');
    btn.classList.toggle('connected', connected);
    btn.title = (midiRecording ? 'Stop recording' : 'Start recording') +
      (connected ? ' — ' + names : ' — no MIDI device connected (on-screen keys still record)');
    dev.textContent = midiRecording
      ? midiTakes.length + (midiTakes.length === 1 ? ' note' : ' notes') : '';
    dev.classList.toggle('live', midiRecording);
  }

  function midiOnMessage(e){
    const [status, data1, data2] = e.data;
    const cmd = status & 0xf0;
    if (cmd === 0x90 && data2 > 0) midiKeyDown(data1, data2);
    else if (cmd === 0x80 || (cmd === 0x90 && data2 === 0)) midiKeyUp(data1);
  }

  // Built on first use rather than only when a MIDI session starts, so the
  // on-screen keys make a sound on a page where no score has been loaded.
  function midiEnsureVoice(){
    if (midiVoice) return midiVoice;
    try{
      // Whichever voice the keyboard's own picker is set to. The staves are
      // untouched by this -- they play through their own track.synth.
      midiVoice = keyVoiceBuild(keyVoiceKey);
    }catch(err){ midiVoice = null; }
    return midiVoice;
  }

  function midiKeyDown(note, velocity){
    pianoNoteOn(note, 'var(--brass)');
    midiDown.set(note, { ms: performance.now() });
    try{
      Tone.start();
      const voice = midiEnsureVoice();
      if (voice) voice.triggerAttack(Tone.Frequency(note, 'midi').toFrequency(),
                                     undefined, Math.max(0.05, velocity / 127));
    }catch(err){ /* a voice that will not sound must not stop the capture */ }
  }

  function midiKeyUp(note){
    pianoNoteOff(note, 'var(--brass)');
    const held = midiDown.get(note);
    midiDown.delete(note);
    try{
      if (midiVoice) midiVoice.triggerRelease(
        Tone.Frequency(note, 'midi').toFrequency());
    }catch(err){ /* ignore */ }

    if (!midiRecording || !held) return;
    const bpm = parseInt(el('tempo-slider').value, 10) || 120;
    const toTicks = (ms) => Math.round(ms / 1000 * bpm / 60 * MIDI_DIV);
    const tick = Math.max(0, toTicks(held.ms - midiStartMs));
    const dur = Math.max(1, toTicks(performance.now() - held.ms));
    midiTakes.push({ midi: note, tick, dur });
    midiShowCount();
    midiScheduleRender();
  }

  // --- the take ------------------------------------------------------------

  /** Ask for the staff to be redrawn. Throttled, not debounced: a debounce
   *  pushes its deadline forward on every note, so playing without pausing
   *  drew nothing at all. This draws immediately when nothing is pending and
   *  then at a steady gap, however long the playing goes on. */
  function midiScheduleRender(){
    midiDirty = true;
    // One render in flight and one waiting is enough. OSMD's load is async and
    // two overlapping loads leave it drawing whichever finished last.
    if (midiRenderTimer !== null || midiRendering) return;
    const wait = Math.max(0, midiRenderGap - (performance.now() - midiLastRender));
    midiRenderTimer = setTimeout(midiRenderNow, wait);
  }

  async function midiRenderNow(){
    midiRenderTimer = null;
    if (midiRendering || !osmd) return;
    midiRendering = true;
    midiDirty = false;
    const started = performance.now();
    try{
      // Only draw while the take's own tab is showing.
      if (activeTabId === midiTabId){
        await osmd.load(midiBuildXml(midiTakes, midiTakeTitle()));
        osmd.render();
      }
    }catch(err){
      // A half-written bar is not worth an error box; the next note fixes it.
    }
    const cost = performance.now() - started;
    midiLastRender = performance.now();
    midiRendering = false;

    // Space the next one by what the last actually cost. A short take redraws
    // in a few tens of milliseconds and should feel immediate; a long one
    // costs hundreds, and redrawing back to back would take the thread the
    // playing needs. The ceiling stops a very long take from freezing.
    midiRenderGap = Math.min(1500, Math.max(180, Math.round(cost * 1.6)));

    // Anything that arrived while this was drawing is still owed a render.
    if (midiDirty) midiScheduleRender();
  }

  async function midiEnable(){
    const note = el('midi-home-note');
    const say = (m) => { if (note) note.textContent = m; };

    if (!navigator.requestMIDIAccess){
      say('This browser has no MIDI support here. Web MIDI needs a secure ' +
          'page — open the stand over http://localhost rather than from the file.');
      return false;
    }
    say('Asking for MIDI access…');
    try{
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    }catch(err){
      say('MIDI access was refused: ' + (err && err.message ? err.message : err));
      return false;
    }
    midiAccess.onstatechange = midiRefreshDevices;
    midiRefreshDevices();
    say(midiInputs.length ? 'Found ' + midiInputs[0].name : 'No MIDI device found yet — plug one in and it will appear.');

    // One voice for what you play, built once. Rebuilding a sampler per note
    // would cost more than the note lasts.
    if (!midiVoice){
      try{
        midiVoice = createInstrumentVoice('piano', [], null, 'Piano');
        midiVoice.toDestination();
      }catch(err){ midiVoice = null; }
    }
    return true;
  }

  async function midiStartSession(){
    if (!await midiEnable()) return;
    await Tone.start().catch(() => {});
    midiTakes = [];
    midiDown.clear();
    { const name = midiTakeName(); await addTab(midiBuildXml([], name), name); }
    midiTabId = activeTabId;
    el('midi-rec').hidden = false;
    showMixerPanel('piano');
    midiRefreshDevices();
  }

  // A recording always goes into its own tab. If a score is open (or the
  // Piano Roll tab was closed), a fresh "Piano Roll" tab is opened first so
  // the take never draws over, or replaces, the loaded MusicXML.
  function midiTakeName(){
    const used = new Set(scoreTabs.map(t => t.name));
    if (!used.has(MIDI_TAKE)) return MIDI_TAKE;
    let n = 2;
    while (used.has(MIDI_TAKE + ' ' + n)) n++;
    return MIDI_TAKE + ' ' + n;
  }
  async function midiEnsureTakeTab(){
    const tab = scoreTabs.find(t => t.id === activeTabId);
    if (tab && tab.name.startsWith(MIDI_TAKE)){ midiTabId = tab.id; return; }   // already on a take
    stopPlayback();
    const name = midiTakeName();
    await addTab(midiBuildXml([], name), name);
    midiTabId = activeTabId;
    showMixerPanel('piano');
  }

  let midiStarting = false;
  async function midiStartRecording(){
    if (midiStarting) return;
    midiStarting = true;
    try{ await midiEnsureTakeTab(); }finally{ midiStarting = false; }
    midiRecording = true;
    midiStartMs = performance.now();
    midiTakes = [];
    // A fresh take is cheap to draw again, whatever the last one cost.
    midiRenderGap = 180;
    midiLastRender = 0;
    midiDirty = false;
    el('midi-rec-btn').classList.add('armed');
    el('midi-rec-btn').title = 'Stop recording';
    midiShowCount();
  }

  async function midiStopRecording(){
    midiRecording = false;
    clearTimeout(midiRenderTimer);
    midiRenderTimer = null;
    // Nothing is owed any more: the full reload below replaces the staff, and
    // a live render landing after it would draw the take twice.
    midiDirty = false;
    el('midi-rec-btn').classList.remove('armed');
    el('midi-rec-btn').title = 'Start recording';
    midiShowCount();
    if (!midiTakes.length) return;

    // Now, and only now, the expensive path: a real load rebuilds the staff
    // list, the synths and the schedule, so the take can be played back.
    const xml = midiBuildXml(midiTakes, midiTakeTitle());
    const tab = scoreTabs.find(t => t.id === midiTabId);
    if (!tab) return;                      // its tab was closed meanwhile
    tab.xmlText = xml;
    try{ dbSaveTab({ id: tab.id, name: tab.name, xmlText: xml,
                     order: scoreTabs.indexOf(tab) }); }catch(err){ /* ignore */ }
    if (activeTabId === tab.id) await loadScoreFromText(xml, tab.name);
  }

  el('midi-home-btn').addEventListener('click', midiStartSession);

  // "Record a MIDI device" shows only while one is plugged in. Once MIDI is
  // allowed the devices are watched quietly (no prompt), so plugging one in
  // brings the button back. With no answer yet on MIDI the button stays, as
  // it's the only way to ask; with no MIDI at all (or refused) it goes.
  (async () => {
    const home = document.querySelector('.midi-home');
    if (!home) return;
    const show = (on) => { home.hidden = !on; };
    if (!navigator.requestMIDIAccess) return show(false);
    let state = 'prompt';
    try{ state = (await navigator.permissions.query({ name: 'midi' })).state; }catch(err){ /* can't tell: ask on tap */ }
    if (state === 'denied') return show(false);
    if (state !== 'granted') return show(true);
    try{
      const access = await navigator.requestMIDIAccess({ sysex: false });
      const check = () => show([...access.inputs.values()].some(i => i.state !== 'disconnected'));
      access.addEventListener('statechange', check);
      check();
    }catch(err){ show(false); }
  })();
  el('midi-rec-btn').addEventListener('click', () => {
    if (midiRecording) midiStopRecording(); else midiStartRecording();
  });

  // ---------- Export ----------
  let exportBusy = false;
  const EXPORT_PPQ = 480;          // MIDI ticks per quarter note

  function exportName(){
    const tab = scoreTabs.find(t => t.id === activeTabId);
    const raw = (tab && tab.name) || 'score';
    // Windows refuses most of these outright, and the rest make a file that
    // cannot be typed at a shell without quoting it.
    return raw.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'score';
  }

  function exportComplain(msg){
    showError(msg);
    setTimeout(clearError, 3000);
  }

  /** Hand a file to the user. The Android app has no download to give it to --
   *  nothing native can read a blob: URL -- so the bytes go over the bridge as
   *  base64 and the host writes them itself. */
  // Every saved file starts with "Ark2 - ", so in a phone's Downloads (where
  // a web app can't make a folder of its own) they all sort together.
  const SAVE_PREFIX = 'Ark2 - ';
  async function exportSave(blob, filename, mime){
    if (!filename.startsWith(SAVE_PREFIX)) filename = SAVE_PREFIX + filename;
    if (ANDROID && ANDROID.saveFile){
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      // In chunks: fromCharCode.apply over a multi-megabyte array exceeds the
      // argument limit and throws.
      for (let i = 0; i < buf.length; i += 0x8000){
        bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      }
      ANDROID.saveFile(filename, btoa(bin), mime || blob.type || '');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 20000);
  }

  // --- the notation --------------------------------------------------------

  function exportMusicXml(){
    const tab = scoreTabs.find(t => t.id === activeTabId);
    if (!tab || !tab.xmlText) return exportComplain('There is no score open to export.');
    return exportSave(new Blob([tab.xmlText], { type: 'application/xml' }),
                      exportName() + '.musicxml', 'application/xml');
  }

  // --- the performance -----------------------------------------------------

  /** MIDI delta times are base-128, high bit set on every byte but the last. */
  function exportVarLen(n){
    const out = [n & 0x7f];
    n = Math.floor(n / 128);
    while (n > 0){ out.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    return out;
  }

  const exportAppend = (into, from) => { for (let i = 0; i < from.length; i++) into.push(from[i]); };

  function exportChunk(id, body){
    const out = [];
    for (let i = 0; i < 4; i++) out.push(id.charCodeAt(i));
    const n = body.length;
    out.push((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
    exportAppend(out, body);
    return out;
  }

  function exportMidiTrack(events, channel, name){
    const list = [];
    events.forEach(e => {
      const on = Math.max(0, Math.round(e.time * EXPORT_PPQ));
      const off = Math.max(on + 1, Math.round((e.time + e.dur) * EXPORT_PPQ));
      const note = Math.max(0, Math.min(127, e.midi));
      list.push({ tick: on, order: 1, data: [0x90 | channel, note, 90] });
      list.push({ tick: off, order: 0, data: [0x80 | channel, note, 0] });
    });
    // At a shared tick, releases come before presses -- otherwise a repeated
    // note is switched off by its own predecessor the instant it starts.
    list.sort((a, b) => a.tick - b.tick || a.order - b.order);

    const body = [];
    const label = [];
    for (const c of String(name).slice(0, 60)) label.push(c.charCodeAt(0) & 0x7f);
    body.push(0x00, 0xFF, 0x03);
    exportAppend(body, exportVarLen(label.length));
    exportAppend(body, label);

    let last = 0;
    list.forEach(ev => {
      exportAppend(body, exportVarLen(ev.tick - last));
      exportAppend(body, ev.data);
      last = ev.tick;
    });
    body.push(0x00, 0xFF, 0x2F, 0x00);          // end of track
    return exportChunk('MTrk', body);
  }

  function exportMidi(){
    const tracks = staffTracks.filter(t => t.events && t.events.length);
    if (!tracks.length) return exportComplain('There is no score open to export.');

    // One tempo event per change in the score, at the listener's speed.
    const tempo = [];
    let lastTick = 0;
    tempoMap.forEach(t => {
      const tick = Math.round(t.beat * EXPORT_PPQ);
      const us = Math.round(60000000 / (t.bpm * tempoFactor));
      exportAppend(tempo, exportVarLen(tick - lastTick));
      tempo.push(0xFF, 0x51, 0x03, (us >>> 16) & 0xff, (us >>> 8) & 0xff, us & 0xff);
      lastTick = tick;
    });
    tempo.push(0x00, 0xFF, 0x2F, 0x00);

    const bytes = [];
    exportAppend(bytes, exportChunk('MThd', [
      0x00, 0x01,                                  // format 1: parallel tracks
      (tracks.length + 1) >>> 8, (tracks.length + 1) & 0xff,
      (EXPORT_PPQ >>> 8) & 0xff, EXPORT_PPQ & 0xff
    ]));
    exportAppend(bytes, exportChunk('MTrk', tempo));
    tracks.forEach((t, i) => {
      // Channel 9 is the drum channel; a choir routed through it would play
      // back as percussion in anything that honours General MIDI.
      const ch = (i < 9 ? i : i + 1) % 16;
      exportAppend(bytes, exportMidiTrack(t.events, ch, t.label || ('Staff ' + (i + 1))));
    });
    return exportSave(new Blob([new Uint8Array(bytes)], { type: 'audio/midi' }),
                      exportName() + '.mid', 'audio/midi');
  }

  // --- the sound -----------------------------------------------------------

  async function exportPcmToWav(buf, onProgress){
    const channels = Math.min(2, buf.numberOfChannels);
    const frames = buf.length;
    const bytes = 44 + frames * channels * 2;
    const view = new DataView(new ArrayBuffer(bytes));
    const tag = (at, s) => { for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i)); };

    tag(0, 'RIFF'); view.setUint32(4, bytes - 8, true); tag(8, 'WAVE');
    tag(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, buf.sampleRate, true);
    view.setUint32(28, buf.sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true);
    tag(36, 'data'); view.setUint32(40, frames * channels * 2, true);

    const data = [];
    for (let c = 0; c < channels; c++) data.push(buf.getChannelData(c));
    let at = 44;
    // A quarter of a million frames per pass: often enough to keep the bar
    // moving, rare enough that yielding does not dominate the work.
    const SLICE = 250000;
    for (let start = 0; start < frames; start += SLICE){
      const end = Math.min(frames, start + SLICE);
      for (let i = start; i < end; i++){
        for (let c = 0; c < channels; c++){
          const s = Math.max(-1, Math.min(1, data[c][i]));
          view.setInt16(at, s < 0 ? s * 0x8000 : s * 0x7fff, true);
          at += 2;
        }
      }
      if (onProgress) onProgress(end / frames);
      if (end < frames) await new Promise(res => setTimeout(res, 0));
    }
    return new Blob([view.buffer], { type: 'audio/wav' });
  }

  async function exportPcmToMp3(buf, onProgress){
    const channels = Math.min(2, buf.numberOfChannels);
    const encoder = new lamejs.Mp3Encoder(channels, buf.sampleRate, 192);
    const left = buf.getChannelData(0);
    const right = channels > 1 ? buf.getChannelData(1) : null;
    const BLOCK = 1152;                           // one MP3 frame
    const parts = [];

    // Float -1..1 to signed 16-bit. The two scales are not a typo: the range
    // is asymmetric, and using 0x8000 for both clips every full-scale peak.
    const toInt16 = (src, at, n) => {
      const out = new Int16Array(n);
      for (let i = 0; i < n; i++){
        const s = Math.max(-1, Math.min(1, src[at + i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return out;
    };

    let sinceYield = 0;
    for (let i = 0; i < left.length; i += BLOCK){
      const n = Math.min(BLOCK, left.length - i);
      const l = toInt16(left, i, n);
      const r = right ? toInt16(right, i, n) : l;
      const chunk = encoder.encodeBuffer(l, r);
      if (chunk.length) parts.push(chunk);
      // Encoding used to run to completion in one go, which froze the page
      // for the whole of a long piece -- no progress could be drawn because
      // nothing could be drawn. Handing the thread back every 64 frames costs
      // almost nothing and makes the bar real.
      if (++sinceYield >= 64){
        sinceYield = 0;
        if (onProgress) onProgress(i / left.length);
        await new Promise(res => setTimeout(res, 0));
      }
    }
    const tail = encoder.flush();
    if (tail.length) parts.push(tail);
    return new Blob(parts, { type: 'audio/mpeg' });
  }

  /** Peak level, sampled. Every 32nd frame is far more than enough to tell
   *  silence from sound, and a full scan of a long stereo render is millions
   *  of reads for an answer that never changes. */
  function exportPeak(buf){
    let peak = 0;
    for (let c = 0; c < buf.numberOfChannels; c++){
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i += 32){
        const v = Math.abs(d[i]);
        if (v > peak) peak = v;
      }
    }
    return peak;
  }

  /** Rebuild the mixer inside an offline context and render it flat out.
   *  Nodes belong to the context that made them, so nothing here can be
   *  borrowed from the live graph -- but the settings can, and are: the pan
   *  spread, the fader positions and the mute/solo state all carry over, so
   *  the file matches what the speakers would have played. */
  async function exportRenderOffline(onProgress){
    const bpm = parseInt(el('tempo-slider').value, 10) || 120;
    const anySolo = staffTracks.some(t => t.soloed);
    const spread = staffTracks.length > 1;

    const spec = staffTracks.map((t, i) => ({
      instrument: t.instrument,
      label: t.label,
      events: t.events,
      pan: spread ? (-0.4 + (i / (staffTracks.length - 1)) * 0.8) : 0,
      level: (anySolo ? t.soloed : !t.muted) ? (t.volume / 100) : 0
    }));

    // Two seconds past the last note, so releases and tails are inside the
    // render rather than chopped off the end of it.
    const seconds = totalDuration + 2;

    const rendered = await Tone.Offline(async (ctx) => {
      const loads = [];
      spec.forEach(s => {
        const gain = new Tone.Gain(s.level).toDestination();
        const panner = new Tone.Panner(s.pan).connect(gain);
        const voice = createInstrumentVoice(s.instrument, loads, null, s.label)
                        .connect(panner);
        const events = s.events.map(e => ({
          time: beatsToSeconds(e.time),
          midi: e.midi,
          dur: Math.max(0.05, noteSeconds(e) * 0.96),
          ph: e.ph
        }));
        new Tone.Part((time, value) => {
          const freq = Tone.Frequency(value.midi, 'midi').toFrequency();
          // Only the singing voices take a phoneme; a Sampler reads that
          // fourth argument as velocity.
          if (voice && voice.wantsPhonemes){
            voice.triggerAttackRelease(freq, value.dur, time, value.ph);
          } else {
            voice.triggerAttackRelease(freq, value.dur, time);
          }
        }, events.map(e => [e.time, e])).start(0);
      });

      // A sampler that never loads would otherwise hang the render forever.
      await Promise.race([
        Promise.all(loads),
        new Promise(res => setTimeout(res, 15000))
      ]);

      // Real progress. Suspending an OfflineAudioContext at a time and
      // resuming it is the only window rendering gives you; these are queued
      // now because Tone starts the render itself once this returns. The
      // times must land on the 128-frame render quantum or Chrome rejects
      // them, and a suspend that is never resumed hangs the render, so the
      // resume happens even when the report throws.
      const raw = ctx.rawContext || ctx._context || null;
      if (onProgress && raw && typeof raw.suspend === 'function'){
        try{
          const quantum = 128 / raw.sampleRate;
          const step = Math.max(quantum * 8, seconds / 60);
          for (let t = step; t < seconds - quantum; t += step){
            const at = Math.round(t / quantum) * quantum;
            raw.suspend(at).then(() => {
              try{ onProgress(at / seconds); }catch(err){ /* never skip the resume */ }
              raw.resume();
            }).catch(() => { /* a suspend that was refused needs no resume */ });
          }
        }catch(err){ /* no progress rather than no render */ }
      }

      ctx.transport.start(0);
    }, seconds);

    return rendered.get ? rendered.get() : rendered;
  }

  /** The fast path, with the slow one behind it. */
  async function exportAudioBuffer(say){
    try{
      say('RENDER 0%');
      const buf = await exportRenderOffline(
        p => say('RENDER ' + Math.round(p * 100) + '%'));
      if (exportPeak(buf) > 0.0005) return buf;
      // Silence here means something did not survive the offline context.
      // Handing over a file that plays nothing would be worse than being slow.
      console.warn('Music Stand: offline render was silent; recording instead.');
    }catch(err){
      console.warn('Music Stand: offline render failed; recording instead.', err);
    }
    return await exportCapture(pct => say(pct + '%'));
  }

  /** Play the score through, capturing the master output, and hand back what
   *  was heard as an AudioBuffer. */
  async function exportCapture(onProgress){
    await Tone.start();
    stopPlayback();

    const ctx = Tone.getContext();
    // Tone's context wraps the real one and does not always forward this.
    const dest = ctx.createMediaStreamDestination
      ? ctx.createMediaStreamDestination()
      : ctx.rawContext.createMediaStreamDestination();
    Tone.getDestination().connect(dest);

    try{
      const chunks = [];
      const rec = new MediaRecorder(dest.stream);
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const recorded = new Promise(res => { rec.onstop = res; });
      rec.start();

      await startPlayback();
      const length = totalDuration;
      await new Promise(res => {
        const tick = setInterval(() => {
          const at = Tone.Transport.seconds;
          if (onProgress) onProgress(Math.min(99, Math.round(at / length * 100)));
          if (!isPlaying || at >= length){ clearInterval(tick); res(); }
        }, 200);
      });

      // Let the last release and any tail through before closing the recorder,
      // or every export ends on a clipped chord.
      await new Promise(res => setTimeout(res, 700));
      stopPlayback();
      rec.stop();
      await recorded;

      return await ctx.decodeAudioData(await new Blob(chunks).arrayBuffer());
    } finally {
      try{ Tone.getDestination().disconnect(dest); }catch(err){ /* ignore */ }
    }
  }

  // --- the menu ------------------------------------------------------------

  function exportMenu(open){
    const menu = el('export-menu'), btn = el('export-btn');
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open) return;
    // Out of the bottom panel altogether. Every candidate parent in there is
    // either a clipper or a containing block for fixed children; the body is
    // neither, and is the only place this reliably survives.
    if (menu.parentNode !== document.body) document.body.appendChild(menu);
    const r = btn.getBoundingClientRect();
    menu.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    menu.style.bottom = Math.max(8, window.innerHeight - r.top + 8) + 'px';
  }

  async function exportRun(fmt){
    if (exportBusy) return;
    exportMenu(false);

    if (fmt === 'musicxml') return exportMusicXml();
    if (fmt === 'midi') return exportMidi();

    if (!staffTracks.length || !totalDuration){
      return exportComplain('There is no score open to export.');
    }
    if (fmt === 'mp3' && typeof lamejs === 'undefined'){
      return exportComplain('The MP3 encoder did not load.');
    }

    const btn = el('export-btn');
    const label = btn.innerHTML;
    exportBusy = true;
    btn.classList.add('working');
    try{
      const buf = await exportAudioBuffer(msg => { btn.textContent = msg; });
      if (fmt === 'mp3'){
        const blob = await exportPcmToMp3(
          buf, p => { btn.textContent = 'MP3 ' + Math.round(p * 100) + '%'; });
        btn.textContent = 'SAVING';
        await exportSave(blob, exportName() + '.mp3', 'audio/mpeg');
      } else {
        const blob = await exportPcmToWav(
          buf, p => { btn.textContent = 'WAV ' + Math.round(p * 100) + '%'; });
        btn.textContent = 'SAVING';
        await exportSave(blob, exportName() + '.wav', 'audio/wav');
      }
    }catch(err){
      exportComplain('Could not export audio: ' + (err && err.message ? err.message : err));
    }finally{
      btn.classList.remove('working');
      btn.innerHTML = label;
      exportBusy = false;
    }
  }

  el('export-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (exportBusy) return;
    exportMenu(el('export-menu').hidden);
  });
  el('export-menu').addEventListener('click', (e) => {
    const item = e.target.closest('button[data-fmt]');
    if (item) exportRun(item.dataset.fmt);
  });
  // Anywhere else, or Escape, puts it away.
  document.addEventListener('click', (e) => {
    // The menu is no longer inside #export-bar, so it needs naming separately
    // or the first click on a format would close it before it fired.
    if (!e.target.closest('#export-bar') && !e.target.closest('#export-menu')){
      exportMenu(false);
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') exportMenu(false);
  });

  // ---------- Keyboard voices ----------
  // Six voicings of the one sampled piano the page carries, and four voices
  // synthesised outright. `lp` and `hs` shape the recording; `synth` replaces
  // it. Nothing here is reachable from a staff -- these build midiVoice only.
  const KEY_VOICES = {
    grand:   { label: 'Concert Grand' },
    upright: { label: 'Studio Upright', lp: 4200, hs: { f: 2600, g: -3 } },
    mellow:  { label: 'Mellow Grand',   lp: 2100 },
    bright:  { label: 'Bright Grand',   hs: { f: 3200, g: 7 } },
    // Two strings a few cents apart is what a honky-tonk piano is; a chorus
    // is the nearest thing to that with one recording to work from.
    honky:   { label: 'Honky-Tonk',     chorus: { rate: 0.7, delay: 3.5, depth: 0.75 },
                                        hs: { f: 2800, g: 3 } },
    hall:    { label: 'Hall Grand',     reverb: { room: 0.82, wet: 0.3 } },

    rhodes:  { label: 'Electric Rhodes', tremolo: { rate: 4.2, depth: 0.35 },
      synth: () => new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3.01, modulationIndex: 5.5,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.004, decay: 1.8, sustain: 0.15, release: 1.1 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.004, decay: 0.4, sustain: 0, release: 0.4 }
      }) },
    wurli:   { label: 'Wurlitzer', drive: 0.14, hs: { f: 2400, g: 4 },
      synth: () => new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2, modulationIndex: 9,
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.003, decay: 1.1, sustain: 0.1, release: 0.8 },
        modulation: { type: 'square' },
        modulationEnvelope: { attack: 0.002, decay: 0.22, sustain: 0, release: 0.3 }
      }) },
    dx:      { label: 'DX Bell', reverb: { room: 0.7, wet: 0.22 },
      synth: () => new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 7, modulationIndex: 12,
        oscillator: { type: 'sine' },
        envelope: { attack: 0.002, decay: 2.4, sustain: 0.05, release: 1.6 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.002, decay: 1.2, sustain: 0, release: 1.0 }
      }) },
    stage:   { label: 'Digital Stage', chorus: { rate: 1.1, delay: 4, depth: 0.5 },
      synth: () => new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.006, decay: 1.4, sustain: 0.25, release: 1.0 }
      }) }
  };

  let keyVoiceKey = 'grand';
  let keyVoiceChain = [];          // everything to tear down on a change

  function keyVoiceDispose(){
    keyVoiceChain.forEach(node => {
      try{ node.dispose(); }catch(err){ /* already gone */ }
    });
    keyVoiceChain = [];
    midiVoice = null;
  }

  /** Build the keyboard's voice and its effects. The chain is assembled from
   *  the destination backwards, so each effect is created already knowing
   *  what it feeds and nothing is left dangling if a later one throws. */
  function keyVoiceBuild(key){
    const preset = KEY_VOICES[key] || KEY_VOICES.grand;
    const chain = [];
    let tail = Tone.getDestination();

    const add = (node) => { chain.push(node); tail = node; return node; };
    if (preset.reverb){
      add(new Tone.Freeverb({ roomSize: preset.reverb.room, wet: preset.reverb.wet })
            .connect(tail));
    }
    if (preset.tremolo){
      add(new Tone.Tremolo(preset.tremolo.rate, preset.tremolo.depth)
            .connect(tail).start());
    }
    if (preset.chorus){
      add(new Tone.Chorus(preset.chorus.rate, preset.chorus.delay, preset.chorus.depth)
            .connect(tail).start());
    }
    if (preset.drive){
      add(new Tone.Distortion(preset.drive).connect(tail));
    }
    if (preset.hs){
      add(new Tone.Filter({ type: 'highshelf', frequency: preset.hs.f, gain: preset.hs.g })
            .connect(tail));
    }
    if (preset.lp){
      add(new Tone.Filter({ type: 'lowpass', frequency: preset.lp, rolloff: -12 })
            .connect(tail));
    }

    // The sampled piano when the preset does not bring its own oscillator.
    const voice = preset.synth
      ? preset.synth()
      : createInstrumentVoice('piano', [], null, 'Piano');
    voice.connect(tail);
    chain.push(voice);

    keyVoiceChain = chain;
    return voice;
  }

  function keyVoiceSelect(key){
    if (!KEY_VOICES[key]) return;
    keyVoiceKey = key;
    // Only rebuild if a voice already exists; otherwise the next key press
    // builds it, and building the sampler for a voice nobody plays is waste.
    if (midiVoice){
      keyVoiceDispose();
      try{ midiVoice = keyVoiceBuild(keyVoiceKey); }catch(err){ midiVoice = null; }
    }
    try{ dbSaveMeta('keyboardVoice', key); }catch(err){ /* not worth failing over */ }
  }

  // The on-screen keyboard always plays the Concert Grand ("grand") voice
  // now -- the picker that let this change was removed, so keyVoiceKey
  // stays at its default above rather than being set from a UI or a
  // previously saved preference.

  function escapeHtml(s){
    return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // While the lyrics view is open, lyricsFocus names the only tracks that
  // sound (the chosen voice, plus the accompaniment if Piano is on). It sits
  // on top of the mixer's own Mute/Solo, which stay exactly as they were.
  let lyricsFocus = null;
  function trackAudible(t){
    if (lyricsFocus) return lyricsFocus.has(t.id);
    const anySolo = staffTracks.some(x => x.soloed);
    return !t.muted && (!anySolo || t.soloed);
  }
  // Lyrics view has its own balance: the chosen voice at full volume, the
  // piano well underneath it. While it's open the mixer's faders show -- and
  // set -- those levels for the parts that are sounding; the mixer's own
  // settings are kept aside and come back when the lyrics view closes.
  const LYRICS_VOICE_LEVEL = 100;
  const LYRICS_PIANO_LEVEL = 15;
  const lyricsLevels = new Map();          // track id -> 0..100 while in lyrics view
  // Lead voice 'v', accompaniment 'a', or another voice added with its Solo 'x'.
  function lyricsKind(t){
    if (lyricsTrack && t.id === lyricsTrack.id) return 'v';
    return accompaniment().includes(t) ? 'a' : 'x';
  }
  function lyricsLevelOf(t){
    const kind = lyricsKind(t), key = kind + ':' + t.id;
    if (!lyricsLevels.has(key)){
      lyricsLevels.set(key, kind === 'v' ? LYRICS_VOICE_LEVEL : kind === 'a' ? LYRICS_PIANO_LEVEL : t.volume);
    }
    return lyricsLevels.get(key);
  }
  function lyricsSetLevel(t, v){
    lyricsLevels.set(lyricsKind(t) + ':' + t.id, v);
  }
  // Solo buttons in the lyrics view: a singing icon on every part that's
  // sounding -- locked on the lead voice, tap to drop the others. Outside the
  // lyrics view they're the mixer's plain Solo buttons.
  const SING_ICON = '<span class="sing-ico" aria-hidden="true"><i></i><i></i><i></i><i></i></span>';
  // The lead voice wears the singer instead: a woman for soprano, mezzo, alto
  // and child parts, a man for the rest, with music notes floating off while
  // the music plays.
  function leadIcon(t){
    const w = singerEmoji(t).startsWith('\ud83d\udc69');
    return '<span class="lead-ico" aria-hidden="true"><span class="lead-fig ' + (w ? 'f' : 'm') + '"></span>'
      + '<b>\u266a</b><b>\u266b</b><b>\u266a</b></span>';
  }
  function paintSoloButtons(){
    staffTracks.forEach(t => {
      const card = document.querySelector(`.staff-card[data-track-id="${t.id}"]`);
      const b = card && card.querySelector('.solo-btn');
      if (!b) return;
      const inLyrics = !!lyricsTrack;
      const lead = inLyrics && t.id === lyricsTrack.id;
      const singing = inLyrics && lyricsFocus && lyricsFocus.has(t.id);
      b.classList.toggle('singing', !!singing);
      b.classList.toggle('lead', !!lead);
      b.classList.toggle('on-solo', !inLyrics && !!t.soloed);
      b.setAttribute('aria-disabled', lead ? 'true' : 'false');
      const face = lead ? 'lead' + singerEmoji(t) : singing ? 'sing' : 'solo';
      if (b.dataset.face !== face){ b.innerHTML = lead ? leadIcon(t) : singing ? SING_ICON : 'Solo'; b.dataset.face = face; }
      b.title = lead ? t.label + ' is the voice in the lyrics view'
        : !inLyrics ? 'Hear only the soloed parts'
        : singing ? 'Stop ' + t.label + ' singing along'
        : 'Add ' + t.label + ' to sing along';
      b.setAttribute('aria-label', b.title);
    });
  }
  // Fader shown for a track: its lyrics level while it sounds in the lyrics
  // view, otherwise its own volume.
  const faderValueOf = (t) => (lyricsFocus && lyricsFocus.has(t.id)) ? lyricsLevelOf(t) : t.volume;
  function paintFaders(){
    staffTracks.forEach(t => {
      const card = document.querySelector(`.staff-card[data-track-id="${t.id}"]`);
      if (!card) return;
      const v = faderValueOf(t);
      const slider = card.querySelector('.vol-slider');
      if (slider && +slider.value !== v) slider.value = v;
      const val = card.querySelector('.vol-val');
      if (val) val.textContent = v;
      card.style.setProperty('--vu-level', v + '%');
    });
  }
  function applyMixState(){
    paintFaders();
    paintSoloButtons();
    staffTracks.forEach(t => {
      let target;
      if (lyricsFocus){
        target = lyricsFocus.has(t.id) ? lyricsLevelOf(t) / 100 : 0;
      } else {
        target = trackAudible(t) ? (t.volume / 100) : 0;
      }
      t.gain.gain.rampTo(target, 0.05);
    });
  }

  // ---------- Playback ----------
  function buildSchedule(){
    scheduledParts.forEach(p => p.dispose());
    scheduledParts = [];
    const userBpm = parseInt(el('tempo-slider').value, 10);

    staffTracks.forEach(track => {
      const events = track.events.map(e => ({
        time: beatsToSeconds(e.time),
        midi: e.midi,
        dur: Math.max(0.05, noteSeconds(e) * 0.96),
        ph: e.ph
      }));
      const part = new Tone.Part((time, value) => {
        const freq = Tone.Frequency(value.midi, 'midi').toFrequency();
        // Only the AI Singer takes a 4th argument. Tone.Sampler reads that
        // slot as velocity, so it must not be passed to the other voices.
        if (track.synth && track.synth.wantsPhonemes){
          track.synth.triggerAttackRelease(freq, value.dur, time, value.ph);
        } else {
          track.synth.triggerAttackRelease(freq, value.dur, time);
        }
        pianoSchedule(track, value.midi, time, value.dur);
      }, events.map(e => [e.time, e]));
      part.start(0);
      scheduledParts.push(part);
    });

    let maxBeat = 0;
    staffTracks.forEach(t => t.events.forEach(e => { maxBeat = Math.max(maxBeat, e.time + e.dur); }));
    totalDuration = beatsToSeconds(maxBeat, userBpm);
    if (metronomeOn) scheduleMetronome(maxBeat, userBpm);
    updateTimeReadout();
  }

  // ---------- Metronome ----------
  // A click on every quarter-note beat, pitched up on each bar's downbeat.
  // Scheduled as one more Tone.Part alongside the staves, so it follows
  // seeking, pausing and stopping for free.
  let metroSynth = null;
  function scheduleMetronome(maxBeat, bpm){
    if (!metroSynth){
      metroSynth = new Tone.MembraneSynth({
        pitchDecay: 0.008, octaves: 2,
        envelope: { attack: 0.001, decay: 0.08, sustain: 0, release: 0.02 }
      }).toDestination();
      metroSynth.volume.value = -8;
    }
    // Count beats bar by bar, so a pickup bar of odd length doesn't knock
    // every later click off the barlines.
    const bars = measureStarts.length ? measureStarts.slice() : [0];
    bars.push(maxBeat);
    const clicks = [];
    for (let i = 0; i < bars.length - 1; i++){
      for (let b = bars[i]; b < bars[i + 1] - 1e-6; b++){
        clicks.push([beatsToSeconds(b, bpm), b === bars[i]]);
      }
    }
    const part = new Tone.Part((time, accent) => {
      metroSynth.triggerAttackRelease(accent ? 'C6' : 'G5', 0.03, time);
    }, clicks);
    part.start(0);
    scheduledParts.push(part);
  }

  // ---------- Real-voice pre-rendering ----------
  // Walks every "Real Voice (Pre-rendered)" track's events in order (same
  // math buildSchedule uses) and calls triggerAttackRelease in "dry" mode:
  // PSOLA synthesis still runs and its result still gets cached, but
  // nothing is scheduled to play. Doing this before Tone.Transport starts
  // means the actual playback pass hits a warm cache instead of computing
  // PSOLA live -- which is what causes Real Voice playback to stutter,
  // especially with several SATB voices going at once. Tracks set to
  // "Real Voice (Live)" are left alone, per-track, by the _renderMode tag
  // set in createInstrumentVoice.
  async function prerenderRealVoice(onProgress){
    const userBpm = parseInt(el('tempo-slider').value, 10);
    const targets = staffTracks.filter(t =>
      t.synth && typeof SampledSingerVoice === 'function'
      && t.synth instanceof SampledSingerVoice
      && t.synth._renderMode === 'pre');
    if (!targets.length) return;

    for (let i = 0; i < targets.length; i++){
      const track = targets[i];
      const synth = track.synth;
      const savedPrevPh = synth.prevPh, savedLastNote = synth.lastNote;
      synth.prevPh = null;
      synth.lastNote = null;
      synth._dry = true;
      try {
        track.events.forEach(e => {
          const time = beatsToSeconds(e.time);
          const dur = Math.max(0.05, noteSeconds(e) * 0.96);
          const freq = Tone.Frequency(e.midi, 'midi').toFrequency();
          synth.triggerAttackRelease(freq, dur, time, e.ph);
        });
      } finally {
        synth._dry = false;
        // Real playback also starts from a clean slate (prevPh/lastNote are
        // null until the first note is triggered), so restoring rather than
        // keeping this pass's end state keeps it invisible to the actual
        // performance that follows.
        synth.prevPh = savedPrevPh;
        synth.lastNote = savedLastNote;
      }
      if (onProgress) onProgress(i + 1, targets.length);
      // Yield so a progress indicator can actually repaint between tracks
      // instead of the whole pass running as one blocking chunk.
      await new Promise(r => setTimeout(r, 0));
    }
  }

  // Cached units are specific to the notes/pitches/durations of whichever
  // piece produced them -- call this whenever a new score loads so a
  // previous piece's renders can't leak into (or bloat memory for) the new
  // one.
  function clearPrerenderCache(){
    if (typeof SampledSingerVoice !== 'undefined') SampledSingerVoice._cache.clear();
  }

  async function startPlayback(){
    if (staffTracks.length === 0 || !samplesReady) return;
    await Tone.start();
    const bpm = parseInt(el('tempo-slider').value, 10);
    if (scheduledParts.length === 0 || Tone.Transport.state === 'stopped'){
      const resumeSeconds = Tone.Transport.seconds; // preserve any note that was selected before pressing play
      buildSchedule();
      const needsPrerender = staffTracks.some(t =>
        t.synth && typeof SampledSingerVoice === 'function'
        && t.synth instanceof SampledSingerVoice && t.synth._renderMode === 'pre');
      if (needsPrerender){
        const btn = el('play-btn');
        const prevLabel = btn.textContent;
        btn.textContent = '⏳';
        btn.disabled = true;
        try {
          await prerenderRealVoice((done, total) => {
            btn.textContent = '⏳ ' + done + '/' + total;
          });
        } finally {
          btn.disabled = false;
          btn.textContent = prevLabel;
        }
      }
      Tone.Transport.seconds = resumeSeconds;
      resetCursorTo(beatFromSeconds(resumeSeconds, bpm));
    } else {
      try{ osmd.cursor.show(); }catch(err){ /* ignore */ }
    }
    // Keys held at a pause, or lit while moving through the notes, let go:
    // the music lights its own.
    pianoReleaseAll();
    Tone.Transport.start();
    isPlaying = true;
    document.body.classList.add('notes-playing');
    el('play-btn').textContent = '⏸';
    applyMixState();
    tickLoop();
  }

  function seekToBeat(beat){
    if (scheduledParts.length === 0) buildSchedule();
    const bpm = parseInt(el('tempo-slider').value, 10);
    const seconds = Math.max(0, Math.min(beatsToSeconds(beat, bpm), totalDuration || Infinity));
    Tone.Transport.seconds = seconds;
    updateProgress(totalDuration ? seconds / totalDuration : 0);
    resetCursorTo(beat);
    tempoFollow(beat);
    if (!isPlaying) pianoShowAt(beat);                   // traversing: show the notes there
    return seconds;
  }

  async function seekAndPlay(beat){
    if (staffTracks.length === 0 || !samplesReady) return;
    await Tone.start();
    seekToBeat(beat);
    pianoReleaseAll();                                   // the music lights its own keys
    Tone.Transport.start();
    isPlaying = true;
    document.body.classList.add('notes-playing');
    el('play-btn').textContent = '⏸';
    applyMixState();
    tickLoop();
  }

  function pausePlayback(){
    Tone.Transport.pause();
    document.body.classList.remove('notes-playing');
    // Keep the piano keys that were down at the pause lit: drop the queued
    // key changes (their "off" moments were scheduled ahead of time).
    try{ Tone.Draw.cancel(Tone.now()); }catch(err){ /* ignore */ }
    isPlaying = false;
    el('play-btn').textContent = '▶';
    if (rafId) cancelAnimationFrame(rafId);
  }

  function stopPlayback(){
    Tone.Transport.stop();
    document.body.classList.remove('notes-playing');
    scheduledParts.forEach(p => p.dispose());
    scheduledParts = [];
    isPlaying = false;
    el('play-btn').textContent = '▶';
    if (rafId) cancelAnimationFrame(rafId);
    updateProgress(0);
    tempoFollow(0);
    document.querySelectorAll('.staff-card').forEach(c => c.classList.remove('playing'));
    try{ Tone.Draw.cancel(); }catch(err){ /* ignore */ }
    pianoReleaseAll();
    try{ osmd.cursor.hide(); osmd.cursor.reset(); }catch(err){ /* ignore */ }
    cursorIndex = cursorTimeline.length > 0 ? 0 : -1; // reset() already places the cursor at step 0
  }

  el('play-btn').addEventListener('click', () => {
    if (isPlaying) pausePlayback(); else startPlayback();
  });
  el('stop-btn').addEventListener('click', stopPlayback);

  // ---------- Bar skip (arrow keys) / metronome ----------
  // Beat the transport is at right now, whether playing or parked.
  function currentBeat(){
    return beatFromSeconds(Tone.Transport.seconds, parseInt(el('tempo-slider').value, 10));
  }
  function skipBars(delta){
    if (staffTracks.length === 0 || !samplesReady) return;
    const bars = measureStarts.length ? measureStarts : [0];
    const now = currentBeat();
    // Index of the bar we're in. Going back from a little way into a bar
    // lands on its own downbeat first, like the previous-track button on
    // a CD player, rather than skipping two bars.
    let i = 0;
    while (i + 1 < bars.length && bars[i + 1] <= now + 1e-6) i++;
    let target;
    if (delta < 0) target = (now - bars[i] > 0.5) ? i : i - 1;
    else target = i + 1;
    target = Math.max(0, Math.min(bars.length - 1, target));
    if (isPlaying) seekAndPlay(bars[target]); else seekToBeat(bars[target]);
  }

  function setMetronome(on){
    metronomeOn = on;
    el('metro-btn').setAttribute('aria-pressed', String(on));
    try{ localStorage.setItem('noteMetronome', on ? '1' : '0'); }catch(err){ /* ignore */ }
    // The click track lives in scheduledParts, so rebuild it in place --
    // restoring the transport position so playback carries on seamlessly.
    if (staffTracks.length && scheduledParts.length){
      const pos = Tone.Transport.seconds;
      buildSchedule();
      Tone.Transport.seconds = pos;
    }
  }
  el('metro-btn').addEventListener('click', () => setMetronome(!metronomeOn));
  (() => {
    try{
      metronomeOn = localStorage.getItem('noteMetronome') === '1';
      el('metro-btn').setAttribute('aria-pressed', String(metronomeOn));
    }catch(err){ /* ignore */ }
  })();

  document.addEventListener('keydown', (e) => {
    if (!workspace.classList.contains('active')) return;
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'Space'){
      e.preventDefault();
      if (isPlaying) pausePlayback(); else startPlayback();
    } else if (e.key === 'ArrowLeft'){
      e.preventDefault(); skipBars(-1);
    } else if (e.key === 'ArrowRight'){
      e.preventDefault(); skipBars(1);
    } else if (e.key === 'Home'){
      e.preventDefault();
      if (isPlaying) seekAndPlay(0); else if (staffTracks.length) seekToBeat(0);
    } else if (e.key === 'm' || e.key === 'M'){
      setMetronome(!metronomeOn);
    } else if (e.key === '+' || e.key === '='){
      nudgeTempo(5);
    } else if (e.key === '-' || e.key === '_'){
      nudgeTempo(-5);
    }
  });

  // Keyboard tempo nudge -- goes through the slider's own events so the
  // readout and schedule rebuild behave exactly like dragging it.
  function nudgeTempo(delta){
    const s = el('tempo-slider');
    const v = Math.max(+s.min, Math.min(+s.max, parseInt(s.value, 10) + delta));
    if (v === parseInt(s.value, 10)) return;
    s.value = v;
    s.dispatchEvent(new Event('input'));
    s.dispatchEvent(new Event('change'));
  }

  // Progress bar: click or drag to any position, playback starts (or continues) from there.
  let isDraggingProgress = false;

  function progressRatioFromEvent(e){
    const rect = el('progress-track').getBoundingClientRect();
    let clientX;
    if (e.touches && e.touches.length) clientX = e.touches[0].clientX;
    else if (e.changedTouches && e.changedTouches.length) clientX = e.changedTouches[0].clientX;
    else clientX = e.clientX;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  }

  function handleProgressSeek(e, commit){
    if (!totalDuration) return;
    const ratio = progressRatioFromEvent(e);
    updateProgress(ratio); // live preview while dragging
    if (commit){
      const bpm = parseInt(el('tempo-slider').value, 10);
      seekAndPlay(beatFromSeconds(ratio * totalDuration, bpm));
    }
  }

  const progressTrackEl = el('progress-track');
  progressTrackEl.addEventListener('mousedown', (e) => { isDraggingProgress = true; handleProgressSeek(e, false); });
  window.addEventListener('mousemove', (e) => { if (isDraggingProgress) handleProgressSeek(e, false); });
  window.addEventListener('mouseup', (e) => {
    if (isDraggingProgress){ isDraggingProgress = false; handleProgressSeek(e, true); }
  });
  progressTrackEl.addEventListener('touchstart', (e) => { isDraggingProgress = true; handleProgressSeek(e, false); }, { passive: true });
  progressTrackEl.addEventListener('touchmove', (e) => { if (isDraggingProgress) handleProgressSeek(e, false); }, { passive: true });
  progressTrackEl.addEventListener('touchend', (e) => {
    if (isDraggingProgress){ isDraggingProgress = false; handleProgressSeek(e, true); }
  });

  // Click any note on the score to select that position — press Play to start from there.
  el('score-paper').addEventListener('click', (e) => {
    if (staffTracks.length === 0 || cursorTimeline.length === 0 || !samplesReady) return;
    const paper = el('score-paper');
    const pRect = paper.getBoundingClientRect();
    const x = e.clientX - pRect.left + paper.scrollLeft;
    const y = e.clientY - pRect.top + paper.scrollTop;
    const beat = nearestBeatForPoint(x, y);
    if (beat === null) return;
    seekToBeat(beat);
  });

  // Paints the filled part of the tempo track up to the handle.
  function tempoPaint(){
    const s = el('tempo-slider');
    const pct = (s.value - s.min) / (s.max - s.min) * 100;
    s.style.setProperty('--pct', pct + '%');
  }
  el('tempo-slider').addEventListener('input', (e) => {
    el('tempo-val').innerHTML = e.target.value + '<small> bpm</small>';
    tempoPaint();
  });
  // Keep the number centred on the knob, wherever the value comes from.
  function tempoKnobPlace(){
    const sl = el('tempo-slider'), val = el('tempo-val');
    const w = sl.clientWidth;
    if (!w) return;
    const knob = 36;   // the square knob's width (see #tempo-slider::-webkit-slider-thumb)
    const f = (sl.value - sl.min) / ((sl.max - sl.min) || 1);
    val.style.left = (knob / 2 + f * (w - knob)) + 'px';
    document.querySelectorAll('.tempo-step').forEach(b => { b.disabled = sl.disabled; });
  }
  new MutationObserver(tempoKnobPlace).observe(el('tempo-val'), { childList: true, characterData: true, subtree: true });
  new MutationObserver(tempoKnobPlace).observe(el('tempo-slider'), { attributes: true });
  el('tempo-slider').addEventListener('input', tempoKnobPlace);
  window.addEventListener('resize', tempoKnobPlace);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(tempoKnobPlace).observe(el('tempo-slider'));
  document.querySelectorAll('.tempo-step').forEach(b => b.addEventListener('click', () => {
    const sl = el('tempo-slider');
    if (sl.disabled) return;
    const v = Math.max(+sl.min, Math.min(+sl.max, +sl.value + +b.dataset.step));
    if (v === +sl.value) return;
    sl.value = v;
    sl.dispatchEvent(new Event('input', { bubbles: true }));
    sl.dispatchEvent(new Event('change', { bubbles: true }));
    // Green flash on the button and the knob (restarted on every tap).
    [b, sl.closest('.tempo-track')].forEach(x => {
      x.classList.remove('flash'); void x.offsetWidth; x.classList.add('flash');
      clearTimeout(x._flashT); x._flashT = setTimeout(() => x.classList.remove('flash'), 520);
    });
  }));
  // Tapping the knob itself (no drag) puts the tempo back to the score's own.
  let knobTap = null;
  el('tempo-slider').addEventListener('pointerdown', (e) => {
    const sl = el('tempo-slider');
    const r = sl.getBoundingClientRect();
    const f = (sl.value - sl.min) / ((sl.max - sl.min) || 1);
    const knobX = r.left + 18 + f * (r.width - 36);
    knobTap = Math.abs(e.clientX - knobX) <= 20 ? { x: e.clientX, v: +sl.value } : null;
  });
  window.addEventListener('pointerup', (e) => {
    const t = knobTap; knobTap = null;
    const sl = el('tempo-slider');
    if (!t || sl.disabled || Math.abs(e.clientX - t.x) > 5 || +sl.value !== t.v) return;
    const orig = Math.round(Math.max(+sl.min, Math.min(+sl.max, tempoAt(currentBeat()))));
    sl.value = orig;
    sl.dispatchEvent(new Event('input', { bubbles: true }));
    tempoResetting = true;
    try{ sl.dispatchEvent(new Event('change', { bubbles: true })); }
    finally{ tempoResetting = false; }
    const tr = sl.closest('.tempo-track');
    tr.classList.remove('flash'); void tr.offsetWidth; tr.classList.add('flash');
    clearTimeout(tr._flashT); tr._flashT = setTimeout(() => tr.classList.remove('flash'), 520);
  });
  el('tempo-slider').title = 'Drag to change the tempo — tap the knob for the original tempo';
  tempoPaint();
  requestAnimationFrame(tempoKnobPlace);
  // The slider shows the tempo where the music is now (times the
  // listener's factor) and moves by itself at each tempo change -- except
  // while it's being dragged.
  let tempoDragging = false;
  el('tempo-slider').addEventListener('pointerdown', () => { tempoDragging = true; });
  window.addEventListener('pointerup', () => { tempoDragging = false; });
  window.addEventListener('pointercancel', () => { tempoDragging = false; });
  function tempoFollow(beat){
    if (tempoDragging) return;
    const v = Math.round(Math.max(30, Math.min(220, tempoAt(beat) * tempoFactor)));
    const s = el('tempo-slider');
    if (+s.value === v) return;
    s.value = v;
    el('tempo-val').innerHTML = v + '<small> bpm</small>';
    tempoPaint();
  }
  // Setting the slider sets the speed for the whole piece relative to the
  // score: the new value over the score's tempo at this point. Playback
  // carries on from the same spot at the new speed.
  let tempoResetting = false;   // a tap on the knob: back to exactly the score's tempo
  el('tempo-slider').addEventListener('change', () => {
    const beat = currentBeat();                          // measured at the old speed
    tempoFactor = tempoResetting ? 1 : parseInt(el('tempo-slider').value, 10) / tempoAt(beat);
    // rendered voices stretch well only so far
    if (staffTracks.some(t => t.instrument === 'recording')){
      const f = Math.max(RECORDING_TEMPO_RANGE[0], Math.min(RECORDING_TEMPO_RANGE[1], tempoFactor));
      if (f !== tempoFactor){
        tempoFactor = f;
        const v = Math.round(tempoAt(beat) * f);
        el('tempo-slider').value = v;
        el('tempo-val').innerHTML = v + '<small> bpm</small>';
        tempoPaint();
      }
    }
    if (!staffTracks.length) return;
    scheduledParts.forEach(p => p.dispose());
    scheduledParts = [];
    buildSchedule();
    Tone.Transport.seconds = beatsToSeconds(beat);
    updateProgress(totalDuration ? Tone.Transport.seconds / totalDuration : 0);
    RecordingVoice.syncAll();                            // renders get ready for the new tempo now
  });

  function formatTime(s){
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  function updateTimeReadout(){
    el('time-total').textContent = formatTime(totalDuration);
  }

  const PLAY_RING_LEN = 2 * Math.PI * 24;
  function updateProgress(ratio){
    const r = Math.min(1, Math.max(0, ratio || 0));
    el('progress-fill').style.width = (r * 100) + '%';
    el('time-now').textContent = formatTime(r * totalDuration);
    // Ring around Play fills with the piece.
    el('play-ring-fg').style.strokeDashoffset = String(PLAY_RING_LEN * (1 - r));
    el('play-ring-fg').style.opacity = r > 0 ? '1' : '0'; // an empty ring would still show its round cap as a dot
    // Stop counts down the time left once the piece is under way (playing,
    // or paused part-way); at the very start it's the plain stop square.
    const stop = el('stop-btn');
    const counting = totalDuration > 0 && (isPlaying || r > 0);
    stop.classList.toggle('counting', counting);
    stop.textContent = counting ? formatTime(Math.max(0, totalDuration * (1 - r))) : '\u25A0';
    stop.setAttribute('aria-label', counting ? 'Stop (' + stop.textContent + ' left)' : 'Stop');
  }

  const TAIL_BUFFER_SECONDS = 1.5; // let the last note's natural piano decay ring out before stopping

  function tickLoop(){
    if (!isPlaying) return;
    const t = Tone.Transport.seconds;
    const ratio = totalDuration ? Math.min(1, t / totalDuration) : 0;
    updateProgress(ratio);

    const nowBeat = beatFromSeconds(t);
    advanceCursorTo(nowBeat);
    RecordingVoice.syncAll();
    tempoFollow(nowBeat);

    document.querySelectorAll('.staff-card').forEach(card => {
      const track = staffTracks.find(tr => tr.id === card.dataset.trackId);
      const audible = track && trackAudible(track);
      const active = audible && track.events.some(e => nowBeat >= e.time && nowBeat < e.time + e.dur);
      card.classList.toggle('playing', !!active);
    });

    if (totalDuration && t >= totalDuration + TAIL_BUFFER_SECONDS){
      stopPlayback();
      return;
    }
    rafId = requestAnimationFrame(tickLoop);
  }

  // ---------- Mixer show/hide + resize ----------
  let mixerCustomHeight = null; // px; null = default CSS-driven height
  const MIXER_CHROME_H = 176; // header row + card padding/led/name/instrument-select/toggles/value, non-fader vertical space
  const FADER_H_DEFAULT = 98;
  const FADER_H_MIN = 22;

  function applyBodyPadding(){
    if (document.body.classList.contains('mixer-collapsed')){
      document.body.style.paddingBottom = '';
      return;
    }
    document.body.style.paddingBottom = mixerCustomHeight ? (mixerCustomHeight + 14) + 'px' : '';
  }

  // Sets both the mixer's overall height and compresses/expands each channel
  // strip's fader + VU meter proportionally so content shrinks to fit instead
  // of just clipping or requiring a scrollbar.
  function applyMixerHeight(h){
    const bottomMixer = el('bottom-mixer');
    bottomMixer.style.height = h + 'px';
    const faderH = Math.max(FADER_H_MIN, Math.min(FADER_H_DEFAULT, h - MIXER_CHROME_H));
    bottomMixer.style.setProperty('--fader-h', faderH + 'px');
  }

  el('mixer-toggle-btn').addEventListener('click', () => {
    const bottomMixer = el('bottom-mixer');
    const collapsed = bottomMixer.classList.toggle('collapsed');
    document.body.classList.toggle('mixer-collapsed', collapsed);
    const btn = el('mixer-toggle-btn');
    const arrowChar = collapsed ? '▲' : '▼';
    btn.querySelectorAll('.mixer-toggle-arrow').forEach(a => { a.textContent = arrowChar; });
    btn.querySelector('.mixer-toggle-label').textContent = collapsed ? 'Show Controls' : 'Hide Controls';
    btn.title = collapsed ? 'Show controls' : 'Hide controls';
    if (collapsed){
      bottomMixer.style.height = '';
    } else if (mixerCustomHeight){
      applyMixerHeight(mixerCustomHeight);
    }
    applyBodyPadding();
  });

  // Drag the handle above the mixer to resize it.
  let isResizingMixer = false;
  let resizeStartY = 0;
  let resizeStartHeight = 0;

  function mixerResizeClientY(e){
    if (e.touches && e.touches.length) return e.touches[0].clientY;
    if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0].clientY;
    return e.clientY;
  }

  function beginMixerResize(e){
    const bottomMixer = el('bottom-mixer');
    if (bottomMixer.classList.contains('collapsed')) return;
    isResizingMixer = true;
    resizeStartY = mixerResizeClientY(e);
    resizeStartHeight = bottomMixer.offsetHeight;
    bottomMixer.classList.add('resizing');
  }

  function doMixerResize(e){
    if (!isResizingMixer) return;
    const delta = resizeStartY - mixerResizeClientY(e); // dragging up = taller
    const minH = 70;
    const maxH = Math.round(Math.min(520, window.innerHeight * 0.6));
    const newHeight = Math.max(minH, Math.min(maxH, resizeStartHeight + delta));
    mixerCustomHeight = newHeight;
    applyMixerHeight(newHeight);
    applyBodyPadding();
  }

  function endMixerResize(){
    if (!isResizingMixer) return;
    isResizingMixer = false;
    el('bottom-mixer').classList.remove('resizing');
  }

  const resizeHandleEl = el('resize-handle');
  resizeHandleEl.addEventListener('mousedown', beginMixerResize);
  window.addEventListener('mousemove', doMixerResize);
  window.addEventListener('mouseup', endMixerResize);
  resizeHandleEl.addEventListener('touchstart', beginMixerResize, { passive: true });
  window.addEventListener('touchmove', doMixerResize, { passive: true });
  window.addEventListener('touchend', endMixerResize);

  // ---------- Zoom ----------
  let zoom = 0.6; // default = 100% minus four clicks of the "-" button (each click is -0.1)
  function updateZoomDisplay(){
    const v = document.getElementById('zoom-val');
    if (v) v.textContent = Math.round(zoom * 100) + '%';
  }
  updateZoomDisplay();
  function setScoreZoom(z){
    zoom = Math.round(Math.min(2, Math.max(0.5, z)) * 100) / 100;
    updateZoomDisplay();
    if (osmd){ osmd.zoom = zoom; osmd.render(); buildCursorTimeline(); }
  }
  el('zoom-in').addEventListener('click', () => setScoreZoom(zoom + 0.1));
  el('zoom-out').addEventListener('click', () => setScoreZoom(zoom - 0.1));
  // Tapping the percentage puts the score back to its default size.
  const ZOOM_DEFAULT = zoom;
  const zoomValEl = el('zoom-val');
  zoomValEl.setAttribute('role', 'button');
  zoomValEl.tabIndex = 0;
  zoomValEl.title = 'Back to ' + Math.round(ZOOM_DEFAULT * 100) + '%';
  zoomValEl.addEventListener('click', () => { if (zoom !== ZOOM_DEFAULT) setScoreZoom(ZOOM_DEFAULT); });
  zoomValEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); zoomValEl.click(); }
  });
  // Phones and tablets: pinch the score to zoom (the - / + buttons are
  // hidden there). While the fingers move the drawn score is only stretched;
  // when they lift it's redrawn sharply at the new size.
  (() => {
    const paper = el('score-paper'), box = el('osmd-container');
    let pinch = null;
    // Locked by default, so a stray two-finger touch never changes the
    // layout; the choice is remembered on the device.
    let zoomLocked = true;
    try{ zoomLocked = localStorage.getItem('scoreZoomLocked') !== '0'; }catch(err){ /* locked */ }
    const lockBtn = el('zoom-lock');
    const paintLock = () => {
      lockBtn.setAttribute('aria-pressed', zoomLocked ? 'true' : 'false');
      lockBtn.title = zoomLocked ? 'Zoom locked — tap to unlock pinch zoom' : 'Pinch to zoom — tap to lock the zoom';
      lockBtn.setAttribute('aria-label', lockBtn.title);
    };
    paintLock();
    lockBtn.addEventListener('click', () => {
      zoomLocked = !zoomLocked;
      try{ localStorage.setItem('scoreZoomLocked', zoomLocked ? '1' : '0'); }catch(err){ /* ignore */ }
      paintLock();
    });
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    paper.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 2 || !osmd || zoomLocked) return;
      const r = box.getBoundingClientRect();
      const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
      const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top;
      pinch = { d0: dist(e.touches), ratio: 1 };
      box.style.transformOrigin = mx + 'px ' + my + 'px';
      e.preventDefault();
    }, { passive: false });
    paper.addEventListener('touchmove', (e) => {
      if (!pinch || e.touches.length < 2) return;
      const lo = 0.5 / zoom, hi = 2 / zoom;               // stay within 50-200%
      pinch.ratio = Math.min(hi, Math.max(lo, dist(e.touches) / pinch.d0));
      box.style.transform = 'scale(' + pinch.ratio + ')';
      el('zoom-val').textContent = Math.round(zoom * pinch.ratio * 100) + '%';
      e.preventDefault();
    }, { passive: false });
    const end = (e) => {
      if (!pinch || e.touches.length >= 2) return;
      const ratio = pinch.ratio;
      pinch = null;
      box.style.transform = '';
      box.style.transformOrigin = '';
      if (Math.abs(ratio - 1) > 0.03) setScoreZoom(zoom * ratio);
      else updateZoomDisplay();
    };
    paper.addEventListener('touchend', end);
    paper.addEventListener('touchcancel', end);
  })();

  // With autoResize off, we control redraws ourselves: nothing happens while the window
  // is actively being resized (keeps the drag itself smooth), then a single re-render +
  // cursor-timeline rebuild happens shortly after the user stops.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!osmd || staffTracks.length === 0) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      try{ osmd.render(); }catch(err){ /* ignore */ }
      buildCursorTimeline();
    }, 180);
  });

  // ---------- Responsive top-bar padding ----------
  // The top bar's content (tabs + transport controls) can wrap onto extra lines
  // on narrow phone/tablet widths, and the exact wrapped height isn't something a
  // fixed CSS breakpoint value can predict reliably. Measuring the bar's real
  // rendered height and syncing body's padding-top to match keeps the score from
  // ever being hidden behind it, on any screen size or orientation.
  function syncTopBarPadding(){
    const topBar = el('top-bar');
    if (!topBar) return;
    document.body.style.paddingTop = (topBar.offsetHeight + 10) + 'px';
  }
  if (typeof ResizeObserver !== 'undefined'){
    new ResizeObserver(() => syncTopBarPadding()).observe(el('top-bar'));
  } else {
    window.addEventListener('resize', syncTopBarPadding);
    window.addEventListener('orientationchange', () => setTimeout(syncTopBarPadding, 200));
  }
  syncTopBarPadding();

  // ---------- Music Sheet (PDF) ----------
  // Same shape as the Note Player's library: shared Drive folders from the
  // "// Music Sheets" section of config.ark2, copies saved on this device
  // ("📥", IndexedDB 'sheets', the default when there are any), or a folder
  // on this device. Tapping a sheet opens the PDF viewer below.
  const SHEET_EXT = ['.pdf'];
  let sheetSource = '', sheetLocalName = '', sheetOffline = [], sheetItems = [], sheetDirHandle = null;
  const sheetNote = (m) => { el('sheet-note').textContent = m || ''; };
  const sheetTitleOf = (name) => {
    let stem = name.replace(/\.[^.]+$/, '');
    if (!/\s/.test(stem)) stem = stem.replace(/[-_]+/g, ' ');   // "A-Christmas-Blessing" -> "A Christmas Blessing"
    return stem.trim();
  };
  function sheetFillSource(){
    fillSourceSelect(el('sheet-path'), cloudCfg.sheets, sheetLocalName, sheetSource,
                     'No folder chosen — pick one to see your music sheets', sheetOffline);
    sheetUpdateDownloadAll();
  }
  async function sheetRefreshOffline(){
    sheetOffline = await offlineFolders('sheets');
    sheetFillSource();
  }
  const sheetNeedsDownload = (item) => !item.saved || (item.modifiedTime && item.saved.modifiedTime !== item.modifiedTime);
  function sheetUpdateDownloadAll(){
    const b = el('sheet-dl-all');
    if (!sheetSource.startsWith('drive:') || !sheetItems.length || !sheetItems[0].driveId){ b.hidden = true; return; }
    b.hidden = false;
    const todo = sheetItems.filter(sheetNeedsDownload).length;
    b.disabled = todo === 0;
    b.querySelector('span').textContent = todo === 0 ? 'All saved on this device'
      : (todo === sheetItems.length ? 'Download all (' + todo + ')' : 'Download ' + todo + ' more');
  }

  async function sheetLoadDrive(id){
    await getCloudConfig();
    const f = cloudCfg.sheets.find(x => x.id === id);
    sheetNote('Loading ' + (f ? f.name : 'shared folder') + '\u2026');
    try{
      const found = await driveList(id, SHEET_EXT);
      if (sheetSource !== 'drive:' + id) return;
      const saved = new Map((await offlineAll('sheets')).filter(r => r.folderId === id).map(r => [r.driveId, r]));
      sheetItems = found.map(x => Object.assign(x, {
        saved: saved.has(x.driveId) ? { savedAt: saved.get(x.driveId).savedAt, modifiedTime: saved.get(x.driveId).modifiedTime } : null
      }));
      sheetItems.sort((a, b) => (a.rel + a.name).localeCompare(b.rel + b.name));
      sheetRender();
    }catch(err){ sheetNote(driveErrorText(err)); }
  }
  async function sheetLoadOffline(folderId){
    const recs = (await offlineAll('sheets')).filter(r => r.folderId === folderId);
    if (sheetSource !== 'offline:' + folderId) return;
    sheetItems = recs.map(r => ({ name: r.name, rel: r.rel || '', blob: r.blob, offlineKey: r.key, savedAt: r.savedAt }));
    sheetItems.sort((a, b) => (a.rel + a.name).localeCompare(b.rel + b.name));
    sheetRender();
    if (!recs.length) sheetNote('Nothing saved from this folder yet.');
  }
  async function sheetWalk(dir, prefix, out, depth){
    if (depth > 4) return;
    for await (const [name, handle] of dir.entries()){
      if (handle.kind === 'directory') await sheetWalk(handle, prefix + name + '/', out, depth + 1);
      else if (SHEET_EXT.some(x => name.toLowerCase().endsWith(x))) out.push({ handle, name, rel: prefix });
    }
  }
  async function sheetScanLocal(){
    if (!sheetDirHandle) return sheetBrowse();
    sheetNote('Scanning\u2026');
    try{
      if (sheetDirHandle.queryPermission){
        let state = await sheetDirHandle.queryPermission({ mode: 'read' });
        if (state !== 'granted' && sheetDirHandle.requestPermission) state = await sheetDirHandle.requestPermission({ mode: 'read' });
        if (state !== 'granted') return sheetNote('Access to that folder was not allowed. Tap Scan and choose Allow, or pick the folder again with Browse.');
      }
      const found = [];
      await sheetWalk(sheetDirHandle, '', found, 0);
      sheetItems = [];
      for (const f of found){
        try{ sheetItems.push({ file: await f.handle.getFile(), name: f.name, rel: f.rel }); }catch(err){ /* skip */ }
      }
      sheetItems.sort((a, b) => (a.rel + a.name).localeCompare(b.rel + b.name));
      sheetRender();
    }catch(err){
      if (err && err.name === 'NotFoundError') return sheetForgetFolder();
      sheetNote(folderErrorText(err));
    }
  }
  async function sheetBrowse(){
    const useLocal = (name) => {
      sheetLocalName = name; sheetSource = 'local';
      saveSourcePref('sheetSource', 'local');
      sheetFillSource();
    };
    if (window.showDirectoryPicker){
      try{
        sheetDirHandle = await window.showDirectoryPicker({ id: 'ark2-sheets', mode: 'read' });
        useLocal(sheetDirHandle.name);
        return sheetScanLocal();
      }catch(err){
        if (err && err.name === 'AbortError'){ sheetFillSource(); return; }
      }
    }
    const inp = document.createElement('input');
    inp.type = 'file'; inp.webkitdirectory = true; inp.multiple = true;
    inp.addEventListener('change', () => {
      sheetDirHandle = null;
      const files = [...inp.files].filter(f => SHEET_EXT.some(x => f.name.toLowerCase().endsWith(x)));
      sheetItems = files.map(f => ({ file: f, name: f.name, rel: (f.webkitRelativePath || '').replace(f.name, '') }));
      sheetItems.sort((a, b) => (a.rel + a.name).localeCompare(b.rel + b.name));
      const first = inp.files[0];
      useLocal(first ? ((first.webkitRelativePath || '').split('/')[0] || 'chosen folder') : 'chosen folder');
      sheetRender();
    });
    inp.click();
  }

  // ---------- Device folders that were deleted ----------
  // A folder picked with Browse is remembered by name, so if it's later
  // deleted (or moved) on the phone its name would linger in the picker. The
  // folder is checked when the app starts, when you come back to it, when a
  // picker is tapped and on Scan; one that's gone is dropped from the list.
  async function folderMissing(handle, items){
    if (handle){
      try{
        // Without read permission there is no way to look; assume it's there
        // (Scan asks for permission and finds out).
        if (handle.queryPermission && await handle.queryPermission({ mode: 'read' }) !== 'granted') return false;
        for await (const entry of handle.values()){ void entry; break; }
        return false;
      }catch(err){ return !!err && err.name === 'NotFoundError'; }
    }
    // Picked with the plain folder input: all there is, is the files. Only
    // when none of a few can be read any more is the folder taken as gone.
    const files = (items || []).filter(i => i.file instanceof Blob).slice(0, 3);
    if (!files.length) return false;
    for (const i of files){
      try{ await i.file.slice(0, 1).arrayBuffer(); return false; }
      catch(err){ if (!err || !/NotFound|NotReadable/.test(err.name)) return false; }
    }
    return true;
  }
  const FOLDER_GONE = 'That folder was deleted or moved on this device, so it was taken off the list. Use Browse to choose another.';
  function libForgetFolder(){
    libDirHandle = null;
    dbSaveMeta('libraryDir', null);
    libLocalName = '';
    if (libSource === 'local'){ libSource = ''; saveSourcePref('libSource', ''); libItems = []; libRender([]); }
    libFillSource();
    libNote(FOLDER_GONE);
  }
  function audioForgetFolder(){
    audioDirHandle = null;
    dbSaveMeta('audioLibraryDir', null);
    audioLocalName = '';
    if (audioSource === 'local'){ audioSource = ''; saveSourcePref('audioSource', ''); audioItems = []; audioRefreshView(); }
    audioFillSource();
    audioNote(FOLDER_GONE);
  }
  function sheetForgetFolder(){
    sheetDirHandle = null;
    sheetLocalName = '';
    if (sheetSource === 'local'){ sheetSource = ''; saveSourcePref('sheetSource', ''); sheetItems = []; sheetRender(); }
    sheetFillSource();
    sheetNote(FOLDER_GONE);
  }
  let folderChecking = false;
  async function checkDeviceFolders(){
    if (folderChecking) return;
    folderChecking = true;
    try{
      if (libLocalName && await folderMissing(libDirHandle, libDirHandle ? null : libItems)) libForgetFolder();
      if (audioLocalName && await folderMissing(audioDirHandle, audioDirHandle ? null : audioItems)) audioForgetFolder();
      if (sheetLocalName && await folderMissing(sheetDirHandle, sheetDirHandle ? null : sheetItems)) sheetForgetFolder();
    }catch(err){ /* never get in the way */ }
    finally{ folderChecking = false; }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDeviceFolders(); });
  ['lib-path', 'audio-path', 'sheet-path'].forEach(id => el(id).addEventListener('pointerdown', checkDeviceFolders));

  async function sheetSaveOffline(item){
    const folderId = sheetSource.slice(6);
    const folder = cloudCfg.sheets.find(f => f.id === folderId);
    const res = await fetch(driveMediaUrl(item.driveId));
    if (!res.ok){ const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
    const rec = {
      key: folderId + ':' + item.driveId, folderId,
      folderName: folder ? folder.name : 'Shared sheets',
      driveId: item.driveId, name: item.name, rel: item.rel || '',
      blob: await res.blob(), savedAt: Date.now(), modifiedTime: item.modifiedTime || ''
    };
    await offlinePut(rec, 'sheets');
    item.saved = { savedAt: rec.savedAt, modifiedTime: rec.modifiedTime };
    try{ if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); }catch(err){ /* ignore */ }
  }
  let sheetDownloading = false;
  el('sheet-dl-all').addEventListener('click', async () => {
    if (sheetDownloading) return;
    const src = sheetSource;
    const todo = sheetItems.filter(sheetNeedsDownload);
    if (!todo.length) return;
    if (!(await confirmDownloadAll(todo, 'music sheet'))) return;
    if (sheetDownloading || sheetSource !== src) return;
    sheetDownloading = true;
    el('sheet-dl-all').disabled = true;
    let done = 0, failed = 0;
    for (const item of todo){
      if (sheetSource !== src) break;
      sheetNote('Downloading ' + (done + 1) + ' of ' + todo.length + '\u2026');
      try{ await sheetSaveOffline(item); }catch(err){ failed++; }
      done++;
    }
    sheetDownloading = false;
    await sheetRefreshOffline();
    if (sheetSource === src) sheetRender();
    sheetNote(failed ? (done - failed) + ' saved, ' + failed + " couldn't be downloaded — tap Download again to retry."
                     : 'Saved ' + done + (done === 1 ? ' sheet' : ' sheets') + ' on this device.');
  });

  function sheetRender(){
    const shelf = el('sheet-shelf');
    shelf.innerHTML = '';
    sheetUpdateDownloadAll();
    sheetNote(sheetItems.length ? '' : 'No PDF music sheets in that folder.');
    sheetItems.forEach(item => {
      const title = sheetTitleOf(item.name);
      const card = document.createElement('div');
      card.className = 'lib-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.title = item.rel + item.name;
      card.innerHTML = '<span class="lib-cover"><span></span></span><span class="lib-name"></span>' +
                       '<span class="lib-sub"></span><span class="pl-actions"></span>';
      card.querySelector('.lib-cover span').textContent = title;
      addFileIcon(card, 'pdf', item.name);
      card.querySelector('.lib-name').textContent = title;
      card.querySelector('.lib-sub').textContent = item.offlineKey ? 'Saved ' + savedDate(item.savedAt) : item.rel.replace(/\/$/, '');
      const acts = card.querySelector('.pl-actions');
      const act = (cls, label, svg, fn) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'pl-act ' + cls; b.title = label;
        b.setAttribute('aria-label', label + ': ' + title);
        b.innerHTML = svg;
        b.addEventListener('click', (e) => { e.stopPropagation(); fn(b); });
        acts.appendChild(b);
      };
      if (item.driveId){
        const stale = item.saved && sheetNeedsDownload(item);
        act(!item.saved ? 'lib-dl' : stale ? 'lib-update' : 'lib-saved',
            !item.saved ? 'Save on this device' : stale ? 'Changed on Drive — tap to update' : 'Saved on this device ' + savedDate(item.saved.savedAt),
            item.saved && !stale ? '<svg viewBox="0 0 16 16"><path d="M3.5 8.5 6.5 11.5 12.5 4.5"/></svg>'
                                 : '<svg viewBox="0 0 16 16"><path d="M8 2.5v8M4.5 7.5 8 11l3.5-3.5M3 13.5h10"/></svg>',
            async (b) => {
              if (b.classList.contains('lib-busy')) return;
              b.classList.add('lib-busy');
              sheetNote('Saving ' + title + '\u2026');
              try{
                await sheetSaveOffline(item);
                await sheetRefreshOffline();
                sheetRender();
                sheetNote('Saved ' + title + ' on this device.');
              }catch(err){ sheetNote(driveErrorText(err)); b.classList.remove('lib-busy'); }
            });
      } else if (item.offlineKey){
        act('pl-remove', 'Remove from this device',
            '<svg viewBox="0 0 16 16"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
            async () => {
              await offlineDelete(item.offlineKey, 'sheets');
              await sheetRefreshOffline();
              if (sheetOffline.some(o => 'offline:' + o.folderId === sheetSource)) sheetLoadOffline(sheetSource.slice(8));
              else { sheetItems = []; sheetRender(); }
              sheetNote('Removed ' + title + ' from this device.');
            });
      }
      const open = () => sheetOpen(item, title);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (e) => {
        if (e.target !== card) return;
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); open(); }
      });
      shelf.appendChild(card);
    });
  }

  el('sheet-path').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === 'browse'){ sheetFillSource(); sheetBrowse(); return; }
    sheetSource = v;
    saveSourcePref('sheetSource', v);
    sheetUpdateDownloadAll();
    if (v === 'local') sheetScanLocal();
    else if (v.startsWith('drive:')) sheetLoadDrive(v.slice(6));
    else if (v.startsWith('offline:')) sheetLoadOffline(v.slice(8));
  });
  el('sheet-browse').addEventListener('click', sheetBrowse);
  el('sheet-scan').addEventListener('click', () => {
    if (sheetSource.startsWith('drive:')) sheetLoadDrive(sheetSource.slice(6));
    else if (sheetSource.startsWith('offline:')) sheetLoadOffline(sheetSource.slice(8));
    else sheetScanLocal();
  });

  // ---------- PDF viewer with page flip ----------
  // PDF.js (Mozilla's reader, vendored in vendor/ and cached for offline)
  // renders each page to a canvas; pages are cached a few at a time so
  // turning is instant. Turning forward swings the current leaf over its
  // left edge to reveal the next page underneath; turning back swings the
  // previous page in on top.
  let pdfjsP = null;
  function loadPdfJs(){
    if (!pdfjsP){
      pdfjsP = new Promise((res, rej) => {
        const ready = () => window.pdfjsLib || window['pdfjs-dist/build/pdf'];
        if (ready()) return res(ready());
        const sc = document.createElement('script');
        sc.src = 'vendor/pdf.min.js';
        sc.onload = () => {
          const lib = ready();
          if (!lib) return rej(new Error('PDF viewer did not load'));
          lib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
          res(lib);
        };
        sc.onerror = () => { pdfjsP = null; rej(new Error('PDF viewer could not load')); };
        document.head.appendChild(sc);
      });
    }
    return pdfjsP;
  }

  // Page turning is StPageFlip (MIT, vendored in vendor/ with its licence):
  // a real page curl -- drag a corner or swipe and the page bends over with
  // its shadow, like turning a book page. It is kept to one page at a time
  // (portrait) on every screen. Each page is a canvas drawn by PDF.js just
  // before it's needed; pages far from the current one are freed again.
  let pageFlipP = null;
  function loadPageFlip(){
    if (!pageFlipP){
      pageFlipP = new Promise((res, rej) => {
        if (window.St && window.St.PageFlip) return res(window.St.PageFlip);
        const sc = document.createElement('script');
        sc.src = 'vendor/page-flip.browser.js';
        sc.onload = () => (window.St && window.St.PageFlip) ? res(window.St.PageFlip) : rej(new Error('Page flip did not load'));
        sc.onerror = () => { pageFlipP = null; rej(new Error('Page flip could not load')); };
        document.head.appendChild(sc);
      });
    }
    return pageFlipP;
  }

  const sv = { doc: null, page: 1, pages: 0, book: null, W: 0, H: 0, canvases: [], drawn: new Map(), dens: new Map(), token: 0 };
  function svDpr(){ return Math.min(3, window.devicePixelRatio || 1); }
  // On a wide screen the book opens to a two-page spread (when two pages
  // fit at full size), on a phone it's one page at a time.
  const svSpread = () => !!(sv.book && sv.book.getOrientation && sv.book.getOrientation() === 'landscape');
  function svUpdateChrome(){
    const spread = svSpread() && sv.page < sv.pages;
    el('sv-count').textContent = !sv.pages ? ''
      : spread ? 'Pages ' + sv.page + '–' + (sv.page + 1) + ' / ' + sv.pages
      : 'Page ' + sv.page + ' / ' + sv.pages;
    el('sv-prev').disabled = sv.page <= 1;
    el('sv-next').disabled = (spread ? sv.page + 1 : sv.page) >= sv.pages;
  }
  // Draw page n into its leaf (once), scaled to the book's page size.
  // Redraw page n at a higher pixel density (after zooming in), into a
  // spare canvas first so it never collides with a render in progress.
  async function svSharpen(n, density){
    if (n < 1 || n > sv.pages || (sv.dens.get(n) || 0) >= density - 0.01) return;
    const token = sv.token;
    sv.dens.set(n, density);
    const page = await sv.doc.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(sv.W / vp1.width, sv.H / vp1.height) * density });
    const tmp = document.createElement('canvas');
    tmp.width = Math.floor(vp.width); tmp.height = Math.floor(vp.height);
    await page.render({ canvasContext: tmp.getContext('2d'), viewport: vp }).promise;
    const c = sv.canvases[n - 1];
    if (!c || token !== sv.token || (sv.dens.get(n) || 0) > density + 0.01) return;
    c.width = tmp.width; c.height = tmp.height;
    c.getContext('2d').drawImage(tmp, 0, 0);
  }
  async function svDraw(n){
    if (n < 1 || n > sv.pages || sv.drawn.has(n)) return sv.drawn.get(n);
    const token = sv.token;
    const job = (async () => {
      const page = await sv.doc.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(sv.W / vp1.width, sv.H / vp1.height) * svDpr();
      const vp = page.getViewport({ scale });
      const c = sv.canvases[n - 1];
      if (!c || token !== sv.token) return;
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      sv.dens.set(n, svDpr());
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    })();
    sv.drawn.set(n, job);
    return job;
  }
  // Keep the pages around the current one drawn, and free the rest.
  function svKeepNear(){
    for (let n = sv.page - 2; n <= sv.page + 3; n++) svDraw(n).catch(() => {});
    [...sv.drawn.keys()].forEach(n => {
      if (Math.abs(n - sv.page) > 4){
        const c = sv.canvases[n - 1];
        if (c){ c.width = 0; c.height = 0; }
        sv.drawn.delete(n);
        sv.dens.delete(n);
      }
    });
  }
  // (Re)build the book at the current screen size, opening on page `start`.
  async function svBuild(start){
    const token = ++sv.token;
    if (sv.book){ try{ sv.book.destroy(); }catch(err){ /* ignore */ } sv.book = null; }
    const stage = el('sv-stage');
    const old = el('sv-book');
    if (old) old.remove();
    const holder = document.createElement('div');
    holder.className = 'sv-book';
    holder.id = 'sv-book';
    el('sv-zoom').appendChild(holder);
    svZoomReset(false);

    const PageFlip = await loadPageFlip();
    const p1 = await sv.doc.getPage(1);
    const vp1 = p1.getViewport({ scale: 1 });
    const fit = Math.max(0.1, Math.min((stage.clientWidth - 24) / vp1.width, (stage.clientHeight - 24) / vp1.height));
    sv.W = Math.floor(vp1.width * fit);
    sv.H = Math.floor(vp1.height * fit);
    // Narrower than two pages, so the library shows one page (portrait).
    holder.style.width = sv.W + 'px';
    holder.style.maxWidth = sv.W + 'px';

    sv.canvases = [];
    sv.drawn.clear();
    sv.dens.clear();
    for (let n = 1; n <= sv.pages; n++){
      const leaf = document.createElement('div');
      leaf.className = 'sv-leaf';
      const c = document.createElement('canvas');
      leaf.appendChild(c);
      holder.appendChild(leaf);
      sv.canvases.push(c);
    }
    sv.page = Math.min(Math.max(1, start), sv.pages);
    // Have the opening page(s) (and their neighbours) drawn before showing.
    await Promise.all([sv.page - 1, sv.page, sv.page + 1, sv.page + 2].map(n => svDraw(n)));
    if (token !== sv.token) return;

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sv.book = new PageFlip(holder, {
      width: sv.W, height: sv.H, size: 'fixed',
      // autoSize would stretch the book to the viewer's width -- wide enough
      // for a two-page spread, leaving the page on its right half.
      usePortrait: true, showCover: false, autoSize: false,
      drawShadow: true, maxShadowOpacity: 0.55,
      flippingTime: reduce ? 250 : 900,
      showPageCorners: true, mobileScrollSupport: false, disableFlipByClick: true,
      swipeDistance: 30, startPage: sv.page - 1
    });
    sv.book.loadFromHTML(holder.querySelectorAll('.sv-leaf'));
    // StPageFlip turns back by "pressing" a point that, one page at a time,
    // isn't on a corner -- so with disableFlipByClick every back turn (the
    // button and a swipe to the right alike) was ignored. Lift it for that
    // one call; taps on the page still don't turn it.
    { const book = sv.book, prev = book.flipPrev.bind(book);
      book.flipPrev = (corner) => {
        const set = book.getSettings();
        set.disableFlipByClick = false;
        try{ prev(corner); }finally{ set.disableFlipByClick = true; }
      };
    }
    sv.book.on('flip', (e) => {
      svZoomReset(true);
      sv.page = (e.data | 0) + 1;
      svUpdateChrome();
      svKeepNear();
    });
    sv.book.on('changeOrientation', () => svUpdateChrome());
    svUpdateChrome();
    svKeepNear();
  }
  function svTurn(dir){
    if (!sv.book) return;
    svZoomReset(true);
    if (dir > 0 && sv.page < sv.pages) sv.book.flipNext('bottom');
    else if (dir < 0 && sv.page > 1) sv.book.flipPrev('bottom');
  }

  async function sheetOpen(item, title){
    const viewer = el('sheet-viewer');
    el('sv-title').textContent = title;
    el('sv-count').textContent = '';
    el('sv-loading').hidden = false;
    el('sv-loading').textContent = 'Loading\u2026';
    viewer.hidden = false;
    svPlayOpen(title);                                  // play-along pickers
    sv.token++;
    if (sv.book){ try{ sv.book.destroy(); }catch(err){ /* ignore */ } sv.book = null; }
    if (el('sv-book')) el('sv-book').innerHTML = '';
    sv.doc = null;
    try{
      const [lib] = await Promise.all([loadPdfJs(), loadPageFlip()]);
      let data;
      if (item.blob) data = await item.blob.arrayBuffer();
      else if (item.file) data = await item.file.arrayBuffer();
      else {
        await getCloudConfig();
        const res = await fetch(driveMediaUrl(item.driveId));
        if (!res.ok){ const e = new Error('HTTP ' + res.status); e.status = res.status; throw e; }
        data = await res.arrayBuffer();
      }
      if (viewer.hidden) return;                         // closed while loading
      sv.doc = await lib.getDocument({ data }).promise;
      sv.pages = sv.doc.numPages;
      await svBuild(1);
      el('sv-loading').hidden = true;
    }catch(err){
      if (item.driveId && !item.blob){
        console.warn('Shared folder:', err);
        el('sv-loading').textContent = 'File is not available';
        showRenderFail('File is not Available', 'note', 'Please check your connection or wait for few moment and come back again', svCancelLoads);
      } else el('sv-loading').textContent = "Couldn't open this PDF.";
    }
  }
  function sheetClose(){
    svPlayStop();
    svZoomReset(false);
    el('sheet-viewer').hidden = true;
    sv.token++;
    if (sv.book){ try{ sv.book.destroy(); }catch(err){ /* ignore */ } sv.book = null; }
    sv.drawn.clear();
    sv.canvases = [];
    if (sv.doc){ try{ sv.doc.destroy(); }catch(err){ /* ignore */ } }
    sv.doc = null;
  }
  // ---------- Zoom (pinch, double-tap, trackpad) ----------
  // The zoom layer wraps the book. Pinching scales it around the fingers;
  // one finger pans while zoomed. These gestures are caught on the way in
  // (capture phase) so the page-flip library never sees them -- at normal
  // size single-finger swipes/drags still reach it and turn the page.
  const svZ = { z: 1, tx: 0, ty: 0, pinch: null, pan: null, tapT: 0, tapX: 0, tapY: 0, sharpT: null };
  const SV_ZMAX = 4;
  function svZoomApply(animate){
    const zc = el('sv-zoom');
    zc.style.transition = animate ? 'transform .22s ease' : 'none';
    zc.style.transform = svZ.z === 1 ? '' : 'translate(' + svZ.tx + 'px,' + svZ.ty + 'px) scale(' + svZ.z + ')';
    const zb = el('sv-zoomreset');
    zb.hidden = svZ.z <= 1.001;
    zb.textContent = Math.round(svZ.z * 100) + '%';
    el('sheet-viewer').classList.toggle('zoomed', svZ.z > 1.001);
  }
  // Keep the zoomed page covering the stage (or centred when smaller).
  function svZoomClamp(){
    const st = el('sv-stage'), zc = el('sv-zoom');
    const W = st.clientWidth, H = st.clientHeight;
    const ox = zc.offsetLeft, oy = zc.offsetTop;
    const sw = zc.offsetWidth * svZ.z, sh = zc.offsetHeight * svZ.z;
    svZ.tx = sw <= W ? (W - sw) / 2 - ox : Math.min(-ox, Math.max(W - ox - sw, svZ.tx));
    svZ.ty = sh <= H ? (H - sh) / 2 - oy : Math.min(-oy, Math.max(H - oy - sh, svZ.ty));
  }
  // Content point (in unzoomed page pixels) under a screen point.
  function svZoomPoint(clientX, clientY){
    const r = el('sv-stage').getBoundingClientRect(), zc = el('sv-zoom');
    const px = clientX - r.left, py = clientY - r.top;
    return { px, py, cx: (px - zc.offsetLeft - svZ.tx) / svZ.z, cy: (py - zc.offsetTop - svZ.ty) / svZ.z };
  }
  function svZoomTo(z, anchor, px, py, animate){
    const zc = el('sv-zoom');
    svZ.z = Math.min(SV_ZMAX, Math.max(1, z));
    if (svZ.z < 1.02){ svZoomReset(animate); return; }
    svZ.tx = px - zc.offsetLeft - anchor.cx * svZ.z;
    svZ.ty = py - zc.offsetTop - anchor.cy * svZ.z;
    svZoomClamp();
    svZoomApply(animate);
    svZoomSharpenSoon();
  }
  function svZoomReset(animate){
    svZ.z = 1; svZ.tx = 0; svZ.ty = 0; svZ.pinch = null; svZ.pan = null;
    svZoomApply(animate);
  }
  // Once the fingers settle, redraw what's on screen sharply for this zoom.
  function svZoomSharpenSoon(){
    clearTimeout(svZ.sharpT);
    svZ.sharpT = setTimeout(() => {
      if (svZ.z <= 1.05 || !sv.doc) return;
      const density = Math.min(4, svDpr() * svZ.z);
      const pages = svSpread() ? [sv.page, sv.page + 1] : [sv.page];
      pages.forEach(n => svSharpen(n, density).catch(() => {}));
    }, 250);
  }
  el('sv-zoomreset').addEventListener('click', () => svZoomReset(true));
  (() => {
    const zc = el('sv-zoom');
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
    const swallow = (e) => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); };

    zc.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2){
        const m = mid(e.touches);
        svZ.pinch = { d0: dist(e.touches), z0: svZ.z, anchor: svZoomPoint(m.x, m.y) };
        svZ.pan = null;
        swallow(e);
      } else if (e.touches.length === 1 && svZ.z > 1.001){
        const t = e.touches[0];
        svZ.pan = { x0: t.clientX, y0: t.clientY, tx0: svZ.tx, ty0: svZ.ty, moved: false };
        swallow(e);
      }
    }, { capture: true, passive: false });
    zc.addEventListener('touchmove', (e) => {
      if (svZ.pinch && e.touches.length >= 2){
        const m = mid(e.touches);
        const r = el('sv-stage').getBoundingClientRect();
        svZoomTo(svZ.pinch.z0 * dist(e.touches) / svZ.pinch.d0, svZ.pinch.anchor, m.x - r.left, m.y - r.top, false);
        swallow(e);
      } else if (svZ.pan && e.touches.length === 1){
        const t = e.touches[0];
        svZ.tx = svZ.pan.tx0 + (t.clientX - svZ.pan.x0);
        svZ.ty = svZ.pan.ty0 + (t.clientY - svZ.pan.y0);
        if (Math.abs(t.clientX - svZ.pan.x0) + Math.abs(t.clientY - svZ.pan.y0) > 8) svZ.pan.moved = true;
        svZoomClamp();
        svZoomApply(false);
        swallow(e);
      }
    }, { capture: true, passive: false });
    zc.addEventListener('touchend', (e) => {
      const hadGesture = !!(svZ.pinch || svZ.pan);
      const tapWhileZoomed = svZ.pan && !svZ.pan.moved;
      if (e.touches.length < 2) svZ.pinch = null;
      if (e.touches.length === 0) svZ.pan = null;
      // Double-tap: zoom to 2.5x there, or back to the full page.
      if (e.touches.length === 0 && e.changedTouches.length === 1 && (!hadGesture || tapWhileZoomed)){
        const t = e.changedTouches[0], now = Date.now();
        if (now - svZ.tapT < 320 && Math.hypot(t.clientX - svZ.tapX, t.clientY - svZ.tapY) < 30){
          svZ.tapT = 0;
          if (svZ.z > 1.001) svZoomReset(true);
          else { const a = svZoomPoint(t.clientX, t.clientY); svZoomTo(2.5, a, a.px, a.py, true); }
          swallow(e);
          return;
        }
        svZ.tapT = now; svZ.tapX = t.clientX; svZ.tapY = t.clientY;
      }
      if (hadGesture) swallow(e);
    }, { capture: true, passive: false });
    // iOS Safari's own page zoom would fight this one.
    ['gesturestart', 'gesturechange'].forEach(ev =>
      zc.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));

    // Desktop: trackpad pinch / Ctrl+wheel zooms; dragging pans while zoomed.
    el('sv-stage').addEventListener('wheel', (e) => {
      if (el('sheet-viewer').hidden || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const a = svZoomPoint(e.clientX, e.clientY);
      svZoomTo(svZ.z * Math.exp(-e.deltaY * 0.01), a, a.px, a.py, false);
    }, { passive: false });
    zc.addEventListener('mousedown', (e) => {
      if (svZ.z <= 1.001 || e.button !== 0) return;
      e.stopPropagation(); e.preventDefault();
      const start = { x: e.clientX, y: e.clientY, tx: svZ.tx, ty: svZ.ty };
      const move = (ev) => {
        svZ.tx = start.tx + ev.clientX - start.x; svZ.ty = start.ty + ev.clientY - start.y;
        svZoomClamp(); svZoomApply(false);
        ev.stopPropagation();
      };
      const up = (ev) => { window.removeEventListener('mousemove', move, true); window.removeEventListener('mouseup', up, true); ev.stopPropagation(); };
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
    }, true);
    zc.addEventListener('dblclick', (e) => {
      if (svZ.z > 1.001) svZoomReset(true);
      else { const a = svZoomPoint(e.clientX, e.clientY); svZoomTo(2.5, a, a.px, a.py, true); }
    });
  })();

  el('sv-close').addEventListener('click', sheetClose);

  // ---------- Play along in the sheet viewer ----------
  // Two pickers in the viewer's header: a recording (from the Audio folders
  // and songs saved on this device) and the score's notes (from the Note
  // Player's folders and saved scores). Each starts on the file whose name
  // matches the sheet. The recording plays here, on its own; the notes open
  // through the Note Player, behind the viewer, so its mixer and rendered
  // voices apply as usual. Closing the viewer stops both.
  const svAudio = new Audio();
  svAudio.crossOrigin = 'anonymous';
  svAudio.preload = 'none';
  let svAudioKey = '', svAudioUrl = null, svNotesKey = '', svNotesOpened = false, svNotesBusy = false, svAudioBusy = false, svCancel = false, svScrub = null, svAskParts = false;
  const svOpenedTabs = new Set();   // Note Player tabs the viewer opened
  let svAudioList = [], svNotesList = [], svListsP = null, svTicker = null;
  const svStem = (name) => String(name || '').replace(/\.[^.]+$/, '');
  const svNorm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const svStat = (msg) => { el('sv-pstat').textContent = msg || ''; };
  const svPop = (msg) => showRenderFail(msg, 'note');
  // 0..1: how alike two names are (edit distance, scaled to the longer one).
  function svSimilar(a, b){
    if (a === b) return 1;
    const m = a.length, n = b.length;
    if (!m || !n) return 0;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++){
      const cur = [i];
      for (let j = 1; j <= n; j++){
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return 1 - prev[n] / Math.max(m, n);
  }

  // Every recording and score the app can reach, listed once per session.
  function svLoadLists(){
    if (svListsP) return svListsP;
    svListsP = (async () => {
      await getCloudConfig();
      const audio = [], notes = [];
      for (const f of cloudCfg.audio || []){
        try{ (await driveList(f.id, AUDIO_EXT)).forEach(x => audio.push({ group: '\u2601 ' + f.name, name: x.name, driveId: x.driveId })); }catch(err){ /* offline or no access: skip */ }
      }
      try{ (await offlineAll('songs')).forEach(r => audio.push({ group: '\uD83D\uDCE5 ' + (r.folderName || 'Saved'), name: r.name, blob: r.blob, key: r.key })); }catch(err){ /* none */ }
      for (const f of cloudCfg.notes || []){
        try{ (await driveList(f.id, LIB_EXT)).forEach(x => notes.push({ group: '\u2601 ' + f.name, name: x.name, driveId: x.driveId, source: 'drive:' + f.id })); }catch(err){ /* skip */ }
      }
      try{ (await offlineAll()).forEach(r => notes.push({ group: '\uD83D\uDCE5 ' + (r.folderName || 'Saved'), name: r.name, key: r.key, source: 'offline:' + r.folderId })); }catch(err){ /* none */ }
      return { audio, notes };
    })();
    svListsP.catch(() => { svListsP = null; });
    return svListsP;
  }
  function svFill(sel, list, placeholder, title){
    sel.innerHTML = '';
    sel.add(new Option(list.length ? placeholder : placeholder + ' (none found)', ''));
    const groups = new Map();
    list.forEach((it, i) => {
      if (!groups.has(it.group)){ const g = document.createElement('optgroup'); g.label = it.group; groups.set(it.group, g); sel.appendChild(g); }
      groups.get(it.group).appendChild(new Option(svStem(it.name), String(i)));
    });
    // Start on the file named most like the sheet -- forgiving small typos
    // ("A Chirstmas blessing") but not a different song.
    const want = svNorm(title);
    let hit = -1, best = 0;
    if (want) list.forEach((it, i) => {
      const n = svNorm(svStem(it.name));
      if (!n) return;
      const score = (n.includes(want) || want.includes(n)) ? 1 : svSimilar(n, want);
      if (score > best){ best = score; hit = i; }
    });
    sel.value = hit >= 0 && best >= 0.8 ? String(hit) : '';
  }
  async function svPlayOpen(title){
    svPaint();
    el('sv-audio').innerHTML = '<option value="">Loading\u2026</option>';
    el('sv-notes').innerHTML = '<option value="">Loading\u2026</option>';
    try{
      const lists = await svLoadLists();
      svAudioList = lists.audio; svNotesList = lists.notes;
      svFill(el('sv-audio'), svAudioList, 'Select Song', title);
      svFill(el('sv-notes'), svNotesList, 'Select Notes', title);
    }catch(err){ svStat('Couldn\u2019t list the files'); }
    clearInterval(svTicker);
    svTicker = setInterval(svPaint, 400);
  }
  function svPaint(){
    el('sv-audio-play').classList.toggle('playing', !svAudio.paused);
    el('sv-notes-play').classList.toggle('playing', !!isPlaying && svNotesOpened);
    el('sv-clef').classList.toggle('playing', !!isPlaying && svNotesOpened);
    el('sv-phones').classList.toggle('playing', !svAudio.paused && !svAudioBusy);
    // One at a time: whichever is playing greys out the other.
    const aOn = !svAudio.paused, nOn = (!!isPlaying && svNotesOpened) || svNotesBusy;
    el('sv-audio').disabled = el('sv-audio-play').disabled = nOn;
    el('sv-notes').disabled = aOn;
    el('sv-notes-play').disabled = svNotesBusy || aOn;
    el('sv-notes-play').classList.toggle('loading', svNotesBusy);
    el('sv-audio-play').classList.toggle('loading', svAudioBusy && !svAudio.paused);
    // Once it's going, the ring is the progress bar (0..1 round the button).
    const ringOf = (btn, p, on) => {
      btn.classList.toggle('prog', on);
      btn.style.setProperty('--p', on ? Math.min(1, Math.max(0, p)).toFixed(4) : '0');
    };
    const dur = svAudio.duration;
    if (!svScrub) ringOf(el('sv-audio-play'), dur > 0 && isFinite(dur) ? svAudio.currentTime / dur : 0, !!svAudioKey && !svAudioBusy);
    if (!svScrub) ringOf(el('sv-notes-play'), (parseFloat(el('progress-fill').style.width) || 0) / 100, svNotesOpened && !!svNotesKey && !svNotesBusy);
    el('sv-audio').parentElement.classList.toggle('dim', nOn);
    el('sv-notes').parentElement.classList.toggle('dim', aOn);
  }
  // OK on the "File is not available" pop-up: stop every spinner.
  function svCancelLoads(){
    svCancel = true;
    svAudio.pause(); svAudioBusy = false;
    svPaint();
  }
  function svPlayStop(){
    clearInterval(svTicker);
    svAudio.pause(); svAudioBusy = false;
    if (svNotesOpened || svOpenedTabs.size){
      // The scores the viewer opened for its notes close with it; tabs that
      // were already open stay.
      stopPlayback();
      svOpenedTabs.forEach(id => closeTab(id));
      svOpenedTabs.clear();
      if (scoreTabs.length) goHome();
      svNotesOpened = false; svNotesKey = '';
    }
    svStat('');
    svPaint();
  }

  // The ring is a progress bar once the music is going: press or drag on it to
  // jump to that point (clockwise from the top). Pressing the disc still
  // plays / pauses.
  function svRingSeek(btn, ratioOf, commit){
    let swallow = false;
    btn.addEventListener('click', (e) => { if (swallow){ swallow = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
    const at = (e) => {
      const r = btn.getBoundingClientRect(), x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      return { d: Math.hypot(x, y), r: r.width / 2, a: (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI) / (2 * Math.PI) };
    };
    btn.addEventListener('pointerdown', (e) => {
      if (!btn.classList.contains('prog') || btn.disabled) return;
      const p = at(e);
      if (p.d < p.r - 6) return;                          // the disc, not the ring
      svScrub = btn; swallow = true;
      btn.classList.add('scrub');
      btn.setPointerCapture(e.pointerId);
      btn.style.setProperty('--p', p.a.toFixed(4));
      const move = (ev) => btn.style.setProperty('--p', at(ev).a.toFixed(4));
      const up = (ev) => {
        btn.removeEventListener('pointermove', move);
        btn.removeEventListener('pointerup', up);
        btn.removeEventListener('pointercancel', up);
        btn.classList.remove('scrub');
        svScrub = null;
        commit(at(ev).a);
        svPaint();
      };
      btn.addEventListener('pointermove', move);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      e.preventDefault();
    });
  }
  svRingSeek(el('sv-audio-play'), null, (ratio) => {
    if (svAudio.duration > 0 && isFinite(svAudio.duration)) svAudio.currentTime = ratio * svAudio.duration;
  });
  svRingSeek(el('sv-notes-play'), null, (ratio) => {
    if (!totalDuration) return;
    const beat = beatFromSeconds(ratio * totalDuration, parseInt(el('tempo-slider').value, 10));
    if (isPlaying) seekAndPlay(beat); else seekToBeat(beat);
  });

  // The clef beside the notes: while they play (the flying notes) a tap stops
  // them; stopped or paused, a tap means "pick the parts again" -- either
  // way the next Play opens the What should play? pop-up.
  el('sv-clef').addEventListener('click', () => {
    if (svNotesBusy) return;
    if (isPlaying && svNotesOpened) stopPlayback();
    svAskParts = true;
    svPaint();
  });

  // The flying notes by the headphones: a tap stops the recording.
  el('sv-phones').addEventListener('click', () => {
    if (svAudio.paused) return;
    svAudio.pause();
    try{ svAudio.currentTime = 0; }catch(err){ /* not loaded */ }
    svPaint();
  });

  // The song / notes pickers open folder-first: the folders are listed, and
  // tapping one shows just its files (with a way back). The <select> keeps
  // the choice, so everything else reads it as before.
  let svMenuEl = null;
  function svMenuClose(){
    if (!svMenuEl) return;
    svMenuEl.remove(); svMenuEl = null;
    document.removeEventListener('pointerdown', svMenuOutside, true);
    document.removeEventListener('keydown', svMenuKey, true);
  }
  function svMenuOutside(e){ if (svMenuEl && !svMenuEl.contains(e.target)) svMenuClose(); }
  function svMenuKey(e){ if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); svMenuClose(); } }
  function svMenuOpen(sel, list){
    svMenuClose();
    if (sel.disabled || !list.length) return;
    const groups = [];
    list.forEach((it, i) => {
      let g = groups.find(x => x.name === it.group);
      if (!g) groups.push(g = { name: it.group, items: [] });
      g.items.push(i);
    });
    const m = svMenuEl = document.createElement('div');
    m.className = 'sv-menu';
    const r = sel.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 268)) + 'px';
    m.style.top = (r.bottom + 6) + 'px';
    m.style.minWidth = r.width + 'px';
    const cur = sel.value === '' ? -1 : +sel.value;
    const row = (cls, html, onClick) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'sv-menu-row ' + cls; b.innerHTML = html;
      b.addEventListener('click', onClick);
      m.appendChild(b); return b;
    };
    const showFolders = () => {
      m.innerHTML = '';
      groups.forEach(g => {
        row('folder' + (g.items.includes(cur) ? ' has' : ''),
          `<span class="nm">${escapeHtml(g.name)}</span><span class="ct">${g.items.length}</span><span class="go">›</span>`,
          () => showFiles(g));
      });
    };
    const showFiles = (g) => {
      m.innerHTML = '';
      row('back', `<span class="go">‹</span><span class="nm">${escapeHtml(g.name)}</span>`, showFolders);
      g.items.forEach(i => {
        row('file' + (i === cur ? ' on' : ''), `<span class="nm">${escapeHtml(svStem(list[i].name))}</span>`, () => {
          sel.value = String(i);
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          svMenuClose();
        });
      });
      m.scrollTop = 0;
    };
    if (groups.length === 1) showFiles(groups[0]); else showFolders();
    document.body.appendChild(m);
    setTimeout(() => {
      document.addEventListener('pointerdown', svMenuOutside, true);
      document.addEventListener('keydown', svMenuKey, true);
    }, 0);
  }
  [['sv-audio', () => svAudioList], ['sv-notes', () => svNotesList]].forEach(([id, listOf]) => {
    const sel = el(id);
    const wrap = document.createElement('span');
    wrap.className = 'sv-selwrap';
    sel.parentNode.insertBefore(wrap, sel);
    wrap.appendChild(sel);
    wrap.addEventListener('click', () => { if (svMenuEl) svMenuClose(); else svMenuOpen(sel, listOf()); });
    sel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown')){ e.preventDefault(); svMenuOpen(sel, listOf()); }
    });
  });
  // The viewer closing takes an open list with it.
  el('sv-close').addEventListener('click', svMenuClose);

  el('sv-audio-play').addEventListener('click', () => {
    if (!svAudio.paused){ svAudio.pause(); return svPaint(); }
    const it = svAudioList[+el('sv-audio').value];
    if (!el('sv-audio').value || !it) return svPop('Choose a song from the list');
    const key = it.driveId || it.key;
    if (svAudioKey !== key){
      if (svAudioUrl){ URL.revokeObjectURL(svAudioUrl); svAudioUrl = null; }
      svAudio.src = it.blob ? (svAudioUrl = URL.createObjectURL(it.blob)) : driveMediaUrl(it.driveId);
      svAudioKey = key;
    }
    svStat('');
    svAudioBusy = true; svPaint();     // spinner until it starts
    svAudio.play().then(() => { svAudioBusy = false; svPaint(); }, (err) => {
      svAudioBusy = false; svPaint();
      // Pausing (or picking another song) while it was still loading cancels
      // the request -- that's the listener's doing, not a failure.
      if (err && err.name === 'AbortError') return svStat('');
      console.warn('Sheet recording:', err);
      svStat('Couldn\u2019t play that recording');
    });
  });
  el('sv-audio').addEventListener('change', () => { svAudio.pause(); svAudioKey = ''; svStat(''); svPaint(); });
  // Clear the spinner the moment sound starts, not on the next tick.
  svAudio.addEventListener('playing', () => { svAudioBusy = false; svPaint(); });
  svAudio.addEventListener('ended', () => { svAudio.currentTime = 0; svPaint(); });

  // Before the notes start: a pop-up listing every voice and the piano, all
  // ticked. Whatever is ticked plays (the others are left out via Solo).
  // -> false when cancelled.
  function svChooseParts(){
    const box = el('sv-parts'), list = el('sv-parts-list'), go = el('sv-parts-go'), no = el('sv-parts-cancel');
    list.innerHTML = '';
    staffTracks.forEach(t => {
      const li = document.createElement('li');
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = true; cb.dataset.id = t.id;
      li.style.setProperty('--pc', 'var(' + t.colorVar + ')');
      lab.append(cb, document.createTextNode(' ' + t.label));
      li.appendChild(lab);
      // The part's voice, from the same list as its mixer channel. Choosing
      // one here works the mixer's own dropdown, so a render is fetched etc.
      const mix = document.querySelector(`.staff-card[data-track-id="${t.id}"] .sc-instrument`);
      if (mix && mix.options.length > 1){
        const pick = mix.cloneNode(true);
        pick.className = 'sv-parts-voice';
        pick.value = mix.value;
        pick.title = 'Voice for ' + t.label;
        pick.addEventListener('change', () => {
          mix.value = pick.value;
          mix.dispatchEvent(new Event('change', { bubbles: true }));
          setTimeout(() => { pick.value = mix.value; }, 0);   // a render that isn't there puts it back
        });
        li.appendChild(pick);
      }
      list.appendChild(li);
    });
    const sync = () => { go.disabled = !list.querySelector('input:checked'); };
    list.onchange = sync; sync();
    return new Promise(resolve => {
      const done = (ok) => {
        if (ok){
          const picked = new Set([...list.querySelectorAll('input:checked')].map(i => i.dataset.id));
          const all = picked.size === staffTracks.length;
          staffTracks.forEach(t => { t.soloed = !all && picked.has(String(t.id)); });
          applyMixState();
        }
        box.hidden = true;
        go.onclick = no.onclick = null;
        document.removeEventListener('keydown', onKey, true);
        resolve(ok);
      };
      const onKey = (e) => { if (e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); done(false); } };
      go.onclick = () => done(true);
      no.onclick = () => done(false);
      document.addEventListener('keydown', onKey, true);
      // Sits in the empty space beside the sheet, just under the player bar.
      const head = document.querySelector('#sheet-viewer .sv-head');
      box.style.setProperty('--top', (head ? head.getBoundingClientRect().bottom + 10 : 80) + 'px');
      box.hidden = false;
      go.focus();
    });
  }

  el('sv-notes-play').addEventListener('click', async () => {
    if (svNotesBusy) return;
    if (isPlaying && svNotesOpened){ pausePlayback(); return svPaint(); }
    const it = svNotesList[+el('sv-notes').value];
    if (!el('sv-notes').value || !it) return svPop('Choose a song from the list');
    try{ Tone.start(); }catch(err){ /* started again below */ }   // while the tap still counts
    const key = it.driveId || it.key;
    if (svNotesOpened && svNotesKey === key && scoreTabs.some(t => t.id === activeTabId)){
      if ((svAskParts || Tone.Transport.state !== 'paused') && !(await svChooseParts())) return svPaint();
      svAskParts = false;
      await startPlayback(); return svPaint();
    }
    svCancel = false;
    svNotesBusy = true; svPaint();
    try{
      // Open it the way the Note Player does, from its folder.
      if (libSource !== it.source){
        libSource = it.source;
        saveSourcePref('libSource', it.source);
        libFillSource();
        if (it.source.startsWith('drive:')) await libLoadDrive(it.source.slice(6));
        else await libLoadOffline(it.source.slice(8));
      }
      const item = libItems.find(x => it.driveId ? x.driveId === it.driveId : x.offlineKey === it.key);
      if (!item) throw new Error('not found');
      const gen0 = loadGeneration, want = svStem(item.name), t0 = Date.now();
      const before = new Set(scoreTabs.map(x => x.id));
      if (item.driveId) openDriveScore(item); else handleFile(item.file, item.recordings, item.offlineKey);
      // Wait for it to open (or for the tab it's already in to come forward).
      for (;;){
        await new Promise(r => setTimeout(r, 120));
        if (svCancel) throw new Error('cancelled');
        const t = scoreTabs.find(x => x.id === activeTabId);
        const idle = el('loading-overlay').style.display === 'none';
        if (t && t.name === want && idle && (loadGeneration !== gen0 || Date.now() - t0 > 800)) break;
        if (Date.now() - t0 > 90000) throw new Error('timeout');
      }
      svNotesOpened = true;
      if (!before.has(activeTabId)) svOpenedTabs.add(activeTabId);   // ours to close with the viewer
      svNotesKey = key;
      svStat('');
      if (!(await svChooseParts())) return;
      await startPlayback();
    }catch(err){
      if (err && err.message === 'cancelled') return;
      svStat(err && err.message === 'timeout' ? 'The notes took too long to load' : 'Couldn\u2019t open that score');
    }finally{
      svNotesBusy = false; svPaint();
    }
  });
  el('sv-notes').addEventListener('change', () => { if (isPlaying && svNotesOpened) pausePlayback(); svNotesKey = ''; svStat(''); svPaint(); });
  el('sv-next').addEventListener('click', (e) => { e.stopPropagation(); svTurn(1); });
  el('sv-prev').addEventListener('click', (e) => { e.stopPropagation(); svTurn(-1); });
  document.addEventListener('keydown', (e) => {
    if (el('sheet-viewer').hidden) return;
    if (e.key === 'Escape'){ e.preventDefault(); sheetClose(); }
    else if (['ArrowRight', 'PageDown', ' '].includes(e.key)){ e.preventDefault(); svTurn(1); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)){ e.preventDefault(); svTurn(-1); }
  }, true);
  // New size (rotation, window resize): rebuild the book on the same page.
  let svResizeT = null;
  window.addEventListener('resize', () => {
    if (el('sheet-viewer').hidden || !sv.doc) return;
    clearTimeout(svResizeT);
    svResizeT = setTimeout(() => { svBuild(sv.page).catch(() => {}); }, 250);
  });

  // The pickers are usable straight away ("Choose a folder…"), before
  // config.ark2 or the saved copies have been read.
  libFillSource(); audioFillSource(); sheetFillSource();

  // config.ark2 couldn't be reached at start (offline, or timed out): once
  // the connection is back, read it again and add the shared folders.
  var cloudRetrying = false;
  async function cloudConfigRetry(){
    if (cloudRetrying) return;
    cloudRetrying = true;
    try{
      _cloudCfgP = null;
      const cfg = await getCloudConfig();
      if (cfg.reachable){ libFillSource(); audioFillSource(); sheetFillSource(); }
    }finally{ cloudRetrying = false; }
  }

  // Shared folders: fill both pickers from config.ark2 and open whichever
  // source each player was last using (a shared folder by default).
  Promise.all([getCloudConfig(), offlineFolders(), offlineFolders('songs'), offlineFolders('sheets')]).then(([cfg, offs, songOffs, sheetOffs]) => {
    // Music Sheet: saved copies first, like the other two players.
    sheetOffline = sheetOffs;
    sheetSource = sheetOffs.length ? 'offline:' + sheetOffs[0].folderId : startPref('sheetSource');
    sheetFillSource();
    if (sheetSource.startsWith('drive:')) sheetLoadDrive(sheetSource.slice(6));
    else if (sheetSource.startsWith('offline:')) sheetLoadOffline(sheetSource.slice(8));
    libOffline = offs;
    audioOffline = songOffs;
    // Likewise the Audio Player opens on songs saved on this device.
    if (songOffs.length && (!audioSource || audioSource.startsWith('drive:'))) audioSource = 'offline:' + songOffs[0].folderId;
    // The Note Player always opens on the scores saved on this device when
    // there are any. Otherwise nothing is chosen -- no shared folder is
    // opened by itself -- unless a folder on this device was in use.
    if (offs.length && (!libSource || libSource.startsWith('drive:'))) libSource = 'offline:' + offs[0].folderId;
    if (!libSource) libSource = startPref('libSource');
    if (!audioSource) audioSource = startPref('audioSource');
    libFillSource();
    audioFillSource();
    if (libSource.startsWith('drive:')) libLoadDrive(libSource.slice(6));
    else if (libSource.startsWith('offline:')) libLoadOffline(libSource.slice(8));
    if (audioSource.startsWith('drive:')) audioLoadDrive(audioSource.slice(6));
    else if (audioSource.startsWith('offline:')) audioLoadOffline(audioSource.slice(8));
  });

  // Restore whatever tabs/scores were open last time, if any are saved locally.
  restoreSession();

})();
