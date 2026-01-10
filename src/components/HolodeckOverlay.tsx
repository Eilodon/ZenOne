
import { useEffect, useState } from 'react';
import { Terminal, X, Activity } from 'lucide-react';
import { Holodeck } from '../services/Holodeck';
import { useKernel } from '../kernel/KernelProvider';
import clsx from 'clsx';

export function HolodeckOverlay({ onClose }: { onClose: () => void }) {
    const kernel = useKernel();
    const holodeck = Holodeck.getInstance();
    const [logs, setLogs] = useState(holodeck.getLogs());
    const [isRunning, setIsRunning] = useState(holodeck.isActive);

    useEffect(() => {
        holodeck.attach(kernel);
        const unsub = holodeck.subscribe(() => {
            setLogs([...holodeck.getLogs()]);
            setIsRunning(holodeck.isActive);
        });
        return () => { unsub(); };
    }, [kernel]);

    const run = (id: string) => {
        holodeck.runScenario(id);
    };

    return (
        <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-xl flex flex-col font-mono text-xs animate-in fade-in duration-300">
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#161719]">
                <div className="flex items-center gap-2">
                    <Terminal size={14} className="text-purple-400" />
                    <span className="font-bold text-white tracking-widest uppercase">THE HOLODECK <span className="text-purple-400">// SIMULATION RUNTIME</span></span>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full"><X size={16} className="text-white/50" /></button>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Sidebar: Scenarios */}
                <div className="w-48 border-r border-white/10 p-4 space-y-2 bg-[#0B0B0C]">
                    <div className="text-[9px] text-white/30 uppercase tracking-widest mb-2">Test Scenarios</div>

                    <button
                        disabled={isRunning}
                        onClick={() => run('nominal')}
                        className="w-full text-left p-3 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50 border border-white/5 flex items-center gap-2 group"
                    >
                        <div className="w-2 h-2 rounded-full bg-emerald-500 group-hover:shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                        <div>
                            <div className="text-white/90 font-bold">NOMINAL</div>
                            <div className="text-[9px] text-white/40">Standard Flow</div>
                        </div>
                    </button>

                    <button
                        disabled={isRunning}
                        onClick={() => run('panic')}
                        className="w-full text-left p-3 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50 border border-white/5 flex items-center gap-2 group"
                    >
                        <div className="w-2 h-2 rounded-full bg-red-500 group-hover:shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                        <div>
                            <div className="text-white/90 font-bold">TRAUMA</div>
                            <div className="text-[9px] text-white/40">Panic Response</div>
                        </div>
                    </button>

                    <button
                        disabled={isRunning}
                        onClick={() => run('ai_tune')}
                        className="w-full text-left p-3 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50 border border-white/5 flex items-center gap-2 group"
                    >
                        <div className="w-2 h-2 rounded-full bg-blue-500 group-hover:shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
                        <div>
                            <div className="text-white/90 font-bold">CORTEX</div>
                            <div className="text-[9px] text-white/40">AI Co-Regulation</div>
                        </div>
                    </button>
                </div>

                {/* Main Log Output */}
                <div className="flex-1 p-4 overflow-y-auto bg-black font-mono">
                    {logs.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-30 gap-2">
                            <Activity size={32} />
                            <div>Ready for Simulation</div>
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {logs.map((l, i) => (
                                <div key={i} className="flex gap-3 border-b border-white/5 pb-1 last:border-0">
                                    <span className="text-white/20 shrink-0 w-16">{new Date(l.time).toISOString().split('T')[1].slice(0, -1)}</span>
                                    <span className={clsx(
                                        "font-bold uppercase shrink-0 w-12",
                                        l.type === 'pass' ? 'text-emerald-500' : l.type === 'fail' ? 'text-red-500' : 'text-blue-400'
                                    )}>[{l.type}]</span>
                                    <span className="text-white/70">{l.msg}</span>
                                </div>
                            ))}
                            <div id="log-end" />
                        </div>
                    )}
                </div>
            </div>

            {isRunning && (
                <div className="h-1 w-full bg-purple-500/20 overflow-hidden">
                    <div className="h-full bg-purple-500 animate-shimmer w-[50%]" />
                </div>
            )}
        </div>
    );
}
