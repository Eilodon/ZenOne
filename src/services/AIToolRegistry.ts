/**
 * AI TOOL REGISTRY - SAFE FUNCTION CALLING
 * =========================================
 *
 * Validates and controls AI function calls with:
 * - Schema validation (type-safe without Zod dependency)
 * - Pre-condition checks (rate limits, safety locks)
 * - User confirmation for risky actions
 * - Rollback capability
 *
 * References:
 * - OpenAI Function Calling API
 * - Anthropic Tool Use
 * - Semantic Kernel Pattern (Microsoft)
 */

import { PureZenBKernel } from './PureZenBKernel';
import { BreathingType, BREATHING_PATTERNS } from '../types';

// --- VALIDATION SCHEMAS ---

interface FieldSchema {
  type: 'number' | 'string' | 'boolean';
  required?: boolean;
  min?: number;
  max?: number;
  enum?: string[];
  minLength?: number;
}

interface ToolSchema {
  [key: string]: FieldSchema;
}

// --- TOOL DEFINITIONS ---

export interface ToolDefinition {
  name: string;
  description: string;
  schema: ToolSchema;

  // Pre-condition check (before execution)
  canExecute: (args: any, context: ToolContext) => {
    allowed: boolean;
    reason?: string;
    needsConfirmation?: boolean;
  };

  // Execution logic
  execute: (args: any, kernel: PureZenBKernel) => Promise<any>;

  // Rollback (if user reports distress after execution)
  rollback?: (context: ToolContext, kernel: PureZenBKernel) => Promise<void>;
}

export interface ToolContext {
  safetyRegistry: Record<string, any>;
  lastTempoChange: number;
  lastPatternChange: number;
  currentTempo: number;
  currentPattern: string | null;
  sessionDuration: number;
  userConfirmed?: boolean;
  previousTempo?: number;
  previousPattern?: string;
}

// --- VALIDATION HELPER ---

class SchemaValidator {
  static validate(data: any, schema: ToolSchema): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const [field, fieldSchema] of Object.entries(schema)) {
      const value = data[field];

      // Check required
      if (fieldSchema.required && (value === undefined || value === null)) {
        errors.push(`Field '${field}' is required`);
        continue;
      }

      if (value === undefined || value === null) continue; // Optional field not provided

      // Check type
      if (typeof value !== fieldSchema.type) {
        errors.push(`Field '${field}' must be of type ${fieldSchema.type}`);
        continue;
      }

      // Number constraints
      if (fieldSchema.type === 'number') {
        if (fieldSchema.min !== undefined && value < fieldSchema.min) {
          errors.push(`Field '${field}' must be >= ${fieldSchema.min}`);
        }
        if (fieldSchema.max !== undefined && value > fieldSchema.max) {
          errors.push(`Field '${field}' must be <= ${fieldSchema.max}`);
        }
      }

      // String constraints
      if (fieldSchema.type === 'string') {
        if (fieldSchema.minLength !== undefined && value.length < fieldSchema.minLength) {
          errors.push(`Field '${field}' must have at least ${fieldSchema.minLength} characters`);
        }
        if (fieldSchema.enum && !fieldSchema.enum.includes(value)) {
          errors.push(`Field '${field}' must be one of: ${fieldSchema.enum.join(', ')}`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

// --- TOOL REGISTRY ---

export const AI_TOOLS: Record<string, ToolDefinition> = {
  adjust_tempo: {
    name: 'adjust_tempo',
    description: 'Adjust breathing guide speed based on user distress or relaxation levels',

    schema: {
      scale: { type: 'number', required: true, min: 0.8, max: 1.4 },
      reason: { type: 'string', required: true, minLength: 10 }
    },

    canExecute: (args, context) => {
      // Rate limit: Max 1 adjustment per 5 seconds
      const timeSinceLastAdjust = Date.now() - context.lastTempoChange;
      if (timeSinceLastAdjust < 5000) {
        return {
          allowed: false,
          reason: `Rate limit: Must wait ${Math.ceil((5000 - timeSinceLastAdjust) / 1000)}s before next tempo adjustment`
        };
      }

      // Max delta check: Cannot change more than 0.2 from current
      const delta = Math.abs(args.scale - context.currentTempo);
      if (delta > 0.2) {
        return {
          allowed: false,
          reason: `Tempo change too large (Δ=${delta.toFixed(2)}). Max allowed: 0.2`
        };
      }

      return { allowed: true };
    },

    execute: async (args, kernel) => {
      kernel.dispatch({
        type: 'ADJUST_TEMPO',
        scale: args.scale,
        reason: `AI: ${args.reason}`,
        timestamp: Date.now()
      });

      return { success: true, new_tempo: args.scale };
    },

    rollback: async (context, kernel) => {
      if (context.previousTempo) {
        kernel.dispatch({
          type: 'ADJUST_TEMPO',
          scale: context.previousTempo,
          reason: 'ROLLBACK: User reported discomfort',
          timestamp: Date.now()
        });
      }
    }
  },

  switch_pattern: {
    name: 'switch_pattern',
    description: 'Switch the current breathing pattern to a more suitable technique',

    schema: {
      patternId: {
        type: 'string',
        required: true,
        enum: ['4-7-8', 'box', 'calm', 'coherence', 'deep-relax', '7-11', 'awake', 'triangle', 'tactical', 'buteyko', 'wim-hof']
      },
      reason: { type: 'string', required: true, minLength: 10 }
    },

    canExecute: (args, context) => {
      // Check if pattern is trauma-locked
      const profile = context.safetyRegistry[args.patternId];
      if (profile?.safety_lock_until > Date.now()) {
        const unlockDate = new Date(profile.safety_lock_until).toLocaleString();
        return {
          allowed: false,
          reason: `Pattern "${args.patternId}" is locked until ${unlockDate} due to previous stress response`
        };
      }

      // Rate limit: Max 1 pattern switch per 30 seconds
      const timeSinceLastSwitch = Date.now() - context.lastPatternChange;
      if (timeSinceLastSwitch < 30000) {
        return {
          allowed: false,
          reason: `Rate limit: Must wait ${Math.ceil((30000 - timeSinceLastSwitch) / 1000)}s before switching patterns`
        };
      }

      // Require user confirmation for high-arousal patterns
      const pattern = BREATHING_PATTERNS[args.patternId as BreathingType];
      if (pattern && pattern.arousalImpact > 0.5 && !context.userConfirmed) {
        return {
          allowed: false,
          reason: `Pattern "${args.patternId}" (${pattern.label}) requires user confirmation`,
          needsConfirmation: true
        };
      }

      // Don't switch if session is very short (user just started)
      if (context.sessionDuration < 30) {
        return {
          allowed: false,
          reason: 'Cannot switch patterns during first 30 seconds of session'
        };
      }

      return { allowed: true };
    },

    execute: async (args, kernel) => {
      kernel.dispatch({
        type: 'LOAD_PROTOCOL',
        patternId: args.patternId as BreathingType,
        timestamp: Date.now()
      });

      kernel.dispatch({
        type: 'START_SESSION',
        timestamp: Date.now()
      });

      return { success: true, pattern: args.patternId };
    },

    rollback: async (context, kernel) => {
      if (context.previousPattern) {
        kernel.dispatch({
          type: 'LOAD_PROTOCOL',
          patternId: context.previousPattern as BreathingType,
          timestamp: Date.now()
        });
        kernel.dispatch({
          type: 'START_SESSION',
          timestamp: Date.now()
        });
      }
    }
  }
};

// --- TOOL EXECUTOR ---

export class ToolExecutor {
  private kernel: PureZenBKernel;
  private lastTempoChange = 0;
  private lastPatternChange = 0;
  private confirmationCallbacks = new Map<string, (confirmed: boolean) => void>();

  constructor(kernel: PureZenBKernel) {
    this.kernel = kernel;
  }

  /**
   * Execute an AI tool call with full validation
   */
  async execute(
    toolName: string,
    args: any,
    userConfirmed: boolean = false
  ): Promise<{ success: boolean; result?: any; error?: string; needsConfirmation?: boolean }> {
    // 1. Validate tool exists
    const tool = AI_TOOLS[toolName];
    if (!tool) {
      return { success: false, error: `Unknown tool: ${toolName}` };
    }

    // 2. Validate arguments
    const validation = SchemaValidator.validate(args, tool.schema);
    if (!validation.valid) {
      return { success: false, error: `Validation failed: ${validation.errors.join(', ')}` };
    }

    // 3. Build context
    const state = this.kernel.getState();
    const context: ToolContext = {
      safetyRegistry: state.safetyRegistry,
      lastTempoChange: this.lastTempoChange,
      lastPatternChange: this.lastPatternChange,
      currentTempo: state.tempoScale,
      currentPattern: state.pattern?.id || null,
      sessionDuration: state.sessionDuration,
      userConfirmed,
      previousTempo: state.tempoScale,
      previousPattern: state.pattern?.id
    };

    // 4. Check pre-conditions
    const canExec = tool.canExecute(args, context);
    if (!canExec.allowed) {
      if (canExec.needsConfirmation) {
        return { success: false, needsConfirmation: true, error: canExec.reason };
      }
      return { success: false, error: canExec.reason };
    }

    // 5. Execute
    try {
      const result = await tool.execute(args, this.kernel);

      // Update tracking
      if (toolName === 'adjust_tempo') {
        this.lastTempoChange = Date.now();
      }
      if (toolName === 'switch_pattern') {
        this.lastPatternChange = Date.now();
      }

      return { success: true, result };
    } catch (err: any) {
      console.error(`[ToolExecutor] Execution failed for ${toolName}:`, err);

      // Attempt rollback if available
      if (tool.rollback) {
        try {
          await tool.rollback(context, this.kernel);
          console.log(`[ToolExecutor] Rollback completed for ${toolName}`);
        } catch (rollbackErr) {
          console.error(`[ToolExecutor] Rollback failed:`, rollbackErr);
        }
      }

      return { success: false, error: err.message };
    }
  }

  /**
   * Request user confirmation for a tool call
   */
  requestConfirmation(
    toolName: string,
    args: any,
    onConfirm: (confirmed: boolean) => void
  ): void {
    const confirmId = `${toolName}_${Date.now()}`;
    this.confirmationCallbacks.set(confirmId, onConfirm);

    // Dispatch event for UI to show confirmation dialog
    this.kernel.dispatch({
      type: 'AI_INTERVENTION',
      intent: `CONFIRMATION_REQUIRED:${toolName}`,
      parameters: { confirmId, toolName, args },
      timestamp: Date.now()
    });
  }

  /**
   * Handle user confirmation response
   */
  handleConfirmation(confirmId: string, confirmed: boolean): void {
    const callback = this.confirmationCallbacks.get(confirmId);
    if (callback) {
      callback(confirmed);
      this.confirmationCallbacks.delete(confirmId);
    }
  }
}
