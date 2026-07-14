/**
 * AudioReceiver - Web Audio API FFT analysis module
 *
 * Analyzes audio from an HTMLAudioElement and outputs frequency band data
 * to drive a particle visualizer for an immersive AI music player.
 *
 * Usage:
 *   var receiver = new AudioReceiver(audioElement);
 *   // After a user gesture (click):
 *   receiver.init();
 *   receiver.resume();
 *   // Each animation frame:
 *   var data = receiver.analyze(); // { bass, mid, treble, beat, energy, centroid }
 */
(function () {
  'use strict';

  // ---- Constants ----
  var FFT_SIZE = 2048;            // FFT size -> 1024 frequency bins
  var SMOOTHING = 0.8;            // analyser.smoothingTimeConstant
  var BEAT_HISTORY_SIZE = 43;     // ~0.7s of frames at 60fps
  var BEAT_THRESHOLD = 1.3;       // current bass must exceed 1.3x history average
  var BEAT_DECAY = 0.95;          // exponential decay of beat value per frame
  var BEAT_MIN_ENERGY = 0.08;     // ignore beats when bass is near-silent
  var CENTROID_NORM = 8000;       // Hz ceiling for normalizing centroid (reference)

  // Frequency band boundaries (Hz)
  var BASS_MAX_HZ = 250;
  var MID_MAX_HZ = 4000;
  var TREBLE_MAX_HZ = 16000;

  /**
   * Construct an AudioReceiver wrapping an HTMLAudioElement.
   * The AudioContext is NOT created here (autoplay policy requires a user
   * gesture); call .init() after a click/keydown.
   *
   * @param {HTMLAudioElement} audioElement
   */
  function AudioReceiver(audioElement) {
    this.audioElement = audioElement;

    // Lazy-initialized in .init()
    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.sampleRate = 44100; // updated to real rate in init()

    // Pre-allocated data buffers (created in init)
    this.freqData = null; // Uint8Array, length = frequencyBinCount (1024)
    this.timeData = null; // Uint8Array, length = fftSize (2048)

    // Frequency band bin indices (computed in init from sampleRate)
    this.bassEnd = 0;
    this.midEnd = 0;
    this.trebleEnd = 0;

    // Beat detection state
    this.beatHistory = []; // rolling bass energy history (last BEAT_HISTORY_SIZE frames)
    this.beat = 0;         // current beat value 0-1

    this._initialized = false;
  }

  /**
   * Initialize the AudioContext, AnalyserNode, and audio graph.
   * Must be called from a user-gesture handler (click/keydown) so the
   * AudioContext starts in a running state.
   *
   * @returns {AudioReceiver} this (chainable)
   */
  AudioReceiver.prototype.init = function () {
    if (this._initialized) return this;

    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioCtx();
    this.sampleRate = this.audioContext.sampleRate;

    // Create + configure analyser
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;                 // 1024 frequency bins
    this.analyser.smoothingTimeConstant = SMOOTHING;  // temporal smoothing
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -10;

    // Connect audio graph: audioElement -> source -> analyser -> destination
    this.source = this.audioContext.createMediaElementSource(this.audioElement);
    this.source.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination); // keep audio audible

    // Allocate data buffers
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount); // 1024
    this.timeData = new Uint8Array(this.analyser.fftSize);           // 2048

    // Compute band bin boundaries: binIndex = Hz * fftSize / sampleRate
    this.bassEnd = Math.floor(BASS_MAX_HZ * FFT_SIZE / this.sampleRate);
    this.midEnd = Math.floor(MID_MAX_HZ * FFT_SIZE / this.sampleRate);
    this.trebleEnd = Math.floor(TREBLE_MAX_HZ * FFT_SIZE / this.sampleRate);

    this._initialized = true;
    return this;
  };

  /**
   * Average energy of a frequency bin range, normalized to 0-1.
   * Byte frequency data is 0-255, so divide by 255.
   */
  AudioReceiver.prototype._bandAverage = function (start, end) {
    if (end <= start) return 0;
    var sum = 0;
    for (var i = start; i < end; i++) {
      sum += this.freqData[i];
    }
    return (sum / (end - start)) / 255;
  };

  /**
   * Spectral centroid (brightness measure) in Hz.
   *   centroid = sum(freq[i] * magnitude[i]) / sum(magnitude[i])
   * Returned in Hz. Divide by ~8000 (CENTROID_NORM) if a 0-1 value is needed.
   */
  AudioReceiver.prototype._computeCentroidHz = function () {
    var sumMag = 0;
    var sumWeighted = 0;
    var binHz = this.sampleRate / FFT_SIZE; // Hz per bin
    var n = this.freqData.length;
    for (var i = 0; i < n; i++) {
      var mag = this.freqData[i];
      sumMag += mag;
      sumWeighted += (i * binHz) * mag;
    }
    if (sumMag === 0) return 0;
    return sumWeighted / sumMag;
  };

  /**
   * RMS energy from time-domain data, normalized to 0-1.
   * Byte time data is 0-255 centered at 128.
   */
  AudioReceiver.prototype._computeEnergy = function () {
    var sum = 0;
    var n = this.timeData.length;
    for (var i = 0; i < n; i++) {
      var v = (this.timeData[i] - 128) / 128; // normalize sample to -1..1
      sum += v * v;
    }
    var rms = Math.sqrt(sum / n);
    return rms < 1 ? rms : 1; // clamp to 0-1
  };

  /**
   * Energy-based beat detection on bass energy.
   * Keeps a rolling history (last ~43 frames). If current bass energy
   * exceeds 1.3x the history average (and is above the silence floor),
   * a beat is registered (spikes to 1). Otherwise the beat value decays
   * exponentially (0.95 per frame).
   */
  AudioReceiver.prototype._detectBeat = function (bass) {
    // Update rolling history
    this.beatHistory.push(bass);
    if (this.beatHistory.length > BEAT_HISTORY_SIZE) {
      this.beatHistory.shift();
    }

    // Need a full history window for a stable average
    if (this.beatHistory.length < BEAT_HISTORY_SIZE) {
      this.beat *= BEAT_DECAY;
      return;
    }

    // Average of history
    var avg = 0;
    for (var i = 0; i < this.beatHistory.length; i++) {
      avg += this.beatHistory[i];
    }
    avg /= this.beatHistory.length;

    // Beat condition: transient above threshold * average, above silence floor
    if (bass > BEAT_MIN_ENERGY && bass > BEAT_THRESHOLD * avg) {
      this.beat = 1;
    } else {
      this.beat *= BEAT_DECAY;
    }
  };

  /**
   * Analyze the current audio frame. Call once per animation frame.
   *
   * @returns {Object} { bass, mid, treble, beat, energy, centroid }
   *   bass/mid/treble/beat/energy: 0-1
   *   centroid: spectral centroid in Hz (brightness measure)
   */
  AudioReceiver.prototype.analyze = function () {
    var result = { bass: 0, mid: 0, treble: 0, beat: 0, energy: 0, centroid: 0 };

    if (!this._initialized || !this.analyser) {
      return result;
    }

    // Pull fresh data from the analyser
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getByteTimeDomainData(this.timeData);

    // Frequency band averages (0-1)
    result.bass = this._bandAverage(0, this.bassEnd);
    result.mid = this._bandAverage(this.bassEnd, this.midEnd);
    result.treble = this._bandAverage(this.midEnd, this.trebleEnd);

    // Overall RMS energy from time domain (0-1)
    result.energy = this._computeEnergy();

    // Spectral centroid in Hz
    result.centroid = this._computeCentroidHz();

    // Beat detection (driven by bass energy), updates this.beat
    this._detectBeat(result.bass);
    result.beat = this.beat;

    return result;
  };

  /**
   * Resume the AudioContext (required after autoplay-policy suspension).
   * Returns a Promise that resolves when the context is running.
   */
  AudioReceiver.prototype.resume = function () {
    if (this.audioContext && this.audioContext.state === 'suspended') {
      return this.audioContext.resume();
    }
    return Promise.resolve();
  };

  /**
   * Return the raw AnalyserNode for external audio-graph integration
   * (e.g. P3 spatial audio chain).
   */
  AudioReceiver.prototype.getAnalyser = function () {
    return this.analyser;
  };

  /**
   * Return the raw byte frequency data (Uint8Array, length = frequencyBinCount).
   * Refreshes the buffer from the analyser before returning.
   */
  AudioReceiver.prototype.getFrequencyData = function () {
    if (this.analyser && this.freqData) {
      this.analyser.getByteFrequencyData(this.freqData);
    }
    return this.freqData;
  };

  /**
   * Return the raw byte time-domain data (Uint8Array, length = fftSize).
   * Refreshes the buffer from the analyser before returning.
   */
  AudioReceiver.prototype.getTimeData = function () {
    if (this.analyser && this.timeData) {
      this.analyser.getByteTimeDomainData(this.timeData);
    }
    return this.timeData;
  };

  // Expose globally (plain JS, no ES modules)
  window.AudioReceiver = AudioReceiver;
})();
