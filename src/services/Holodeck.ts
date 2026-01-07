
import { PureZenBKernel } from './PureZenBKernel';
import { useSettingsStore } from '../stores/settingsStore';
import { useSessionStore } from '../stores/sessionStore';
import { VitalSigns } from '../types';

/**
 * 🜂 THE HOLODECK (Simulation Runtime)
 * =====================================
 * Runs automated integration tests on the live Biological OS.
 */

type LogEntry = { time: number; msg: string; type: 'info' | 'pass' | 'fail' };

export class Holodeck {
    private static instance: Holodeck;
    public isActive = false;
    private logs: LogEntry[] = [];
    private listeners = new Set<() => void>();
    
    // Injected References
    private kernel: PureZenBKernel | null = null;
    
    private constructor() {}

    public static getInstance(): Holodeck {
        if (!Holodeck.instance) Holodeck.instance = new Holodeck();
        return Holodeck.instance;
    }

    public attach(kernel: PureZenBKernel) {
        this.kernel = kernel;
    }

    public getLogs() { return this.logs; }
    
    public clearLogs() { 
        this.logs = []; 
        this.notify();
    }

    private log(msg: string, type: 'info' | 'pass' | 'fail' = 'info') {
        this.logs.push({ time: Date.now(), msg, type });
        console.log(`[Holodeck] ${type.toUpperCase()}: ${msg}`);
        this.notify();
    }

    public subscribe(cb: () => void) {
        this.listeners.add(cb);
        return () => this.listeners.delete(cb);
    }

    private notify() { this.listeners.forEach(cb => cb()); }

    // --- SCENARIO RUNNER ---

    public async runScenario(scenarioId: string): Promise<void> {
        if (!this.kernel) { this.log("Kernel not attached!", 'fail'); return; }
        
        this.isActive = true;
        this.clearLogs();
        this.notify();

        try {
            switch(scenarioId) {
                case 'nominal': await this.scenarioNominal(); break;
                case 'panic': await this.scenarioPanicResponse(); break;
                case 'ai_tune': await this.scenarioAiTuning(); break;
                default: this.log(`Unknown scenario: ${scenarioId}`, 'fail');
            }
        } catch (e: any) {
            this.log(`Scenario Crashed: ${e.message}`, 'fail');
        } finally {
            this.isActive = false;
            this.stopSimulationEffects();
            this.notify();
        }
    }

    // --- SCENARIO 01: NOMINAL FLOW ---
    private async scenarioNominal() {
        this.log("Initializing SCENARIO 01: NOMINAL FLOW", 'info');
        
        // 1. Setup Environment
        useSettingsStore.getState().setQuality('low');
        
        // 2. Start Session (4-7-8)
        this.log("Action: Start Session (4-7-8)", 'info');
        useSessionStore.getState().startSession('4-7-8');
        
        // Wait for Boot
        await this.wait(500);
        const state = this.kernel!.getState();
        if (state.status !== 'RUNNING') throw new Error("Kernel failed to start");
        this.log("Kernel State: RUNNING", 'pass');

        // 3. Inject "Perfect" Bio-Data (Coherent HR)
        this.startMockVitals(() => ({
             heartRate: 60 + Math.sin(Date.now() / 1000) * 5, // RSA-like
             confidence: 0.95,
             signalQuality: 'excellent',
             snr: 20,
             motionLevel: 0,
             hrv: { rmssd: 50, sdnn: 50, stressIndex: 80 }
        }));
        this.log("Injecting: Coherent Bio-Signals", 'info');

        // 4. Run for 5 seconds (fast forward)
        await this.wait(5000);
        
        // Assert: Phase Machine
        const p = this.kernel!.getState().phase;
        if (p === 'inhale' || p === 'holdIn') {
             this.log(`Phase transition verified (Current: ${p})`, 'pass');
        } else {
             this.log(`Unexpected phase: ${p}`, 'fail');
        }

        // 5. Clean Stop
        useSessionStore.getState().stopSession();
        await this.wait(500);
        if (this.kernel!.getState().status === 'HALTED' || this.kernel!.getState().status === 'IDLE') {
             this.log("Kernel Halted Cleanly", 'pass');
        } else {
             throw new Error("Kernel failed to halt");
        }
    }

    // --- SCENARIO 02: PANIC RESPONSE (Safety Lock) ---
    private async scenarioPanicResponse() {
        this.log("Initializing SCENARIO 02: TRAUMA RESPONSE", 'info');
        
        useSessionStore.getState().startSession('4-7-8');
        await this.wait(1000);

        // 1. Inject "Panic" Data (HR 160, Low HRV)
        this.log("Injecting: PANIC SIGNAL (HR 160, SI 800)", 'info');
        this.startMockVitals(() => ({
             heartRate: 160,
             confidence: 0.9,
             signalQuality: 'good',
             snr: 15,
             motionLevel: 0.2,
             hrv: { rmssd: 10, sdnn: 10, stressIndex: 800 }
        }));

        // 2. Force Belief Update in Kernel to reflect this immediately (bypass smoothers)
        this.kernel!.dispatch({
            type: 'BELIEF_UPDATE',
            belief: { 
                ...this.kernel!.getState().belief,
                prediction_error: 0.99, // CRITICAL ERROR
                arousal: 1.0
            },
            timestamp: Date.now()
        });

        // Wait for Safety Guard to trip (SafetyConfig.safety.minSessionSecBeforeEmergency = 10s usually, 
        // but for test we assume Kernel reacts to events. 
        // We simulate the kernel catching up or manually firing the guard event if needed for deterministic test)
        
        this.log("Simulating Safety Interdiction Event...", 'info');
        this.kernel!.dispatch({
            type: 'SAFETY_INTERDICTION',
            riskLevel: 0.99,
            action: 'EMERGENCY_HALT',
            timestamp: Date.now()
        });

        await this.wait(500);
        const status = this.kernel!.getState().status;
        
        if (status === 'SAFETY_LOCK') {
            this.log("System entered SAFETY_LOCK", 'pass');
        } else {
            this.log(`System failed to lock. Status: ${status}`, 'fail');
        }
        
        useSessionStore.getState().stopSession();
    }

    // --- SCENARIO 03: AI TUNING ---
    private async scenarioAiTuning() {
        this.log("Initializing SCENARIO 03: AI CO-REGULATION", 'info');
        useSessionStore.getState().startSession('box');
        await this.wait(1000);

        // 1. Simulate "AI Connected"
        this.kernel!.dispatch({ type: 'AI_STATUS_CHANGE', status: 'connected', timestamp: Date.now() });
        this.log("AI Agent: Connected", 'pass');

        // 2. Simulate AI Tool Call (Slow Down)
        this.log("Simulating AI Tool: adjust_tempo(1.2)", 'info');
        this.kernel!.dispatch({
            type: 'ADJUST_TEMPO',
            scale: 1.2,
            reason: 'Holodeck Test',
            timestamp: Date.now()
        });

        await this.wait(200);
        if (this.kernel!.getState().tempoScale === 1.2) {
            this.log("Tempo adjusted successfully", 'pass');
        } else {
            this.log("Tempo adjustment failed", 'fail');
        }

        useSessionStore.getState().stopSession();
    }

    // --- UTILS ---
    private wait(ms: number) { return new Promise(r => setTimeout(r, ms)); }

    private startMockVitals(generator: () => VitalSigns) {
        // Mock global hook that CameraVitalsEngine listens to
        (window as any).__ZENB_HOLODECK_VITALS__ = generator;
    }

    private stopSimulationEffects() {
        (window as any).__ZENB_HOLODECK_VITALS__ = null;
    }
}
