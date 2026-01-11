import React, { useState, useEffect, useRef } from 'react';
import { Lock, Circle, X, Check, AlertTriangle, Info, ThumbsUp, ThumbsDown, Copy } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';

// --- TOKENS & UTILS ---
const TOKENS = {
  colors: {
    dark: { surface: "#0B0B0C", elev: "#161719", text: "#EDEDED", primary: "#3B82F6", success: "#16A34A", warn: "#F59E0B", error: "#DC2626" }
  },
  duration: { in: 150, out: 200 }
};

// --- SECURITY CUE ---
interface SecurityCueProps { mode: 'on-device'|'hybrid'|'cloud' }

export const SecurityCue: React.FC<SecurityCueProps> = ({ mode }) => {
  const map = {
    'on-device': { color: TOKENS.colors.dark.success, label: 'On-device', icon: Lock },
    'hybrid': { color: TOKENS.colors.dark.primary, label: 'Hybrid', icon: Lock },
    'cloud': { color: '#64748B', label: 'Cloud', icon: Lock },
  } as const;
  
  const cfg = map[mode];
  const Icon = cfg.icon;

  return (
    <div 
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-medium tracking-wide backdrop-blur-sm bg-black/20"
      style={{ borderColor: cfg.color, color: cfg.color }}
      aria-label={`Privacy: ${cfg.label}`}
    >
      <Circle size={6} fill="currentColor" stroke="none" />
      <span>{cfg.label}</span>
      <Icon size={10} className="opacity-70" />
    </div>
  );
};

// --- LIVE RESULT CARD (Streaming) ---
interface LiveResultCardProps { 
  title: string; 
  content?: string; 
  generating?: boolean; 
  onDismiss?: () => void;
  mode?: 'on-device' | 'hybrid' | 'cloud';
}

export const LiveResultCard: React.FC<LiveResultCardProps> = ({ 
  title, 
  content, 
  generating = false, 
  onDismiss, 
  mode = 'cloud' 
}) => {
  const [stream, setStream] = useState("");
  const [isGen, setIsGen] = useState(generating);

  useEffect(() => {
    setIsGen(generating);
  }, [generating]);

  // Simulate streaming effect if generating is true, or if content changes
  useEffect(() => {
    if (!content) return;
    if (generating) {
        setStream(""); 
        return;
    }
    
    // Simple typewriter effect for new content
    let i = 0;
    setStream("");
    const id = setInterval(() => {
      setStream(s => s + (content[i] || ""));
      i++;
      if (i >= content.length) clearInterval(id);
    }, 15);
    
    return () => clearInterval(id);
  }, [content, generating]);

  const displayedText = generating ? "Processing..." : (stream || content);

  return (
    <div 
        className="relative w-full max-w-sm rounded-[16px] p-5 bg-[#161719] border border-white/10 shadow-card transition-all"
        role="region" 
        aria-live="polite"
    >
      <div className="absolute top-4 right-4 flex items-center gap-3">
        <SecurityCue mode={mode} />
        {onDismiss && (
            <button onClick={onDismiss} className="p-1 hover:bg-white/10 rounded-full text-white/40 hover:text-white transition-colors">
                <X size={14} />
            </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3 text-white/50">
        <div className={clsx("w-2 h-2 rounded-full", generating ? "bg-blue-500 animate-pulse" : "bg-white/20")} />
        <span className="text-xs font-medium tracking-wide font-sans">{title}</span>
      </div>

      <div className="min-h-[60px] text-sm leading-relaxed text-[#EDEDED]/90 font-light font-sans">
        {generating ? (
            <div className="space-y-2 animate-pulse">
                <div className="h-4 bg-white/5 rounded w-3/4"></div>
                <div className="h-4 bg-white/5 rounded w-1/2"></div>
            </div>
        ) : (
            <p>
               {displayedText}
               {isGen && <span className="inline-block w-1.5 h-3 ml-1 bg-blue-500 animate-pulse align-middle"/>}
            </p>
        )}
      </div>
      
      {!generating && content && (
        <div className="mt-4 flex gap-2 pt-3 border-t border-white/5">
            <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[10px] text-white/60 transition-colors">
                <Copy size={12} /> Copy
            </button>
             <div className="ml-auto flex gap-1">
                <button className="p-1.5 rounded-lg hover:bg-white/5 text-white/40 hover:text-green-400 transition-colors"><ThumbsUp size={12}/></button>
                <button className="p-1.5 rounded-lg hover:bg-white/5 text-white/40 hover:text-red-400 transition-colors"><ThumbsDown size={12}/></button>
             </div>
        </div>
      )}
    </div>
  );
};

// --- KINETIC SNACKBAR ---
interface KineticSnackbarProps { 
    kind?: 'success' | 'warn' | 'error'; 
    text: string; 
    onClose: () => void; 
}

export const KineticSnackbar: React.FC<KineticSnackbarProps> = ({ 
    kind = 'success', 
    text, 
    onClose 
}) => {
  const [closing, setClosing] = useState(false);
  
  useEffect(() => {
    const t1 = setTimeout(() => setClosing(true), 3500);
    const t2 = setTimeout(onClose, 3700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [onClose]);

  const IconMap = {
      success: Check,
      warn: AlertTriangle,
      error: Info // or alert
  };
  const Icon = IconMap[kind];
  
  const colors = {
      success: 'border-green-500/50 text-green-100',
      warn: 'border-amber-500/50 text-amber-100',
      error: 'border-red-500/50 text-red-100'
  };

  return (
    <div 
        role="status" 
        className={clsx(
            "fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] min-w-[300px] max-w-[90vw] px-4 py-3 rounded-[12px] border bg-[#161719]/90 backdrop-blur-md shadow-2xl flex items-center gap-3",
            colors[kind],
            closing ? "animate-snack-out" : "animate-snack-in"
        )}
    >
      <Icon size={18} className={kind === 'success' ? 'text-green-500' : kind === 'warn' ? 'text-amber-500' : 'text-red-500'} />
      <span className="text-sm font-medium">{text}</span>
    </div>
  );
};

// --- BOTTOM SHEET (Gesture) ---
interface GestureBottomSheetProps { 
    open: boolean; 
    onClose: () => void; 
    children?: React.ReactNode; 
    title?: React.ReactNode;
}

export const GestureBottomSheet: React.FC<GestureBottomSheetProps> = ({
    open,
    onClose,
    children,
    title
}) => {
  const [dy, setDy] = useState(0);
  const startY = useRef<number|null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // [P2.1 UPGRADE] Focus trap and keyboard navigation
  useEffect(() => {
    if (!open) {
      setDy(0);
      return;
    }

    // Focus close button when sheet opens (or first focusable element)
    setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 100);

    // Keyboard handler
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      // Tab key focus trap
      if (e.key === 'Tab' && sheetRef.current) {
        const focusableElements = sheetRef.current.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey && document.activeElement === firstElement) {
          lastElement?.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === lastElement) {
          firstElement?.focus();
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
          {/* [P1.1 UPGRADE] Backdrop with fade animation */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-label="Close dialog"
          />

          {/* [P1.1 UPGRADE] Sheet with spring physics slide-up */}
          {/* [P2.1 UPGRADE] Focus trap and accessibility */}
          <motion.div
            ref={sheetRef}
            initial={{ y: "100%", opacity: 0 }}
            animate={{ y: dy, opacity: 1 }}
            exit={{ y: "100%", opacity: 0 }}
            transition={{
              type: "spring",
              damping: 25,
              stiffness: 300,
              duration: 0.4
            }}
            className="relative w-full bg-[#161719] border-t border-white/10 rounded-t-[24px] shadow-2xl pb-safe"
            onTouchStart={e => { startY.current = e.touches[0].clientY; }}
            onTouchMove={e => {
                if (startY.current === null) return;
                const delta = e.touches[0].clientY - startY.current;
                if (delta > 0) setDy(delta);
            }}
            onTouchEnd={() => {
                if (dy > 100) onClose();
                setDy(0);
                startY.current = null;
            }}
          >
        {/* Handle */}
        <div className="w-full flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing" aria-hidden="true">
            <div className="w-12 h-1.5 bg-white/20 rounded-full" />
        </div>

        {title && (
            <div className="px-6 py-2 border-b border-white/5 flex items-center justify-between">
                <div id="sheet-title" className="text-lg font-serif text-white/90">{title}</div>
                <button
                  ref={closeButtonRef}
                  onClick={onClose}
                  className="p-2 bg-white/5 rounded-full hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-[#161719] transition-all"
                  aria-label="Close dialog"
                >
                  <X size={16} className="text-white/60"/>
                </button>
            </div>
        )}
        
        <div className="p-6 max-h-[75vh] overflow-y-auto scrollbar-hide">
            {children}
        </div>
      </motion.div>
    </div>
      )}
    </AnimatePresence>
  );
};