
import React, { useRef, useEffect } from 'react';
import { Play, Pause, Square, Lock, Settings2, History, ChevronRight, Wind, Zap, Moon, Activity, Hexagon, Fingerprint } from 'lucide-react';
import clsx from 'clsx';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { TRANSLATIONS } from '../../translations';
import { BREATHING_PATTERNS, BreathingType, BreathPattern, ColorTheme } from '../../types';
import { unlockAudio, cleanupAudio } from '../../services/audio';
import { hapticTick } from '../../services/haptics';
import { useKernel, useKernelState } from '../../kernel/KernelProvider';

type FooterProps = {
  selectedPatternId: BreathingType;
  setSelectedPatternId: (id: BreathingType) => void;
};

// --- VISUAL SUB-COMPONENTS ---

// 1. Rhythm Bar: Visualizes the timing (Inhale-Hold-Exhale-Hold) as colored bars
const RhythmBar = ({ pattern, themeColor }: { pattern: BreathPattern, themeColor: string }) => {
  const { inhale, holdIn, exhale, holdOut } = pattern.timings;
  const total = inhale + holdIn + exhale + holdOut;

  // Helper to calc width percentage
  const w = (val: number) => `${(val / total) * 100}%`;

  return (
    <div className="w-full h-1.5 flex gap-0.5 rounded-full overflow-hidden opacity-80 mt-3">
      <div style={{ width: w(inhale) }} className={clsx("h-full rounded-sm", themeColor)} />
      {holdIn > 0 && <div style={{ width: w(holdIn) }} className="h-full bg-white/20 rounded-sm" />}
      <div style={{ width: w(exhale) }} className={clsx("h-full rounded-sm opacity-60", themeColor)} />
      {holdOut > 0 && <div style={{ width: w(holdOut) }} className="h-full bg-white/20 rounded-sm" />}
    </div>
  );
};

export function Footer({ selectedPatternId, setSelectedPatternId }: FooterProps) {
  const isActive = useSessionStore(s => s.isActive);
  const isPaused = useSessionStore(s => s.isPaused);
  const startSession = useSessionStore(s => s.startSession);
  const togglePause = useSessionStore(s => s.togglePause);
  const finishSessionStore = useSessionStore(s => s.finishSession);

  const userSettings = useSettingsStore(s => s.userSettings);
  const setLastUsedPattern = useSettingsStore(s => s.setLastUsedPattern);
  const registerSessionComplete = useSettingsStore(s => s.registerSessionComplete);
  const history = useSettingsStore(s => s.history);

  const setSettingsOpen = useUIStore(s => s.setSettingsOpen);
  const setHistoryOpen = useUIStore(s => s.setHistoryOpen);

  const t = TRANSLATIONS[userSettings.language] || TRANSLATIONS.en;

  const kernel = useKernel();
  const safetyRegistry = useKernelState(s => s.safetyRegistry);
  const sessionStartTime = useSessionStore(s => s.sessionStartTime);
  const cycleCount = useSessionStore(s => s.cycleCount);
  const currentPattern = useSessionStore(s => s.currentPattern);

  // Auto-scroll logic
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollContainerRef.current && !isActive) {
      const selectedEl = scrollContainerRef.current.querySelector('[data-selected="true"]');
      if (selectedEl) {
        selectedEl.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [isActive]); // Only run on mount or when returning to menu

  const isPatternLocked = (pattern: BreathPattern): { locked: boolean; reason?: string } => {
    const record = safetyRegistry[pattern.id];
    if (record && record.safety_lock_until > Date.now()) {
      const remainMs = Math.max(0, record.safety_lock_until - Date.now());
      const h = Math.floor(remainMs / 3600000);
      return { locked: true, reason: `${h}h Lock` };
    }
    if (pattern.tier === 1) return { locked: false };
    const qualitySessions = history.filter(h => h.durationSec > 60);
    if (pattern.tier === 2) {
      const minSessions = 5;
      if (qualitySessions.length < minSessions) return { locked: true, reason: `${minSessions - qualitySessions.length} more` };
      return { locked: false };
    }
    if (pattern.tier === 3) {
      const minSessions = 20;
      if (qualitySessions.length < minSessions) return { locked: true, reason: `${minSessions - qualitySessions.length} more` };
      return { locked: false };
    }
    return { locked: false };
  };

  const getResonanceScore = (pid: string): number => {
    const profile = safetyRegistry[pid];
    return profile?.resonance_score ?? 0.5; // Default 50%
  };

  const triggerHaptic = (strength: 'light' | 'medium' | 'heavy' = 'light') => {
    if (userSettings.hapticEnabled) hapticTick(true, strength);
  };

  const handleStart = () => {
    const pattern = BREATHING_PATTERNS[selectedPatternId];
    const lock = isPatternLocked(pattern);
    if (lock.locked) {
      triggerHaptic('heavy');
      alert(`Pattern Locked: ${lock.reason}`);
      return;
    }

    triggerHaptic('medium');
    unlockAudio();
    setLastUsedPattern(selectedPatternId);
    startSession(selectedPatternId);
  };

  const handleStop = () => {
    triggerHaptic('medium');
    cleanupAudio();
    const durationSec = Math.floor((Date.now() - sessionStartTime) / 1000);
    const kernelState = kernel.getState();

    // Explicitly manually trigger the HALT logic in Kernel first to ensure analytics run
    kernel.dispatch({ type: 'HALT', reason: 'user_stop', timestamp: Date.now() });

    registerSessionComplete(durationSec, currentPattern.id, cycleCount, kernelState.belief);
    finishSessionStore({
      durationSec,
      cyclesCompleted: cycleCount,
      patternId: currentPattern.id,
      timestamp: Date.now()
    });
  };

  const handleTogglePause = () => {
    triggerHaptic('light');
    togglePause();
  };

  const currentPatternConfig = BREATHING_PATTERNS[selectedPatternId];
  const lockStatus = isPatternLocked(currentPatternConfig);

  // --- THEME MAPPING ---
  const getThemeStyles = (theme: ColorTheme, isSelected: boolean, isLocked: boolean) => {
    if (isLocked) return {
      card: "bg-white/5 border-white/5 grayscale opacity-50",
      icon: "bg-white/5 text-white/30",
      text: "text-white/40",
      accent: "bg-white/20"
    };

    if (!isSelected) return {
      card: "bg-white/[0.03] border-white/5 hover:bg-white/[0.08] hover:border-white/10 opacity-60 scale-95",
      icon: "bg-white/5 text-white/60",
      text: "text-white/60",
      accent: "bg-white/40"
    };

    // Active State Colors
    switch (theme) {
      case 'warm': return {
        card: "bg-gradient-to-br from-orange-500/10 to-rose-900/20 border-orange-500/30 shadow-[0_0_30px_-10px_rgba(249,115,22,0.3)] scale-100 opacity-100",
        icon: "bg-orange-500 text-white shadow-lg shadow-orange-500/20",
        text: "text-orange-100",
        accent: "bg-orange-400"
      };
      case 'cool': return {
        card: "bg-gradient-to-br from-cyan-500/10 to-blue-900/20 border-cyan-500/30 shadow-[0_0_30px_-10px_rgba(6,182,212,0.3)] scale-100 opacity-100",
        icon: "bg-cyan-500 text-black shadow-lg shadow-cyan-500/20",
        text: "text-cyan-50",
        accent: "bg-cyan-400"
      };
      default: return { // Neutral
        card: "bg-gradient-to-br from-white/10 to-gray-800/20 border-white/20 shadow-[0_0_30px_-10px_rgba(255,255,255,0.15)] scale-100 opacity-100",
        icon: "bg-white text-black shadow-lg shadow-white/10",
        text: "text-white",
        accent: "bg-white"
      };
    }
  };

  const getIcon = (id: string) => {
    if (['4-7-8', 'deep-relax', '7-11'].includes(id)) return Moon;
    if (['awake', 'wim-hof'].includes(id)) return Zap;
    if (['coherence', 'calm'].includes(id)) return Activity;
    if (['box', 'tactical'].includes(id)) return Hexagon;
    return Wind;
  };

  // Sort patterns: High resonance first, then standard order
  const sortedPatterns = React.useMemo(() => {
    return Object.values(BREATHING_PATTERNS).sort((a, b) => {
      const scoreA = getResonanceScore(a.id);
      const scoreB = getResonanceScore(b.id);
      // Only prioritize if significantly better (>10% diff)
      if (Math.abs(scoreA - scoreB) > 0.1) return scoreB - scoreA;
      return 0; // maintain original order otherwise
    });
  }, [safetyRegistry]);

  return (
    <footer className="fixed bottom-0 inset-x-0 z-30 pb-[calc(1.5rem+env(safe-area-inset-bottom))] transition-all duration-700 ease-out pointer-events-none">
      <div className="w-full flex flex-col justify-end pointer-events-auto">

        {!isActive && (
          <div className="flex flex-col gap-8 animate-in slide-in-from-bottom-10 fade-in duration-700">

            {/* HORIZONTAL SLIDE CARDS (Optimized) */}
            <div
              ref={scrollContainerRef}
              className="w-full overflow-x-auto snap-x snap-mandatory scrollbar-hide px-6 pb-4 -mx-0 pt-4"
            >
              <div className="flex gap-5 min-w-max items-center">
                {sortedPatterns.map(p => {
                  const status = isPatternLocked(p);
                  const isSelected = selectedPatternId === p.id;
                  const styles = getThemeStyles(p.colorTheme, isSelected, status.locked);
                  const Icon = getIcon(p.id);
                  const resonance = getResonanceScore(p.id);
                  const isHighResonance = resonance > 0.7;

                  return (
                    <button
                      key={p.id}
                      data-selected={isSelected}
                      onClick={() => {
                        if (!status.locked) {
                          triggerHaptic('light');
                          setSelectedPatternId(p.id as BreathingType);
                        } else {
                          triggerHaptic('heavy');
                        }
                      }}
                      className={clsx(
                        "snap-center shrink-0 w-[160px] h-[200px] rounded-[24px] p-5 flex flex-col justify-between text-left transition-all duration-500 ease-out border backdrop-blur-2xl relative overflow-hidden group",
                        styles.card,
                        isHighResonance && !status.locked && isSelected && "ring-1 ring-emerald-500/50 shadow-[0_0_20px_-5px_rgba(16,185,129,0.3)]"
                      )}
                    >
                      {/* Top Section */}
                      <div className="relative z-10 w-full">
                        <div className="flex justify-between items-start mb-4">
                          <div className={clsx("w-10 h-10 rounded-full flex items-center justify-center transition-colors duration-300", styles.icon)}>
                            {status.locked ? <Lock size={16} /> : <Icon size={18} />}
                          </div>

                          {/* Resonance Badge (Affinity) */}
                          {!status.locked && (
                            <div className="flex flex-col items-end gap-1">
                              <div className="flex gap-0.5">
                                {[...Array(p.tier)].map((_, i) => (
                                  <div key={i} className={clsx("w-1 h-1 rounded-full", isSelected ? styles.accent : "bg-white/20")} />
                                ))}
                              </div>
                              {resonance > 0.6 && (
                                <div className={clsx("flex items-center gap-1 text-[8px] font-mono border rounded px-1.5 py-0.5",
                                  resonance > 0.8 ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10" : "text-white/40 border-white/10"
                                )}>
                                  <Fingerprint size={8} /> {(resonance * 100).toFixed(0)}%
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <div className={clsx("text-xl font-serif leading-tight mb-1 transition-colors duration-300", styles.text)}>
                          {t.patterns[p.id as BreathingType]?.label || p.label}
                        </div>
                        <div className="text-[10px] text-white/40 uppercase tracking-widest font-medium truncate">
                          {t.patterns[p.id as BreathingType]?.tag || p.tag}
                        </div>
                      </div>

                      {/* Bottom Section */}
                      <div className="relative z-10 pt-4 border-t border-white/5 w-full">
                        <div className="text-[10px] text-white/40 font-mono flex items-center justify-between mb-1">
                          {status.locked ? (
                            <span className="flex items-center gap-1.5 text-white/30 tracking-widest uppercase">{status.reason}</span>
                          ) : (
                            <span className="tracking-wider opacity-80">{p.timings.inhale}-{p.timings.holdIn}-{p.timings.exhale}-{p.timings.holdOut}</span>
                          )}
                          <span className="opacity-40">{p.recommendedCycles}x</span>
                        </div>

                        {/* Visual Rhythm Bar */}
                        {!status.locked && <RhythmBar pattern={p} themeColor={styles.accent} />}
                      </div>
                    </button>
                  )
                })}
                {/* Spacer for end of list */}
                <div className="w-1" />
              </div>
            </div>

            {/* Bottom Controls Row - Glass Pills */}
            <div className="px-6 flex items-center gap-4 h-[64px]">
              {/* History */}
              <button
                onClick={() => { triggerHaptic(); setHistoryOpen(true); }}
                className="h-full aspect-[1.1/1] flex items-center justify-center rounded-2xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.08] active:scale-95 transition-all backdrop-blur-md group"
              >
                <History size={20} className="text-white/40 group-hover:text-white/80 transition-colors" />
              </button>

              {/* Start Button - The Big Pill */}
              <button
                onClick={handleStart}
                disabled={lockStatus.locked}
                className={clsx(
                  "flex-1 h-full rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-[0.98] group relative overflow-hidden backdrop-blur-md",
                  lockStatus.locked
                    ? "bg-white/5 border border-white/10 cursor-not-allowed opacity-50"
                    : "bg-white text-black hover:bg-white/90 shadow-[0_0_40px_-10px_rgba(255,255,255,0.2)]"
                )}
              >
                {lockStatus.locked ? (
                  <Lock size={18} className="text-white/50" />
                ) : (
                  <>
                    <span className="text-sm font-bold tracking-[0.2em] uppercase pl-1">
                      {t.ui.begin}
                    </span>
                    <ChevronRight size={16} className="group-hover:translate-x-1 transition-transform opacity-60" />
                  </>
                )}
              </button>

              {/* Settings */}
              <button
                onClick={() => { triggerHaptic(); setSettingsOpen(true); }}
                className="h-full aspect-[1.1/1] flex items-center justify-center rounded-2xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.08] active:scale-95 transition-all backdrop-blur-md group"
              >
                <Settings2 size={20} className="text-white/40 group-hover:text-white/80 transition-colors" />
              </button>
            </div>
          </div>
        )}

        {isActive && (
          <div className="px-6 grid grid-cols-2 gap-4 animate-in slide-in-from-bottom-20 fade-in duration-700 pb-4">
            <button
              onClick={handleStop}
              className="py-6 bg-white/[0.05] backdrop-blur-xl border border-white/5 hover:bg-red-500/10 text-white/50 hover:text-red-300 rounded-2xl font-medium flex items-center justify-center gap-3 transition-all active:scale-95"
            >
              <Square size={18} fill="currentColor" className="opacity-60" />
              <span className="text-[10px] tracking-[0.2em] uppercase">{t.ui.end}</span>
            </button>

            <button
              onClick={handleTogglePause}
              className="py-6 bg-white text-black hover:bg-gray-200 rounded-2xl font-medium flex items-center justify-center gap-3 transition-all active:scale-95"
            >
              {isPaused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
              <span className="text-[10px] tracking-[0.2em] uppercase font-bold">{isPaused ? t.ui.resume : t.ui.pause}</span>
            </button>
          </div>
        )}
      </div>
    </footer>
  );
}
