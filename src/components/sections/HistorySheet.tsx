
import { useMemo } from 'react';
import { Flame, Trash2, Fingerprint, Lock, ShieldCheck, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
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

    // [P1.3 UPGRADE] Data visualization: Emotional journey & bio-metrics trends
    const chartData = useMemo(() => {
        // Get last 10 sessions for trend analysis
        const recentSessions = history.slice(-10).reverse();

        return recentSessions.map((session, idx) => {
            const date = new Date(session.timestamp);
            const timeLabel = date.toLocaleDateString(userSettings.language === 'vi' ? 'vi-VN' : 'en-US', {
                month: 'short',
                day: 'numeric'
            });

            return {
                id: session.id,
                time: timeLabel,
                session: idx + 1,
                arousal: session.finalBelief?.arousal ?? 0.5,
                valence: session.finalBelief?.valence ?? 0,
                rhythm: session.finalBelief?.rhythm_alignment ?? 0.5,
                attention: session.finalBelief?.attention ?? 0.5,
                duration: session.durationSec / 60, // minutes
            };
        });
    }, [history, userSettings.language]);

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

                {/* [P1.3 UPGRADE] EMOTIONAL JOURNEY TRENDS */}
                {chartData.length >= 3 && (
                    <section className="bg-white/[0.02] border border-white/5 rounded-[24px] p-6 backdrop-blur-md">
                        <div className="flex items-center justify-between mb-4">
                            <div className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-bold flex items-center gap-2">
                                <TrendingUp size={12} className="text-blue-500" /> Emotional Journey
                            </div>
                            <div className="text-[9px] text-white/20 font-mono">Last {chartData.length} Sessions</div>
                        </div>

                        {/* Arousal & Valence Dual Chart */}
                        <div className="mb-6">
                            <div className="text-xs text-white/50 mb-2 pl-2">Emotional State Over Time</div>
                            <ResponsiveContainer width="100%" height={180}>
                                <AreaChart data={chartData}>
                                    <defs>
                                        <linearGradient id="arousalGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                                        </linearGradient>
                                        <linearGradient id="valenceGradient" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#16A34A" stopOpacity={0.3}/>
                                            <stop offset="95%" stopColor="#16A34A" stopOpacity={0}/>
                                        </linearGradient>
                                    </defs>
                                    <XAxis
                                        dataKey="time"
                                        stroke="#475569"
                                        style={{ fontSize: 9, fill: '#64748B' }}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        stroke="#475569"
                                        domain={[-1, 1]}
                                        ticks={[-1, 0, 1]}
                                        style={{ fontSize: 9, fill: '#64748B' }}
                                        tickLine={false}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: '#161719',
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: '8px',
                                            fontSize: '10px'
                                        }}
                                        labelStyle={{ color: '#CBD5E1', fontWeight: 'bold' }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="valence"
                                        stroke="#16A34A"
                                        strokeWidth={2}
                                        fill="url(#valenceGradient)"
                                        name="Valence"
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="arousal"
                                        stroke="#3B82F6"
                                        strokeWidth={2}
                                        fill="url(#arousalGradient)"
                                        name="Arousal"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                            <div className="flex items-center justify-center gap-6 mt-3">
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-1 bg-blue-500 rounded-full" />
                                    <span className="text-[9px] text-white/40">Arousal</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <div className="w-3 h-1 bg-emerald-500 rounded-full" />
                                    <span className="text-[9px] text-white/40">Valence</span>
                                </div>
                            </div>
                        </div>

                        {/* Rhythm Alignment Progress */}
                        <div>
                            <div className="text-xs text-white/50 mb-2 pl-2">Bio-Resonance Progress</div>
                            <ResponsiveContainer width="100%" height={140}>
                                <LineChart data={chartData}>
                                    <XAxis
                                        dataKey="time"
                                        stroke="#475569"
                                        style={{ fontSize: 9, fill: '#64748B' }}
                                        tickLine={false}
                                    />
                                    <YAxis
                                        stroke="#475569"
                                        domain={[0, 1]}
                                        ticks={[0, 0.5, 1]}
                                        style={{ fontSize: 9, fill: '#64748B' }}
                                        tickLine={false}
                                    />
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: '#161719',
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: '8px',
                                            fontSize: '10px'
                                        }}
                                        labelStyle={{ color: '#CBD5E1', fontWeight: 'bold' }}
                                    />
                                    <Line
                                        type="monotone"
                                        dataKey="rhythm"
                                        stroke="#A855F7"
                                        strokeWidth={2.5}
                                        dot={{ fill: '#A855F7', r: 4, strokeWidth: 2, stroke: '#1F2937' }}
                                        activeDot={{ r: 6, fill: '#A855F7', stroke: '#1F2937', strokeWidth: 3 }}
                                        name="Rhythm Alignment"
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                            <div className="text-[9px] text-white/30 text-center mt-2 leading-relaxed">
                                Shows how well your breathing synchronized with your heart rhythm (HRV coherence)
                            </div>
                        </div>
                    </section>
                )}

                {/* BIO-AFFINITY MATRIX (Trauma Registry Viz) */}
                <section className="bg-white/[0.02] border border-white/5 rounded-[24px] p-6 backdrop-blur-md">
                    <div className="flex items-center justify-between mb-4">
                        <div className="text-[10px] text-white/40 uppercase tracking-[0.2em] font-bold flex items-center gap-2">
                            <Fingerprint size={12} className="text-emerald-500" /> Bio-Affinity Matrix
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
                        <motion.div
                            className="space-y-3"
                            initial="hidden"
                            animate="visible"
                            variants={{
                                visible: {
                                    transition: {
                                        staggerChildren: 0.08,
                                        delayChildren: 0.12
                                    }
                                }
                            }}
                        >
                            {history.map((item, idx) => (
                                <motion.div
                                    key={item.id}
                                    variants={{
                                        hidden: { opacity: 0, x: -20, scale: 0.95 },
                                        visible: {
                                            opacity: 1,
                                            x: 0,
                                            scale: 1,
                                            transition: {
                                                type: "spring",
                                                damping: 20,
                                                stiffness: 200,
                                                delay: idx * 0.05
                                            }
                                        }
                                    }}
                                    className="flex items-center justify-between p-4 bg-white/[0.02] hover:bg-white/[0.04] rounded-2xl border border-white/5 transition-colors"
                                >
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
                                </motion.div>
                            ))}

                            <button
                                onClick={() => { triggerHaptic(); clearHistory(); }}
                                className="w-full mt-8 py-4 text-[10px] text-white/20 hover:text-red-400 hover:bg-red-500/5 rounded-2xl transition-all flex items-center justify-center gap-2 font-caps tracking-widest"
                            >
                                <Trash2 size={12} /> {t.history.clear}
                            </button>
                        </motion.div>
                    )}
                </div>
            </div>
        </GestureBottomSheet>
    );
}
