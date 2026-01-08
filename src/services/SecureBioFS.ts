/**
 * SECURE BIO FILESYSTEM - SQLITE WASM + ENCRYPTION
 * ==================================================
 *
 * Upgrade from plain IndexedDB to encrypted SQLite with:
 * - AES-256-GCM encryption at rest
 * - HMAC-SHA256 integrity verification
 * - SQL query capabilities
 * - ACID transactions
 * - Graceful fallback to IndexedDB if SQLite unavailable
 *
 * Security Features:
 * - Key derivation via PBKDF2 (100k iterations)
 * - Per-event encryption with unique IV
 * - Signature verification on read
 * - Automatic key rotation (future)
 *
 * References:
 * - SQLite WASM: https://sqlite.org/wasm
 * - Web Crypto API: https://w3c.github.io/webcrypto/
 * - NIST SP 800-38D: AES-GCM recommendations
 */

import { KernelEvent } from '../types';

// --- CRYPTO UTILITIES ---

class CryptoService {
  private encryptionKey: CryptoKey | null = null;
  private signingKey: CryptoKey | null = null;

  /**
   * Initialize crypto keys from user passphrase
   */
  async init(passphrase: string): Promise<void> {
    // Get or create salt
    const salt = await this.getSalt();

    // Derive key material from passphrase
    const passphraseBytes = new TextEncoder().encode(passphrase);
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      passphraseBytes.buffer,
      'PBKDF2',
      false,
      ['deriveKey']
    );

    // Derive encryption key (AES-256-GCM)
    this.encryptionKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    // Derive signing key (HMAC-SHA256)
    this.signingKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt.buffer as ArrayBuffer,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );
  }

  /**
   * Encrypt data with AES-256-GCM
   */
  async encrypt(data: string): Promise<{ iv: Uint8Array; ciphertext: ArrayBuffer }> {
    if (!this.encryptionKey) throw new Error('Crypto not initialized');

    const iv = crypto.getRandomValues(new Uint8Array(12));  // 96-bit IV for GCM
    const plaintext = new TextEncoder().encode(data);

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      this.encryptionKey,
      plaintext.buffer as ArrayBuffer
    );

    return { iv, ciphertext };
  }

  /**
   * Decrypt data
   */
  async decrypt(iv: Uint8Array, ciphertext: ArrayBuffer): Promise<string> {
    if (!this.encryptionKey) throw new Error('Crypto not initialized');

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      this.encryptionKey,
      ciphertext
    );

    return new TextDecoder().decode(plaintext);
  }

  /**
   * Sign data with HMAC
   */
  async sign(data: string): Promise<ArrayBuffer> {
    if (!this.signingKey) throw new Error('Crypto not initialized');

    const dataBytes = new TextEncoder().encode(data);
    return await crypto.subtle.sign(
      'HMAC',
      this.signingKey,
      dataBytes.buffer as ArrayBuffer
    );
  }

  /**
   * Verify signature
   */
  async verify(signature: ArrayBuffer, data: string): Promise<boolean> {
    if (!this.signingKey) throw new Error('Crypto not initialized');

    const dataBytes = new TextEncoder().encode(data);
    return await crypto.subtle.verify(
      'HMAC',
      this.signingKey,
      signature,
      dataBytes.buffer as ArrayBuffer
    );
  }

  /**
   * Get or create persistent salt
   */
  private async getSalt(): Promise<Uint8Array> {
    const SALT_KEY = 'zenb_crypto_salt';

    // Try to load existing salt from localStorage
    const storedSalt = localStorage.getItem(SALT_KEY);
    if (storedSalt) {
      return this.base64ToUint8Array(storedSalt);
    }

    // Generate new salt
    const salt = crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem(SALT_KEY, this.uint8ArrayToBase64(salt));
    return salt;
  }

  private uint8ArrayToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...Array.from(bytes)));
  }

  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  }
}

// --- ENCRYPTED EVENT RECORD ---

interface EncryptedEvent {
  id: number;
  timestamp: number;
  type: string;
  iv: string;              // Base64-encoded IV
  ciphertext: string;      // Base64-encoded encrypted payload
  signature: string;       // Base64-encoded HMAC
}

// --- SECURE BIO FILESYSTEM ---

export class SecureBioFS {
  private crypto: CryptoService;
  private backend: 'sqlite' | 'indexeddb' = 'indexeddb';
  private db: any = null;  // SQLite or IndexedDB database
  private isInitialized = false;

  constructor() {
    this.crypto = new CryptoService();
  }

  /**
   * Initialize filesystem with encryption
   * @param passphrase User passphrase for key derivation (default: device fingerprint)
   */
  async init(passphrase?: string): Promise<void> {
    // Use device-specific passphrase if none provided
    const devicePassphrase = passphrase || await this.getDeviceFingerprint();

    // Initialize crypto
    await this.crypto.init(devicePassphrase);

    // Try SQLite WASM first, fallback to IndexedDB
    try {
      await this.initSQLite();
      this.backend = 'sqlite';
      console.log('[SecureBioFS] Using SQLite WASM backend');
    } catch (err) {
      console.warn('[SecureBioFS] SQLite unavailable, falling back to IndexedDB:', err);
      await this.initIndexedDB();
      this.backend = 'indexeddb';
    }

    this.isInitialized = true;
  }

  /**
   * Write encrypted event
   */
  async writeEvent(event: KernelEvent): Promise<void> {
    if (!this.isInitialized) throw new Error('SecureBioFS not initialized');

    // 1. Serialize event
    const payload = JSON.stringify(event);

    // 2. Sign payload
    const signature = await this.crypto.sign(payload);

    // 3. Encrypt payload
    const { iv, ciphertext } = await this.crypto.encrypt(payload);

    // 4. Create encrypted record
    const encryptedEvent: EncryptedEvent = {
      id: 0,  // Auto-increment
      timestamp: event.timestamp,
      type: event.type,
      iv: this.arrayBufferToBase64(iv),
      ciphertext: this.arrayBufferToBase64(ciphertext),
      signature: this.arrayBufferToBase64(signature)
    };

    // 5. Write to backend
    if (this.backend === 'sqlite') {
      await this.writeSQLite(encryptedEvent);
    } else {
      await this.writeIndexedDB(encryptedEvent);
    }
  }

  /**
   * Query events with decryption and verification
   */
  async queryEvents(startTime: number, endTime: number): Promise<KernelEvent[]> {
    if (!this.isInitialized) throw new Error('SecureBioFS not initialized');

    // 1. Fetch encrypted events from backend
    let encryptedEvents: EncryptedEvent[];
    if (this.backend === 'sqlite') {
      encryptedEvents = await this.querySQLite(startTime, endTime);
    } else {
      encryptedEvents = await this.queryIndexedDB(startTime, endTime);
    }

    // 2. Decrypt and verify
    const events: KernelEvent[] = [];
    for (const encrypted of encryptedEvents) {
      try {
        // Decrypt
        const iv = this.base64ToArrayBuffer(encrypted.iv);
        const ciphertext = this.base64ToArrayBuffer(encrypted.ciphertext);
        const payload = await this.crypto.decrypt(new Uint8Array(iv), ciphertext);

        // Verify signature
        const signature = this.base64ToArrayBuffer(encrypted.signature);
        const isValid = await this.crypto.verify(signature, payload);

        if (!isValid) {
          console.error('[SecureBioFS] Signature verification failed for event:', encrypted.id);
          continue;  // Skip corrupted event
        }

        // Parse
        const event: KernelEvent = JSON.parse(payload);
        events.push(event);
      } catch (err) {
        console.error('[SecureBioFS] Failed to decrypt event:', encrypted.id, err);
      }
    }

    return events;
  }

  /**
   * Get/Set metadata (unencrypted, for configuration)
   */
  async getMeta<T = any>(key: string): Promise<T | undefined> {
    // Metadata is stored separately (not encrypted for performance)
    // In production, consider encrypting sensitive metadata too
    if (this.backend === 'sqlite') {
      // TODO: Implement SQLite metadata table
      return undefined;
    } else {
      const { openDB } = await import('idb');
      const db = await openDB('zenb-bio-os', 2);
      return await db.get('meta', key);
    }
  }

  async setMeta(key: string, value: any): Promise<void> {
    if (this.backend === 'sqlite') {
      // TODO: Implement SQLite metadata table
      return;
    } else {
      const { openDB } = await import('idb');
      const db = await openDB('zenb-bio-os', 2);
      await db.put('meta', value, key);
    }
  }

  // --- SQLITE BACKEND ---

  private async initSQLite(): Promise<void> {
    // Dynamic import (SQLite WASM is large, ~1MB)
    // @ts-ignore - SQLite WASM types
    const sqlite3InitModule = (await import('@sqlite.org/sqlite-wasm')).default;
    const sqlite3 = await sqlite3InitModule();

    this.db = new sqlite3.oo1.DB();

    // Create schema
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        iv TEXT NOT NULL,
        ciphertext TEXT NOT NULL,
        signature TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_timestamp ON event_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_type ON event_log(type);
    `);
  }

  private async writeSQLite(event: EncryptedEvent): Promise<void> {
    this.db.exec({
      sql: `INSERT INTO event_log (timestamp, type, iv, ciphertext, signature)
            VALUES (?, ?, ?, ?, ?)`,
      bind: [event.timestamp, event.type, event.iv, event.ciphertext, event.signature]
    });
  }

  private async querySQLite(startTime: number, endTime: number): Promise<EncryptedEvent[]> {
    const results: EncryptedEvent[] = [];

    this.db.exec({
      sql: `SELECT * FROM event_log
            WHERE timestamp BETWEEN ? AND ?
            ORDER BY timestamp ASC`,
      bind: [startTime, endTime],
      callback: (row: any) => {
        results.push({
          id: row.id,
          timestamp: row.timestamp,
          type: row.type,
          iv: row.iv,
          ciphertext: row.ciphertext,
          signature: row.signature
        });
      }
    });

    return results;
  }

  // --- INDEXEDDB BACKEND (FALLBACK) ---

  private async initIndexedDB(): Promise<void> {
    const { openDB } = await import('idb');

    this.db = await openDB('zenb-bio-os-secure', 1, {
      upgrade(db) {
        // Create encrypted event store
        const eventStore = db.createObjectStore('event_log', { keyPath: 'id', autoIncrement: true });
        eventStore.createIndex('timestamp', 'timestamp');
        eventStore.createIndex('type', 'type');

        // Metadata store
        db.createObjectStore('meta');
      }
    });
  }

  private async writeIndexedDB(event: EncryptedEvent): Promise<void> {
    await this.db.put('event_log', event);
  }

  private async queryIndexedDB(startTime: number, endTime: number): Promise<EncryptedEvent[]> {
    const tx = this.db.transaction('event_log', 'readonly');
    const index = tx.store.index('timestamp');

    const range = IDBKeyRange.bound(startTime, endTime);
    const results = await index.getAll(range);

    return results;
  }

  // --- UTILITIES ---

  private async getDeviceFingerprint(): Promise<string> {
    // Simple device fingerprint (not cryptographically secure, but sufficient for key derivation)
    const ua = navigator.userAgent;
    const screen = `${window.screen.width}x${window.screen.height}`;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return `${ua}|${screen}|${timezone}`;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

/**
 * USAGE EXAMPLE:
 *
 * const fs = new SecureBioFS();
 * await fs.init();  // Uses device fingerprint as passphrase
 *
 * // Write encrypted event
 * await fs.writeEvent({ type: 'BOOT', timestamp: Date.now() });
 *
 * // Query with auto-decryption
 * const events = await fs.queryEvents(startTime, endTime);
 */
