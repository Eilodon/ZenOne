<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# ZenOne v7.0 - Biological OS with Safety-Critical Control

A real-time biofeedback system with formal verification, non-linear state estimation, and multi-layer safety guarantees.

View your app in AI Studio: https://ai.studio/apps/drive/19-Tm2-aVa89Z91YUUv63L-xxCIbZ0dc_

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Architecture Highlights

- **Pure Functional Kernel**: Event-sourced state machine with immutable events
- **Formal Verification**: LTL runtime monitor with safety shield synthesis
- **Non-Linear State Estimation**: Unscented Kalman Filter for physiological tracking
- **Defense-in-Depth Security**: Multi-layer safety with watchdog and trauma detection
- **Encrypted Storage**: AES-256-GCM for event persistence

## Security & Privacy

### Data Storage
- **Encryption**: All events encrypted at rest using AES-256-GCM
- **Integrity**: HMAC-SHA256 signatures verify data authenticity
- **Key Derivation**: PBKDF2 with 100k iterations

### Threat Model
**Protects Against:**
- Physical storage extraction (encrypted IndexedDB)
- Malware with file system access (data is encrypted)

**Does NOT Protect Against:**
- XSS attacks with memory access (keys stored in memory per Web Crypto API design)
- Malicious browser extensions with full DOM access
- Device fingerprint is for convenience, NOT cryptographic security

**For Stronger Security:**
- Use a user-provided passphrase instead of device fingerprint
- Implement Content Security Policy (CSP) to prevent XSS
- Consider WebAuthn for hardware-backed keys (future enhancement)

### Privacy
- All data stored locally in your browser
- No server-side storage or telemetry by default
- AI integration (Gemini) requires explicit user activation

## Testing

Run comprehensive tests:
```bash
npm test
```

## License

MIT
