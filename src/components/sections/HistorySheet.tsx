
import React, { useMemo } from 'react';
import { Flame, Trash2, Fingerprint, Lock, ShieldCheck, Activity } from 'lucide-react';
import clsx from 'clsx';
import { useSettingsStore } from '../../stores/settingsStore';
import { useUIStore } from '../../stores/uiStore';
import { TRANSLATIONS } from '../../translations';
import { hapticTick } from '../../services/haptics';
import { GestureBottomSheet } from '../design-system/Primitives';
import { useKernelState } from '../../kernel/KernelProvider';
import { BREATHING_PATTERNS } from '../../types';

const formatDate = (timestamp: number, lang: 'en' | 'vi', t: any) => {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  const timeStr = date.toLocaleTimeString(lang === 'vi' ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit' });
  if (isToday) return `${t.history.today}, ${timeStr}`;
  return date.toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', { month: 'short', day: 'numeric' }) + `, ${timeStr}`;
};

export function HistorySheet() {
  const isHistoryOpen = useUIStore(s => s.isHistoryOpen);
  const setHistoryOpen = useUIStore(s => s.setHistoryOpen);
  
  const userSettings = useSettingsStore(s => s.userSettings);
  const history = useSettingsStore(s => s.history);
  const clearHistory = useSettingsStore(s => s.clearHistory);
  
  // Connect to Kernel Safety Registry for Bio-Affinity Data
  const safetyRegistry = useKernelState(s => s.safetyRegistry);
  
  const t = TRANSLATIONS[userSettings.language] || TRANSLATIONS.en;

  const triggerHaptic = () => {
    if (userSettings.hapticEnabled) hapticTick(true, 'medium');
  };

  const historyStats = useMemo(() => {
    const totalSessions = history.length;
    const totalSecs = history.reduce((acc, curr) => acc + curr.durationSec, 0);
    const totalMins = Math.floor(totalSecs / 60);
    return { totalSessions, totalMins };
  }, [history]);
  
  // Sort patterns by affinity for the Matrix view
  const affinityData = useMemo(() => {
      return Object.values(BREATHING_PATTERNS).map(p => {
          const profile = safetyRegistry[p.id];
          return {
              ...p,
              score: profile?.resonance_score ?? 0.5,
              locked: (profile?.safety_lock_until ?? 0) > Date.now(),
              stress: profile?.cummulative_stress_score ?? 0
          };
      }).sort((a, b) => b.score - a.score);
  }, [safetyRegistry]);

  return (
    <GestureBottomSheet
      open={isHistoryOpen}
      onClose={() => setHistoryOpen(false)}
      title={
        <span className="flex items-center gap-2">
           {t.history.title}
        </span>
      }
    >
        <div className="space-y-8 pb-8">
            {/* STATS ROW */}
            <div className="grid grid-cols-2 gap-4">
                <div className="bg-white/[0.02] border border-white/5 rounded-[2rem] p-6 backdrop-blur-md">
                    <div className="text-3xl font-light font-sans mb-1 text-white/90">{historyStats.totalMins}</div>
                    <div className="text-white/30 font-caps text-[9px] tracking-widest">{t.history.totalMinutes}</div>
                </div>
                <div className="bg-white/[0.02] border border-white/5 rounded-[2rem] p-6 backdrop-blur-md relative overflow-hidden">
                    {userSettings.streak > 1 && <div className="absolute inset-0 bg-orange-500/5" />}
                    <div className={clsx("text-3xl font-light font-sans mb-1 flex items-center gap-2", userSettings.streak > 1 ? "text-orange-200" : "text-white/90")}>
                        {userSettings.streak} <Flame size={18} className={userSettings.streak > 1 ? "text-orange-500 fill-orange-500" : "text-white/20"} />
                    </div>
                    <div className="text-white/30 font-caps text-[9px] tracking-widest">{t.ui.streak}</div>
                </div>
            </div>

            {/* BIO-AFFINITY MATRIX (Trauma Registry Viz) */}
            <section className="bg-white/[0.02] border border-white/5 rounded-[24px] p-6 backdrop-blur-md">
                <div className="flex items-center justify-between mb-4">
                    <div className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-bold flex items-center gap-2">
                        <Fingerprint size={12} className="text-emerald-500"/> Bio-Affinity Matrix
                    </div>
                    <div className="text-[9px] text-white/20 font-mono">v6.4 REGISTRY</div>
                </div>
                
                <div className="space-y-3">
                    {affinityData.slice(0, 5).map((p) => {
                        const isHigh = p.score > 0.7;
                        const isLow = p.score < 0.3;
                        const colorClass = p.locked ? 'bg-red-500' : isHigh ? 'bg-emerald-500' : isLow ? 'bg-orange-500' : 'bg-blue-500';
                        const textClass = p.locked ? 'text-red-400' : isHigh ? 'text-emerald-400' : isLow ? 'text-orange-400' : 'text-blue-400';
                        
                        return (
                            <div key={p.id} className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center shrink-0">
                                    {p.locked ? <Lock size={12} className="text-white/20" /> : <ShieldCheck size={12} className={textClass} opacity={0.6} />}
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs text-white/80 font-medium">{t.patterns[p.id]?.label || p.label}</span>
                                        <span className="text-[10px] text-white/30 font-mono">{(p.score * 100).toFixed(0)}%</span>
                                    </div>
                                    <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                                        <div 
                                            className={clsx("h-full transition-all duration-500 rounded-full", colorClass)} 
                                            style={{ width: `${p.score * 100}%`, opacity: p.locked ? 0.3 : 0.8 }} 
                                        />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="mt-4 pt-4 border-t border-white/5 text-[9px] text-white/30 font-light leading-relaxed">
                    System automatically ranks protocols based on your biological resonance (HRV coherence & affective response).
                </div>
            </section>

            {/* SESSION HISTORY */}
            <div>
                <div className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-bold mb-4 pl-2">Recent Sessions</div>
                {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 opacity-30 text-center">
                    <div className="mb-2 text-2xl grayscale opacity-50">🍃</div>
                    <p className="text-xs font-light max-w-[200px] leading-relaxed">{t.history.noHistory}</p>
                </div>
                ) : (
                <div className="space-y-3">
                    {history.map((item) => (
                    <div key={item.id} className="flex items-center justify-between p-4 bg-white/[0.02] hover:bg-white/[0.04] rounded-2xl border border-white/5 transition-colors">
                        <div className="flex items-center gap-4">
                            <div className="w-8 h-8 rounded-full bg-white/5 border border-white/5 flex items-center justify-center text-[10px] font-bold text-white/50 font-mono">
                                {item.cycles}
                            </div>
                            <div>
                                <div className="text-sm font-medium text-white/80">
                                {t.patterns[item.patternId]?.label || 'Breath'}
                                </div>
                                <div className="text-[10px] text-white/30 font-mono mt-0.5 tracking-wide">
                                {formatDate(item.timestamp, userSettings.language, t)}
                                </div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-xs font-medium text-white/60 font-mono">
                                {Math.floor(item.durationSec / 60)}<span className="text-[8px] text-white/20 ml-0.5">{t.history.min}</span> {item.durationSec % 60}<span className="text-[8px] text-white/20 ml-0.5">{t.history.sec}</span>
                            </div>
                        </div>
                    </div>
                    ))}
                    
                    <button 
                    onClick={() => { triggerHaptic(); clearHistory(); }}
                    className="w-full mt-8 py-4 text-[10px] text-white/20 hover:text-red-400 hover:bg-red-500/5 rounded-2xl transition-all flex items-center justify-center gap-2 font-caps tracking-widest"
                    >
                    <Trash2 size={12} /> {t.history.clear}
                    </button>
                </div>
                )}
            </div>
        </div>
    </GestureBottomSheet>
  );
}
