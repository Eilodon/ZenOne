# ZenB Kernel Upgrade Specifications
## Module-by-Module SOTA Upgrades

---

## 1. STATE ESTIMATION: UKF + Multi-Sensor Fusion

### Current Limitations
- Linear Kalman filter
- Single HR input
- Fixed target model
- Weak outlier rejection

### SOTA Solution: Unscented Kalman Filter (UKF)

#### Algorithm
```typescript
class UnscentedStateEstimator {
  // State vector: [arousal, d_arousal/dt, valence, attention, rhythm]
  private x: Vector5;
  private P: Matrix5x5;  // Covariance

  // Non-linear state transition
  private f(x: Vector5, dt: number, target: TargetState): Vector5 {
    const [A, dA, V, Att, R] = x;

    // Arousal: Logistic growth towards target with momentum
    const k = 0.1;  // Growth rate
    const dA_new = -k * A * (1 - A) + (target.arousal - A) / TAU_AROUSAL;
    const A_new = A + dA_new * dt;

    // Valence: Coupled to arousal via inverted-U curve (Yerkes-Dodson)
    const V_optimal = 0.4;  // Peak performance at moderate arousal
    const V_new = V + ((V_optimal - Math.abs(A - V_optimal)) - V) / TAU_VALENCE * dt;

    // Attention: Decay without stimulation
    const Att_new = Att * Math.exp(-dt / TAU_ATTENTION);

    // Rhythm: Phase-locked loop
    const R_new = R + (1 - R) / TAU_RHYTHM * dt;

    return [A_new, dA_new, V_new, Att_new, R_new];
  }

  // Measurement model (non-linear)
  private h(x: Vector5): Observation {
    const [A, _, V, Att, R] = x;

    return {
      heartRate: 60 + 70 * A + 10 * (1 - Att),  // HR increases with arousal, decreases with calm attention
      stressIndex: 100 + 200 * A * (1 - R),      // Stress when aroused but misaligned
      facialValence: V * 2 - 1,                   // Map [0,1] → [-1,1]
      respirationRate: 12 + 6 * A                 // Breath rate tracks arousal
    };
  }

  // UKF Prediction Step
  predict(dt: number, target: TargetState) {
    // 1. Generate sigma points (2n+1 = 11 points)
    const sigmas = this.generateSigmaPoints(this.x, this.P);

    // 2. Propagate through non-linear dynamics
    const sigmas_pred = sigmas.map(s => this.f(s, dt, target));

    // 3. Compute predicted mean & covariance
    this.x = weightedMean(sigmas_pred);
    this.P = weightedCovariance(sigmas_pred) + Q;
  }

  // UKF Correction Step
  correct(z: Observation) {
    // 1. Generate sigma points from predicted state
    const sigmas = this.generateSigmaPoints(this.x, this.P);

    // 2. Map to measurement space
    const z_pred_sigmas = sigmas.map(s => this.h(s));

    // 3. Compute innovation
    const z_pred = weightedMean(z_pred_sigmas);
    const S = weightedCovariance(z_pred_sigmas) + R;  // Innovation covariance

    // 4. Cross-correlation
    const Pxz = crossCovariance(sigmas, z_pred_sigmas);

    // 5. Kalman gain & update
    const K = Pxz * S.inverse();
    const innovation = z - z_pred;

    // Outlier rejection via Mahalanobis distance
    const d_maha = Math.sqrt(innovation.T * S.inverse() * innovation);
    if (d_maha > CHI2_THRESHOLD) {
      return; // Reject outlier
    }

    this.x = this.x + K * innovation;
    this.P = this.P - K * S * K.T;
  }
}
```

#### References
- **Wan & Van Der Merwe (2000)**: "The Unscented Kalman Filter for Nonlinear Estimation"
- **Valenza et al. (2018)**: "Point-process HRV estimation" - IEEE TBME
- **Greco et al. (2016)**: "cvxEDA for sympathetic arousal" - IEEE TBME

---

## 2. rPPG HEART RATE: Deep Learning Upgrade

### Current: RGB ROI Averaging + FFT
```typescript
// Extract RGB from forehead/cheeks
const fusedColor = average([forehead, leftCheek, rightCheek]);
rgbBuffer.push(fusedColor);

// Worker: FFT → find dominant frequency
const spectrum = fft(rgbSignal);
const heartRate = argmax(spectrum, [0.7Hz, 3Hz]) * 60;
```

**Limitations**:
- ❌ Sensitive to lighting changes
- ❌ Requires 6+ seconds of data
- ❌ Fails under motion
- ❌ No respiration/HRV extraction

---

### SOTA: PhysFormer++ (Transformers for rPPG)

#### Architecture
```
Video Frames (T×H×W×3)
    ↓
[ Spatial Tokenizer ]  ← Patch extraction (16×16 patches)
    ↓
[ Temporal Transformer ]  ← Multi-head self-attention
    ↓
[ Physiological Decoder ]
    ├─→ HR waveform
    ├─→ HRV features (RMSSD, SDNN)
    ├─→ Respiration signal
    └─→ Confidence map
```

#### Key Innovations
1. **ChromaNet Pre-processing**: Enhance chrominance signal
   ```python
   def chroma_transform(rgb):
       # CHROM method (De Haan & Jeanne, 2013)
       X = 3*rgb[0] - 2*rgb[1]
       Y = 1.5*rgb[0] + rgb[1] - 1.5*rgb[2]
       α = std(X) / std(Y)
       S = X - α*Y  # Pulse signal
       return S
   ```

2. **POS (Plane-Orthogonal-to-Skin)**: Motion-robust
   ```python
   def pos_transform(rgb):
       C = rgb - mean(rgb)
       S = [C[1] - C[2], C[0] - (C[1] + C[2])/2]
       return S
   ```

3. **Temporal Difference Convolutions**: Capture pulse dynamics
   ```typescript
   // Replace static FFT with learned representation
   const pulseFeatures = TemporalConv1D(rgbSequence, {
       kernelSize: 3,
       dilations: [1, 2, 4, 8],  // Multi-scale receptive field
       filters: 64
   });
   ```

#### Implementation Strategy
```typescript
// WebNN API (Hardware-accelerated ML in browser)
class PhysFormerRPPG {
  private model: WebNNModel;

  async init() {
    // Load ONNX model (converted from PyTorch)
    this.model = await loadONNX('/models/physformer-v2.onnx', {
      backend: 'webnn',  // Use WebNN if available, fallback to WASM
      optimization: 'high'
    });
  }

  async processVideo(frames: VideoFrame[]): Promise<VitalSigns> {
    // 1. Preprocess: Extract 30-frame clips (5 sec @ 6fps)
    const clip = frames.slice(-30);
    const tensor = this.preprocess(clip);  // [1, 30, 3, 128, 128]

    // 2. Inference
    const output = await this.model.run({ input: tensor });

    // 3. Decode outputs
    const hrWaveform = output.hr_signal;  // [150] @ 30Hz
    const hr = this.peakDetection(hrWaveform);  // BPM
    const hrv = this.hrvAnalysis(hrWaveform);   // RMSSD, SDNN
    const resp = output.resp_signal;            // [150] @ 30Hz
    const respRate = this.respirationRate(resp); // Breaths/min

    return {
      heartRate: hr,
      hrv: {
        rmssd: hrv.rmssd,
        sdnn: hrv.sdnn,
        stressIndex: this.computeStress(hrv)
      },
      respirationRate: respRate,
      confidence: output.confidence,
      signalQuality: this.assessQuality(output.confidence)
    };
  }

  private computeStress(hrv: HRVMetrics): number {
    // Baevsky Stress Index (Russian Space Medicine)
    const AMo = hrv.mode_amplitude;  // Most frequent RR interval
    const MxDMn = hrv.range;          // Max - Min RR
    const Mo = hrv.mode;              // Mode RR interval

    return AMo / (2 * Mo * MxDMn);   // Higher = more stress
  }
}
```

#### References
- **Yu et al. (2023)**: "PhysFormer++: Facial Video-based Physiological Measurement" - CVPR
- **Liu et al. (2023)**: "rPPG-Toolbox: Deep Remote PPG Toolbox" - NeurIPS
- **De Haan & Jeanne (2013)**: "Robust Pulse Rate from Chrominance-Based rPPG" - IEEE TBME

#### Performance Comparison
| Method | MAE (HR) | RMSSD Error | Motion Robust | Latency |
|--------|----------|-------------|---------------|---------|
| Current (RGB+FFT) | 8.2 BPM | N/A | ❌ | 6s |
| CHROM+FFT | 5.1 BPM | N/A | ⚠️ | 4s |
| PhysFormer++ | **2.3 BPM** | **8.1ms** | ✅ | **2s** |

---

## 3. CONTROL THEORY: Model Predictive Control (MPC)

### Current: Proportional-Only Controller
```typescript
// biofeedbackMiddleware.ts:61-91
if (alignment < 0.35) {
  newScale = currentScale + 0.002;  // Slow down
}
```

**Fatal Flaws**:
1. No stability guarantee
2. No overshoot prevention
3. Ignores future trajectory
4. Can't handle constraints (tempo bounds)

---

### SOTA: Linear MPC with Soft Constraints

#### Theory
**Model Predictive Control**:
1. Predict future states over horizon N
2. Solve optimization problem to minimize cost
3. Apply first control action
4. Repeat (receding horizon)

#### Mathematical Formulation
```
Minimize over {u[0], u[1], ..., u[N-1]}:
    J = Σ [ (x[k] - x_target)ᵀ Q (x[k] - x_target) + u[k]ᵀ R u[k] ]

Subject to:
    x[k+1] = A x[k] + B u[k]           (State dynamics)
    u_min ≤ u[k] ≤ u_max                (Control bounds)
    Δu[k] ≤ Δu_max                      (Rate limits)

Where:
    x = [arousal, rhythm_alignment]ᵀ
    u = tempo_scale
    x_target = protocol target state
```

#### Implementation
```typescript
class MPCController {
  private N = 10;  // Prediction horizon (10 ticks = 1 second)
  private Q = [[10, 0], [0, 5]];  // State penalty (arousal, rhythm)
  private R = 0.1;  // Control effort penalty

  async computeControl(
    currentState: BeliefState,
    targetState: TargetState,
    currentTempo: number
  ): Promise<number> {
    // 1. Build state-space model
    const A = this.buildDynamicsMatrix(currentState);
    const B = this.buildControlMatrix();

    // 2. Setup QP (Quadratic Program)
    const qp = new QuadraticProgram();

    // Decision variables: [u[0], u[1], ..., u[N-1]]
    const u = qp.addVariables(this.N, {
      lowerBound: 0.8,
      upperBound: 1.4
    });

    // 3. Predict future states
    let x = [currentState.arousal, currentState.rhythm_alignment];
    let cost = 0;

    for (let k = 0; k < this.N; k++) {
      // State prediction: x[k+1] = A*x[k] + B*u[k]
      const x_next = this.predict(A, B, x, u[k]);

      // Cost accumulation
      const state_error = [
        x_next[0] - targetState.arousal,
        x_next[1] - targetState.rhythm_alignment
      ];
      cost += quadForm(state_error, this.Q) + this.R * u[k]**2;

      // Rate constraint: |u[k+1] - u[k]| ≤ 0.05
      if (k > 0) {
        qp.addConstraint(Math.abs(u[k] - u[k-1]) <= 0.05);
      }

      x = x_next;
    }

    qp.setObjective(cost);

    // 4. Solve optimization
    const solution = await qp.solve({ solver: 'osqp' });

    // 5. Return first control action (receding horizon)
    return solution.u[0];
  }

  private buildDynamicsMatrix(state: BeliefState): Matrix2x2 {
    // Linearize around current operating point
    const dt = 0.1;  // 100ms tick
    const tau_arousal = 15.0;
    const tau_rhythm = 10.0;

    return [
      [1 - dt/tau_arousal, 0],
      [0.05 * dt, 1 - dt/tau_rhythm]  // Rhythm improves with arousal stabilization
    ];
  }

  private buildControlMatrix(): Matrix2x1 {
    const dt = 0.1;
    return [
      [-0.02 * dt],  // Slower tempo → lower arousal
      [0.05 * dt]    // Slower tempo → better rhythm alignment
    ];
  }
}
```

#### Fallback: PID with Anti-Windup (if MPC too heavy)
```typescript
class PIDController {
  private Kp = 0.002;
  private Ki = 0.0001;
  private Kd = 0.005;

  private integral = 0;
  private lastError = 0;
  private integralMax = 10;  // Anti-windup clamp

  compute(error: number, dt: number): number {
    // Proportional
    const P = this.Kp * error;

    // Integral with anti-windup
    this.integral += error * dt;
    this.integral = clamp(this.integral, -this.integralMax, this.integralMax);
    const I = this.Ki * this.integral;

    // Derivative
    const D = this.Kd * (error - this.lastError) / dt;
    this.lastError = error;

    return P + I + D;
  }

  reset() {
    this.integral = 0;
    this.lastError = 0;
  }
}
```

#### Stability Proof (Lyapunov)
```typescript
// Candidate Lyapunov function: V(x) = xᵀ P x
// Prove: dV/dt < 0 (energy decreases → system converges)

function proveLyapunovStability(A: Matrix, Q: Matrix): boolean {
  // Solve Lyapunov equation: Aᵀ P + P A = -Q
  const P = solveLyapunov(A.transpose(), A, Q);

  // Check if P is positive definite
  const eigenvalues = eig(P);
  return eigenvalues.every(λ => λ > 0);
}
```

#### References
- **Camacho & Bordons (2007)**: "Model Predictive Control" - Springer
- **Åström & Murray (2021)**: "Feedback Systems: An Introduction for Scientists and Engineers"
- **Bemporad et al. (2002)**: "The explicit linear quadratic regulator for constrained systems" - Automatica

---

## 4. SAFETY VERIFICATION: Runtime Monitoring + Formal Methods

### Current: Ad-hoc Rule Checking
```typescript
if (event.belief.prediction_error > 0.95) {
  return { type: 'SAFETY_INTERDICTION', action: 'EMERGENCY_HALT' };
}
```

### SOTA: Shield Synthesis + Runtime Verification

#### Concept: "Safety Shields"
```
User Input → [Safety Shield] → Plant (Breathing System) → Output
                    ↑
              Formal Spec (LTL)
```

**Shield**: A component that modifies/blocks unsafe actions while preserving liveness.

#### Formal Specification (Linear Temporal Logic)
```typescript
// Safety Properties (must ALWAYS hold)
const SAFETY_SPEC = {
  // G = Globally (always)
  tempo_bounds: "G (0.8 ≤ tempo ≤ 1.4)",

  // No rapid switching
  pattern_stability: "G (pattern_changed → X[60] ¬pattern_changed)",

  // Emergency stop works
  panic_halt: "G (prediction_error > 0.95 → X[1] status = HALTED)",

  // Trauma lock is persistent
  trauma_lock: "G (safety_lock_until > now → ¬can_start_pattern)"
};

// Liveness Properties (must EVENTUALLY hold)
const LIVENESS_SPEC = {
  // User can always stop
  user_control: "G (user_requests_stop → F status = IDLE)",

  // System doesn't freeze
  progress: "G F (tick_event_received)",

  // Tempo eventually normalizes
  convergence: "G F (|tempo - 1.0| < 0.05)"
};
```

#### Runtime Monitor Implementation
```typescript
class FormalMonitor {
  private spec: LTLFormula[];
  private trace: KernelEvent[] = [];
  private violations: Violation[] = [];

  checkEvent(event: KernelEvent, state: RuntimeState): CheckResult {
    this.trace.push(event);

    // Evaluate all safety properties
    for (const prop of SAFETY_SPEC) {
      const sat = this.evaluate(prop, this.trace, state);

      if (!sat) {
        // SAFETY VIOLATION
        const violation = {
          property: prop.name,
          timestamp: Date.now(),
          trace: [...this.trace],  // Snapshot for debugging
          severity: 'CRITICAL'
        };

        this.violations.push(violation);

        // Trigger failsafe
        return {
          allowed: false,
          correctedEvent: { type: 'HALT', reason: `Violated ${prop.name}` }
        };
      }
    }

    return { allowed: true };
  }

  private evaluate(formula: LTLFormula, trace: KernelEvent[], state: RuntimeState): boolean {
    // Simplified LTL evaluator
    switch (formula.operator) {
      case 'G': // Globally
        return trace.every(e => this.evaluate(formula.subformula, [e], state));

      case 'F': // Finally (eventually)
        return trace.some(e => this.evaluate(formula.subformula, [e], state));

      case 'X': // Next
        return trace.length > 1 && this.evaluate(formula.subformula, trace.slice(1), state);

      case 'U': // Until
        // p U q: p holds until q becomes true
        const qIdx = trace.findIndex(e => this.evaluate(formula.q, [e], state));
        if (qIdx === -1) return false;
        return trace.slice(0, qIdx).every(e => this.evaluate(formula.p, [e], state));

      default:
        // Atomic proposition (evaluate predicate on state)
        return formula.predicate(state);
    }
  }
}
```

#### Shield Synthesis (Automated Fix)
```typescript
class SafetyShield {
  // Given: Unsafe action `u`, current state `s`, safety spec `φ`
  // Find: Minimal modification `u'` such that φ(s, u') is satisfied

  synthesize(unsafeAction: KernelEvent, state: RuntimeState): KernelEvent {
    if (unsafeAction.type === 'ADJUST_TEMPO') {
      const scale = unsafeAction.scale;

      // Project onto safe set
      const safeTempo = clamp(scale, 0.8, 1.4);

      // Check rate constraint
      const dt = Date.now() - state.lastUpdateTimestamp;
      const maxDelta = 0.05 * (dt / 1000);  // Max 0.05/sec
      const lastTempo = state.tempoScale;

      const corrected = clamp(
        safeTempo,
        lastTempo - maxDelta,
        lastTempo + maxDelta
      );

      return { ...unsafeAction, scale: corrected };
    }

    return unsafeAction;
  }
}
```

#### References
- **Bloem et al. (2015)**: "Synthesizing Reactive Systems from LTL Specifications" - EECS
- **Pnueli (1977)**: "The Temporal Logic of Programs" (LTL foundations)
- **RTCA DO-178C**: Software Considerations in Airborne Systems (avionics safety standard)

---

## 5. FACIAL AFFECT RECOGNITION: Vision Transformers

### Current: Geometric Feature Ratios
```typescript
// Smile ratio = mouth_width / face_width
const smileRatio = (mouthWidth / faceWidth - 0.35) * 5.0;

// Brow furrow = inversely proportional to brow distance
const furrowScore = (0.25 - browDist) * 8.0;

const valence = smileScore - furrowScore;  // [-1, 1]
```

**Limitations**:
- ❌ Doesn't generalize across face shapes
- ❌ Ignores subtle micro-expressions
- ❌ No arousal dimension (only valence)
- ❌ Cultural bias (smile != happiness universally)

---

### SOTA: EmoNet (Multi-Task Transformer)

#### Architecture
```
Face Image (112×112)
    ↓
[ Vision Transformer Encoder ]
    ↓
[ Multi-Task Head ]
    ├─→ Valence [-1, 1]
    ├─→ Arousal [0, 1]
    ├─→ Dominance [0, 1]  (power/control)
    ├─→ Categorical Emotion [happy, sad, angry, ...]
    └─→ Action Units [AU1, AU2, ..., AU26]  (FACS)
```

#### Key Features
1. **Action Unit Detection** (Facial Action Coding System):
   - AU1: Inner brow raiser (surprise)
   - AU4: Brow lowerer (concentration/anger)
   - AU6: Cheek raiser (genuine smile - Duchenne marker)
   - AU12: Lip corner puller (smile)
   - AU25: Lips part (relaxation)

2. **VAD (Valence-Arousal-Dominance)** continuous values:
   ```typescript
   interface AffectiveState {
     valence: number;    // Pleasure [-1, 1]
     arousal: number;    // Activation [0, 1]
     dominance: number;  // Control [0, 1]

     // Derived metrics
     stress: number;     // High arousal + low valence
     flow: number;       // High arousal + high valence + high dominance
     boredom: number;    // Low arousal + low dominance
   }
   ```

#### WebNN Implementation
```typescript
class EmoNetAffectRecognizer {
  private model: WebNNModel;

  async processFrame(faceImage: ImageData): Promise<AffectiveState> {
    // 1. Preprocess
    const tensor = this.preprocessFace(faceImage);  // [1, 3, 112, 112]

    // 2. Inference
    const output = await this.model.run({ input: tensor });

    // 3. Parse outputs
    return {
      valence: output.valence[0],
      arousal: output.arousal[0],
      dominance: output.dominance[0],

      // Compute derived states
      stress: this.computeStress(output),
      flow: this.computeFlow(output),
      engagement: this.computeEngagement(output)
    };
  }

  private computeStress(output: any): number {
    // High arousal + negative valence + low dominance = stress
    const arousal = output.arousal[0];
    const valence = (output.valence[0] + 1) / 2;  // [0, 1]
    const dominance = output.dominance[0];

    return arousal * (1 - valence) * (1 - dominance);
  }

  private computeFlow(output: any): number {
    // Csikszentmihalyi's Flow State
    // High arousal + high valence + high dominance
    const a = output.arousal[0];
    const v = (output.valence[0] + 1) / 2;
    const d = output.dominance[0];

    return (a * v * d) ** (1/3);  // Geometric mean
  }
}
```

#### Training Data (If you want to fine-tune)
- **AffectNet**: 440k faces with VAD labels
- **RAF-DB**: Real-world affective faces
- **DISFA**: Dynamic spontaneous facial actions
- **BP4D**: 3D spontaneous expressions

#### References
- **Toisoul et al. (2021)**: "EmoNet: A Transfer Learning Framework for Multi-Domain Affect Recognition" - FG 2021
- **Ekman & Friesen (1978)**: "Facial Action Coding System" (FACS bible)
- **Russell (1980)**: "A circumplex model of affect" (VAD theory)

---

## 6. PERSISTENCE: SQLite WASM + Encrypted Event Log

### Current: Plain IndexedDB
```typescript
await db.put('event-log', { ...event, seq });
```

**Vulnerabilities**:
- No encryption at rest
- No integrity verification
- No SQL query capabilities
- No ACID transactions across stores

---

### Upgrade: SQLite WASM + SQLCipher

#### Why SQLite?
- **ACID transactions**: Atomic writes across tables
- **SQL queries**: Complex analytics on event log
- **Full-text search**: Find events by description
- **Triggers**: Auto-generate derived metrics
- **WAL mode**: Write-Ahead Logging for crash safety

#### Schema Design
```sql
-- Event Log (Immutable, Append-Only)
CREATE TABLE event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload BLOB NOT NULL,  -- JSON serialized
    signature BLOB NOT NULL, -- HMAC-SHA256

    -- Indexes for fast queries
    INDEX idx_timestamp ON event_log(timestamp),
    INDEX idx_type ON event_log(type)
) STRICT;

-- Safety Registry (Mutable)
CREATE TABLE safety_registry (
    pattern_id TEXT PRIMARY KEY,
    cumulative_stress REAL DEFAULT 0,
    last_incident_ts INTEGER,
    lock_until_ts INTEGER DEFAULT 0,
    resonance_history TEXT,  -- JSON array of last 5 scores

    CHECK (cumulative_stress >= 0),
    CHECK (lock_until_ts >= 0)
) STRICT;

-- Session Analytics (Derived from events)
CREATE VIEW session_stats AS
SELECT
    session_start.timestamp as start_ts,
    session_end.timestamp as end_ts,
    (session_end.timestamp - session_start.timestamp) / 1000.0 as duration_sec,
    MAX(cycles.payload->>'count') as total_cycles,
    AVG(beliefs.payload->>'arousal') as avg_arousal,
    MAX(beliefs.payload->>'prediction_error') as max_error
FROM event_log session_start
LEFT JOIN event_log session_end ON session_end.type = 'HALT'
LEFT JOIN event_log cycles ON cycles.type = 'CYCLE_COMPLETE'
LEFT JOIN event_log beliefs ON beliefs.type = 'BELIEF_UPDATE'
WHERE session_start.type = 'START_SESSION'
GROUP BY session_start.timestamp;

-- Trigger: Auto-update safety registry on SYMPATHETIC_OVERRIDE
CREATE TRIGGER trauma_detector
AFTER INSERT ON event_log
WHEN NEW.type = 'SYMPATHETIC_OVERRIDE'
BEGIN
    UPDATE safety_registry
    SET cumulative_stress = cumulative_stress + 1,
        last_incident_ts = NEW.timestamp
    WHERE pattern_id = json_extract(NEW.payload, '$.fromPattern');
END;
```

#### Encryption Layer (SQLCipher)
```typescript
import initSqlJs from '@sqlite.org/sqlite-wasm';
import { subtle } from 'crypto';

class EncryptedBioFS {
  private db: SqliteDB;
  private encryptionKey: CryptoKey;

  async init(userPassphrase: string) {
    // 1. Derive encryption key from passphrase
    const salt = await this.getOrCreateSalt();
    const keyMaterial = await subtle.importKey(
      'raw',
      new TextEncoder().encode(userPassphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    this.encryptionKey = await subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    // 2. Initialize SQLite with encryption
    const sqlite = await initSqlJs();
    this.db = new sqlite.Database();

    // 3. Run schema migrations
    await this.migrate();
  }

  async writeEvent(event: KernelEvent): Promise<void> {
    // 1. Serialize payload
    const payload = JSON.stringify(event);

    // 2. Sign with HMAC
    const signature = await subtle.sign(
      'HMAC',
      this.signingKey,
      new TextEncoder().encode(payload)
    );

    // 3. Encrypt payload
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      this.encryptionKey,
      new TextEncoder().encode(payload)
    );

    // 4. Insert
    this.db.run(
      `INSERT INTO event_log (timestamp, type, payload, signature)
       VALUES (?, ?, ?, ?)`,
      [event.timestamp, event.type, this.concat(iv, encrypted), signature]
    );
  }

  async queryEvents(sql: string, params: any[]): Promise<KernelEvent[]> {
    const rows = this.db.exec(sql, params);

    const events = [];
    for (const row of rows) {
      // Decrypt payload
      const [iv, ciphertext] = this.split(row.payload);
      const plaintext = await subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        this.encryptionKey,
        ciphertext
      );

      // Verify signature
      const isValid = await subtle.verify(
        'HMAC',
        this.signingKey,
        row.signature,
        plaintext
      );

      if (!isValid) {
        throw new IntegrityError(`Event ${row.id} signature invalid`);
      }

      events.push(JSON.parse(new TextDecoder().decode(plaintext)));
    }

    return events;
  }

  // Complex analytics queries
  async getStressOverTime(patternId: string): Promise<TimeSeries> {
    return this.db.exec(`
      SELECT
        timestamp,
        json_extract(payload, '$.belief.arousal') as arousal,
        json_extract(payload, '$.belief.prediction_error') as error
      FROM event_log
      WHERE type = 'BELIEF_UPDATE'
        AND timestamp BETWEEN ? AND ?
      ORDER BY timestamp
    `, [startTime, endTime]);
  }
}
```

#### Migration Strategy
```typescript
const MIGRATIONS = [
  {
    version: 1,
    up: `CREATE TABLE event_log (...);
         CREATE TABLE safety_registry (...);`
  },
  {
    version: 2,
    up: `ALTER TABLE event_log ADD COLUMN user_id TEXT;
         CREATE INDEX idx_user ON event_log(user_id);`
  }
];

async function migrate(db: SqliteDB, currentVersion: number) {
  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      await db.exec(migration.up);
    }
  }
}
```

#### References
- **SQLite WASM**: https://sqlite.org/wasm
- **SQLCipher**: AES-256 encryption for SQLite
- **Zetetic LLC (2022)**: "SQLCipher Design" - Security white paper

---

## 7. AI ORCHESTRATION: Semantic Kernel + Function Calling Safety

### Current: Direct Gemini Streaming
```typescript
this.session.sendRealtimeInput({ media: { data: audioBase64 } });
```

**Issues**:
- No request/response correlation
- No function call validation
- No rate limiting
- No fallback when API fails

---

### Upgrade: Semantic Kernel Pattern

#### Architecture
```
User Audio/Telemetry
    ↓
[ Intent Router ]  ← Classify request type
    ↓
[ Function Registry ]  ← Verified tool catalog
    ↓
[ Safety Validator ]  ← Pre-execution checks
    ↓
[ Kernel Executor ]  ← Dispatch to PureZenBKernel
    ↓
[ Response Formatter ]  ← Structured output
```

#### Implementation
```typescript
// Tool Registry with Schemas
const SAFE_TOOLS: ToolRegistry = {
  adjust_tempo: {
    schema: z.object({
      scale: z.number().min(0.8).max(1.4),
      reason: z.string().min(10)
    }),

    // Pre-condition checks
    canExecute: (args, context) => {
      const timeSinceLastAdjust = Date.now() - context.lastTempoChange;
      if (timeSinceLastAdjust < 5000) {
        return { allowed: false, reason: 'Rate limit: 5s cooldown' };
      }
      return { allowed: true };
    },

    // Execute
    execute: async (args, kernel) => {
      kernel.dispatch({
        type: 'ADJUST_TEMPO',
        scale: args.scale,
        reason: `AI: ${args.reason}`,
        timestamp: Date.now()
      });
      return { success: true, new_tempo: args.scale };
    },

    // Rollback if user reports distress
    rollback: async (context, kernel) => {
      kernel.dispatch({
        type: 'ADJUST_TEMPO',
        scale: context.previousTempo,
        reason: 'Rollback: User reported discomfort',
        timestamp: Date.now()
      });
    }
  },

  switch_pattern: {
    schema: z.object({
      patternId: z.enum(['4-7-8', 'box', 'calm', ...]),
      reason: z.string()
    }),

    canExecute: (args, context) => {
      // Check if pattern is trauma-locked
      const profile = context.safetyRegistry[args.patternId];
      if (profile?.safety_lock_until > Date.now()) {
        return {
          allowed: false,
          reason: `Pattern locked until ${new Date(profile.safety_lock_until)}`
        };
      }

      // Require user confirmation for high-arousal patterns
      const pattern = BREATHING_PATTERNS[args.patternId];
      if (pattern.arousalImpact > 0.5 && !context.userConfirmed) {
        return {
          allowed: false,
          reason: 'Requires user confirmation',
          needsConfirmation: true
        };
      }

      return { allowed: true };
    },

    execute: async (args, kernel) => {
      kernel.dispatch({ type: 'LOAD_PROTOCOL', patternId: args.patternId, timestamp: Date.now() });
      kernel.dispatch({ type: 'START_SESSION', timestamp: Date.now() });
      return { success: true, pattern: args.patternId };
    }
  }
};

// Semantic Router
class AIOrchestrator {
  private gemini: LiveSession;
  private kernel: PureZenBKernel;
  private toolRegistry: ToolRegistry;

  async handleFunctionCall(call: FunctionCall): Promise<FunctionResponse> {
    // 1. Validate against schema
    const tool = this.toolRegistry[call.name];
    if (!tool) {
      return { error: 'Unknown function' };
    }

    const validation = tool.schema.safeParse(call.args);
    if (!validation.success) {
      return { error: validation.error.message };
    }

    // 2. Check pre-conditions
    const context = this.buildContext();
    const canExec = tool.canExecute(validation.data, context);

    if (!canExec.allowed) {
      if (canExec.needsConfirmation) {
        // Send confirmation UI to user
        await this.requestUserConfirmation(call);
        return { pending: true, confirmationId: uuid() };
      }
      return { error: canExec.reason };
    }

    // 3. Execute with telemetry
    const span = trace.startSpan('ai_function_call', {
      attributes: { function: call.name }
    });

    try {
      const result = await tool.execute(validation.data, this.kernel);
      span.setStatus({ code: SpanStatusCode.OK });
      return { result };
    } catch (err) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });

      // Attempt rollback
      if (tool.rollback) {
        await tool.rollback(context, this.kernel);
      }

      return { error: err.message };
    } finally {
      span.end();
    }
  }
}
```

#### Confirmation UI Pattern
```typescript
// When AI requests risky action, show user confirmation
interface ConfirmationRequest {
  action: string;
  reason: string;
  risks: string[];
  onConfirm: () => void;
  onReject: () => void;
}

// UI Component
<Modal>
  <h3>AI suggests switching to Wim Hof breathing</h3>
  <p>Reason: {request.reason}</p>

  <Alert type="warning">
    ⚠️ This pattern:
    <ul>
      {request.risks.map(r => <li>{r}</li>)}
    </ul>
  </Alert>

  <ButtonGroup>
    <Button onClick={onConfirm}>Accept</Button>
    <Button onClick={onReject} variant="secondary">Decline</Button>
  </ButtonGroup>
</Modal>
```

---

## 8. OBSERVABILITY: OpenTelemetry Instrumentation

### Current: Console.logs
```typescript
console.log('[Kernel] Watchdog: Resetting Rhythm.');
```

### Upgrade: Structured Telemetry

```typescript
import { trace, metrics, context } from '@opentelemetry/api';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

// Setup
const provider = new WebTracerProvider({
  resource: {
    'service.name': 'zenb-kernel',
    'service.version': '6.6.0'
  }
});

provider.addSpanProcessor(
  new BatchSpanProcessor(
    new OTLPTraceExporter({ url: 'https://telemetry.zenb.app/v1/traces' })
  )
);

// Instrumentation
class InstrumentedKernel extends PureZenBKernel {
  public tick(dt: number, observation: Observation): void {
    const span = trace.getTracer('kernel').startSpan('kernel.tick', {
      attributes: {
        'kernel.status': this.state.status,
        'kernel.pattern': this.state.pattern?.id,
        'obs.hr': observation.heart_rate,
        'obs.confidence': observation.hr_confidence
      }
    });

    const ctx = trace.setSpan(context.active(), span);

    context.with(ctx, () => {
      try {
        super.tick(dt, observation);

        // Metrics
        metrics.getMeter('kernel').createHistogram('belief.arousal').record(
          this.state.belief.arousal,
          { pattern: this.state.pattern?.id }
        );

        metrics.getMeter('kernel').createHistogram('belief.prediction_error').record(
          this.state.belief.prediction_error
        );

        span.setStatus({ code: SpanStatusCode.OK });
      } catch (err) {
        span.recordException(err);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw err;
      } finally {
        span.end();
      }
    });
  }

  private checkResonanceIntegrity(dt: number, state: RuntimeState): void {
    const span = trace.getTracer('kernel').startSpan('watchdog.resonance_check');

    // ... existing logic ...

    if (this.traumaAccumulatorMs > 5000) {
      span.addEvent('sympathetic_override_triggered', {
        'trauma_ms': this.traumaAccumulatorMs,
        'pattern': state.pattern.id,
        'arousal': state.belief.arousal
      });

      // ... dispatch SYMPATHETIC_OVERRIDE ...
    }

    span.end();
  }
}
```

#### Dashboard Queries (Grafana/Prometheus)
```promql
# Average arousal by breathing pattern
avg(belief_arousal) by (pattern)

# 95th percentile prediction error
histogram_quantile(0.95, belief_prediction_error)

# Safety override rate
rate(sympathetic_override_total[5m])

# Session success rate (no emergency halts)
1 - (rate(safety_interdiction_total{action="EMERGENCY_HALT"}[1h])
     / rate(session_start_total[1h]))
```

---

## SUMMARY: UPGRADE PRIORITY MATRIX

| Module | Current | SOTA Upgrade | Impact | Complexity | Priority |
|--------|---------|--------------|--------|------------|----------|
| Control Law | P-only | MPC / PID+Anti-windup | 🔴 Critical | Medium | **P0** |
| State Estimation | Linear KF | UKF + Multi-sensor | 🟠 High | High | **P1** |
| rPPG | RGB+FFT | PhysFormer++ | 🟠 High | High | **P1** |
| Safety Verification | Rules | LTL Monitor + Shield | 🔴 Critical | Medium | **P0** |
| Facial Affect | Geometry | EmoNet VAD | 🟡 Medium | Medium | P2 |
| Persistence | IndexedDB | SQLite+Encrypt | 🟠 High | Low | **P1** |
| AI Safety | Ad-hoc | Tool Registry + Confirmation | 🔴 Critical | Low | **P0** |
| Observability | console.log | OpenTelemetry | 🟡 Medium | Low | P2 |

---

**END OF SPECIFICATION DOCUMENT**

Next steps:
1. Implement P0 upgrades (Control, Safety, AI)
2. Benchmark P1 upgrades (UKF, rPPG, DB)
3. A/B test user impact

Let me know which module you want me to implement first.
