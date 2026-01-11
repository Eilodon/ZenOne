
import * as Tone from 'tone';
import { SoundPack, CueType, Language } from '../types';
import { SAFE_SYNTHESIS_PRESETS } from './audio-synthesis-safe';

// ============================================================================
// PROFESSIONAL ZEN AUDIO ENGINE V2.2 (With Scheduling)
// ============================================================================

const TRANSLATIONS = {
    en: {
        phases: { inhale: 'Breathe in', exhale: 'Breathe out', hold: 'Hold' },
        ui: { finish: 'Complete' }
    },
    vi: {
        phases: { inhale: 'Hít vào', exhale: 'Thở ra', hold: 'Giữ' },
        ui: { finish: 'Hoàn thành' }
    }
};

let isInitialized = false;
let isInitializing = false;

// Master processing chain
let masterBus: Tone.Channel | null = null;
let spatializer: Tone.StereoWidener | null = null;
let panner3D: Tone.Panner3D | null = null; // [NEW] Spatial Audio
let masterEQ: Tone.EQ3 | null = null;
let warmth: Tone.Distortion | null = null;
let compressor: Tone.Compressor | null = null;
let reverb: Tone.Reverb | null = null;
let limiter: Tone.Limiter | null = null;
let duckingGain: Tone.Gain | null = null;

// Instrument layers
type SynthLayers = {
    sub: Tone.Synth;
    body: Tone.AMSynth;
    air: Tone.Synth;
    texture: Tone.FMSynth;
};
let synthLayers: SynthLayers | null = null;

// Breath synthesis
type BreathEngine = {
    white: Tone.Noise;
    pink: Tone.Noise;
    brown: Tone.Noise;
    formant1: Tone.Filter;
    formant2: Tone.Filter;
    formant3: Tone.Filter;
    highpass: Tone.Filter;
    lfo1: Tone.LFO;
    lfo2: Tone.LFO;
    whiteGain: Tone.Gain;
    pinkGain: Tone.Gain;
    brownGain: Tone.Gain;
    mixGain: Tone.Gain;
};
let breathEngine: BreathEngine | null = null;

// Singing bowls
type SingingBowl = {
    synth: Tone.Synth;
    vibrato: Tone.LFO;
    shimmer: Tone.LFO;
    gain: Tone.Gain;
};
let bowls: SingingBowl[] = [];

// Crystal bells
type CrystalBell = {
    synth: Tone.MetalSynth;
    chorus: Tone.Chorus;
    gain: Tone.Gain;
};
let bells: CrystalBell[] = [];

// Ambient pad
let ambientPad: Tone.PolySynth | null = null;
let padFilter: Tone.Filter | null = null;
let padGain: Tone.Gain | null = null;

// Sample bank
type SampleBank = {
    inhale: Tone.Player[];
    exhale: Tone.Player[];
    hold: Tone.Player[];
    finish: Tone.Player[];
    ambience?: Tone.Player;
};
let sampleBank: SampleBank | null = null;

let lastCueKey = '';
let lastCueTime = 0;

// ============================================================================
// [P0.3 UPGRADE] ADAPTIVE AUDIO MIXING - Device-Aware Processing
// ============================================================================

type DeviceAudioProfile = {
  eq: { low: number; mid: number; high: number };
  reverb: { decay: number; wet: number };
  compression: { threshold: number; ratio: number };
  spatializer: number;
  description: string;
};

function getDeviceAudioProfile(): DeviceAudioProfile {
  const isMobile = /iPhone|iPad|Android/i.test(navigator.userAgent);
  const isLowEnd = navigator.hardwareConcurrency < 4;
  const cores = navigator.hardwareConcurrency || 4;

  // Low-end mobile: Boost presence, reduce bass (weak speakers)
  if (isMobile && isLowEnd) {
    return {
      eq: { low: -3, mid: +2, high: +1 },  // Cut bass, boost mids/highs
      reverb: { decay: 2.0, wet: 0.15 },   // Lighter reverb
      compression: { threshold: -15, ratio: 3.5 },  // More compression
      spatializer: 0.25,                   // Reduced spatial width
      description: 'Mobile Low-End (< 4 cores)'
    };
  }

  // Standard mobile: Balanced with presence boost
  if (isMobile) {
    return {
      eq: { low: -2, mid: +1, high: 0 },
      reverb: { decay: 2.8, wet: 0.22 },
      compression: { threshold: -16, ratio: 2.8 },
      spatializer: 0.30,
      description: `Mobile Standard (${cores} cores)`
    };
  }

  // Desktop/High-end: Full-range, natural response
  return {
    eq: { low: -1, mid: +0.5, high: -0.5 },  // Current settings
    reverb: { decay: 3.2, wet: 0.28 },
    compression: { threshold: -18, ratio: 2.5 },
    spatializer: 0.35,
    description: `Desktop (${cores} cores)`
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function clamp(x: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, x));
}

function randomRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

function dbToGain(db: number): number {
    return Math.pow(10, db / 20);
}

function safeDispose(node: any): void {
    try {
        if (node && typeof node.dispose === 'function') {
            node.dispose();
        }
    } catch (e) {
        console.warn('Dispose error:', e);
    }
}

function randomPick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ============================================================================
// MASTER PROCESSING CHAIN
// ============================================================================

function buildMasterChain(): void {
    if (masterBus) return;

    // [P0.3 UPGRADE] Get adaptive audio profile based on device
    const audioProfile = getDeviceAudioProfile();
    console.log(`🎵 Audio Profile: ${audioProfile.description}`);

    masterBus = new Tone.Channel({ volume: -6 });
    spatializer = new Tone.StereoWidener(audioProfile.spatializer);

    // [NEW] 3D Panner for breathing expansion/contraction illusion
    panner3D = new Tone.Panner3D({
        panningModel: 'HRTF',
        positionX: 0,
        positionY: 0,
        positionZ: 0,
        rolloffFactor: 1.5
    });

    masterEQ = new Tone.EQ3({
        low: audioProfile.eq.low,
        mid: audioProfile.eq.mid,
        high: audioProfile.eq.high,
        lowFrequency: 200,
        highFrequency: 5000
    });
    warmth = new Tone.Distortion(SAFE_SYNTHESIS_PRESETS.warmth);
    compressor = new Tone.Compressor({
        threshold: audioProfile.compression.threshold,
        ratio: audioProfile.compression.ratio,
        attack: 0.08,
        release: 0.35,
        knee: 10
    });
    reverb = new Tone.Reverb({
        decay: audioProfile.reverb.decay,
        preDelay: 0.015,
        wet: audioProfile.reverb.wet
    });
    limiter = new Tone.Limiter(-0.3);
    duckingGain = new Tone.Gain(1.0);

    // Connect Chain:
    // EQ -> Warmth -> Compressor -> Reverb -> Ducking -> Panner3D -> Spatializer -> Limiter -> Out
    masterEQ.connect(warmth);
    warmth.connect(compressor);
    compressor.connect(reverb);
    reverb.connect(duckingGain);
    duckingGain.connect(panner3D);
    panner3D.connect(spatializer);
    spatializer.connect(limiter);
    limiter.connect(masterBus);
    masterBus.toDestination();

    reverb.generate().catch(() => { });
}

export function setAiDucking(isSpeaking: boolean) {
    if (!duckingGain) return;
    const now = Tone.now();
    const targetGain = isSpeaking ? 0.25 : 1.0;
    duckingGain.gain.cancelScheduledValues(now);
    duckingGain.gain.rampTo(targetGain, 0.5, now);
}

/**
 * Updates the 3D position of the audio listener/source to match the breath expansion.
 * @param expansion 0.0 (contracted/exhale) to 1.0 (expanded/inhale)
 */
export function setSpatialBreathParams(expansion: number) {
    if (!panner3D) return;
    // When inhaling (expansion -> 1), sound moves z-axis
    const zPos = (expansion * 2) - 1; // -1 to +1
    panner3D.positionZ.rampTo(zPos, 0.1);
}

// ============================================================================
// SYNTH LAYERS
// ============================================================================

function buildSynthLayers(): SynthLayers {
    if (!masterEQ) buildMasterChain();

    const sub = new Tone.Synth({
        oscillator: SAFE_SYNTHESIS_PRESETS.synthLayers.sub.oscillator,
        envelope: SAFE_SYNTHESIS_PRESETS.synthLayers.sub.envelope
    });
    sub.volume.value = -16;

    const body = new Tone.AMSynth({
        harmonicity: SAFE_SYNTHESIS_PRESETS.synthLayers.body.harmonicity,
        oscillator: SAFE_SYNTHESIS_PRESETS.synthLayers.body.oscillator,
        envelope: SAFE_SYNTHESIS_PRESETS.synthLayers.body.envelope,
        modulation: { type: 'sine' },
        modulationEnvelope: SAFE_SYNTHESIS_PRESETS.synthLayers.body.modulationEnvelope
    });
    body.volume.value = -11;

    const air = new Tone.Synth({
        oscillator: { type: 'triangle' },
        envelope: {
            attack: 0.3,
            decay: 1.2,
            sustain: 0.35,
            release: 2.8,
            releaseCurve: 'exponential'
        }
    });
    air.volume.value = -20;

    const texture = new Tone.FMSynth({
        harmonicity: 2.2,
        modulationIndex: 8,
        oscillator: { type: 'triangle' },
        envelope: {
            attack: 0.8,
            decay: 0.5,
            sustain: 0.5,
            release: 2.0
        },
        modulation: { type: 'sine' },
        modulationEnvelope: {
            attack: 0.4,
            decay: 0.3,
            sustain: 0.6,
            release: 1.5
        }
    });
    texture.volume.value = -22;

    sub.connect(masterEQ!);
    body.connect(masterEQ!);
    air.connect(masterEQ!);
    texture.connect(masterEQ!);

    return { sub, body, air, texture };
}

// ============================================================================
// BREATH ENGINE
// ============================================================================

function buildBreathEngine(): BreathEngine {
    if (!masterEQ) buildMasterChain();

    const white = new Tone.Noise('white');
    const pink = new Tone.Noise('pink');
    const brown = new Tone.Noise('brown');

    const formant1 = new Tone.Filter(SAFE_SYNTHESIS_PRESETS.breathFormants.formant1);
    const formant2 = new Tone.Filter(SAFE_SYNTHESIS_PRESETS.breathFormants.formant2);
    const formant3 = new Tone.Filter({ type: 'bandpass', frequency: 2400, Q: 2.8, rolloff: -12 });
    const highpass = new Tone.Filter({ type: 'highpass', frequency: 180, rolloff: -12 });

    const lfo1 = new Tone.LFO({ frequency: 0.35, min: 700, max: 850 });
    lfo1.connect(formant1.frequency);
    lfo1.start();

    const lfo2 = new Tone.LFO({ frequency: 0.42, min: 1100, max: 1250 });
    lfo2.connect(formant2.frequency);
    lfo2.start();

    const whiteGain = new Tone.Gain(0.0);
    const pinkGain = new Tone.Gain(0.0);
    const brownGain = new Tone.Gain(0.0);
    const mixGain = new Tone.Gain(0.0);

    white.connect(formant1); formant1.connect(whiteGain);
    pink.connect(formant2); formant2.connect(pinkGain);
    brown.connect(formant3); formant3.connect(highpass); highpass.connect(brownGain);

    whiteGain.connect(mixGain); pinkGain.connect(mixGain); brownGain.connect(mixGain);
    mixGain.connect(masterEQ!);

    white.start(); pink.start(); brown.start();

    return { white, pink, brown, formant1, formant2, formant3, highpass, lfo1, lfo2, whiteGain, pinkGain, brownGain, mixGain };
}

// ============================================================================
// SINGING BOWLS
// ============================================================================

function createSingingBowl(): SingingBowl {
    if (!masterEQ) buildMasterChain();

    const synth = new Tone.Synth({
        oscillator: { type: 'custom', partials: [1.0, 2.67, 5.40, 8.17] },
        envelope: SAFE_SYNTHESIS_PRESETS.bowlPartials.envelope
    });

    const vibrato = new Tone.LFO(SAFE_SYNTHESIS_PRESETS.bowlPartials.vibrato);
    vibrato.connect(synth.detune);
    vibrato.start();

    const shimmer = new Tone.LFO({ frequency: 0.15, min: 0.85, max: 1.0 });
    const gain = new Tone.Gain(1.0);
    shimmer.connect(gain.gain);
    shimmer.start();

    synth.connect(gain);
    gain.connect(masterEQ!);

    return { synth, vibrato, shimmer, gain };
}

function initializeBowls(count: number = 3): void {
    for (let i = 0; i < count; i++) { bowls.push(createSingingBowl()); }
}

function createCrystalBell(): CrystalBell {
    if (!masterEQ) buildMasterChain();
    const synth = new Tone.MetalSynth(SAFE_SYNTHESIS_PRESETS.crystalBell);
    const chorus = new Tone.Chorus({ frequency: 2.5, delayTime: 3.5, depth: 0.6, wet: 0.5 });
    chorus.start();
    const gain = new Tone.Gain(1.0);
    synth.connect(chorus); chorus.connect(gain); gain.connect(masterEQ!);
    return { synth, chorus, gain };
}

function initializeBells(count: number = 2): void {
    for (let i = 0; i < count; i++) { bells.push(createCrystalBell()); }
}

function buildAmbientPad(): void {
    if (!masterEQ) buildMasterChain();
    ambientPad = new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.05, decay: 0.2, sustain: 0.35, release: 1.8 }
    });
    padFilter = new Tone.Filter({ type: 'lowpass', frequency: 2500, rolloff: -12, Q: 1.2 });
    padGain = new Tone.Gain(0.0);
    ambientPad.connect(padFilter); padFilter.connect(padGain); padGain.connect(masterEQ!);
}

const SAMPLE_URLS = {
    inhale: ['/audio/real-zen/inhale_01.wav', '/audio/real-zen/inhale_02.wav', '/audio/real-zen/inhale_03.wav'],
    exhale: ['/audio/real-zen/exhale_01.wav', '/audio/real-zen/exhale_02.wav', '/audio/real-zen/exhale_03.wav'],
    hold: ['/audio/real-zen/hold_01.wav', '/audio/real-zen/hold_02.wav'],
    finish: ['/audio/real-zen/finish_01.wav'],
    ambience: '/audio/real-zen/ambience_loop.wav'
};

async function loadSampleBank(): Promise<SampleBank | null> {
    if (sampleBank) return sampleBank;
    if (!masterEQ) buildMasterChain();

    try {
        const check = await fetch(SAMPLE_URLS.inhale[0], { method: 'HEAD' });
        if (!check.ok) throw new Error("Samples missing");

        const createPlayers = (urls: string[], volumeDb: number) =>
            urls.map(url => {
                const player = new Tone.Player({ url, autostart: false, fadeIn: 0.02, fadeOut: 0.03 });
                player.volume.value = volumeDb;
                player.connect(masterEQ!);
                return player;
            });

        const bank: SampleBank = {
            inhale: createPlayers(SAMPLE_URLS.inhale, -12),
            exhale: createPlayers(SAMPLE_URLS.exhale, -12),
            hold: createPlayers(SAMPLE_URLS.hold, -14),
            finish: createPlayers(SAMPLE_URLS.finish, -10)
        };

        if (SAMPLE_URLS.ambience) {
            const ambience = new Tone.Player({ url: SAMPLE_URLS.ambience, loop: true, autostart: false, fadeIn: 1.2, fadeOut: 1.5 });
            ambience.volume.value = -32;
            ambience.connect(masterEQ!);
            bank.ambience = ambience;
        }
        sampleBank = bank;
        return bank;
    } catch (error) {
        console.warn('Sample loading failed, will use synthesis fallback:', error);
        return null;
    }
}

async function initializeAudioSystem(): Promise<void> {
    if (isInitialized || isInitializing) return;
    isInitializing = true;
    try {
        await Tone.start();
        buildMasterChain();
        synthLayers = buildSynthLayers();
        breathEngine = buildBreathEngine();
        initializeBowls(3);
        initializeBells(2);
        buildAmbientPad();
        isInitialized = true;
        console.log('✅ Zen Audio Engine initialized');
    } catch (error) {
        console.error('Audio initialization failed:', error);
        throw error;
    } finally {
        isInitializing = false;
    }
}

// [NEW] Robust Unlock with Retry
export const unlockAudio = async (retries = 3): Promise<void> => {
    if (isInitialized) return;

    for (let i = 0; i < retries; i++) {
        try {
            await initializeAudioSystem();
            if (Tone.context.state === 'running') return;
        } catch (e) {
            console.warn(`[AUDIO] Unlock attempt ${i + 1} failed, retrying...`);
            await new Promise(r => setTimeout(r, 300 * Math.pow(2, i))); // Exponential backoff
        }
    }
    console.error('[AUDIO] Critical Failure: Could not start Audio Context after retries.');
};

function shouldSkipCue(cue: CueType, pack: SoundPack, duration: number): boolean {
    const now = performance.now();
    const bucket = Math.floor(now / 80);
    const key = `${pack}:${cue}:${bucket}:${Math.round(duration * 100)}`;
    if (lastCueKey === key && (now - lastCueTime) < 120) return true;
    lastCueKey = key;
    lastCueTime = now;
    return false;
}

function speakCue(text: string, lang: Language): void {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang === 'vi' ? 'vi-VN' : 'en-US';
        utterance.rate = lang === 'vi' ? 0.88 : 0.92;
        utterance.pitch = 0.95;
        utterance.volume = 0.85;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
    } catch (error) {
        console.warn('Speech synthesis error:', error);
    }
}

function playOrganicBreath(shape: 'inhale' | 'exhale', duration: number, when: number): void {
    if (!breathEngine) return;
    const dur = clamp(duration, 0.3, 15);
    const { formant1, formant2, whiteGain, pinkGain, brownGain, mixGain } = breathEngine;

    if (shape === 'inhale') {
        formant1.frequency.setTargetAtTime(800, when, 0.08);
        formant2.frequency.setTargetAtTime(1200, when, 0.08);
    } else {
        formant1.frequency.setTargetAtTime(650, when, 0.08);
        formant2.frequency.setTargetAtTime(950, when, 0.08);
    }

    const rampStart = 0.05;
    mixGain.gain.cancelScheduledValues(when);
    mixGain.gain.setValueAtTime(mixGain.gain.value, when);
    mixGain.gain.linearRampToValueAtTime(dbToGain(-12), when + rampStart);
    mixGain.gain.linearRampToValueAtTime(dbToGain(-14), when + dur * 0.7);
    mixGain.gain.linearRampToValueAtTime(0, when + dur);

    whiteGain.gain.cancelScheduledValues(when);
    whiteGain.gain.setValueAtTime(0, when);
    whiteGain.gain.linearRampToValueAtTime(0.32, when + rampStart);
    whiteGain.gain.linearRampToValueAtTime(0, when + dur);

    pinkGain.gain.cancelScheduledValues(when);
    pinkGain.gain.setValueAtTime(0, when);
    pinkGain.gain.linearRampToValueAtTime(0.48, when + rampStart);
    pinkGain.gain.linearRampToValueAtTime(0, when + dur);

    brownGain.gain.cancelScheduledValues(when);
    brownGain.gain.setValueAtTime(0, when);
    brownGain.gain.linearRampToValueAtTime(0.20, when + rampStart);
    brownGain.gain.linearRampToValueAtTime(0, when + dur);
}

function playSynthCue(cue: CueType, duration: number, when: number): void {
    if (!synthLayers) return;
    const dur = clamp(duration, 0.3, 15);
    const cents = randomRange(-12, 12);
    const { sub, body, air, texture } = synthLayers;

    if (cue === 'inhale') {
        sub.detune.value = cents;
        sub.triggerAttackRelease('C2', Math.min(dur * 0.85, 6), when);
        body.detune.value = cents;
        body.triggerAttackRelease('C3', Math.min(dur * 0.75, 5), when + 0.05);
        air.detune.value = cents + 5;
        air.triggerAttackRelease('C5', Math.min(dur * 0.65, 4), when + 0.1);
        texture.detune.value = cents - 3;
        texture.triggerAttackRelease('G3', Math.min(dur * 0.6, 4.5), when + 0.15);

        if (ambientPad && padGain) {
            padGain.gain.cancelScheduledValues(when);
            padGain.gain.setValueAtTime(0, when);
            padGain.gain.linearRampToValueAtTime(dbToGain(-28), when + 0.3);
            padGain.gain.linearRampToValueAtTime(0, when + dur * 0.5);
            ambientPad.triggerAttackRelease(['C4', 'E4', 'G4'], dur * 0.4, when + 0.1);
        }
    } else if (cue === 'exhale') {
        sub.detune.value = cents;
        sub.triggerAttackRelease('A1', Math.min(dur * 0.85, 6), when);
        body.detune.value = cents;
        body.triggerAttackRelease('A2', Math.min(dur * 0.75, 5), when + 0.05);
        air.detune.value = cents - 5;
        air.triggerAttackRelease('A4', Math.min(dur * 0.65, 4), when + 0.1);
        texture.detune.value = cents + 3;
        texture.triggerAttackRelease('E3', Math.min(dur * 0.6, 4.5), when + 0.15);

        if (ambientPad && padGain) {
            padGain.gain.cancelScheduledValues(when);
            padGain.gain.setValueAtTime(0, when);
            padGain.gain.linearRampToValueAtTime(dbToGain(-28), when + 0.3);
            padGain.gain.linearRampToValueAtTime(0, when + dur * 0.5);
            ambientPad.triggerAttackRelease(['A3', 'C4', 'E4'], dur * 0.4, when + 0.1);
        }
    } else if (cue === 'hold') {
        if (bells.length > 0) {
            const bell = randomPick(bells);
            bell.synth.frequency.value = 330 + randomRange(-15, 15);
            bell.gain.gain.setValueAtTime(dbToGain(-20), when);
            bell.synth.triggerAttackRelease(0.04, when);
        }
    } else if (cue === 'finish') {
        if (bells.length > 0) {
            bells.forEach((bell, i) => {
                bell.synth.frequency.value = [440, 550][i % 2] + randomRange(-10, 10);
                bell.gain.gain.setValueAtTime(dbToGain(-18), when + i * 0.08);
                bell.synth.triggerAttackRelease(0.1, when + i * 0.08);
            });
        }
        if (bowls.length > 0) {
            const bowl = bowls[0];
            bowl.gain.gain.setValueAtTime(dbToGain(-16), when + 0.05);
            bowl.synth.triggerAttackRelease('C3', 2.5, when + 0.05);
        }
    }
}

function playSingingBowl(cue: CueType, when: number): void {
    if (bowls.length === 0) return;
    const bowl = randomPick(bowls);
    let note = 'C3';
    let duration = 3.0;
    if (cue === 'inhale') { note = 'E3'; duration = 3.5; }
    else if (cue === 'exhale') { note = 'A2'; duration = 3.5; }
    else if (cue === 'hold') { note = 'G3'; duration = 1.2; }
    else if (cue === 'finish') { note = 'C3'; duration = 5.0; }

    bowl.gain.gain.setValueAtTime(dbToGain(-14), when);
    bowl.synth.detune.value = randomRange(-8, 8);
    bowl.synth.triggerAttackRelease(note, duration, when);
}

export async function playCue(
    cue: CueType,
    enabled: boolean,
    pack: SoundPack,
    duration: number,
    lang: Language = 'en'
): Promise<void> {
    if (!enabled) return;
    if (shouldSkipCue(cue, pack, duration)) return;

    if (!isInitialized) await initializeAudioSystem();
    try { if (Tone.context.state !== 'running') await Tone.context.resume(); } catch { }

    // SCHEDULING FIX: Schedule a bit in the future to allow UI thread jitter
    const when = Tone.now() + 0.05;

    if (pack.startsWith('voice')) {
        const t = TRANSLATIONS[lang] || TRANSLATIONS.en;
        let text = '';
        if (pack === 'voice-12') {
            if (cue === 'inhale') text = lang === 'vi' ? 'Một' : 'One';
            else if (cue === 'exhale') text = lang === 'vi' ? 'Hai' : 'Two';
            else if (cue === 'hold') text = lang === 'vi' ? 'Giữ' : 'Hold';
        } else {
            if (cue === 'inhale') text = t.phases.inhale;
            else if (cue === 'exhale') text = t.phases.exhale;
            else if (cue === 'hold') text = t.phases.hold;
            else if (cue === 'finish') text = t.ui.finish;
        }
        if (text) speakCue(text.toLowerCase(), lang);
        return;
    }

    const dur = clamp(duration, 0.3, 15);

    if (pack === 'real-zen') {
        const bank = await loadSampleBank();
        if (bank) {
            if (bank.ambience) {
                try {
                    if (cue === 'inhale' && bank.ambience.state !== 'started') bank.ambience.start();
                    if (cue === 'finish' && bank.ambience.state === 'started') bank.ambience.stop('+0.2');
                } catch { }
            }
            const pool = cue === 'inhale' ? bank.inhale : cue === 'exhale' ? bank.exhale : cue === 'hold' ? bank.hold : bank.finish;
            if (pool && pool.length > 0) {
                const player = randomPick(pool);
                player.volume.value += randomRange(-1.5, 1.0);
                try { player.start(when); } catch { }
            }
            if (cue === 'inhale' || cue === 'exhale') playOrganicBreath(cue, dur, when);
            return;
        }
    }

    if (pack === 'synth' || pack === 'real-zen') {
        playSynthCue(cue, dur, when);
        if (cue === 'inhale' || cue === 'exhale') playOrganicBreath(cue, dur, when);
    }

    if (pack === 'breath') {
        if (cue === 'inhale' || cue === 'exhale') {
            playOrganicBreath(cue, dur, when);
            if (synthLayers) {
                synthLayers.sub.volume.value = -24;
                synthLayers.sub.triggerAttackRelease(cue === 'inhale' ? 'C2' : 'A1', Math.min(dur * 0.6, 4), when);
            }
        } else {
            playSingingBowl(cue, when);
        }
    }

    if (pack === 'bells') {
        playSingingBowl(cue, when);
        if (bells.length > 0) {
            const bell = randomPick(bells);
            const freq = cue === 'inhale' ? 330 : cue === 'exhale' ? 264 : cue === 'hold' ? 396 : 440;
            bell.synth.frequency.value = freq + randomRange(-12, 12);
            bell.gain.gain.setValueAtTime(dbToGain(-16), when);
            bell.synth.triggerAttackRelease(cue === 'hold' ? 0.05 : cue === 'finish' ? 0.12 : 0.08, when);
        }
    }
}

export function cleanupAudio(): void {
    try { sampleBank?.ambience?.stop(); } catch { }
    if (sampleBank) {
        [...sampleBank.inhale, ...sampleBank.exhale, ...sampleBank.hold, ...sampleBank.finish].forEach(safeDispose);
        safeDispose(sampleBank.ambience);
    }
    sampleBank = null;

    if (synthLayers) Object.values(synthLayers).forEach(safeDispose);
    synthLayers = null;

    if (breathEngine) {
        breathEngine.lfo1.stop();
        breathEngine.lfo2.stop();
        Object.values(breathEngine).forEach(safeDispose);
    }
    breathEngine = null;

    bowls.forEach(b => { b.vibrato.stop(); b.shimmer.stop(); safeDispose(b.synth); safeDispose(b.gain); });
    bowls = [];

    bells.forEach(b => { safeDispose(b.chorus); safeDispose(b.synth); safeDispose(b.gain); });
    bells = [];

    safeDispose(ambientPad); safeDispose(padFilter); safeDispose(padGain);
    ambientPad = null; padFilter = null; padGain = null;

    safeDispose(spatializer); safeDispose(masterEQ); safeDispose(warmth);
    safeDispose(compressor); safeDispose(reverb); safeDispose(limiter); safeDispose(duckingGain); safeDispose(masterBus); safeDispose(panner3D);
    masterBus = null; spatializer = null; masterEQ = null; warmth = null; compressor = null; reverb = null; limiter = null; duckingGain = null; panner3D = null;

    if (typeof window !== 'undefined' && window.speechSynthesis) try { window.speechSynthesis.cancel(); } catch { }

    isInitialized = false;
    isInitializing = false;
    console.log('🔇 Zen Audio Engine cleaned up');
}
