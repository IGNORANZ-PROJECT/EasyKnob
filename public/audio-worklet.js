class EasyKnobProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleRate = sampleRate;
    this.params = { mic: 0.5, echo: 0.22, reverb: 0.26, room: 0.58, wet: 0.7, tone: 0.5, air: 0.18, stable: 0.3, double: 0, quality: 'maximum' };
    this.enabled = { mic: true, echo: true, reverb: true, room: true, wet: true, tone: true, air: true, stable: true, double: true };
    this.delayBuffer = new Float32Array(Math.ceil(this.sampleRate * 1.4));
    this.doubleBuffer = new Float32Array(Math.ceil(this.sampleRate * 0.08));
    this.revPreBuffer = new Float32Array(Math.ceil(this.sampleRate * 0.18));
    this.revCombL = this.createDelayBank([0.0297, 0.0371, 0.0411, 0.0437, 0.0531, 0.0617]);
    this.revCombR = this.createDelayBank([0.0311, 0.0399, 0.0451, 0.0497, 0.0571, 0.0673]);
    this.revAllpassL = this.createDelayBank([0.0057, 0.0019]);
    this.revAllpassR = this.createDelayBank([0.0063, 0.0023]);
    this.delayIndex = 0;
    this.doubleIndex = 0;
    this.revPreIndex = 0;
    this.env = 0;
    this.lowL = 0;
    this.lowR = 0;
    this.highL = 0;
    this.highR = 0;
    this.noiseFloor = 0.005;
    this.noiseGateGain = 1;
    this.feedbackGuardGain = 1;
    this.feedbackRisk = 0;
    this.echoLow = 0;
    this.revSideBlur = 0;
    this.revEarlySideBlur = 0;
    this.airLowL = 0;
    this.airLowR = 0;
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
  createDelayBank(times) {
    return times.map((seconds) => ({
      buffer: new Float32Array(Math.max(8, Math.floor(this.sampleRate * seconds))),
      index: 0,
      damp: 0
    }));
  }
  clearDelayBank(bank) {
    for (const line of bank) {
      line.buffer.fill(0);
      line.index = 0;
      line.damp = 0;
    }
  }
  readCircular(buffer, writeIndex, offset) {
    return buffer[(writeIndex - offset + buffer.length) % buffer.length];
  }
  processComb(line, input, feedback, dampCoeff) {
    const delayed = line.buffer[line.index];
    line.damp += (delayed - line.damp) * dampCoeff;
    line.buffer[line.index] = input + line.damp * feedback;
    line.index = (line.index + 1) % line.buffer.length;
    return line.damp;
  }
  processAllpass(line, input, feedback) {
    const delayed = line.buffer[line.index];
    const output = delayed - input * feedback;
    line.buffer[line.index] = input + delayed * feedback;
    line.index = (line.index + 1) % line.buffer.length;
    return output;
  }
  softLimit(x) {
    const ax = Math.abs(x);
    if (ax <= 0.88) return x;
    const sign = x < 0 ? -1 : 1;
    const knee = 0.88 + Math.tanh((ax - 0.88) * 4.2) * 0.105;
    return sign * this.clamp(knee, 0, 0.985);
  }
  now() { return globalThis.performance && typeof globalThis.performance.now === 'function' ? globalThis.performance.now() : 0; }
  clearEffectState() {
    this.delayBuffer.fill(0);
    this.doubleBuffer.fill(0);
    this.revPreBuffer.fill(0);
    this.clearDelayBank(this.revCombL);
    this.clearDelayBank(this.revCombR);
    this.clearDelayBank(this.revAllpassL);
    this.clearDelayBank(this.revAllpassR);
    this.delayIndex = 0;
    this.doubleIndex = 0;
    this.revPreIndex = 0;
    this.env = 0;
    this.lowL = 0;
    this.lowR = 0;
    this.highL = 0;
    this.highR = 0;
    this.noiseFloor = 0.005;
    this.noiseGateGain = 1;
    this.feedbackGuardGain = 1;
    this.feedbackRisk = 0;
    this.echoLow = 0;
    this.revSideBlur = 0;
    this.revEarlySideBlur = 0;
    this.airLowL = 0;
    this.airLowR = 0;
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

  qualityReverbCount() {
    const q = this.params.quality;
    if (q === 'light') return 3;
    if (q === 'balanced') return 4;
    if (q === 'high') return 5;
    return 6;
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

    const mic = this.clamp(this.params.mic, 0, 1);
    const echo = this.enabled.echo ? this.params.echo : 0;
    const reverb = this.enabled.reverb ? this.params.reverb : 0;
    const room = this.enabled.room ? this.params.room : 0.58;
    const wet = this.enabled.wet ? this.params.wet : 1;
    const tone = this.params.tone;
    const air = this.enabled.air ? this.params.air : 0;
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
    const feedback = 0.05 + echo * 0.3;
    const wetEcho = echo * wet * 0.62;
    const wetRev = reverb * wet * (0.52 + room * 0.2);
    const reverbCount = this.qualityReverbCount();
    const revFeedback = this.clamp(0.58 + room * 0.16 + reverb * 0.14, 0.55, 0.88);
    const revDamp = this.clamp(0.18 + air * 0.44 + (1 - room) * 0.08, 0.12, 0.72);
    const preDelaySamples = Math.floor(this.sampleRate * (0.007 + room * 0.034));
    const earlySize = 0.72 + room * 1.35;
    const echoLowCoeff = 1 - Math.exp(-2 * Math.PI * 100 / this.sampleRate);
    const toneTilt = (tone - 0.5) * 2;
    const toneCutoff = 0.065 + Math.abs(toneTilt) * 0.055;
    const airCoeff = 1 - Math.exp(-2 * Math.PI * (5200 + air * 2600) / this.sampleRate);
    const compAmount = stable;
    const doubleBase = Math.floor(this.sampleRate * (0.014 + dbl * 0.022));
    const toneOn = this.enabled.tone;
    const stableOn = this.enabled.stable && stable > 0.001;
    const echoOn = this.enabled.echo && echo > 0.001;
    const reverbOn = this.enabled.reverb && reverb > 0.001;
    const airOn = this.enabled.air && air > 0.001;
    const doubleOn = this.enabled.double && dbl > 0.001;

    let peak = 0;
    let clip = 0;
    for (let i = 0; i < outL.length; i++) {
      let l = inL[i] * micGain;
      let r = inR[i] * micGain;
      const mono = (l + r) * 0.5;

      if (toneOn) {
        this.lowL += toneCutoff * (l - this.lowL);
        this.lowR += toneCutoff * (r - this.lowR);
        const brightL = l - this.lowL;
        const brightR = r - this.lowR;
        if (toneTilt >= 0) {
          l += brightL * toneTilt * 0.36;
          r += brightR * toneTilt * 0.36;
        } else {
          l += (this.lowL - l) * -toneTilt * 0.52;
          r += (this.lowR - r) * -toneTilt * 0.52;
        }
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

      const fxMono = (l + r) * 0.5;
      if (echoOn) {
        const dRead = (this.delayIndex - delaySamples + this.delayBuffer.length) % this.delayBuffer.length;
        const d = this.delayBuffer[dRead];
        const echoInput = fxMono + d * feedback;
        this.echoLow += (echoInput - this.echoLow) * echoLowCoeff;
        this.delayBuffer[this.delayIndex] = echoInput - this.echoLow;
        this.delayIndex = (this.delayIndex + 1) % this.delayBuffer.length;
        l += d * wetEcho;
        r += d * wetEcho;
      } else {
        this.echoLow += (fxMono - this.echoLow) * echoLowCoeff;
        this.delayBuffer[this.delayIndex] = fxMono - this.echoLow;
        this.delayIndex = (this.delayIndex + 1) % this.delayBuffer.length;
      }

      this.revPreBuffer[this.revPreIndex] = fxMono;
      if (reverbOn) {
        const pre = this.readCircular(this.revPreBuffer, this.revPreIndex, preDelaySamples);
        const er1 = this.readCircular(this.revPreBuffer, this.revPreIndex, Math.floor(this.sampleRate * 0.011 * earlySize));
        const er2 = this.readCircular(this.revPreBuffer, this.revPreIndex, Math.floor(this.sampleRate * 0.017 * earlySize));
        const er3 = this.readCircular(this.revPreBuffer, this.revPreIndex, Math.floor(this.sampleRate * 0.026 * earlySize));
        const er4 = this.readCircular(this.revPreBuffer, this.revPreIndex, Math.floor(this.sampleRate * 0.039 * earlySize));
        const earlyCenter = er1 * 0.34 + er2 * 0.27 + er3 * 0.21 + er4 * 0.16;
        const earlySideRaw = (er1 - er2 + er3 * 0.7 - er4 * 0.55) * (0.12 + room * 0.22);
        this.revEarlySideBlur += (earlySideRaw - this.revEarlySideBlur) * (0.045 - room * 0.018);

        let tailL = 0;
        let tailR = 0;
        const tailInput = pre + earlyCenter * 0.28;
        for (let c = 0; c < reverbCount; c++) {
          const signL = c % 2 === 0 ? 1 : -0.86;
          const signR = c % 2 === 0 ? -0.82 : 1;
          tailL += this.processComb(this.revCombL[c], tailInput * signL, revFeedback, revDamp);
          tailR += this.processComb(this.revCombR[c], tailInput * signR, revFeedback * 0.997, revDamp);
        }
        tailL /= reverbCount;
        tailR /= reverbCount;
        tailL = this.processAllpass(this.revAllpassL[0], tailL, 0.58);
        tailR = this.processAllpass(this.revAllpassR[0], tailR, 0.58);
        if (reverbCount > 3) {
          tailL = this.processAllpass(this.revAllpassL[1], tailL, 0.46);
          tailR = this.processAllpass(this.revAllpassR[1], tailR, 0.46);
        }

        const tailCenter = (tailL + tailR) * 0.5;
        const tailSideRaw = (tailL - tailR) * 0.5;
        const blurSpeed = 0.008 + (1 - room) * 0.014;
        this.revSideBlur += (tailSideRaw - this.revSideBlur) * blurSpeed;
        const blurredSide = this.revSideBlur * 0.82 + tailSideRaw * 0.18;
        const side = (this.revEarlySideBlur * 0.36 + blurredSide) * (0.12 + room * 0.28);
        const center = earlyCenter * 0.32 + tailCenter * 0.96;
        l += (center + side) * wetRev;
        r += (center - side) * wetRev;
      } else {
        this.revSideBlur += (0 - this.revSideBlur) * 0.02;
        this.revEarlySideBlur += (0 - this.revEarlySideBlur) * 0.04;
      }
      this.revPreIndex = (this.revPreIndex + 1) % this.revPreBuffer.length;

      this.lfo += 2 * Math.PI * 0.22 / this.sampleRate;
      if (this.lfo > Math.PI * 2) this.lfo -= Math.PI * 2;
      if (doubleOn) {
        const mod = Math.floor(Math.sin(this.lfo) * this.sampleRate * 0.003);
        const dbRead = (this.doubleIndex - this.clamp(doubleBase + mod, 1, this.doubleBuffer.length - 1) + this.doubleBuffer.length) % this.doubleBuffer.length;
        const db = this.doubleBuffer[dbRead];
        this.doubleBuffer[this.doubleIndex] = fxMono;
        this.doubleIndex = (this.doubleIndex + 1) % this.doubleBuffer.length;
        l += db * dbl * wet * 0.24;
        r += db * dbl * wet * 0.18;
      } else {
        this.doubleBuffer[this.doubleIndex] = fxMono;
        this.doubleIndex = (this.doubleIndex + 1) % this.doubleBuffer.length;
      }

      if (airOn) {
        this.airLowL += (l - this.airLowL) * airCoeff;
        this.airLowR += (r - this.airLowR) * airCoeff;
        l += (l - this.airLowL) * air * 0.22;
        r += (r - this.airLowR) * air * 0.22;
      } else {
        this.airLowL += (l - this.airLowL) * 0.05;
        this.airLowR += (r - this.airLowR) * 0.05;
      }

      const preGuardPeak = Math.max(Math.abs(l), Math.abs(r));
      clip = Math.max(clip, preGuardPeak);
      this.feedbackRisk = Math.max(preGuardPeak, this.feedbackRisk * 0.9985);
      let guardTarget = 1;
      if (this.feedbackRisk > 1.16 || preGuardPeak > 1.16) guardTarget = 0.44;
      else if (this.feedbackRisk > 0.98 && preGuardPeak > 0.82) guardTarget = 0.68;
      else if (this.feedbackRisk > 0.88 && preGuardPeak > 0.74) guardTarget = 0.84;
      const guardSpeed = guardTarget < this.feedbackGuardGain ? 0.075 : 0.0018;
      this.feedbackGuardGain += (guardTarget - this.feedbackGuardGain) * guardSpeed;
      l *= this.feedbackGuardGain;
      r *= this.feedbackGuardGain;
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
