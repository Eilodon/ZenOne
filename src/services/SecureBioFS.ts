/**
 * SECURE BIO FILESYSTEM - ENCRYPTED INDEXEDDB
 * ============================================
 *
 * Encrypted storage for kernel events using IndexedDB:
 * - AES-256-GCM encryption at rest
 * - HMAC-SHA256 integrity verification
 * - Per-event encryption with unique IV
 * - Signature verification on read
 *
 * Security Features:
 * - Key derivation via PBKDF2 (100k iterations)
 * - Authenticated encryption (AES-GCM)
 * - Integrity verification (HMAC-SHA256)
 *
 * THREAT MODEL:
 * - Protects against: Physical storage extraction, malware with file access
 * - Does NOT protect against: XSS attacks with memory access, browser extensions
 * - Keys stored in memory (required by Web Crypto API architecture)
 * - Device fingerprint is NOT cryptographically secure (convenience, not security)
 *
 * For stronger security:
 * - Use user-provided passphrase instead of device fingerprint
 * - Implement CSP to prevent XSS
 * - Consider WebAuthn for hardware-backed keys (future enhancement)
 *
 * References:
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
  private db: any = null;  // IndexedDB database
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

    // Initialize IndexedDB backend
    await this.initIndexedDB();

    this.isInitialized = true;
    console.log('[SecureBioFS] Initialized with encrypted IndexedDB backend');
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

    // 5. Write to IndexedDB
    await this.db.put('event_log', encryptedEvent);
  }

  /**
   * Query events with decryption and verification
   */
  async queryEvents(startTime: number, endTime: number): Promise<KernelEvent[]> {
    if (!this.isInitialized) throw new Error('SecureBioFS not initialized');

    // 1. Fetch encrypted events from IndexedDB
    const tx = this.db.transaction('event_log', 'readonly');
    const index = tx.store.index('timestamp');
    const range = IDBKeyRange.bound(startTime, endTime);
    const encryptedEvents: EncryptedEvent[] = await index.getAll(range);

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
    return await this.db.get('meta', key);
  }

  async setMeta(key: string, value: any): Promise<void> {
    await this.db.put('meta', value, key);
  }

  // --- INDEXEDDB BACKEND ---

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
