class EasyKnobProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleRate = sampleRate;
    this.params = { mic: 0.5, echo: 0.25, reverb: 0.2, tone: 0.5, stable: 0.3, double: 0, quality: 'maximum' };
    this.enabled = { mic: true, echo: true, reverb: true, tone: true, stable: true, double: true };
    this.delayBuffer = new Float32Array(Math.ceil(this.sampleRate * 1.4));
    this.reverbBuffer = new Float32Array(Math.ceil(this.sampleRate * 1.2));
    this.doubleBuffer = new Float32Array(Math.ceil(this.sampleRate * 0.08));
    this.delayIndex = 0;
    this.reverbIndex = 0;
    this.doubleIndex = 0;
    this.env = 0;
    this.lowL = 0;
    this.lowR = 0;
    this.highL = 0;
    this.highR = 0;
    this.noiseFloor = 0.005;
    this.noiseGateGain = 1;
    this.lfo = 0;
    this.frameCount = 0;
    this.processorLoad = 0;
    this.micMuted = false;
    this.port.onmessage = (event) => {
      if (event.data.type === 'params') this.params = { ...this.params, ...event.data.params };
      if (event.data.type === 'enabled') this.enabled = { ...this.enabled, ...event.data.enabled };
      if (event.data.type === 'visible') this.enabled = { ...this.enabled, ...event.data.visible };
    };
  }

  clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  softLimit(x) { return this.clamp(Math.tanh(x * 1.15) / Math.tanh(1.15), -0.985, 0.985); }
  now() { return globalThis.performance && typeof globalThis.performance.now === 'function' ? globalThis.performance.now() : 0; }
  clearEffectState() {
    this.delayBuffer.fill(0);
    this.reverbBuffer.fill(0);
    this.doubleBuffer.fill(0);
    this.env = 0;
    this.lowL = 0;
    this.lowR = 0;
    this.highL = 0;
    this.highR = 0;
    this.noiseFloor = 0.005;
    this.noiseGateGain = 1;
  }
  publishStats(startedAt, frameLength, peak, clip = 0) {
    const endedAt = this.now();
    const bufferMs = frameLength / this.sampleRate * 1000;
    if (startedAt && endedAt) {
      const instantLoad = Math.max(0, Math.min(1.5, (endedAt - startedAt) / Math.max(0.001, bufferMs)));
      this.processorLoad = this.processorLoad * 0.88 + instantLoad * 0.12;
    }
    this.frameCount++;
    if (this.frameCount % 6 === 0) {
      this.port.postMessage({ type: 'stats', peak, clip, load: this.processorLoad, bufferMs });
    }
  }

  qualityTaps() {
    const q = this.params.quality;
    if (q === 'light') return [0.047, 0.083, 0.131];
    if (q === 'balanced') return [0.041, 0.073, 0.113, 0.177];
    if (q === 'high') return [0.029, 0.043, 0.071, 0.109, 0.173, 0.263];
    return [0.023, 0.037, 0.061, 0.097, 0.149, 0.211, 0.293, 0.389];
  }

  process(inputs, outputs) {
    const startedAt = this.now();
    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const outL = output[0];
    const outR = output[1] || output[0];
    if (!input || input.length === 0) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      this.publishStats(startedAt, outL.length, 0);
      return true;
    }
    const inL = input[0];
    const inR = input[1] || input[0];
    const taps = this.qualityTaps();

    const mic = this.clamp(this.params.mic, 0, 1);
    const echo = this.enabled.echo ? this.params.echo : 0;
    const reverb = this.enabled.reverb ? this.params.reverb : 0;
    const tone = this.params.tone;
    const stable = this.enabled.stable ? this.params.stable : 0;
    const dbl = this.enabled.double ? this.params.double : 0;

    if (this.enabled.mic && mic <= 0.0001) {
      outL.fill(0);
      if (outR !== outL) outR.fill(0);
      if (!this.micMuted) this.clearEffectState();
      this.micMuted = true;
      this.publishStats(startedAt, outL.length, 0);
      return true;
    }

    this.micMuted = false;
    const micGain = this.enabled.mic ? mic * 2 : 1;
    const delaySamples = Math.floor(this.sampleRate * (0.115 + echo * 0.38));
    const feedback = 0.08 + echo * 0.42;
    const wetEcho = echo * 0.55;
    const wetRev = reverb * 0.42;
    const toneLow = 0.055 + (1 - tone) * 0.11;
    const toneHigh = 0.015 + tone * 0.12;
    const compAmount = stable;
    const doubleBase = Math.floor(this.sampleRate * (0.014 + dbl * 0.022));
    const toneOn = this.enabled.tone;
    const stableOn = this.enabled.stable && stable > 0.001;
    const echoOn = this.enabled.echo && echo > 0.001;
    const reverbOn = this.enabled.reverb && reverb > 0.001;
    const doubleOn = this.enabled.double && dbl > 0.001;

    let peak = 0;
    let clip = 0;
    for (let i = 0; i < outL.length; i++) {
      let l = inL[i] * micGain;
      let r = inR[i] * micGain;
      const mono = (l + r) * 0.5;

      if (toneOn) {
        this.lowL += toneLow * (l - this.lowL);
        this.lowR += toneLow * (r - this.lowR);
        const hpL = l - this.highL; this.highL += toneHigh * hpL;
        const hpR = r - this.highR; this.highR += toneHigh * hpR;
        l = this.lowL * (1 - tone) + l * 0.7 + hpL * tone * 0.9;
        r = this.lowR * (1 - tone) + r * 0.7 + hpR * tone * 0.9;
      } else {
        this.lowL = l;
        this.lowR = r;
        this.highL = l;
        this.highR = r;
      }

      if (stableOn) {
        const level = Math.abs((l + r) * 0.5);
        const floorTarget = this.clamp(level * 0.72, 0.0028, 0.018);
        const floorSpeed = level < this.noiseFloor * 2.4 ? 0.0007 : 0.00004;
        this.noiseFloor += (floorTarget - this.noiseFloor) * floorSpeed;
        const noiseFloor = this.clamp(this.noiseFloor + compAmount * 0.004, 0.004, 0.022);
        const noiseKnee = noiseFloor * (2.4 + compAmount * 1.2);
        const noiseDepth = 0.16 + compAmount * 0.42;
        let targetGate = 1;
        if (level < noiseKnee) {
          const openness = this.clamp((level - noiseFloor) / Math.max(0.0001, noiseKnee - noiseFloor), 0, 1);
          const smoothOpen = openness * openness * (3 - 2 * openness);
          targetGate = 1 - noiseDepth * (1 - smoothOpen);
        }
        const gateSpeed = targetGate > this.noiseGateGain ? 0.24 : 0.006 + compAmount * 0.006;
        this.noiseGateGain += (targetGate - this.noiseGateGain) * gateSpeed;
        l *= this.noiseGateGain;
        r *= this.noiseGateGain;

        const stableLevel = level * this.noiseGateGain;
        this.env = Math.max(stableLevel, this.env * (0.994 - compAmount * 0.012));
        const threshold = 0.22 - compAmount * 0.12;
        let gain = 1;
        if (this.env > threshold) {
          const over = this.env / Math.max(0.001, threshold);
          gain = 1 / (1 + (over - 1) * (0.35 + compAmount * 1.2));
        }
        const makeup = 1 + compAmount * 0.28;
        l *= gain * makeup;
        r *= gain * makeup;
      } else {
        this.noiseGateGain += (1 - this.noiseGateGain) * 0.05;
        this.env = Math.max(Math.abs(mono), this.env * 0.98);
      }

      if (echoOn) {
        const dRead = (this.delayIndex - delaySamples + this.delayBuffer.length) % this.delayBuffer.length;
        const d = this.delayBuffer[dRead];
        this.delayBuffer[this.delayIndex] = mono + d * feedback;
        this.delayIndex = (this.delayIndex + 1) % this.delayBuffer.length;
        l += d * wetEcho;
        r += d * wetEcho;
      } else {
        this.delayBuffer[this.delayIndex] = mono;
        this.delayIndex = (this.delayIndex + 1) % this.delayBuffer.length;
      }

      if (reverbOn) {
        this.reverbBuffer[this.reverbIndex] = mono + this.reverbBuffer[(this.reverbIndex - 997 + this.reverbBuffer.length) % this.reverbBuffer.length] * (0.18 + reverb * 0.24);
        let rvL = 0, rvR = 0;
        for (let t = 0; t < taps.length; t++) {
          const offset = Math.floor(this.sampleRate * taps[t] * (1 + reverb * 0.55));
          const idx = (this.reverbIndex - offset + this.reverbBuffer.length) % this.reverbBuffer.length;
          const val = this.reverbBuffer[idx] * (1 / (t + 1));
          if (t % 2 === 0) rvL += val; else rvR += val;
        }
        this.reverbIndex = (this.reverbIndex + 1) % this.reverbBuffer.length;
        l += rvL * wetRev;
        r += rvR * wetRev;
      } else {
        this.reverbBuffer[this.reverbIndex] = mono;
        this.reverbIndex = (this.reverbIndex + 1) % this.reverbBuffer.length;
      }

      this.lfo += 2 * Math.PI * 0.22 / this.sampleRate;
      if (this.lfo > Math.PI * 2) this.lfo -= Math.PI * 2;
      if (doubleOn) {
        const mod = Math.floor(Math.sin(this.lfo) * this.sampleRate * 0.003);
        const dbRead = (this.doubleIndex - this.clamp(doubleBase + mod, 1, this.doubleBuffer.length - 1) + this.doubleBuffer.length) % this.doubleBuffer.length;
        const db = this.doubleBuffer[dbRead];
        this.doubleBuffer[this.doubleIndex] = mono;
        this.doubleIndex = (this.doubleIndex + 1) % this.doubleBuffer.length;
        l += db * dbl * 0.24;
        r += db * dbl * 0.18;
      } else {
        this.doubleBuffer[this.doubleIndex] = mono;
        this.doubleIndex = (this.doubleIndex + 1) % this.doubleBuffer.length;
      }

      clip = Math.max(clip, Math.abs(l), Math.abs(r));
      l = this.softLimit(l);
      r = this.softLimit(r);
      outL[i] = l;
      outR[i] = r;
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
    }

    this.publishStats(startedAt, outL.length, peak, clip);
    return true;
  }
}

registerProcessor('easyknob-processor', EasyKnobProcessor);
