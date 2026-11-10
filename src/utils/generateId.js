import crypto from 'crypto';

/**
 * Generates an 8-character alphanumeric lobby ID.
 * Uses crypto.randomBytes for secure randomness.
 * @returns {string}
 */
export function generateLobbyId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 unambiguous chars
  const bytes = crypto.randomBytes(8);
  let id = '';
  for (const byte of bytes) {
    id += chars[byte % chars.length];
  }
  return id;
}

/**
 * Generates a UUID-like game ID using crypto.randomUUID.
 * @returns {string}
 */
export function generateGameId() {
  return crypto.randomUUID();
}

/**
 * Generates a UUID player ID.
 * @returns {string}
 */
export function generatePlayerId() {
  return crypto.randomUUID();
}

/**
 * Generates a 32-character hex reconnect token.
 * @returns {string}
 */
export function generateReconnectToken() {
  return crypto.randomBytes(16).toString('hex'); // 16 bytes → 32 hex chars
}
