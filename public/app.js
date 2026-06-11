const DEFAULTS = {
  params: { mic: 0.5, echo: 0.22, reverb: 0.26, room: 0.58, wet: 0.7, tone: 0.5, air: 0.18, stable: 0.3, double: 0, quality: 'maximum' },
  enabled: { mic: true, echo: true, reverb: true, room: true, wet: true, tone: true, air: true, stable: true, double: true },
  bypassed: { mic: false, echo: false, reverb: false, room: false, wet: false, tone: false, air: false, stable: false, double: false },
  preset: 'default',
  presetOverrides: {},
  analyzerEnabled: false,
  analyzerPreferenceSet: false,
  micDeviceId: 'default',
  outputDeviceId: ''
};

const FIRST_RUN_NOTICE_KEY = 'easyknob-first-run-notice-v1';

const KNOBS = [
  { key: 'mic', label: 'MIC', desc: 'マイク入力の大きさ。声が小さい時は上げ、割れる時は下げます。' },
  { key: 'echo', label: 'ECHO', desc: '100Hz以下を抑えた遅れ音の返り。声の邪魔になる低域を残しにくくします。' },
  { key: 'reverb', label: 'REVERB', desc: '残響の量。初期反射と拡散テールで、声の後ろに自然な響きを足します。' },
  { key: 'room', label: 'ROOM', desc: '空間の広さ。中央の声を残し、左右に少し広げた輪郭をぼかします。' },
  { key: 'wet', label: 'WET', desc: 'ECHO、REVERB、DOUBLEの混ざり具合。下げるほど原音に近くなります。' },
  { key: 'tone', label: 'TONE', desc: '声の明るさ。左で柔らかく、右でクリアにします。' },
  { key: 'air', label: 'AIR', desc: '高域の抜け。声の輪郭と空気感を少し足します。' },
  { key: 'stable', label: 'STABLE', desc: '声の音量差を整え、床ノイズを控えめに抑えます。小さい声を聞きやすくし、大きすぎる声を抑えます。' },
  { key: 'double', label: 'DOUBLE', desc: '声を少し重ねて厚みを出します。歌声をリッチにしたい時に使います。' }
];

const PRESETS = {
  default: {
    label: 'Default',
    params: { mic: 0.5, echo: 0.22, reverb: 0.26, room: 0.58, wet: 0.7, tone: 0.5, air: 0.18, stable: 0.3, double: 0 },
    bypassed: { ...DEFAULTS.bypassed }
  },
  singing: {
    label: 'Sing',
    params: { mic: 0.52, echo: 0.32, reverb: 0.38, room: 0.7, wet: 0.76, tone: 0.58, air: 0.28, stable: 0.42, double: 0.12 },
    bypassed: { ...DEFAULTS.bypassed }
  },
  talk: {
    label: 'Talk',
    params: { mic: 0.5, echo: 0, reverb: 0, room: 0.44, wet: 0.45, tone: 0.55, air: 0.12, stable: 0.5, double: 0 },
    bypassed: { mic: false, echo: true, reverb: true, tone: false, stable: false, double: true }
  },
  preset1: {
    label: 'Preset 1',
    params: { mic: 0.48, echo: 0.14, reverb: 0.18, room: 0.52, wet: 0.62, tone: 0.54, air: 0.18, stable: 0.44, double: 0.08 },
    bypassed: { ...DEFAULTS.bypassed }
  },
  preset2: {
    label: 'Preset 2',
    params: { mic: 0.46, echo: 0.06, reverb: 0.08, room: 0.38, wet: 0.52, tone: 0.62, air: 0.24, stable: 0.58, double: 0 },
    bypassed: { mic: false, echo: false, reverb: false, tone: false, stable: false, double: true }
  },
  preset3: {
    label: 'Preset 3',
    params: { mic: 0.52, echo: 0.42, reverb: 0.44, room: 0.78, wet: 0.82, tone: 0.6, air: 0.34, stable: 0.36, double: 0.18 },
    bypassed: { ...DEFAULTS.bypassed }
  }
};

let state = loadState();
let audioContext = null;
let sourceNode = null;
let workletNode = null;
let analyserNode = null;
let mediaStream = null;
let outputDestination = null;
let contextSinkActive = false;
let contextSinkPreselected = false;
let contextSinkId = '';
let running = false;
let starting = false;
let analyzerFrame = 0;
let frequencyData = null;
let timeData = null;
let latestStats = { load: 0, peak: 0, bufferMs: 0, clip: 0, guard: 1 };
let statsReceived = false;
let clipUntil = 0;
let warningLabel = 'CLIP';
let supportMessage = '';
let runtimeMessage = '';
let availableMicDeviceIds = new Set();
let availableOutputDeviceIds = new Set();

const $ = (id) => document.getElementById(id);
const knobGrid = $('knobGrid');
const micSelect = $('micSelect');
const outputSelect = $('outputSelect');
const qualitySelect = $('qualitySelect');
const presetSelect = $('presetSelect');
const startBtn = $('startBtn');
const resetBtn = $('resetBtn');
const meterBar = $('meterBar');
const clipWarning = $('clipWarning');
const monitor = $('monitor');
const supportBanner = $('supportBanner');
const runStatus = $('runStatus');
const runState = $('runState');
const loadValue = $('loadValue');
const analyzerCanvas = $('analyzerCanvas');
const analyzerPanel = $('analyzerPanel');
const analyzerToggle = $('analyzerToggle');
const analyzerState = $('analyzerState');
const firstRunNoticeDialog = $('firstRunNoticeDialog');
const noticeAcceptBtn = $('noticeAcceptBtn');

init();

async function init() {
  renderKnobs();
  renderSettings();
  bindUi();
  qualitySelect.value = state.params.quality;
  renderPresetSelect();
  setRunState('idle', 'READY');
  checkSupport();
  renderAnalyzerVisibility();
  renderRuntimeStats();
  await registerServiceWorker();
  showFirstRunNotice();
  await enumerateDevices();
}

function loadState() {
  try {
    const raw = localStorage.getItem('easyknob-state');
    if (!raw) return structuredClone(DEFAULTS);
    const parsed = JSON.parse(raw);
    const migratedEnabled = parsed.enabled || parsed.visible || DEFAULTS.enabled;
    const analyzerPreferenceSet = parsed.analyzerPreferenceSet === true;
    const preset = normalizePreset(parsed.preset);
    const presetOverrides = sanitizePresetOverrides(parsed.presetOverrides);
    if (!presetOverrides[preset] && parsed.params) {
      presetOverrides[preset] = {
        params: sanitizePresetParams(parsed.params),
        bypassed: sanitizePresetBypassed(parsed.bypassed, { ...DEFAULTS.bypassed, ...PRESETS[preset].bypassed })
      };
    }
    return {
      ...structuredClone(DEFAULTS),
      ...parsed,
      params: { ...DEFAULTS.params, ...parsed.params },
      enabled: { ...DEFAULTS.enabled, ...migratedEnabled },
      bypassed: { ...DEFAULTS.bypassed, ...parsed.bypassed },
      preset,
      presetOverrides,
      analyzerEnabled: analyzerPreferenceSet ? (parsed.analyzerEnabled ?? DEFAULTS.analyzerEnabled) : DEFAULTS.analyzerEnabled,
      analyzerPreferenceSet
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function saveState() {
  localStorage.setItem('easyknob-state', JSON.stringify(state));
}

function checkSupport() {
  const issues = [];
  const ua = navigator.userAgent;
  const isChromeLike = /Chrome|Edg/.test(ua) && !/OPR/.test(ua);
  if (!navigator.mediaDevices?.getUserMedia) issues.push('このブラウザはマイク入力に対応していません。');
  if (!HTMLMediaElement.prototype.setSinkId) issues.push('このブラウザは出力先デバイスの選択に対応していません。Chrome / Edgeを推奨します。');
  if (!window.AudioWorkletNode) issues.push('このブラウザは高品質なリアルタイム音声処理に対応していません。');
  if (!isChromeLike) issues.push('推奨環境はデスクトップ版Chrome / Edgeです。対応外環境ではDiscord/VRC連携が動かない場合があります。');
  supportMessage = issues.join(' ');
  renderBanner();
}

function renderBanner() {
  const message = runtimeMessage || supportMessage;
  supportBanner.textContent = message;
  supportBanner.dataset.tone = runtimeMessage ? 'error' : 'warn';
  supportBanner.classList.toggle('hidden', !message);
}

function showRuntimeError(message) {
  runtimeMessage = message;
  renderBanner();
}

function clearRuntimeError() {
  runtimeMessage = '';
  renderBanner();
}

function setRunState(kind, label) {
  runStatus.dataset.state = kind;
  runState.textContent = label;
}

function bindUi() {
  startBtn.addEventListener('click', async () => {
    if (starting) return;
    if (running) await stopAudio();
    else await startAudio();
  });
  resetBtn.addEventListener('click', () => {
    resetCurrentPreset();
    saveState();
    renderPresetSelect();
    renderKnobs();
    sendParams();
    sendEnabled();
    renderRuntimeStats();
  });
  $('settingsBtn').addEventListener('click', () => $('settingsDialog').showModal());
  $('helpBtn').addEventListener('click', () => $('helpDialog').showModal());
  if (firstRunNoticeDialog) {
    firstRunNoticeDialog.addEventListener('cancel', (event) => event.preventDefault());
  }
  if (noticeAcceptBtn) {
    noticeAcceptBtn.addEventListener('click', acceptFirstRunNotice);
  }
  $('restoreKnobsBtn').addEventListener('click', () => {
    state.enabled = structuredClone(DEFAULTS.enabled);
    state.bypassed = structuredClone(DEFAULTS.bypassed);
    saveState();
    renderPresetSelect();
    renderKnobs();
    renderSettings();
    sendEnabled();
    renderRuntimeStats();
  });
  analyzerToggle.addEventListener('change', () => {
    state.analyzerEnabled = analyzerToggle.checked;
    state.analyzerPreferenceSet = true;
    saveState();
    renderAnalyzerVisibility();
    if (running) connectOutputGraph();
  });
  micSelect.addEventListener('change', async () => {
    state.micDeviceId = micSelect.value;
    saveState();
    if (running) await restartAudio();
  });
  outputSelect.addEventListener('change', async () => {
    state.outputDeviceId = outputSelect.value;
    saveState();
    const switched = await applyOutputDevice({ allowFallback: true });
    if (running) await syncOutputRoute();
    if (switched) clearRuntimeError();
    else showRuntimeError('選択したOutputを使えませんでした。Default Outputに戻しました。');
  });
  qualitySelect.addEventListener('change', async () => {
    state.params.quality = qualitySelect.value;
    saveState();
    sendParams();
    renderRuntimeStats();
    if (running) await restartAudio();
  });
  presetSelect.addEventListener('change', () => applyPreset(presetSelect.value));
  window.addEventListener('resize', drawAnalyzerIdle);
}

function showFirstRunNotice() {
  if (!firstRunNoticeDialog || typeof firstRunNoticeDialog.showModal !== 'function') return;
  if (hasAcceptedFirstRunNotice()) return;
  if (!firstRunNoticeDialog.open) firstRunNoticeDialog.showModal();
}

function hasAcceptedFirstRunNotice() {
  try {
    return localStorage.getItem(FIRST_RUN_NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

function acceptFirstRunNotice() {
  try {
    localStorage.setItem(FIRST_RUN_NOTICE_KEY, '1');
  } catch {
    /* optional persistence */
  }
  if (firstRunNoticeDialog?.open) firstRunNoticeDialog.close('accepted');
}

function renderKnobs() {
  knobGrid.innerHTML = '';
  for (const knob of KNOBS) {
    if (!state.enabled[knob.key]) continue;
    const value = state.params[knob.key];
    const active = isKnobActive(knob.key);
    const card = document.createElement('article');
    card.className = `knob-card${active ? '' : ' bypassed'}`;
    card.innerHTML = `
      <div class="knob-head">
        <div class="knob-name">${knob.label}</div>
        <button class="knob-state${active ? '' : ' off'}" type="button" aria-pressed="${active ? 'true' : 'false'}" aria-label="${knob.label} ${active ? '無効化' : '有効化'}">${active ? 'ON' : 'OFF'}</button>
      </div>
      <div class="knob" role="slider" tabindex="${active ? '0' : '-1'}" aria-label="${knob.label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(value * 100)}" aria-disabled="${active ? 'false' : 'true'}">
        <span class="knob-pointer" aria-hidden="true"></span>
      </div>
      <div class="knob-control">
        <input class="knob-input" type="range" min="0" max="100" value="${Math.round(value * 100)}" aria-label="${knob.label}" ${active ? '' : 'disabled'} />
        <div class="knob-value">${Math.round(value * 100)}%</div>
      </div>
    `;
    applyKnobUi(card, value);
    bindKnobControl(card, knob);
    knobGrid.appendChild(card);
  }
  if (!knobGrid.children.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'Knobはすべて無効です。';
    knobGrid.appendChild(empty);
  }
}

function bindKnobControl(card, knob) {
  const dial = card.querySelector('.knob');
  const range = card.querySelector('input');
  const stateButton = card.querySelector('.knob-state');
  stateButton.addEventListener('click', () => toggleKnobBypass(knob.key));
  range.addEventListener('input', () => {
    setKnobValue(knob.key, card, Number(range.value) / 100);
  });

  const updateFromPointer = (event) => {
    if (!isKnobActive(knob.key)) return;
    const rect = dial.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    if (Math.hypot(dx, dy) < rect.width * 0.18) return;
    let deg = Math.atan2(dy, dx) * 180 / Math.PI + 90;
    if (deg > 180) deg -= 360;
    const value = (clamp(deg, -135, 135) + 135) / 270;
    setKnobValue(knob.key, card, value);
  };

  dial.addEventListener('pointerdown', (event) => {
    if (!isKnobActive(knob.key)) return;
    dial.focus();
    event.preventDefault();
    dial.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  });
  dial.addEventListener('pointermove', (event) => {
    if (dial.hasPointerCapture(event.pointerId)) updateFromPointer(event);
  });
  dial.addEventListener('pointerup', (event) => {
    if (dial.hasPointerCapture(event.pointerId)) dial.releasePointerCapture(event.pointerId);
  });
  dial.addEventListener('keydown', (event) => {
    if (!isKnobActive(knob.key)) return;
    const keySteps = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02, PageUp: 0.1, PageDown: -0.1 };
    if (event.key === 'Home') {
      event.preventDefault();
      setKnobValue(knob.key, card, 0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setKnobValue(knob.key, card, 1);
      return;
    }
    if (keySteps[event.key]) {
      event.preventDefault();
      setKnobValue(knob.key, card, state.params[knob.key] + keySteps[event.key]);
    }
  });
}

function isKnobActive(key) {
  return state.enabled[key] && !state.bypassed[key];
}

function toggleKnobBypass(key) {
  if (!state.enabled[key]) return;
  state.bypassed[key] = !state.bypassed[key];
  saveCurrentPreset();
  saveState();
  renderKnobs();
  sendEnabled();
  renderRuntimeStats();
}

function setKnobValue(key, card, rawValue) {
  const value = clamp(rawValue, 0, 1);
  state.params[key] = value;
  applyKnobUi(card, value);
  saveCurrentPreset();
  saveState();
  sendParams();
}

function applyKnobUi(card, value) {
  const percentage = Math.round(value * 100);
  const dial = card.querySelector('.knob');
  const range = card.querySelector('input');
  const label = card.querySelector('.knob-value');
  dial.style.setProperty('--angle', `${-135 + value * 270}deg`);
  dial.setAttribute('aria-valuenow', `${percentage}`);
  range.value = percentage;
  label.textContent = `${percentage}%`;
}

function renderSettings() {
  analyzerToggle.checked = state.analyzerEnabled;
  analyzerState.textContent = state.analyzerEnabled ? 'ON' : 'OFF';
  const root = $('knobSettings');
  root.innerHTML = '';
  for (const knob of KNOBS) {
    const enabled = state.enabled[knob.key];
    const item = document.createElement('label');
    item.className = 'setting-item';
    item.innerHTML = `
      <input type="checkbox" ${enabled ? 'checked' : ''} />
      <span><strong>${knob.label}</strong><p>${knob.desc}</p></span>
      <em>${enabled ? '有効' : '無効'}</em>
    `;
    item.querySelector('input').addEventListener('change', (event) => {
      state.enabled[knob.key] = event.target.checked;
      state.bypassed[knob.key] = false;
      saveState();
      renderKnobs();
      renderSettings();
      sendEnabled();
      renderRuntimeStats();
    });
    root.appendChild(item);
  }
}

async function enumerateDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter(d => d.kind === 'audioinput');
  const outputs = devices.filter(d => d.kind === 'audiooutput');
  availableMicDeviceIds = new Set(inputs.map(d => d.deviceId).filter(Boolean));
  availableOutputDeviceIds = new Set(outputs.map(d => d.deviceId).filter(Boolean));
  fillSelect(micSelect, inputs, 'Default Microphone', state.micDeviceId, '前回選択したマイク');
  fillSelect(outputSelect, outputs, 'Default Output', state.outputDeviceId || 'default', '前回選択した出力');
}

function fillSelect(select, devices, defaultLabel, selectedId, missingLabel) {
  const nextValue = selectedId || 'default';
  select.innerHTML = '';
  const defaultOption = new Option(defaultLabel, 'default');
  select.appendChild(defaultOption);
  for (const d of devices) {
    const label = d.label || `${d.kind} ${select.length}`;
    select.appendChild(new Option(label, d.deviceId));
  }
  const hasSelectedValue = [...select.options].some(o => o.value === nextValue);
  if (!hasSelectedValue && nextValue !== 'default') {
    select.appendChild(new Option(missingLabel, nextValue));
  }
  select.value = hasSelectedValue || nextValue !== 'default' ? nextValue : 'default';
}

function selectedMicDeviceId() {
  const selected = state.micDeviceId || micSelect.value;
  if (!selected || selected === 'default') return undefined;
  return availableMicDeviceIds.has(selected) ? selected : undefined;
}

function selectedOutputDeviceId() {
  const selected = state.outputDeviceId || outputSelect.value;
  if (!selected || selected === 'default') return '';
  return availableOutputDeviceIds.has(selected) ? selected : '';
}

async function startAudio() {
  if (starting || running) return;
  starting = true;
  startBtn.disabled = true;
  startBtn.textContent = '起動中';
  startBtn.classList.remove('active');
  statsReceived = false;
  latestStats = { load: 0, peak: 0, bufferMs: 0, clip: 0, guard: 1 };
  clipUntil = 0;
  warningLabel = 'CLIP';
  setRunState('starting', 'マイク許可待ち');
  clearRuntimeError();
  renderRuntimeStats();

  try {
    await enumerateDevices();
    const micDeviceId = selectedMicDeviceId();
    if ((state.micDeviceId || micSelect.value) !== 'default' && !micDeviceId) {
      setRunState('starting', 'Defaultで起動中');
    }
    mediaStream = await openMicStream(micDeviceId);
    await applyLowLatencyTrackConstraints(mediaStream);
    setRunState('starting', '音声準備中');
    await enumerateDevices();
    audioContext = createAudioContext();
    if (audioContext.state === 'suspended') await audioContext.resume();
    await audioContext.audioWorklet.addModule('./audio-worklet.js');
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    workletNode = new AudioWorkletNode(audioContext, 'easyknob-processor', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
    outputDestination = audioContext.createMediaStreamDestination();
    sourceNode.connect(workletNode);
    monitor.srcObject = outputDestination.stream;
    monitor.muted = false;
    const outputReady = await applyOutputDevice({ allowFallback: true });
    await syncOutputRoute();
    workletNode.port.onmessage = (event) => handleWorkletMessage(event.data);
    sendParams();
    sendEnabled();
    running = true;
    starting = false;
    startBtn.disabled = false;
    startBtn.textContent = 'OFF';
    startBtn.classList.add('active');
    setRunState('live', 'LIVE');
    if (!outputReady) {
      showRuntimeError('選択したOutputへ切り替えられなかったため、Default Outputで起動しました。ブラウザの出力先選択を確認してください。');
    }
    renderRuntimeStats();
    if (state.analyzerEnabled) startAnalyzer();
  } catch (error) {
    const message = startupErrorMessage(error);
    await stopAudio({ showIdle: false });
    setRunState('error', 'ERROR');
    showRuntimeError(message);
  }
}

function createAudioContext() {
  const latencyHint = qualityLatency(state.params.quality);
  const sampleRate = qualitySampleRate(state.params.quality);
  const sinkId = selectedOutputDeviceId();
  contextSinkActive = false;
  contextSinkPreselected = false;
  contextSinkId = '';
  if (sinkId && typeof AudioContext.prototype.setSinkId === 'function') {
    try {
      const context = new AudioContext({ sampleRate, latencyHint, sinkId });
      contextSinkActive = true;
      contextSinkPreselected = true;
      contextSinkId = sinkId;
      return context;
    } catch {
      contextSinkActive = false;
      contextSinkPreselected = false;
      contextSinkId = '';
    }
  }
  try {
    return new AudioContext({ sampleRate, latencyHint });
  } catch {
    return new AudioContext({ latencyHint: 'interactive' });
  }
}

async function openMicStream(micDeviceId) {
  const attempts = [
    buildMicConstraints(micDeviceId),
    buildMicConstraints(micDeviceId, { relaxed: true })
  ];
  if (micDeviceId) attempts.push(buildMicConstraints(undefined, { relaxed: true }));

  let lastError = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function buildMicConstraints(micDeviceId, { relaxed = false } = {}) {
  const audio = {
    deviceId: micDeviceId && micDeviceId !== 'default' ? { exact: micDeviceId } : undefined,
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
    channelCount: relaxed ? { ideal: 1 } : { ideal: 1, max: 1 }
  };
  if (!relaxed) {
    audio.latency = { ideal: preferredInputLatency(), max: 0.02 };
    audio.sampleRate = { ideal: qualitySampleRate(state.params.quality) };
  }
  return { audio, video: false };
}

async function applyLowLatencyTrackConstraints(stream) {
  const constraints = {
    echoCancellation: { ideal: false },
    noiseSuppression: { ideal: false },
    autoGainControl: { ideal: false },
    latency: { ideal: preferredInputLatency(), max: 0.02 },
    channelCount: { ideal: 1 }
  };
  await Promise.all(stream.getAudioTracks().map((track) => {
    if (!track.applyConstraints) return Promise.resolve();
    return track.applyConstraints(constraints).catch(() => track.applyConstraints({
      echoCancellation: { ideal: false },
      noiseSuppression: { ideal: false },
      autoGainControl: { ideal: false },
      channelCount: { ideal: 1 }
    }).catch(() => {}));
  }));
}

function startupErrorMessage(error) {
  const name = error?.name || 'Error';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'マイク許可が必要です。ブラウザの権限設定でEasyKnobのマイク使用を許可してください。';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '使用できるマイクが見つかりません。InputをDefaultにして、マイク接続を確認してください。';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'マイクを開始できません。他のアプリがマイクを占有していないか確認してください。';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return '選択したマイク設定を使えませんでした。InputをDefaultにしてもう一度ONにしてください。';
  }
  if (name === 'AbortError') {
    return '音声デバイスの起動が中断されました。マイクとOutputを確認してもう一度ONにしてください。';
  }
  return `起動できませんでした。マイク許可、Output、対応ブラウザを確認してください。${error?.message ? ` ${error.message}` : ''}`;
}

function connectOutputGraph() {
  if (!audioContext || !workletNode || !outputDestination) return;
  const target = useDirectOutputRoute() || contextSinkActive ? audioContext.destination : outputDestination;
  try { workletNode.disconnect(); } catch {}
  if (analyserNode) {
    try { analyserNode.disconnect(); } catch {}
    analyserNode = null;
  }
  if (state.analyzerEnabled) {
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 1024;
    analyserNode.smoothingTimeConstant = 0.72;
    workletNode.connect(analyserNode);
    analyserNode.connect(target);
    startAnalyzer();
  } else {
    workletNode.connect(target);
    stopAnalyzer();
    drawAnalyzerIdle();
  }
  renderAnalyzerVisibility();
}

function useDirectOutputRoute() {
  const selected = state.outputDeviceId || outputSelect.value;
  return !selected || selected === 'default';
}

async function syncOutputRoute() {
  if (!audioContext || !workletNode || !outputDestination) return;
  connectOutputGraph();
  if (useDirectOutputRoute() || contextSinkActive) {
    monitor.pause();
    monitor.srcObject = null;
    return;
  }
  if (monitor.srcObject !== outputDestination.stream) {
    monitor.srcObject = outputDestination.stream;
  }
  monitor.muted = false;
  await monitor.play();
}

function handleWorkletMessage(data) {
  if (data.type !== 'stats') return;
  latestStats = {
    load: Number.isFinite(data.load) ? data.load : latestStats.load,
    peak: Number.isFinite(data.peak) ? data.peak : latestStats.peak,
    bufferMs: Number.isFinite(data.bufferMs) ? data.bufferMs : latestStats.bufferMs,
    clip: Number.isFinite(data.clip) ? data.clip : latestStats.clip,
    guard: Number.isFinite(data.guard) ? data.guard : latestStats.guard
  };
  statsReceived = true;
  const clipping = latestStats.clip >= 0.96 || latestStats.peak >= 0.98;
  const howling = latestStats.guard < 0.82;
  if (howling) {
    warningLabel = 'HOWL';
    clipUntil = performance.now() + 900;
  } else if (clipping) {
    warningLabel = 'CLIP';
    clipUntil = performance.now() + 900;
  }
  meterBar.style.width = `${Math.min(100, latestStats.peak * 110)}%`;
  renderRuntimeStats();
}

async function stopAudio({ showIdle = true } = {}) {
  running = false;
  starting = false;
  startBtn.disabled = false;
  startBtn.textContent = 'ON';
  startBtn.classList.remove('active');
  meterBar.style.width = '0%';
  latestStats = { load: 0, peak: 0, bufferMs: 0, clip: 0, guard: 1 };
  statsReceived = false;
  clipUntil = 0;
  warningLabel = 'CLIP';
  stopAnalyzer();
  if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
  try { if (sourceNode) sourceNode.disconnect(); } catch {}
  try { if (workletNode) workletNode.disconnect(); } catch {}
  try { if (analyserNode) analyserNode.disconnect(); } catch {}
  if (audioContext) await audioContext.close().catch(() => {});
  monitor.pause();
  monitor.srcObject = null;
  audioContext = null;
  sourceNode = null;
  workletNode = null;
  analyserNode = null;
  mediaStream = null;
  outputDestination = null;
  contextSinkActive = false;
  contextSinkPreselected = false;
  contextSinkId = '';
  if (showIdle) {
    setRunState('idle', 'READY');
    clearRuntimeError();
  }
  renderRuntimeStats();
  drawAnalyzerIdle();
}

async function restartAudio() {
  await stopAudio({ showIdle: false });
  await startAudio();
}

async function applyOutputDevice({ allowFallback = false } = {}) {
  const requested = state.outputDeviceId || outputSelect.value;
  const missing = requested && requested !== 'default' && !availableOutputDeviceIds.has(requested);
  const id = missing ? '' : selectedOutputDeviceId();
  const preselected = contextSinkPreselected && contextSinkId === id && !missing;
  contextSinkActive = false;

  if (audioContext && typeof audioContext.setSinkId === 'function' && !missing) {
    try {
      await audioContext.setSinkId(id);
      contextSinkActive = true;
      contextSinkPreselected = false;
      contextSinkId = id;
      return true;
    } catch {
      contextSinkActive = false;
    }
  }

  if (preselected) {
    contextSinkActive = true;
    return true;
  }

  if (!monitor.setSinkId) {
    if (requested && requested !== 'default' && allowFallback) {
      state.outputDeviceId = '';
      outputSelect.value = 'default';
      saveState();
      return false;
    }
    return true;
  }
  try {
    await monitor.setSinkId(id);
    if (missing && allowFallback) {
      state.outputDeviceId = '';
      outputSelect.value = 'default';
      saveState();
    }
    return !missing;
  } catch (error) {
    if (!allowFallback) {
      showRuntimeError(`Outputを切り替えられませんでした。${error.message || ''}`.trim());
      return false;
    }
    try { await monitor.setSinkId(''); } catch {}
    state.outputDeviceId = '';
    outputSelect.value = 'default';
    saveState();
    return false;
  }
}

function sendParams() {
  if (!workletNode) return;
  workletNode.port.postMessage({ type: 'params', params: state.params });
}

function sendEnabled() {
  if (!workletNode) return;
  workletNode.port.postMessage({ type: 'enabled', enabled: effectiveEnabled() });
}

function effectiveEnabled() {
  return Object.fromEntries(KNOBS.map(knob => [knob.key, isKnobActive(knob.key)]));
}

function renderAnalyzerVisibility() {
  analyzerPanel.classList.toggle('hidden', !state.analyzerEnabled);
  analyzerToggle.checked = state.analyzerEnabled;
  analyzerState.textContent = state.analyzerEnabled ? 'ON' : 'OFF';
  if (state.analyzerEnabled) {
    drawAnalyzerIdle();
    if (running) startAnalyzer();
  } else {
    stopAnalyzer();
  }
}

function startAnalyzer() {
  if (!state.analyzerEnabled || analyzerFrame) return;
  analyzerFrame = requestAnimationFrame(drawAnalyzer);
}

function stopAnalyzer() {
  if (!analyzerFrame) return;
  cancelAnimationFrame(analyzerFrame);
  analyzerFrame = 0;
}

function drawAnalyzer() {
  analyzerFrame = 0;
  const ctx = prepareAnalyzerCanvas();
  if (!ctx) return;
  const width = analyzerCanvas.clientWidth;
  const height = analyzerCanvas.clientHeight;
  paintAnalyzerBackground(ctx, width, height);

  if (running && analyserNode) {
    if (!frequencyData || frequencyData.length !== analyserNode.frequencyBinCount) {
      frequencyData = new Uint8Array(analyserNode.frequencyBinCount);
      timeData = new Uint8Array(analyserNode.fftSize);
    }
    analyserNode.getByteFrequencyData(frequencyData);
    analyserNode.getByteTimeDomainData(timeData);
    drawFrequencyBars(ctx, width, height, frequencyData);
    drawWaveform(ctx, width, height, timeData);
  } else {
    drawIdleGrid(ctx, width, height);
  }

  if (state.analyzerEnabled) analyzerFrame = requestAnimationFrame(drawAnalyzer);
}

function drawAnalyzerIdle() {
  if (!state.analyzerEnabled) return;
  const ctx = prepareAnalyzerCanvas();
  if (!ctx) return;
  const width = analyzerCanvas.clientWidth;
  const height = analyzerCanvas.clientHeight;
  paintAnalyzerBackground(ctx, width, height);
  drawIdleGrid(ctx, width, height);
}

function prepareAnalyzerCanvas() {
  if (!analyzerCanvas || analyzerCanvas.classList.contains('hidden')) return null;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(320, analyzerCanvas.clientWidth);
  const height = Math.max(140, analyzerCanvas.clientHeight);
  const targetWidth = Math.floor(width * dpr);
  const targetHeight = Math.floor(height * dpr);
  if (analyzerCanvas.width !== targetWidth || analyzerCanvas.height !== targetHeight) {
    analyzerCanvas.width = targetWidth;
    analyzerCanvas.height = targetHeight;
  }
  const ctx = analyzerCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function paintAnalyzerBackground(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#0c0d10';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  for (let y = 24; y < height; y += 24) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawFrequencyBars(ctx, width, height, data) {
  const bars = Math.min(80, data.length);
  const gap = 2;
  const barWidth = (width - gap * (bars - 1)) / bars;
  for (let i = 0; i < bars; i++) {
    const index = Math.floor((i / bars) ** 1.7 * (data.length - 1));
    const value = data[index] / 255;
    const barHeight = Math.max(2, value * height * 0.86);
    const x = i * (barWidth + gap);
    const y = height - barHeight;
    const hue = 168 + value * 46;
    ctx.fillStyle = `hsl(${hue}, 72%, ${42 + value * 32}%)`;
    ctx.fillRect(x, y, barWidth, barHeight);
  }
}

function drawWaveform(ctx, width, height, data) {
  ctx.strokeStyle = 'rgba(255,255,255,.82)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * width;
    const y = (data[i] / 255) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawIdleGrid(ctx, width, height) {
  ctx.strokeStyle = 'rgba(255,255,255,.26)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
}

function renderRuntimeStats() {
  renderClipWarning();
  if (!running) {
    loadValue.textContent = 'LOAD --';
    return;
  }
  if (!statsReceived) {
    loadValue.textContent = 'LOAD ...';
    return;
  }
  const load = Math.min(99, Math.round(latestStats.load * 100));
  loadValue.textContent = load <= 0 ? 'LOAD <1%' : `LOAD ${load}%`;
}

function renderClipWarning() {
  const visible = running && performance.now() < clipUntil;
  clipWarning.textContent = warningLabel;
  clipWarning.classList.toggle('hidden', !visible);
  meterBar.classList.toggle('clipping', visible);
}

function renderPresetSelect() {
  state.preset = normalizePreset(state.preset);
  presetSelect.value = state.preset;
}

function applyPreset(key) {
  state.preset = normalizePreset(key);
  const preset = getPresetState(state.preset);
  state.params = { ...state.params, ...preset.params };
  state.bypassed = { ...DEFAULTS.bypassed, ...preset.bypassed };
  saveState();
  renderPresetSelect();
  renderKnobs();
  sendParams();
  sendEnabled();
  renderRuntimeStats();
}

function resetCurrentPreset() {
  state.preset = normalizePreset(state.preset);
  const preset = PRESETS[state.preset];
  state.params = { ...state.params, ...preset.params };
  state.bypassed = { ...DEFAULTS.bypassed, ...preset.bypassed };
  if (state.presetOverrides) delete state.presetOverrides[state.preset];
}

function getPresetState(key) {
  const presetKey = normalizePreset(key);
  const preset = PRESETS[presetKey];
  const override = state.presetOverrides?.[presetKey];
  return {
    params: { ...preset.params, ...sanitizePresetParams(override?.params) },
    bypassed: { ...DEFAULTS.bypassed, ...preset.bypassed, ...sanitizePresetBypassed(override?.bypassed) }
  };
}

function saveCurrentPreset() {
  state.preset = normalizePreset(state.preset);
  state.presetOverrides = {
    ...state.presetOverrides,
    [state.preset]: {
      params: sanitizePresetParams(state.params),
      bypassed: sanitizePresetBypassed(state.bypassed, DEFAULTS.bypassed)
    }
  };
}

function sanitizePresetOverrides(source) {
  const result = {};
  if (!source || typeof source !== 'object') return result;
  for (const key of Object.keys(source)) {
    const presetKey = normalizePreset(key);
    result[presetKey] = {
      params: sanitizePresetParams(source[key]?.params),
      bypassed: sanitizePresetBypassed(source[key]?.bypassed)
    };
  }
  return result;
}

function sanitizePresetParams(source) {
  const result = {};
  if (!source || typeof source !== 'object') return result;
  for (const knob of KNOBS) {
    const value = Number(source[knob.key]);
    if (Number.isFinite(value)) result[knob.key] = clamp(value, 0, 1);
  }
  return result;
}

function sanitizePresetBypassed(source, fallback = {}) {
  const result = { ...fallback };
  if (!source || typeof source !== 'object') return result;
  for (const knob of KNOBS) {
    if (typeof source[knob.key] === 'boolean') result[knob.key] = source[knob.key];
  }
  return result;
}

function normalizePreset(key) {
  if (key === 'vrchat') return 'preset1';
  return PRESETS[key] ? key : DEFAULTS.preset;
}

function qualitySampleRate(q) {
  if (q === 'light') return 32000;
  if (q === 'balanced') return 44100;
  return 48000;
}

function qualityLatency(q) {
  if (q === 'light') return 0.008;
  if (q === 'balanced') return 0.004;
  return 0.0015;
}

function preferredInputLatency() {
  return isWindowsPlatform() ? 0.002 : 0.0025;
}

function isWindowsPlatform() {
  return /Windows|Win32|Win64|WOW64/i.test(`${navigator.userAgent} ${navigator.platform || ''}`);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('./sw.js'); } catch { /* optional */ }
  }
}