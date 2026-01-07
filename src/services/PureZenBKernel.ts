
/**
*    ZENB KERNEL V6.6 - SENTIENT OS (LEVEL 3)
* ===========================================
*    CAPABILITIES:
*    1. Autonomic Reflex (Sympathetic Override)
*    2. Resonance Watchdog
*    3. Strict Type Bounds (Safety)
*/
import { BreathPattern, BreathPhase, KernelEvent, BeliefState, BREATHING_PATTERNS, Observation, SafetyProfile } from '../types';
import { AdaptiveStateEstimator } from './AdaptiveStateEstimator';
import { nextPhaseSkipZero, isCycleBoundary } from './phaseMachine';
import { audioMiddleware, hapticMiddleware, biofeedbackMiddleware, Middleware } from './kernelMiddleware';
import { SafetyConfigType } from '../config/SafetyConfig';

// --- TYPES ---

export type RuntimeStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'HALTED' | 'SAFETY_LOCK';
export type AIConnectionStatus = 'connecting' | 'connected' | 'thinking' | 'speaking' | 'disconnected';

export interface RuntimeState {
  readonly version: number;
  readonly status: RuntimeStatus;
  readonly bootTimestamp: number;
  readonly lastUpdateTimestamp: number;
  
  // Protocol
  readonly pattern: BreathPattern | null;
  readonly tempoScale: number; 
  
  // Phase Machine
  readonly phase: BreathPhase;
  readonly phaseStartTime: number;
  readonly phaseDuration: number;
  readonly cycleCount: number;
  readonly sessionStartTime: number;
  
  // Belief State
  readonly belief: BeliefState;
  
  // Safety Registry (Kernel Owned)
  readonly safetyRegistry: Readonly<Record<string, SafetyProfile>>;
  
  // UI Cache (Computed/Ephemeral)
  readonly phaseElapsed: number;
  readonly sessionDuration: number;
  readonly lastObservation: Observation | null;
  
  // AI Context
  readonly aiActive: boolean;
  readonly aiStatus: AIConnectionStatus;
  readonly lastAiMessage: string | null;

  // Analysis Context
  readonly startBelief: BeliefState | null; 
}

// --- INITIAL STATE ---

function createInitialState(): RuntimeState {
  return {
    version: 6.6,
    status: 'IDLE',
    bootTimestamp: Date.now(),
    lastUpdateTimestamp: Date.now(),
    pattern: null,
    tempoScale: 1.0,
    phase: 'inhale',
    phaseStartTime: 0,
    phaseDuration: 0,
    cycleCount: 0,
    sessionStartTime: 0,
    belief: {
        arousal: 0.5,
        attention: 0.5,
        rhythm_alignment: 0.0,
        valence: 0.0,
        arousal_variance: 0.2,
        attention_variance: 0.2,
        rhythm_variance: 0.3,
        prediction_error: 0.0,
        innovation: 0.0,
        mahalanobis_distance: 0.0,
        confidence: 0.0
    },
    safetyRegistry: {},
    phaseElapsed: 0,
    sessionDuration: 0,
    lastObservation: null,
    aiActive: false,
    aiStatus: 'disconnected',
    lastAiMessage: null,
    startBelief: null
  };
}

// --- PURE REDUCER ---

function reduce(state: RuntimeState, event: KernelEvent): RuntimeState {
  switch (event.type) {
    case 'BOOT':
      return { ...state, status: 'IDLE', lastUpdateTimestamp: event.timestamp };
      
    case 'LOAD_PROTOCOL': {
      if (state.status === 'SAFETY_LOCK') return state;
      const pattern = BREATHING_PATTERNS[event.patternId];
      if (!pattern) return state;
      return {
        ...state,
        pattern,
        tempoScale: 1.0,
        phase: 'inhale',
        phaseStartTime: event.timestamp,
        phaseDuration: pattern.timings.inhale,
        cycleCount: 0,
        sessionStartTime: 0,
        belief: { ...state.belief, rhythm_alignment: 0, prediction_error: 0, confidence: 0 },
        lastUpdateTimestamp: event.timestamp,
        startBelief: null
      };
    }
    
    case 'START_SESSION':
      if (!state.pattern) return state;
      return {
        ...state,
        status: 'RUNNING',
        sessionStartTime: event.timestamp,
        phaseStartTime: event.timestamp,
        lastUpdateTimestamp: event.timestamp,
        startBelief: { ...state.belief } 
      };
      
    case 'INTERRUPTION':
      if (state.status !== 'RUNNING') return state;
      return { ...state, status: 'PAUSED', lastUpdateTimestamp: event.timestamp };
      
    case 'RESUME':
      if (state.status !== 'PAUSED') return state;
      const pauseDuration = event.timestamp - state.lastUpdateTimestamp;
      return {
        ...state,
        status: 'RUNNING',
        phaseStartTime: state.phaseStartTime + pauseDuration,
        lastUpdateTimestamp: event.timestamp
      };
      
    case 'HALT':
      return { 
          ...state, 
          status: 'HALTED', 
          lastUpdateTimestamp: event.timestamp, 
          aiActive: false, 
          aiStatus: 'disconnected',
          startBelief: null,
          tempoScale: 1.0 
      };
      
    case 'SAFETY_INTERDICTION':
      if (event.action === 'EMERGENCY_HALT') {
          return { ...state, status: 'SAFETY_LOCK', lastUpdateTimestamp: event.timestamp };
      }
      return state;

    case 'SYMPATHETIC_OVERRIDE': {
        // Level 3 Reflex: Forcefully switch to safe pattern
        const newPattern = BREATHING_PATTERNS[event.toPattern];
        if (!newPattern) return state;
        
        return {
            ...state,
            pattern: newPattern,
            phase: 'inhale', // Restart phase
            phaseStartTime: event.timestamp,
            phaseDuration: newPattern.timings.inhale,
            tempoScale: 1.0, // Reset tempo
            lastAiMessage: `Safety Override: Switching to ${newPattern.label}`,
            lastUpdateTimestamp: event.timestamp
        };
    }
      
    case 'PHASE_TRANSITION': {
      if (!state.pattern) return state;
      const baseDuration = state.pattern.timings[event.to];
      const scaledDuration = baseDuration * state.tempoScale;
      
      return {
        ...state,
        phase: event.to,
        phaseStartTime: event.timestamp,
        phaseDuration: scaledDuration,
        lastUpdateTimestamp: event.timestamp
      };
    }

    case 'ADJUST_TEMPO':
        return {
            ...state,
            tempoScale: event.scale,
            lastUpdateTimestamp: event.timestamp
        };
    
    case 'CYCLE_COMPLETE':
      return { ...state, cycleCount: event.count, lastUpdateTimestamp: event.timestamp };
      
    case 'BELIEF_UPDATE':
      return { ...state, belief: { ...event.belief }, lastUpdateTimestamp: event.timestamp };
      
    case 'TICK':
       return { 
           ...state, 
           lastUpdateTimestamp: event.timestamp, 
           lastObservation: event.observation 
       };

    case 'LOAD_SAFETY_REGISTRY':
        return { ...state, safetyRegistry: { ...event.registry }, lastUpdateTimestamp: event.timestamp };

    case 'AI_INTERVENTION':
        return { ...state, lastUpdateTimestamp: event.timestamp, aiActive: true };

    case 'AI_VOICE_MESSAGE':
        return { ...state, lastAiMessage: event.text, lastUpdateTimestamp: event.timestamp, aiStatus: 'speaking' };

    case 'AI_STATUS_CHANGE':
        return { ...state, aiStatus: event.status, lastUpdateTimestamp: event.timestamp, aiActive: event.status !== 'disconnected' };

    default:
      return state;
  }
}

// --- KERNEL CLASS ---

export class PureZenBKernel {
  private state: RuntimeState;
  private estimator: AdaptiveStateEstimator;
  private eventLog: KernelEvent[] = [];
  private readonly MAX_LOG_SIZE = 1000;
  private subscribers = new Set<(state: RuntimeState) => void>();
  private middlewares: Middleware[] = [];
  private commandQueue: KernelEvent[] = [];
  private fs: any;
  private config: SafetyConfigType;
  
  private lastNotifyTime = 0;
  private readonly NOTIFY_INTERVAL = 16;
  private lastNotifiedPhase: string | null = null;
  private lastNotifiedAiStatus: string | null = null;

  // Watchdog State
  private divergenceAccumulatorMs = 0;
  private traumaAccumulatorMs = 0; // New for Level 3

  constructor(config: SafetyConfigType, fs: any) {
    this.config = config;
    this.fs = fs;
    this.state = createInitialState();
    
    this.estimator = new AdaptiveStateEstimator({
        alpha: 1.5e-3,
        adaptive_r: true,
        q_base: 0.015,
        r_adaptation_rate: 0.2
    });

    this.use(audioMiddleware);
    this.use(hapticMiddleware);
    this.use(biofeedbackMiddleware);
    
    this.dispatch({ type: 'BOOT', timestamp: Date.now() });
    
    this.fs.getMeta('safetyRegistry').then((reg: any) => {
        if (reg) this.loadSafetyRegistry(reg);
    });

    this.fs.garbageCollect(this.config.persistence.retentionMs);
  }
  
  // --- INTERNAL SAFETY GUARD (THE HIPPOCRATIC LAYER) ---
  private safetyGuard(event: KernelEvent, state: RuntimeState): KernelEvent | null {
    if (state.status === 'SAFETY_LOCK' && event.type === 'START_SESSION') {
       return { type: 'SAFETY_INTERDICTION', riskLevel: 1.0, action: 'REJECT_START', timestamp: Date.now() };
    }
    
    // Emergency Halt (Panic Switch)
    if (event.type === 'BELIEF_UPDATE' && event.belief.prediction_error > 0.95 && state.sessionDuration > this.config.safety.minSessionSecBeforeEmergency) {
        // If we are ALREADY in a safe pattern, halt. Otherwise, let the Override Reflex handle it first.
        if (state.pattern?.id === '4-7-8' || state.pattern?.id === 'deep-relax') {
             return { type: 'SAFETY_INTERDICTION', riskLevel: 0.95, action: 'EMERGENCY_HALT', timestamp: Date.now() };
        }
    }
    
    if (event.type === 'LOAD_PROTOCOL') {
        const profile = state.safetyRegistry[event.patternId];
        if (profile && profile.safety_lock_until > Date.now()) {
            this.dispatch({ type: 'SAFETY_INTERDICTION', riskLevel: 0.8, action: 'PATTERN_LOCKED', timestamp: Date.now() });
            return null;
        }
    }

    if (event.type === 'ADJUST_TEMPO') {
        const SAFE_MIN = this.config.tempo.min;
        const SAFE_MAX = this.config.tempo.max;
        
        if (event.scale < SAFE_MIN || event.scale > SAFE_MAX) {
             console.warn(`[Kernel] Rejected unsafe tempo adjustment: ${event.scale}. Clamping to safety bounds.`);
             const clampedScale = Math.max(SAFE_MIN, Math.min(SAFE_MAX, event.scale));
             return { ...event, scale: clampedScale, reason: event.reason + ' (Clamped)' };
        }
    }

    return event;
  }

  // --- RESONANCE WATCHDOG (FEEDBACK LOOP PROTECTION) ---
  private checkResonanceIntegrity(dt: number, state: RuntimeState): void {
      if (!state.pattern || state.status !== 'RUNNING') return;

      // 1. DIVERGENCE CHECK (Tempo Stability)
      if (Math.abs(state.tempoScale - 1.0) > 0.01 && state.belief.prediction_error > this.config.watchdog.divergenceThreshold) {
          this.divergenceAccumulatorMs += (dt * 1000);
      } else {
          this.divergenceAccumulatorMs = Math.max(0, this.divergenceAccumulatorMs - (dt * 1000 * 2));
      }

      if (this.divergenceAccumulatorMs > this.config.watchdog.maxDivergenceTimeMs) {
          console.error("[Kernel] Watchdog: Resetting Rhythm.");
          this.divergenceAccumulatorMs = 0;
          this.commandQueue.push({ type: 'ADJUST_TEMPO', scale: 1.0, reason: 'WATCHDOG_RESET', timestamp: Date.now() });
          this.commandQueue.push({ type: 'AI_VOICE_MESSAGE', text: 'Resetting rhythm.', sentiment: 'system', timestamp: Date.now() });
      }

      // 2. THE HOT STOVE REFLEX (Real-time Trauma Prevention)
      // If Arousal is climbing AND Pattern Impact is positive (Stimulant), we are hurting the user.
      const isStimulant = state.pattern.arousalImpact > 0;
      const isHighArousal = state.belief.arousal > 0.7;
      
      if (isStimulant && isHighArousal) {
          this.traumaAccumulatorMs += (dt * 1000);
      } else {
          this.traumaAccumulatorMs = Math.max(0, this.traumaAccumulatorMs - (dt * 1000));
      }

      // If we persist in a damaging state for 5 seconds, OVERRIDE.
      if (this.traumaAccumulatorMs > 5000) {
          this.traumaAccumulatorMs = 0;
          this.commandQueue.push({
              type: 'SYMPATHETIC_OVERRIDE',
              fromPattern: state.pattern.id,
              toPattern: 'deep-relax', // Fallback to safe zone
              reason: 'HYPER_AROUSAL_INTERVENTION',
              timestamp: Date.now()
          });
          
          // Log trauma instantly
          this.analyzeSessionTrauma(state); // Update registry
      }
  }

  // --- TRAUMA LEARNING ---
  private analyzeSessionTrauma(state: RuntimeState): void {
      if (!state.pattern || !state.startBelief) return;

      const patternId = state.pattern.id;
      const start = state.startBelief;
      const end = state.belief;
      const isEnergizing = state.pattern.arousalImpact > 0.1;
      
      let deltaArousal = end.arousal - start.arousal; 
      if (isEnergizing) deltaArousal = -deltaArousal;

      const outcomeCost = deltaArousal - (end.valence - start.valence);
      const profile = state.safetyRegistry[patternId] || {
          patternId,
          cummulative_stress_score: 0,
          last_incident_timestamp: 0,
          safety_lock_until: 0,
          resonance_history: [],
          resonance_score: 0.5 
      };

      const sessionScore = Math.max(0, Math.min(1, 0.5 - (outcomeCost * 0.5)));
      const history = [sessionScore, ...profile.resonance_history].slice(0, 5);
      const avgScore = history.reduce((a,b)=>a+b, 0) / history.length;
      
      let lockUntil = profile.safety_lock_until;
      let stressScore = profile.cummulative_stress_score;
      
      // Strict Penalty: If we increased arousal on a relax pattern, strike it.
      if (!isEnergizing && deltaArousal > 0.2) {
          stressScore += 1;
          if (stressScore >= 3) {
              lockUntil = Date.now() + 24 * 60 * 60 * 1000; // 24h Lock
              stressScore = 0;
          }
      } else {
          stressScore = Math.max(0, stressScore - 0.5);
      }

      const newProfile: SafetyProfile = {
          ...profile,
          resonance_history: history,
          resonance_score: avgScore,
          cummulative_stress_score: stressScore,
          safety_lock_until: lockUntil,
          last_incident_timestamp: Date.now()
      };

      this.updateSafetyProfile(patternId, newProfile);
  }

  // --- PUBLIC API ---
  
  public dispatch(event: KernelEvent): void {
    if (event.type === 'HALT') {
        this.analyzeSessionTrauma(this.state);
        this.divergenceAccumulatorMs = 0;
        this.traumaAccumulatorMs = 0;
    }

    this.processEvent(event);
    
    let depth = 0;
    const MAX_DEPTH = 5;
    while(this.commandQueue.length > 0 && depth < MAX_DEPTH) {
        const cmd = this.commandQueue.shift();
        if (cmd) this.processEvent(cmd);
        depth++;
    }
  }

  private processEvent(event: KernelEvent) {
      const beforeState = this.state;
      const guardedEvent = this.safetyGuard(event, beforeState);
      if (!guardedEvent) return;
      
      this.eventLog.push(guardedEvent);
      if (this.eventLog.length > this.MAX_LOG_SIZE) this.eventLog.shift();
      
      if (guardedEvent.type !== 'TICK') {
          this.fs.writeEvent(guardedEvent);
      }
      
      const reducedState = reduce(beforeState, guardedEvent);
      const enrichedState = this.computeDerivedFields(reducedState);
      
      this.state = enrichedState;
      
      const api = { queue: (cmd: KernelEvent) => this.commandQueue.push(cmd) };
      this.middlewares.forEach(mw => mw(guardedEvent, beforeState, enrichedState, api));
      
      this.notify();
  }
  
  public tick(dt: number, observation: Observation): void {
      const now = Date.now();
      
      this.estimator.setProtocol(this.state.pattern); 
      const newBelief = this.estimator.update(observation, dt);
      
      this.dispatch({ type: 'BELIEF_UPDATE', belief: newBelief, timestamp: now });
      
      if (this.state.status === 'RUNNING' && this.state.pattern) {
          // RUN LEVEL 3 WATCHDOG
          this.checkResonanceIntegrity(dt, this.state);

          const elapsed = (now - this.state.phaseStartTime) / 1000;
          
          if (elapsed >= this.state.phaseDuration) {
              const nextPhase = nextPhaseSkipZero(this.state.phase, this.state.pattern);
              this.dispatch({ 
                  type: 'PHASE_TRANSITION', 
                  from: this.state.phase, 
                  to: nextPhase, 
                  timestamp: now 
              });
              
              if (isCycleBoundary(nextPhase)) {
                  this.dispatch({ 
                      type: 'CYCLE_COMPLETE', 
                      count: this.state.cycleCount + 1, 
                      timestamp: now 
                  });
              }
          }
      }
      
      this.dispatch({ type: 'TICK', dt, observation, timestamp: now });
  }
  
  public getState(): RuntimeState { return this.state; }
  
  public subscribe(callback: (state: RuntimeState) => void): () => void {
      this.subscribers.add(callback);
      callback(this.state);
      return () => { this.subscribers.delete(callback); };
  }
  
  public use(middleware: Middleware): void { this.middlewares.push(middleware); }
  
  public loadSafetyRegistry(registry: Record<string, SafetyProfile>): void {
      this.dispatch({ type: 'LOAD_SAFETY_REGISTRY', registry, timestamp: Date.now() });
  }

  public updateSafetyProfile(patternId: string, profile: SafetyProfile) {
      const newRegistry = { ...this.state.safetyRegistry, [patternId]: profile };
      this.loadSafetyRegistry(newRegistry);
      this.fs.setMeta('safetyRegistry', newRegistry);
  }
  
  public getLogBuffer(): KernelEvent[] { return [...this.eventLog]; }
  
  // --- INTERNAL ---
  
  private computeDerivedFields(state: RuntimeState): RuntimeState {
      const now = Date.now();
      return {
          ...state,
          phaseElapsed: state.status === 'RUNNING' ? Math.max(0, (now - state.phaseStartTime) / 1000) : 0,
          sessionDuration: state.sessionStartTime > 0 ? Math.max(0, (now - state.sessionStartTime) / 1000) : 0
      };
  }
  
  private notify(): void {
      const now = performance.now();
      
      const isCritical = this.state.status === 'SAFETY_LOCK' || 
                         this.state.phase !== this.lastNotifiedPhase ||
                         this.state.status !== 'RUNNING' ||
                         this.state.aiStatus !== this.lastNotifiedAiStatus ||
                         this.state.lastAiMessage !== null; 
      
      if (isCritical || (now - this.lastNotifyTime) >= this.NOTIFY_INTERVAL) {
        this.subscribers.forEach(cb => {
            try { cb(this.state); } catch(e) { console.error('Subscriber error', e); }
        });
        this.lastNotifyTime = now;
        this.lastNotifiedPhase = this.state.phase;
        this.lastNotifiedAiStatus = this.state.aiStatus;
      }
  }
}
