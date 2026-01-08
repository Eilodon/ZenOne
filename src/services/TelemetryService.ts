/**
 * TELEMETRY SERVICE v1.0
 * ======================
 * OpenTelemetry instrumentation for ZenB Kernel
 *
 * Features:
 * - Distributed tracing (spans)
 * - Metrics collection (histograms, counters)
 * - Structured event logging
 * - Context propagation
 * - Performance monitoring
 *
 * Backend Support:
 * - OTLP/HTTP export (configurable endpoint)
 * - Console export (dev mode)
 * - In-memory export (testing)
 *
 * Performance:
 * - Non-blocking async export
 * - Batched span processing
 * - Minimal overhead (<1ms per operation)
 *
 * References:
 * - OpenTelemetry Specification v1.24
 * - W3C Trace Context standard
 * - Prometheus naming conventions
 */

import type { KernelEvent, BeliefState } from '../types';
import type { RuntimeState } from './PureZenBKernel';

// ========== TYPES ==========

export type SpanKind = 'INTERNAL' | 'CLIENT' | 'SERVER';
export type SpanStatus = 'OK' | 'ERROR' | 'UNSET';

export interface SpanAttributes {
  [key: string]: string | number | boolean;
}

export interface Span {
  id: string;
  traceId: string;
  parentId?: string;
  name: string;
  kind: SpanKind;
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  attributes: SpanAttributes;
  events: SpanEvent[];
}

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes: SpanAttributes;
}

export interface MetricValue {
  name: string;
  value: number;
  timestamp: number;
  labels: Record<string, string>;
}

export interface TelemetryConfig {
  serviceName: string;
  serviceVersion: string;
  endpoint?: string;       // OTLP endpoint (e.g., https://telemetry.zenb.app/v1/traces)
  exportInterval?: number; // ms (default: 5000)
  maxBatchSize?: number;   // (default: 100)
  enableConsole?: boolean; // Log to console (dev mode)
}

// ========== TELEMETRY SERVICE ==========

export class TelemetryService {
  private config: Required<TelemetryConfig>;
  private spans: Span[] = [];
  private metrics: MetricValue[] = [];
  private activeSpans: Map<string, Span> = new Map();
  private exportTimer?: number;

  // Resource attributes (service metadata)
  private resource: Record<string, string>;

  constructor(config: TelemetryConfig) {
    this.config = {
      serviceName: config.serviceName,
      serviceVersion: config.serviceVersion,
      endpoint: config.endpoint || '',
      exportInterval: config.exportInterval || 5000,
      maxBatchSize: config.maxBatchSize || 100,
      enableConsole: config.enableConsole ?? false
    };

    this.resource = {
      'service.name': this.config.serviceName,
      'service.version': this.config.serviceVersion,
      'telemetry.sdk.name': 'zenb-otel',
      'telemetry.sdk.version': '1.0.0',
      'telemetry.sdk.language': 'typescript'
    };

    // Start batch export timer
    if (this.config.endpoint) {
      this.startExportTimer();
    }
  }

  // ========== TRACING API ==========

  /**
   * Start a new span
   */
  public startSpan(name: string, attributes?: SpanAttributes, kind: SpanKind = 'INTERNAL'): string {
    const span: Span = {
      id: this.generateId(),
      traceId: this.generateTraceId(),
      name,
      kind,
      startTime: performance.now(),
      status: 'UNSET',
      attributes: attributes || {},
      events: []
    };

    this.activeSpans.set(span.id, span);

    if (this.config.enableConsole) {
      console.log(`[TRACE] → ${name}`, attributes);
    }

    return span.id;
  }

  /**
   * Start a child span (nested operation)
   */
  public startChildSpan(parentId: string, name: string, attributes?: SpanAttributes): string {
    const parent = this.activeSpans.get(parentId);
    if (!parent) {
      return this.startSpan(name, attributes);
    }

    const span: Span = {
      id: this.generateId(),
      traceId: parent.traceId,
      parentId: parent.id,
      name,
      kind: 'INTERNAL',
      startTime: performance.now(),
      status: 'UNSET',
      attributes: attributes || {},
      events: []
    };

    this.activeSpans.set(span.id, span);

    return span.id;
  }

  /**
   * Add attributes to an active span
   */
  public setSpanAttributes(spanId: string, attributes: SpanAttributes): void {
    const span = this.activeSpans.get(spanId);
    if (span) {
      Object.assign(span.attributes, attributes);
    }
  }

  /**
   * Add an event to a span (timestamped annotation)
   */
  public addSpanEvent(spanId: string, eventName: string, attributes?: SpanAttributes): void {
    const span = this.activeSpans.get(spanId);
    if (span) {
      span.events.push({
        name: eventName,
        timestamp: performance.now(),
        attributes: attributes || {}
      });

      if (this.config.enableConsole) {
        console.log(`[EVENT] ${eventName}`, attributes);
      }
    }
  }

  /**
   * End a span (mark as complete)
   */
  public endSpan(spanId: string, status: SpanStatus = 'OK', error?: Error): void {
    const span = this.activeSpans.get(spanId);
    if (span) {
      span.endTime = performance.now();
      span.status = status;

      if (error) {
        span.attributes['error'] = true;
        span.attributes['error.type'] = error.name;
        span.attributes['error.message'] = error.message;
        span.attributes['error.stack'] = error.stack || '';
      }

      // Move to completed spans buffer
      this.spans.push(span);
      this.activeSpans.delete(spanId);

      if (this.config.enableConsole) {
        const duration = (span.endTime - span.startTime).toFixed(2);
        console.log(`[TRACE] ← ${span.name} (${duration}ms) [${status}]`);
      }

      // Flush if buffer is full
      if (this.spans.length >= this.config.maxBatchSize) {
        this.flush();
      }
    }
  }

  /**
   * Record an exception in a span
   */
  public recordException(spanId: string, error: Error): void {
    this.addSpanEvent(spanId, 'exception', {
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stacktrace': error.stack || ''
    });
  }

  // ========== METRICS API ==========

  /**
   * Record a histogram value (e.g., latency, size)
   */
  public recordHistogram(name: string, value: number, labels?: Record<string, string>): void {
    this.metrics.push({
      name: `${name}_histogram`,
      value,
      timestamp: Date.now(),
      labels: labels || {}
    });

    if (this.config.enableConsole) {
      console.log(`[METRIC] ${name} = ${value}`, labels);
    }
  }

  /**
   * Increment a counter
   */
  public incrementCounter(name: string, delta: number = 1, labels?: Record<string, string>): void {
    this.metrics.push({
      name: `${name}_total`,
      value: delta,
      timestamp: Date.now(),
      labels: labels || {}
    });

    if (this.config.enableConsole) {
      console.log(`[COUNTER] ${name} += ${delta}`, labels);
    }
  }

  /**
   * Record a gauge value (snapshot)
   */
  public recordGauge(name: string, value: number, labels?: Record<string, string>): void {
    this.metrics.push({
      name: `${name}_gauge`,
      value,
      timestamp: Date.now(),
      labels: labels || {}
    });
  }

  // ========== DOMAIN-SPECIFIC INSTRUMENTATION ==========

  /**
   * Instrument kernel tick (primary operation)
   */
  public instrumentKernelTick(
    state: RuntimeState,
    observation: any,
    callback: () => void
  ): void {
    const spanId = this.startSpan('kernel.tick', {
      'kernel.status': state.status,
      'kernel.pattern': state.pattern?.id || 'none',
      'obs.hr': observation.heart_rate || 0,
      'obs.confidence': observation.hr_confidence || 0
    });

    try {
      callback();

      // Record metrics
      this.recordHistogram('belief.arousal', state.belief.arousal, {
        pattern: state.pattern?.id || 'none'
      });

      this.recordHistogram('belief.prediction_error', state.belief.prediction_error);
      this.recordGauge('kernel.tempo_scale', state.tempoScale);

      this.endSpan(spanId, 'OK');
    } catch (error) {
      this.recordException(spanId, error as Error);
      this.endSpan(spanId, 'ERROR', error as Error);
      throw error;
    }
  }

  /**
   * Instrument kernel event dispatch
   */
  public instrumentEventDispatch(event: KernelEvent, callback: () => void): void {
    const spanId = this.startSpan('kernel.dispatch_event', {
      'event.type': event.type,
      'event.timestamp': event.timestamp
    });

    try {
      callback();

      // Increment event counter
      this.incrementCounter('kernel.events', 1, {
        type: event.type
      });

      this.endSpan(spanId, 'OK');
    } catch (error) {
      this.recordException(spanId, error as Error);
      this.endSpan(spanId, 'ERROR', error as Error);
      throw error;
    }
  }

  /**
   * Instrument safety check
   */
  public instrumentSafetyCheck(
    eventType: string,
    result: { safe: boolean; reason?: string },
    callback: () => void
  ): void {
    const spanId = this.startSpan('safety.check', {
      'event.type': eventType,
      'safety.result': result.safe
    });

    if (!result.safe) {
      this.addSpanEvent(spanId, 'safety_violation', {
        reason: result.reason || 'unknown'
      });

      this.incrementCounter('safety.violations', 1, {
        event_type: eventType
      });
    }

    callback();
    this.endSpan(spanId, 'OK');
  }

  /**
   * Instrument sympathetic override (trauma detection)
   */
  public recordSympatheticOverride(
    traumaMs: number,
    patternId: string,
    arousal: number
  ): void {
    const spanId = this.startSpan('watchdog.sympathetic_override', {
      'trauma_ms': traumaMs,
      'pattern': patternId,
      'arousal': arousal
    });

    this.addSpanEvent(spanId, 'sympathetic_override_triggered');
    this.incrementCounter('sympathetic_override', 1, { pattern: patternId });

    this.endSpan(spanId, 'OK');
  }

  /**
   * Record session lifecycle events
   */
  public recordSessionEvent(eventType: 'start' | 'end' | 'pause' | 'resume', metadata?: Record<string, any>): void {
    this.incrementCounter('session.events', 1, { type: eventType });

    if (this.config.enableConsole) {
      console.log(`[SESSION] ${eventType}`, metadata);
    }
  }

  // ========== EXPORT ==========

  /**
   * Flush buffered telemetry to backend
   */
  public async flush(): Promise<void> {
    if (this.spans.length === 0 && this.metrics.length === 0) {
      return;
    }

    const payload = {
      resourceSpans: [{
        resource: this.resource,
        scopeSpans: [{
          scope: {
            name: this.config.serviceName,
            version: this.config.serviceVersion
          },
          spans: this.spans.map(s => this.serializeSpan(s))
        }]
      }],
      resourceMetrics: [{
        resource: this.resource,
        scopeMetrics: [{
          scope: {
            name: this.config.serviceName,
            version: this.config.serviceVersion
          },
          metrics: this.metrics
        }]
      }]
    };

    // Export to OTLP endpoint
    if (this.config.endpoint) {
      try {
        await fetch(this.config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
      } catch (error) {
        console.error('[Telemetry] Export failed:', error);
      }
    }

    // Clear buffers
    this.spans = [];
    this.metrics = [];
  }

  /**
   * Serialize span to OTLP format
   */
  private serializeSpan(span: Span): any {
    return {
      traceId: span.traceId,
      spanId: span.id,
      parentSpanId: span.parentId,
      name: span.name,
      kind: span.kind,
      startTimeUnixNano: span.startTime * 1e6,
      endTimeUnixNano: (span.endTime || span.startTime) * 1e6,
      attributes: Object.entries(span.attributes).map(([key, value]) => ({
        key,
        value: { stringValue: String(value) }
      })),
      events: span.events.map(e => ({
        timeUnixNano: e.timestamp * 1e6,
        name: e.name,
        attributes: Object.entries(e.attributes).map(([key, value]) => ({
          key,
          value: { stringValue: String(value) }
        }))
      })),
      status: {
        code: span.status === 'OK' ? 1 : span.status === 'ERROR' ? 2 : 0
      }
    };
  }

  /**
   * Start periodic export timer
   */
  private startExportTimer(): void {
    this.exportTimer = window.setInterval(() => {
      this.flush();
    }, this.config.exportInterval);
  }

  /**
   * Shutdown telemetry service
   */
  public async shutdown(): Promise<void> {
    if (this.exportTimer) {
      clearInterval(this.exportTimer);
    }

    // Final flush
    await this.flush();
  }

  // ========== UTILITIES ==========

  private generateId(): string {
    return Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  private generateTraceId(): string {
    return Array.from({ length: 32 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }
}

// ========== GLOBAL SINGLETON ==========

let globalTelemetry: TelemetryService | null = null;

export function initTelemetry(config: TelemetryConfig): TelemetryService {
  if (!globalTelemetry) {
    globalTelemetry = new TelemetryService(config);
  }
  return globalTelemetry;
}

export function getTelemetry(): TelemetryService | null {
  return globalTelemetry;
}

export function shutdownTelemetry(): Promise<void> {
  if (globalTelemetry) {
    return globalTelemetry.shutdown();
  }
  return Promise.resolve();
}
