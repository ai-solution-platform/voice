// Fictional endpoints shown in code samples and the trunk wizard. The .example TLD is reserved (RFC 2606)
// and never resolves, so a visitor who pastes a sample cannot reach a real server.
// CONTRACT: change a host here and every screen follows. Customer hosts are *.example.com.

export const API_HOST = 'api.voice.example';
export const API_BASE = `https://${API_HOST}/v1`;
export const SIP_HOST = 'sip.voice.example';
export const SIGNALLING_IPS = ['203.0.113.40', '203.0.113.41'];
export const MEDIA_IPS = '203.0.113.50–51';
export const MEDIA_PORTS = 'UDP 10000–20000';
export const PORTS = 'TLS 5061 · TCP/UDP 5060';
export const SANDBOX_CALLER = '02-xxx-0100';       // ANTS sandbox number, shared
export const SANDBOX_CALLER_E164 = '+662xxx0100';
export const DEFAULT_WEBHOOK = 'https://hooks.example.com/ants/voice';
export const DEMO_SIP_PASSWORD = 'demo-only-not-a-password';
export const DEMO_KEY_SANDBOX = 'ak_test_DEMO_0001_not_a_real_key';
export const DEMO_KEY_LIVE = 'ak_live_DEMO_0002_not_a_real_key';
/** Masked display of a key: ak_test_DEMO…0001 */
export const maskKey = (prefix, last4) => `${prefix}DEMO…${last4}`;
