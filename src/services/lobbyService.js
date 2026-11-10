import Lobby from '../models/Lobby.js';
import Player from '../models/Player.js';
import {
  generateLobbyId,
  generatePlayerId,
  generateReconnectToken,
} from '../utils/generateId.js';

/**
 * Creates a new lobby and the host player record.
 *
 * @param {{ nickname: string, color: 'white'|'black'|'random', timeControl: object }} params
 * @returns {{ lobby: object, player: object, reconnectToken: string }}
 */
export async function createLobby({ nickname, color, timeControl }) {
  const lobbyId = generateLobbyId();
  const playerId = generatePlayerId();
  const reconnectToken = generateReconnectToken();

  // Resolve random color
  let resolvedColor = color;
  if (!resolvedColor || resolvedColor === 'random') {
    resolvedColor = Math.random() < 0.5 ? 'white' : 'black';
  }

  // Build player slot object
  const playerSlot = {
    playerId,
    nickname: nickname || 'Anonymous',
    reconnectToken,
    socketId: null,
  };

  const whitePlayer = resolvedColor === 'white' ? playerSlot : {};
  const blackPlayer = resolvedColor === 'black' ? playerSlot : {};

  // Normalise timeControl
  const tc = buildTimeControl(timeControl);

  // Persist lobby
  const lobby = await Lobby.create({
    lobbyId,
    hostId: playerId,
    status: 'waiting',
    whitePlayer,
    blackPlayer,
    timeControl: tc,
  });

  // Persist player
  const player = await Player.create({
    playerId,
    nickname: nickname || 'Anonymous',
    reconnectToken,
    currentLobbyId: lobbyId,
  });

  return { lobby, player, reconnectToken };
}

/**
 * Joins an existing lobby as the second player.
 *
 * @param {{ lobbyId: string, nickname: string }} params
 * @returns {{ lobby: object, player: object, reconnectToken: string }}
 */
export async function joinLobby({ lobbyId, nickname }) {
  const lobby = await Lobby.findOne({ lobbyId });

  if (!lobby) {
    throw Object.assign(new Error('Lobby not found'), { status: 404 });
  }
  if (lobby.status !== 'waiting') {
    throw Object.assign(
      new Error(`Lobby is not available (status: ${lobby.status})`),
      { status: 409 }
    );
  }

  const playerId = generatePlayerId();
  const reconnectToken = generateReconnectToken();

  const playerSlot = {
    playerId,
    nickname: nickname || 'Anonymous',
    reconnectToken,
    socketId: null,
  };

  // Assign to the empty color slot
  const whiteEmpty =
    !lobby.whitePlayer || !lobby.whitePlayer.playerId;
  if (whiteEmpty) {
    lobby.whitePlayer = playerSlot;
  } else {
    lobby.blackPlayer = playerSlot;
  }

  lobby.status = 'ready';
  lobby.updatedAt = new Date();
  await lobby.save();

  // Persist player
  const player = await Player.create({
    playerId,
    nickname: nickname || 'Anonymous',
    reconnectToken,
    currentLobbyId: lobbyId,
  });

  return { lobby, player, reconnectToken };
}

/**
 * Retrieves a lobby by its lobbyId.
 * @param {string} lobbyId
 * @returns {object|null}
 */
export async function getLobby(lobbyId) {
  return Lobby.findOne({ lobbyId });
}

/**
 * Updates the status of a lobby.
 * @param {string} lobbyId
 * @param {string} status
 * @returns {object|null}
 */
export async function updateLobbyStatus(lobbyId, status) {
  return Lobby.findOneAndUpdate(
    { lobbyId },
    { status, updatedAt: new Date() },
    { new: true }
  );
}

/**
 * Finds the lobby that contains a player with the given reconnect token
 * (checks both white and black player slots).
 * @param {string} token
 * @returns {object|null}
 */
export async function getLobbyByReconnectToken(token) {
  return Lobby.findOne({
    $or: [
      { 'whitePlayer.reconnectToken': token },
      { 'blackPlayer.reconnectToken': token },
    ],
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildTimeControl(tc) {
  if (!tc || tc.isUnlimited || tc.type === 'unlimited') {
    return { type: 'unlimited', minutes: 0, increment: 0, isUnlimited: true };
  }
  return {
    type: tc.type || 'rapid',
    minutes: Number(tc.minutes) || 10,
    increment: Number(tc.increment) || 0,
    isUnlimited: false,
  };
}
