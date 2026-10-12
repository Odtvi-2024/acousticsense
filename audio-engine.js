// Web Audio API Engine for Behringer Ultragraph Pro FBQ Clone
import { ISO_FREQUENCIES } from './presets.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.sampleRate = 48000;
    this.isInitialized = false;

    // State
    this.sourceType = 'none'; // 'file', 'mic', 'generator'
    this.eqInCh1 = true;
    this.eqInCh2 = true;
    this.fbqEnabledCh1 = true;
    this.fbqEnabledCh2 = true;
    this.rangeMode = 12; // 12 or 6 (dB)
    this.stereoLink = true;

    // Audio Nodes
    this.sourceNode = null;
    this.mediaElement = null;
    this.mediaElementSourceNode = null;
    this.micStream = null;
    this.generatorNode = null;

    this.inputSplitter = null;
    this.outputMerger = null;
    this.masterGainNode = null;

    // Channel 1 (Left) chain
    this.ch1 = {
      inputGainNode: null,
      lowCutNodes: [],   // 2 cascaded highpass for steep slope
      highCutNodes: [],  // 2 cascaded lowpass for steep slope
      eqNodes: [],       // 31 peaking filters
      analyserNode: null,
      dryGainNode: null,
      wetGainNode: null,
      levelMeter: { rms: -60, peak: -60, peakHold: -60, peakHoldTime: 0 },
      fbqEnergy: new Float32Array(31),
      fbqPeaks: new Uint8Array(31),
      currentGains: new Float32Array(31)
    };

    // Channel 2 (Right) chain
    this.ch2 = {
      inputGainNode: null,
      lowCutNodes: [],
      highCutNodes: [],
      eqNodes: [],
      analyserNode: null,
      dryGainNode: null,
      wetGainNode: null,
      levelMeter: { rms: -60, peak: -60, peakHold: -60, peakHoldTime: 0 },
      fbqEnergy: new Float32Array(31),
      fbqPeaks: new Uint8Array(31),
      currentGains: new Float32Array(31)
    };

    // Subwoofer chain
    this.sub = {
      gainNode: null,
      filterNodes: [],
      muted: false,
      frequency: 80,
      level: 0
    };

    // FFT Data Buffers
    this.fftSize = 2048;
    this.fftFreqData1 = new Float32Array(this.fftSize / 2);
    this.fftFreqData2 = new Float32Array(this.fftSize / 2);
    this.timeData1 = new Float32Array(this.fftSize);
    this.timeData2 = new Float32Array(this.fftSize);

    // Band bin boundaries for 31 ISO bands
    this.bandBins = [];
  }

  async init() {
    if (this.isInitialized) return;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass();
    this.sampleRate = this.ctx.sampleRate;

    // Calculate FFT bin boundaries for each ISO 1/3 octave band
    this.calculateBandBins();

    // Setup Master Nodes
    this.inputSplitter = this.ctx.createChannelSplitter(2);
    this.outputMerger = this.ctx.createChannelMerger(2);
    this.masterGainNode = this.ctx.createGain();
    this.masterGainNode.gain.value = 1.0;

    // Create Channel 1 (Left) chain
    this.setupChannel(this.ch1, 0);

    // Create Channel 2 (Right) chain
    this.setupChannel(this.ch2, 1);

    // Setup Subwoofer circuit (Mono sum -> Sub Filter -> Master)
    this.setupSubwoofer();

    // Connect Output Merger to Master Gain, then to Destination
    this.outputMerger.connect(this.masterGainNode);
    this.masterGainNode.connect(this.ctx.destination);

    this.isInitialized = true;
  }

  calculateBandBins() {
    const binWidth = this.sampleRate / this.fftSize;
    this.bandBins = ISO_FREQUENCIES.map(f0 => {
      // 1/3 octave band edges: f0 / 2^(1/6) to f0 * 2^(1/6)
      const fLow = f0 * 0.8908987;
      const fHigh = f0 * 1.122462;
      const binStart = Math.max(0, Math.floor(fLow / binWidth));
      const binEnd = Math.min(this.fftSize / 2 - 1, Math.ceil(fHigh / binWidth));
      return { f0, binStart, binEnd };
    });
  }

  setupChannel(ch, channelIndex) {
    // Input Gain (-12 dB to +12 dB)
    ch.inputGainNode = this.ctx.createGain();
    ch.inputGainNode.gain.value = 1.0; // 0 dB

    // Low Cut (Cascaded 18dB/octave highpass filter)
    const hp1 = this.ctx.createBiquadFilter();
    hp1.type = 'highpass';
    hp1.frequency.value = 10;
    hp1.Q.value = 0.707;

    const hp2 = this.ctx.createBiquadFilter();
    hp2.type = 'highpass';
    hp2.frequency.value = 10;
    hp2.Q.value = 0.707;
    ch.lowCutNodes = [hp1, hp2];

    // High Cut (Cascaded 18dB/octave lowpass filter)
    const lp1 = this.ctx.createBiquadFilter();
    lp1.type = 'lowpass';
    lp1.frequency.value = 30000;
    lp1.Q.value = 0.707;

    const lp2 = this.ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 30000;
    lp2.Q.value = 0.707;
    ch.highCutNodes = [lp1, lp2];

    // 31 Peaking EQ Filters (Q ~ 4.32 for 1/3-octave bandwidth)
    const qValue = 4.32;
    ch.eqNodes = ISO_FREQUENCIES.map(freq => {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = freq;
      filter.Q.value = qValue;
      filter.gain.value = 0; // 0 dB flat
      return filter;
    });

    // Wet / Dry gains for Bypass (EQ IN switch)
    ch.wetGainNode = this.ctx.createGain();
    ch.wetGainNode.gain.value = 1.0;

    ch.dryGainNode = this.ctx.createGain();
    ch.dryGainNode.gain.value = 0.0;

    // Analyser Node for metering & FBQ detection
    ch.analyserNode = this.ctx.createAnalyser();
    ch.analyserNode.fftSize = this.fftSize;
    ch.analyserNode.smoothingTimeConstant = 0.5;

    // Wiring:
    // Splitter[channelIndex] -> inputGainNode
    this.inputSplitter.connect(ch.inputGainNode, channelIndex);

    // Bypass path:
    ch.inputGainNode.connect(ch.dryGainNode);

    // Wet EQ path:
    ch.inputGainNode.connect(hp1);
    hp1.connect(hp2);
    hp2.connect(lp1);
    lp1.connect(lp2);

    let prevNode = lp2;
    ch.eqNodes.forEach(filterNode => {
      prevNode.connect(filterNode);
      prevNode = filterNode;
    });
    prevNode.connect(ch.wetGainNode);

    // Combine Wet + Dry into Channel Output -> Merger & Analyser
    const chOut = this.ctx.createGain();
    ch.wetGainNode.connect(chOut);
    ch.dryGainNode.connect(chOut);

    chOut.connect(this.outputMerger, 0, channelIndex);
    chOut.connect(ch.analyserNode);
  }

  setupSubwoofer() {
    // Subwoofer circuit takes L and R outputs, sums them, filters 30-200Hz
    this.sub.gainNode = this.ctx.createGain();
    this.sub.gainNode.gain.value = 1.0;

    const subLp1 = this.ctx.createBiquadFilter();
    subLp1.type = 'lowpass';
    subLp1.frequency.value = this.sub.frequency;
    subLp1.Q.value = 0.707;

    const subLp2 = this.ctx.createBiquadFilter();
    subLp2.type = 'lowpass';
    subLp2.frequency.value = this.sub.frequency;
    subLp2.Q.value = 0.707;

    this.sub.filterNodes = [subLp1, subLp2];

    // Connect Ch1 & Ch2 wet gains into Sub circuit
    this.ch1.wetGainNode.connect(subLp1);
    this.ch2.wetGainNode.connect(subLp1);
    subLp1.connect(subLp2);
    subLp2.connect(this.sub.gainNode);
    // Subwoofer is mixed into Master Output (L and R)
    this.sub.gainNode.connect(this.outputMerger, 0, 0);
    this.sub.gainNode.connect(this.outputMerger, 0, 1);
  }

  async resumeContext() {
    if (!this.ctx) await this.init();
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  // --- Audio Source Controls ---

  disconnectCurrentSource() {
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (e) {}
      this.sourceNode = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach(track => track.stop());
      this.micStream = null;
    }
    if (this.generatorNode) {
      try { this.generatorNode.stop(); } catch (e) {}
      try { this.generatorNode.disconnect(); } catch (e) {}
      this.generatorNode = null;
    }
    this.sourceType = 'none';
  }

  async setFileSource(audioElement) {
    await this.resumeContext();

    if (this.sourceType === 'file' && this.sourceNode && this.mediaElement === audioElement) {
      return;
    }

    this.disconnectCurrentSource();

    this.mediaElement = audioElement;
    if (!this.mediaElementSourceNode) {
      this.mediaElementSourceNode = this.ctx.createMediaElementSource(audioElement);
    }
    this.sourceNode = this.mediaElementSourceNode;
    this.sourceNode.connect(this.inputSplitter);
    this.sourceType = 'file';
  }

  async setMicSource() {
    await this.resumeContext();
    this.disconnectCurrentSource();

    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          latency: 0
        }
      });
      this.sourceNode = this.ctx.createMediaStreamSource(this.micStream);
      this.sourceNode.connect(this.inputSplitter);
      this.sourceType = 'mic';
      return true;
    } catch (err) {
      console.error('Error accessing microphone/line-in:', err);
      throw err;
    }
  }

  setGeneratorSource(type = 'pink', freq = 1000) {
    this.resumeContext();
    this.disconnectCurrentSource();

    const bufferSize = this.ctx.sampleRate * 2; // 2 seconds looping buffer
    const buffer = this.ctx.createBuffer(2, bufferSize, this.ctx.sampleRate);
    const leftData = buffer.getChannelData(0);
    const rightData = buffer.getChannelData(1);

    if (type === 'white') {
      // White noise: flat power across frequency
      for (let i = 0; i < bufferSize; i++) {
        const val = (Math.random() * 2 - 1) * 0.3;
        leftData[i] = val;
        rightData[i] = val;
      }
    } else if (type === 'pink') {
      // Paul Kellet's refined pink noise filter algorithm
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < bufferSize; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.05;
        b6 = white * 0.115926;
        leftData[i] = pink;
        rightData[i] = pink;
      }
    } else if (type === 'sine') {
      // Pure sine wave tone at specified frequency
      const omega = (2 * Math.PI * freq) / this.ctx.sampleRate;
      for (let i = 0; i < bufferSize; i++) {
        const val = Math.sin(omega * i) * 0.3;
        leftData[i] = val;
        rightData[i] = val;
      }
    } else if (type === 'sweep') {
      // Logarithmic sine sweep (20Hz to 20kHz over buffer duration)
      const fStart = 20;
      const fEnd = 20000;
      const duration = bufferSize / this.ctx.sampleRate;
      for (let i = 0; i < bufferSize; i++) {
        const t = i / this.ctx.sampleRate;
        const currentFreq = fStart * Math.pow(fEnd / fStart, t / duration);
        const phase = 2 * Math.PI * fStart * (Math.pow(fEnd / fStart, t / duration) - 1) / Math.log(fEnd / fStart);
        const val = Math.sin(phase) * 0.25;
        leftData[i] = val;
        rightData[i] = val;
      }
    }

    const bufferSource = this.ctx.createBufferSource();
    bufferSource.buffer = buffer;
    bufferSource.loop = true;
    bufferSource.connect(this.inputSplitter);
    bufferSource.start();

    this.generatorNode = bufferSource;
    this.sourceNode = bufferSource;
    this.sourceType = 'generator';
  }

  // --- Filter and Channel Controls ---

  setBandGain(channelIndex, bandIndex, gainDb) {
    if (!this.isInitialized) return;
    const clampedGain = Math.max(-this.rangeMode, Math.min(this.rangeMode, gainDb));

    const setGain = (ch) => {
      if (ch.eqNodes[bandIndex]) {
        ch.eqNodes[bandIndex].gain.setTargetAtTime(clampedGain, this.ctx.currentTime, 0.015);
        ch.currentGains[bandIndex] = clampedGain;
      }
    };

    if (this.stereoLink) {
      setGain(this.ch1);
      setGain(this.ch2);
    } else {
      if (channelIndex === 0) setGain(this.ch1);
      else setGain(this.ch2);
    }
  }

  setInputGain(channelIndex, gainDb) {
    if (!this.isInitialized) return;
    const linearGain = Math.pow(10, gainDb / 20);

    const setInput = (ch) => {
      ch.inputGainNode.gain.setTargetAtTime(linearGain, this.ctx.currentTime, 0.015);
    };

    if (this.stereoLink) {
      setInput(this.ch1);
      setInput(this.ch2);
    } else {
      if (channelIndex === 0) setInput(this.ch1);
      else setInput(this.ch2);
    }
  }

  setLowCut(channelIndex, freqHz) {
    if (!this.isInitialized) return;
    const freq = Math.max(10, Math.min(400, freqHz));

    const setLc = (ch) => {
      ch.lowCutNodes.forEach(node => {
        node.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.015);
      });
    };

    if (this.stereoLink) {
      setLc(this.ch1);
      setLc(this.ch2);
    } else {
      if (channelIndex === 0) setLc(this.ch1);
      else setLc(this.ch2);
    }
  }

  setHighCut(channelIndex, freqHz) {
    if (!this.isInitialized) return;
    const freq = Math.max(2500, Math.min(32000, freqHz));

    const setHc = (ch) => {
      ch.highCutNodes.forEach(node => {
        node.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.015);
      });
    };

    if (this.stereoLink) {
      setHc(this.ch1);
      setHc(this.ch2);
    } else {
      if (channelIndex === 0) setHc(this.ch1);
      else setHc(this.ch2);
    }
  }

  setEqIn(channelIndex, isActive) {
    if (!this.isInitialized) return;

    const setBypass = (ch, state) => {
      // Smooth crossfade between dry and wet
      const now = this.ctx.currentTime;
      ch.wetGainNode.gain.setTargetAtTime(state ? 1.0 : 0.0, now, 0.02);
      ch.dryGainNode.gain.setTargetAtTime(state ? 0.0 : 1.0, now, 0.02);
    };

    if (this.stereoLink) {
      this.eqInCh1 = isActive;
      this.eqInCh2 = isActive;
      setBypass(this.ch1, isActive);
      setBypass(this.ch2, isActive);
    } else {
      if (channelIndex === 0) {
        this.eqInCh1 = isActive;
        setBypass(this.ch1, isActive);
      } else {
        this.eqInCh2 = isActive;
        setBypass(this.ch2, isActive);
      }
    }
  }

  setRangeMode(mode) {
    this.rangeMode = mode === 6 ? 6 : 12;
    // Rescale or clamp current gains to the new range
    for (let i = 0; i < 31; i++) {
      if (this.ch1.currentGains[i] > this.rangeMode || this.ch1.currentGains[i] < -this.rangeMode) {
        this.setBandGain(0, i, this.ch1.currentGains[i]);
      }
      if (this.ch2.currentGains[i] > this.rangeMode || this.ch2.currentGains[i] < -this.rangeMode) {
        this.setBandGain(1, i, this.ch2.currentGains[i]);
      }
    }
  }

  setStereoLink(isLinked) {
    this.stereoLink = isLinked;
    if (isLinked) {
      // Mirror Ch1 to Ch2
      for (let i = 0; i < 31; i++) {
        this.setBandGain(1, i, this.ch1.currentGains[i]);
      }
    }
  }

  setSubwooferParams(freqHz, gainDb, muted) {
    if (!this.isInitialized) return;
    this.sub.frequency = Math.max(30, Math.min(200, freqHz));
    this.sub.filterNodes.forEach(node => {
      node.frequency.setTargetAtTime(this.sub.frequency, this.ctx.currentTime, 0.02);
    });

    this.sub.muted = muted;
    const targetGain = muted ? 0 : Math.pow(10, gainDb / 20);
    this.sub.gainNode.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.02);
  }

  resetAllBands(channelIndex = null) {
    if (channelIndex === null || this.stereoLink) {
      for (let i = 0; i < 31; i++) {
        this.setBandGain(0, i, 0);
        this.setBandGain(1, i, 0);
      }
    } else {
      for (let i = 0; i < 31; i++) {
        this.setBandGain(channelIndex, i, 0);
      }
    }
  }

  // --- Real-Time Analysis & FBQ Detection Loop ---

  updateMetersAndFbq() {
    if (!this.isInitialized) return;

    const now = performance.now();

    // Process Channel 1
    this.processChannelAnalysis(this.ch1, this.fftFreqData1, this.timeData1, now);

    // Process Channel 2
    this.processChannelAnalysis(this.ch2, this.fftFreqData2, this.timeData2, now);
  }

  processChannelAnalysis(ch, freqBuffer, timeBuffer, now) {
    if (!ch.analyserNode) return;

    // 1. Level Meter (RMS & Peak)
    ch.analyserNode.getFloatTimeDomainData(timeBuffer);
    let sumSquare = 0;
    let peak = 0;
    for (let i = 0; i < timeBuffer.length; i++) {
      const sample = Math.abs(timeBuffer[i]);
      if (sample > peak) peak = sample;
      sumSquare += sample * sample;
    }
    const rms = Math.sqrt(sumSquare / timeBuffer.length);
    const rmsDb = rms > 0.0001 ? 20 * Math.log10(rms) : -80;
    const peakDb = peak > 0.0001 ? 20 * Math.log10(peak) : -80;

    // Ballistics: Fast attack, smooth decay
    if (rmsDb > ch.levelMeter.rms) ch.levelMeter.rms = rmsDb;
    else ch.levelMeter.rms += (rmsDb - ch.levelMeter.rms) * 0.15;

    if (peakDb > ch.levelMeter.peak) {
      ch.levelMeter.peak = peakDb;
      ch.levelMeter.peakHold = peakDb;
      ch.levelMeter.peakHoldTime = now + 1200; // Hold peak for 1.2s
    } else {
      ch.levelMeter.peak += (peakDb - ch.levelMeter.peak) * 0.2;
      if (now > ch.levelMeter.peakHoldTime) {
        ch.levelMeter.peakHold += (peakDb - ch.levelMeter.peakHold) * 0.1;
      }
    }

    // 2. FBQ 31-Band Energy & Feedback Spike Detection
    ch.analyserNode.getFloatFrequencyData(freqBuffer);

    let maxEnergy = -120;
    let avgEnergy = 0;

    for (let b = 0; b < 31; b++) {
      const { binStart, binEnd } = this.bandBins[b];
      let bandMax = -120;
      for (let k = binStart; k <= binEnd; k++) {
        if (freqBuffer[k] > bandMax) bandMax = freqBuffer[k];
      }
      ch.fbqEnergy[b] = bandMax; // dBFS
      if (bandMax > maxEnergy) maxEnergy = bandMax;
      avgEnergy += bandMax;
    }
    avgEnergy /= 31;

    // Identify Feedback spikes:
    // A band is a feedback spike if:
    // - Its level is substantial (above -35 dBFS)
    // - It stands out at least 8 dB above surrounding bands and average
    for (let b = 0; b < 31; b++) {
      const current = ch.fbqEnergy[b];
      const prev = b > 0 ? ch.fbqEnergy[b - 1] : current;
      const next = b < 30 ? ch.fbqEnergy[b + 1] : current;
      const diffFromNeighbors = (current - prev + (current - next)) / 2;

      const isSpike = current > -35 && (current - avgEnergy > 9) && (diffFromNeighbors > 6);
      ch.fbqPeaks[b] = isSpike ? 2 : (current > -45 ? 1 : 0);
    }
  }

  // Generate Equalizer APO Configuration file content
  exportEqualizerAPO() {
    let output = `# Equalizer APO Configuration\n`;
    output += `# Generated by AcousticSense FBQ-31 Digital Equalizer\n`;
    output += `# Date: ${new Date().toISOString()}\n\n`;

    output += `# Channel 1 (Left)\n`;
    output += `Channel: L\n`;
    output += `Preamp: 0 dB\n`;
    output += `GraphicEQ: `;
    const ch1Entries = ISO_FREQUENCIES.map((f, i) => `${f} ${this.ch1.currentGains[i].toFixed(1)}`);
    output += ch1Entries.join('; ') + '\n\n';

    output += `# Channel 2 (Right)\n`;
    output += `Channel: R\n`;
    output += `Preamp: 0 dB\n`;
    output += `GraphicEQ: `;
    const ch2Entries = ISO_FREQUENCIES.map((f, i) => `${f} ${this.ch2.currentGains[i].toFixed(1)}`);
    output += ch2Entries.join('; ') + '\n';

    return output;
  }
}
