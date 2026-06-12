class EasyKnobProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sampleRate = sampleRate;
    this.params = { mic: 0.5, echo: 0.22, reverb: 0.26, room: 0.58, wet: 0.7, tone: 0.5, air: 0.18, stable: 0.3, double: 0, quality: 'maximum' };
    this.enabled = { mic: true, echo: true, reverb: true, room: true, wet: true, tone: true, air: true, stable: true, double: true };
    this.reverbDetail = { selectedBandId: 'band-1', bands: [{ id: 'band-1', freq: 2200, gain: 3, q: 0.85 }] };
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
    this.stableGain = 1;
    this.stableHighEnv = 0;
    this.stableLowL = 0;
    this.stableLowR = 0;
    this.feedbackGuardGain = 1;
    this.feedbackRisk = 0;
    this.howlGuardGain = 1;
    this.howlRisk = 0;
    this.echoLow = 0;
    this.echoTone = 0;
    this.echoDuckEnv = 0;
    this.revSideBlur = 0;
    this.revEarlySideBlur = 0;
    this.revEqL1 = 0;
    this.revEqL2 = 0;
    this.revEqR1 = 0;
    this.revEqR2 = 0;
    this.revEqInL1 = 0;
    this.revEqInL2 = 0;
    this.revEqInR1 = 0;
    this.revEqInR2 = 0;
    this.revEqState = this.createReverbEqStates(4);
    this.airLowL = 0;
    this.airLowR = 0;
    this.lfo = 0;
    this.frameCount = 0;
    this.processorLoad = 0;
    this.micMuted = false;
    this.port.onmessage = (event) => {
      if (event.data.type === 'params') this.params = { ...this.params, ...event.data.params };
      if (event.data.type === 'reverbDetail') this.reverbDetail = this.sanitizeReverbDetail(event.data.reverbDetail);
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
  createReverbEqStates(count) {
    return Array.from({ length: count }, () => ({
      l1: 0,
      l2: 0,
      r1: 0,
      r2: 0,
      inL1: 0,
      inL2: 0,
      inR1: 0,
      inR2: 0
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
  internalLimit(x, limit = 1.08) {
    if (!Number.isFinite(x)) return 0;
    return this.clamp(x, -limit, limit);
  }
  sanitizeReverbDetail(source) {
    const sourceBands = Array.isArray(source?.bands) ? source.bands : [source || { freq: 2200, gain: 3, q: 0.85 }];
    const bands = sourceBands.slice(0, this.revEqState?.length || 4).map((band, index) => {
      const id = typeof band?.id === 'string' && band.id ? band.id : `band-${index + 1}`;
      const freq = Number(band?.freq);
      const gain = Number(band?.gain);
      const q = Number(band?.q);
      return {
        id,
        freq: Number.isFinite(freq) ? this.clamp(freq, 160, 12000) : 2200,
        gain: Number.isFinite(gain) ? this.clamp(gain, -9, 9) : 0,
        q: Number.isFinite(q) ? this.clamp(q, 0.25, 8) : 0.85
      };
    });
    if (!bands.length) bands.push({ id: 'band-1', freq: 2200, gain: 3, q: 0.85 });
    const selectedBandId = bands.some((band) => band.id === source?.selectedBandId) ? source.selectedBandId : bands[0].id;
    return { selectedBandId, bands };
  }
  reverbBands() {
    return this.sanitizeReverbDetail(this.reverbDetail).bands;
  }
  processComb(line, input, feedback, dampCoeff) {
    input = this.internalLimit(input, 0.72);
    const delayed = line.buffer[line.index];
    line.damp += (delayed - line.damp) * dampCoeff;
    line.buffer[line.index] = this.internalLimit(input + line.damp * feedback, 0.96);
    line.index = (line.index + 1) % line.buffer.length;
    return this.internalLimit(line.damp, 0.96);
  }
  processAllpass(line, input, feedback) {
    input = this.internalLimit(input, 0.9);
    const delayed = line.buffer[line.index];
    const output = this.internalLimit(delayed - input * feedback, 0.96);
    line.buffer[line.index] = this.internalLimit(input + delayed * feedback, 0.96);
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
    this.stableGain = 1;
    this.stableHighEnv = 0;
    this.stableLowL = 0;
    this.stableLowR = 0;
    this.feedbackGuardGain = 1;
    this.feedbackRisk = 0;
    this.howlGuardGain = 1;
    this.howlRisk = 0;
    this.echoLow = 0;
    this.echoTone = 0;
    this.echoDuckEnv = 0;
    this.revSideBlur = 0;
    this.revEarlySideBlur = 0;
    this.revEqL1 = 0;
    this.revEqL2 = 0;
    this.revEqR1 = 0;
    this.revEqR2 = 0;
    this.revEqInL1 = 0;
    this.revEqInL2 = 0;
    this.revEqInR1 = 0;
    this.revEqInR2 = 0;
    this.revEqState = this.createReverbEqStates(this.revEqState?.length || 4);
    this.airLowL = 0;
    this.airLowR = 0;
  }
  peakingCoefficients(freq, gainDb, q) {
    const f = this.clamp(Number(freq) || 2200, 160, Math.min(12000, this.sampleRate * 0.45));
    const gain = this.clamp(Number(gainDb) || 0, -9, 9);
    const quality = this.clamp(Number(q) || 0.85, 0.25, 8);
    const w0 = 2 * Math.PI * f / this.sampleRate;
    const cos = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * quality);
    const a = Math.pow(10, gain / 40);
    const b0 = 1 + alpha * a;
    const b1 = -2 * cos;
    const b2 = 1 - alpha * a;
    const a0 = 1 + alpha / a;
    const a1 = -2 * cos;
    const a2 = 1 - alpha / a;
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }
  processReverbEq(x, bands, right = false) {
    let y = x;
    for (let i = 0; i < this.revEqState.length; i++) {
      const state = this.revEqState[i];
      const band = bands[i];
      if (!band) {
        this.decayReverbEqState(state);
        continue;
      }
      const c = this.peakingCoefficients(band.freq, band.gain, band.q);
      if (right) {
        const out = c.b0 * y + c.b1 * state.inR1 + c.b2 * state.inR2 - c.a1 * state.r1 - c.a2 * state.r2;
        state.inR2 = state.inR1;
        state.inR1 = y;
        state.r2 = state.r1;
        state.r1 = this.internalLimit(out, 0.96);
        y = state.r1;
      } else {
        const out = c.b0 * y + c.b1 * state.inL1 + c.b2 * state.inL2 - c.a1 * state.l1 - c.a2 * state.l2;
        state.inL2 = state.inL1;
        state.inL1 = y;
        state.l2 = state.l1;
        state.l1 = this.internalLimit(out, 0.96);
        y = state.l1;
      }
    }
    return y;
  }
  decayReverbEqState(state) {
    state.l1 *= 0.98;
    state.l2 *= 0.98;
    state.r1 *= 0.98;
    state.r2 *= 0.98;
    state.inL1 *= 0.98;
    state.inL2 *= 0.98;
    state.inR1 *= 0.98;
    state.inR2 *= 0.98;
  }
  decayReverbEqStates() {
    for (const state of this.revEqState) this.decayReverbEqState(state);
  }
  publishStats(startedAt, frameLength, peak, clip = 0, guard = 1) {
    const endedAt = this.now();
    const bufferMs = frameLength / this.sampleRate * 1000;
    if (startedAt && endedAt) {
      const instantLoad = Math.max(0, Math.min(1.5, (endedAt - startedAt) / Math.max(0.001, bufferMs)));
      this.processorLoad = this.processorLoad * 0.88 + instantLoad * 0.12;
    }
    this.frameCount++;
    if (this.frameCount % 6 === 0) {
      this.port.postMessage({ type: 'stats', peak, clip, guard, load: this.processorLoad, bufferMs });
    }
  }

  qualityReverbCount() {
    const q = this.params.quality;
    if (q === 'light') return 2;
    if (q === 'balanced') return 3;
    return 4;
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
    const delaySamples = Math.floor(this.sampleRate * (0.18 + echo * 0.42));
    const echoFeedback = 0.035 + echo * 0.2;
    const wetEcho = echo * wet * (0.16 + echo * 0.22);
    const wetRev = reverb * wet * (0.38 + room * 0.13);
    const reverbCount = this.qualityReverbCount();
    const revFeedback = this.clamp(0.52 + room * 0.14 + reverb * 0.1, 0.5, 0.78);
    const revEqBands = this.reverbBands();
    const revDamp = this.clamp(0.18 + air * 0.44 + (1 - room) * 0.08, 0.12, 0.72);
    const preDelaySamples = Math.floor(this.sampleRate * (0.007 + room * 0.034));
    const earlySize = 0.72 + room * 1.35;
    const echoLowCoeff = 1 - Math.exp(-2 * Math.PI * 100 / this.sampleRate);
    const toneTilt = (tone - 0.5) * 2;
    const toneCutoff = 0.065 + Math.abs(toneTilt) * 0.055;
    const airCoeff = 1 - Math.exp(-2 * Math.PI * (5200 + air * 2600) / this.sampleRate);
    const compAmount = stable;
    const stableAttack = 1 - Math.exp(-1 / (this.sampleRate * (0.0018 + compAmount * 0.0008)));
    const stableRelease = 1 - Math.exp(-1 / (this.sampleRate * (0.042 + (1 - compAmount) * 0.035)));
    const stableGainAttack = 1 - Math.exp(-1 / (this.sampleRate * (0.0007 + compAmount * 0.0008)));
    const stableGainRelease = 1 - Math.exp(-1 / (this.sampleRate * (0.028 + compAmount * 0.028)));
    const stableToneCoeff = 1 - Math.exp(-2 * Math.PI * (1250 + compAmount * 700) / this.sampleRate);
    const stableHighAttack = 1 - Math.exp(-1 / (this.sampleRate * 0.0012));
    const stableHighRelease = 1 - Math.exp(-1 / (this.sampleRate * 0.055));
    const echoDuckAttack = 1 - Math.exp(-1 / (this.sampleRate * 0.006));
    const echoDuckRelease = 1 - Math.exp(-1 / (this.sampleRate * 0.18));
    const echoToneCoeff = 0.16 + echo * 0.14;
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
      const rawPeak = Math.max(Math.abs(inL[i]), Math.abs(inR[i]));
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
      const preStablePeak = Math.max(Math.abs(l), Math.abs(r));

      if (stableOn) {
        const level = Math.max(preStablePeak, Math.abs((l + r) * 0.5) * 1.15);
        this.env += (level - this.env) * (level > this.env ? stableAttack : stableRelease);

        const floorTarget = this.clamp(level * 0.42, 0.0018, 0.012);
        const floorSpeed = level < this.noiseFloor * 2.1 ? 0.00022 : 0.000018;
        this.noiseFloor += (floorTarget - this.noiseFloor) * floorSpeed;
        const noiseFloor = this.clamp(this.noiseFloor + compAmount * 0.002, 0.0025, 0.014);
        const noiseKnee = noiseFloor * (2.1 + compAmount * 0.6);
        const noiseDepth = 0.025 + compAmount * 0.075;
        let targetGate = 1;
        if (level < noiseKnee) {
          const openness = this.clamp((level - noiseFloor) / Math.max(0.0001, noiseKnee - noiseFloor), 0, 1);
          const smoothOpen = openness * openness * (3 - 2 * openness);
          targetGate = 1 - noiseDepth * (1 - smoothOpen);
        }
        const gateSpeed = targetGate > this.noiseGateGain ? 0.08 : 0.0008 + compAmount * 0.0012;
        this.noiseGateGain += (targetGate - this.noiseGateGain) * gateSpeed;
        l *= this.noiseGateGain;
        r *= this.noiseGateGain;

        this.stableLowL += (l - this.stableLowL) * stableToneCoeff;
        this.stableLowR += (r - this.stableLowR) * stableToneCoeff;
        const stableHighL = l - this.stableLowL;
        const stableHighR = r - this.stableLowR;
        const highLevel = Math.max(Math.abs(stableHighL), Math.abs(stableHighR));
        this.stableHighEnv += (highLevel - this.stableHighEnv) * (highLevel > this.stableHighEnv ? stableHighAttack : stableHighRelease);
        const highThreshold = 0.074 - compAmount * 0.028;
        let highGain = 1;
        if (this.stableHighEnv > highThreshold) {
          const highRatio = 1.8 + compAmount * 4.2;
          const highDesired = highThreshold + (this.stableHighEnv - highThreshold) / highRatio;
          highGain = this.clamp(highDesired / Math.max(0.0001, this.stableHighEnv), 0.46, 1);
        }
        l = this.stableLowL + stableHighL * highGain;
        r = this.stableLowR + stableHighR * highGain;

        const threshold = 0.18 - compAmount * 0.09;
        const ratio = 1.6 + compAmount * 5.4;
        let compGain = 1;
        if (this.env > threshold) {
          const over = this.env / Math.max(0.001, threshold);
          const compressed = threshold * Math.pow(over, 1 / ratio);
          compGain = this.clamp(compressed / Math.max(0.0001, this.env), 0.22, 1);
        }

        const stablePeak = Math.max(Math.abs(l), Math.abs(r));
        const peakThreshold = 0.58 - compAmount * 0.22;
        let peakGain = 1;
        if (stablePeak > peakThreshold) {
          const peakRatio = 2.2 + compAmount * 7.8;
          const peakDesired = peakThreshold + (stablePeak - peakThreshold) / peakRatio;
          peakGain = this.clamp(peakDesired / Math.max(0.0001, stablePeak), 0.16, 1);
        }
        const targetStableGain = this.clamp(Math.min(compGain, peakGain), 0.16, 1);
        this.stableGain += (targetStableGain - this.stableGain) * (targetStableGain < this.stableGain ? stableGainAttack : stableGainRelease);
        const makeup = 1 + compAmount * 0.1;
        const stableGain = Math.min(this.stableGain, peakGain) * makeup;
        l *= stableGain;
        r *= stableGain;
      } else {
        this.noiseGateGain += (1 - this.noiseGateGain) * 0.05;
        this.stableGain += (1 - this.stableGain) * 0.02;
        this.stableHighEnv *= 0.98;
        this.stableLowL += (l - this.stableLowL) * 0.02;
        this.stableLowR += (r - this.stableLowR) * 0.02;
        this.env = Math.max(Math.abs(mono), this.env * 0.98);
      }

      const fxMono = (l + r) * 0.5;
      const echoPresence = Math.abs(fxMono);
      this.echoDuckEnv += (echoPresence - this.echoDuckEnv) * (echoPresence > this.echoDuckEnv ? echoDuckAttack : echoDuckRelease);
      const echoDuck = 1 - this.clamp((this.echoDuckEnv - 0.035) / 0.22, 0, 0.58);
      const howlGuard = this.clamp(this.howlGuardGain, 0.32, 1);
      const fxGuard = howlGuard * howlGuard;
      const sendGuard = 0.48 + howlGuard * 0.52;
      if (echoOn) {
        const dRead = (this.delayIndex - delaySamples + this.delayBuffer.length) % this.delayBuffer.length;
        const d = this.delayBuffer[dRead];
        const safeFeedback = echoFeedback * (0.26 + howlGuard * 0.74);
        const echoInput = fxMono * sendGuard + d * safeFeedback;
        this.echoLow += (echoInput - this.echoLow) * echoLowCoeff;
        this.delayBuffer[this.delayIndex] = echoInput - this.echoLow;
        this.delayIndex = (this.delayIndex + 1) % this.delayBuffer.length;
        this.echoTone += (d - this.echoTone) * echoToneCoeff;
        const echoOut = this.echoTone * 0.74 + d * 0.26;
        l += echoOut * wetEcho * fxGuard * echoDuck;
        r += echoOut * wetEcho * fxGuard * echoDuck;
      } else {
        const safeEchoStore = fxMono * sendGuard;
        this.echoLow += (safeEchoStore - this.echoLow) * echoLowCoeff;
        this.delayBuffer[this.delayIndex] = safeEchoStore - this.echoLow;
        this.delayIndex = (this.delayIndex + 1) % this.delayBuffer.length;
        this.echoTone += (0 - this.echoTone) * 0.04;
      }

      this.revPreBuffer[this.revPreIndex] = fxMono * sendGuard;
      if (reverbOn) {
        const pre = this.readCircular(this.revPreBuffer, this.revPreIndex, preDelaySamples);
        const er1 = this.readCircular(this.revPreBuffer, this.revPreIndex, Math.floor(this.sampleRate * 0.011 * earlySize));
        const er2 = this.readCircular(this.revPreBuffer, this.revPreIndex, Math.floor(this.sampleRate * 0.017 * earlySize));
        const er3 = this.readCircular(this.revPreBuffer, this.revPreIndex, Math.floor(this.sampleRate * 0.026 * earlySize));
        const er4 = this.readCircular(this.revPreBuffer, this.revPreIndex, Math.floor(this.sampleRate * 0.039 * earlySize));
        const earlyCenter = this.internalLimit(er1 * 0.34 + er2 * 0.27 + er3 * 0.21 + er4 * 0.16, 0.72);
        const earlySideRaw = this.internalLimit((er1 - er2 + er3 * 0.7 - er4 * 0.55) * (0.1 + room * 0.18), 0.42);
        this.revEarlySideBlur += (earlySideRaw - this.revEarlySideBlur) * (0.045 - room * 0.018);

        let tailL = 0;
        let tailR = 0;
        const safeRevFeedback = revFeedback * (0.44 + howlGuard * 0.56);
        const tailInput = this.internalLimit((pre + earlyCenter * 0.22) * sendGuard, 0.68);
        for (let c = 0; c < reverbCount; c++) {
          const signL = c % 2 === 0 ? 1 : -0.86;
          const signR = c % 2 === 0 ? -0.82 : 1;
          tailL += this.processComb(this.revCombL[c], tailInput * signL, safeRevFeedback, revDamp);
          tailR += this.processComb(this.revCombR[c], tailInput * signR, safeRevFeedback * 0.997, revDamp);
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
        const blurredSide = this.revSideBlur * 0.9 + tailSideRaw * 0.1;
        const side = this.internalLimit((this.revEarlySideBlur * 0.28 + blurredSide) * (0.1 + room * 0.22), 0.42);
        const center = this.internalLimit(earlyCenter * 0.24 + tailCenter * 0.78, 0.72);
        const revL = this.processReverbEq(center + side, revEqBands);
        const revR = this.processReverbEq(center - side, revEqBands, true);
        l += revL * wetRev * fxGuard;
        r += revR * wetRev * fxGuard;
      } else {
        this.revSideBlur += (0 - this.revSideBlur) * 0.02;
        this.revEarlySideBlur += (0 - this.revEarlySideBlur) * 0.04;
        this.decayReverbEqStates();
      }
      this.revPreIndex = (this.revPreIndex + 1) % this.revPreBuffer.length;

      this.lfo += 2 * Math.PI * 0.22 / this.sampleRate;
      if (this.lfo > Math.PI * 2) this.lfo -= Math.PI * 2;
      if (doubleOn) {
        const mod = Math.floor(Math.sin(this.lfo) * this.sampleRate * 0.003);
        const dbRead = (this.doubleIndex - this.clamp(doubleBase + mod, 1, this.doubleBuffer.length - 1) + this.doubleBuffer.length) % this.doubleBuffer.length;
        const db = this.doubleBuffer[dbRead];
        this.doubleBuffer[this.doubleIndex] = fxMono * sendGuard;
        this.doubleIndex = (this.doubleIndex + 1) % this.doubleBuffer.length;
        l += db * dbl * wet * 0.24 * fxGuard;
        r += db * dbl * wet * 0.18 * fxGuard;
      } else {
        this.doubleBuffer[this.doubleIndex] = fxMono * sendGuard;
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
      const inputDrive = this.clamp((preStablePeak - 0.58) / 0.42, 0, 1);
      const rawClipDrive = this.clamp((rawPeak - 0.88) / 0.12, 0, 1);
      const hotDrive = this.clamp((preGuardPeak - 0.76) / 0.36, 0, 1);
      const clipDrive = this.clamp((preGuardPeak - 0.94) / 0.22, 0, 1);
      const sustainedDrive = this.clamp((this.feedbackRisk - 0.82) / 0.28, 0, 1);
      const howlDrive = Math.max(
        inputDrive * (preGuardPeak > 0.24 ? 0.62 : 0.34),
        rawClipDrive * 0.9,
        hotDrive * 0.72,
        clipDrive,
        sustainedDrive * (preGuardPeak > 0.66 ? 0.9 : 0)
      );
      const riskSpeed = howlDrive > this.howlRisk ? 0.01 : 0.00035;
      this.howlRisk += (howlDrive - this.howlRisk) * riskSpeed;
      const howlTarget = this.clamp(1 - this.howlRisk * 0.68, 0.32, 1);
      const howlSpeed = howlTarget < this.howlGuardGain ? 0.018 : 0.00028;
      this.howlGuardGain += (howlTarget - this.howlGuardGain) * howlSpeed;
      let guardTarget = 1;
      if (this.feedbackRisk > 1.18 || preGuardPeak > 1.18) guardTarget = 0.72;
      else if (this.feedbackRisk > 1.02 && preGuardPeak > 0.86) guardTarget = 0.86;
      else if (this.feedbackRisk > 0.9 && preGuardPeak > 0.78) guardTarget = 0.94;
      const guardSpeed = guardTarget < this.feedbackGuardGain ? 0.004 : 0.0008;
      this.feedbackGuardGain += (guardTarget - this.feedbackGuardGain) * guardSpeed;
      l *= this.feedbackGuardGain * this.howlGuardGain;
      r *= this.feedbackGuardGain * this.howlGuardGain;
      l = this.softLimit(l);
      r = this.softLimit(r);
      outL[i] = l;
      outR[i] = r;
      peak = Math.max(peak, Math.abs(l), Math.abs(r));
    }

    this.publishStats(startedAt, outL.length, peak, clip, Math.min(this.feedbackGuardGain, this.howlGuardGain));
    return true;
  }
}

registerProcessor('easyknob-processor', EasyKnobProcessor);
