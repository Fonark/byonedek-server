import Game from '../models/Game.js';
import { Chess } from 'chess.js';
import { generateGameId } from '../utils/generateId.js';
import { getGameStatus } from '../utils/chessHelpers.js';

const INITIAL_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ─── Create ───────────────────────────────────────────────────────────────────

/**
 * Creates a new Game record for a lobby.
 * @param {{ lobbyId: string, timeControl: object }} params
 * @returns {object} Saved game document.
 */
export async function createGame({ lobbyId, timeControl }) {
  const gameId = generateGameId();

  let whiteRemainingTime = null;
  let blackRemainingTime = null;

  if (timeControl && !timeControl.isUnlimited) {
    const ms = (Number(timeControl.minutes) || 10) * 60 * 1000;
    whiteRemainingTime = ms;
    blackRemainingTime = ms;
  }

  const game = await Game.create({
    gameId,
    lobbyId,
    fen: INITIAL_FEN,
    pgn: '',
    moveHistory: [],
    whiteRemainingTime,
    blackRemainingTime,
    activeColor: 'w',
    lastMoveTimestamp: null,
    gameStatus: 'waiting',
    result: { winner: null, condition: null },
    drawOffer: { offeredBy: null, timestamp: null },
    takebackOffer: { offeredBy: null, timestamp: null },
    rematchRequested: { byWhite: false, byBlack: false },
    createdAt: new Date(),
    completedAt: null,
  });

  return game;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Retrieves a game by its gameId.
 * @param {string} gameId
 * @returns {object|null}
 */
export async function getGame(gameId) {
  return Game.findOne({ gameId });
}

/**
 * Retrieves the LATEST game by its associated lobbyId.
 * Uses sort by createdAt desc to avoid returning old completed games.
 * @param {string} lobbyId
 * @returns {object|null}
 */
export async function getGameByLobbyId(lobbyId) {
  return Game.findOne({ lobbyId }).sort({ createdAt: -1 });
}

/**
 * Retrieves the latest ACTIVE game by its associated lobbyId.
 * Returns null if only completed games exist.
 * @param {string} lobbyId
 * @returns {object|null}
 */
export async function getActiveGameByLobbyId(lobbyId) {
  return Game.findOne({ lobbyId, gameStatus: { $in: ['waiting', 'active'] } }).sort({ createdAt: -1 });
}

// ─── Move Processing ──────────────────────────────────────────────────────────

/**
 * Processes a player's move.
 *
 * @param {{ gameId: string, move: string|object, playerColor: 'white'|'black', increment?: number }} params
 * @returns {{ game: object, moveResult: object, status: object }}
 */
export async function processMove({ gameId, move, playerColor, increment = 0 }) {
  const game = await Game.findOne({ gameId });
  if (!game) {
    throw Object.assign(new Error('Game not found'), { status: 404 });
  }
  if (game.gameStatus !== 'active') {
    throw Object.assign(new Error('Game is not active'), { status: 409 });
  }

  // Verify it is this player's turn
  const expectedColor = game.activeColor === 'w' ? 'white' : 'black';
  if (playerColor !== expectedColor) {
    throw Object.assign(new Error("It is not your turn"), { status: 403 });
  }

  // Validate move with chess.js
  const chess = new Chess(game.fen);
  let moveResult;
  try {
    moveResult = chess.move(move);
  } catch (err) {
    throw Object.assign(new Error('Invalid move: ' + err.message), { status: 400 });
  }
  if (!moveResult) {
    throw Object.assign(new Error('Illegal move'), { status: 400 });
  }

  const now = new Date();

  // ── Clock management ───────────────────────────────────────────────────────
  const incrementMs =
    game.gameStatus === 'active' && !isUnlimited(game)
      ? ((increment || getIncrement(game)) * 1000)
      : 0;

  if (!isUnlimited(game) && game.lastMoveTimestamp) {
    const elapsed = now.getTime() - new Date(game.lastMoveTimestamp).getTime();
    if (playerColor === 'white') {
      game.whiteRemainingTime = Math.max(
        0,
        game.whiteRemainingTime - elapsed + incrementMs
      );
    } else {
      game.blackRemainingTime = Math.max(
        0,
        game.blackRemainingTime - elapsed + incrementMs
      );
    }
  } else if (!isUnlimited(game) && !game.lastMoveTimestamp) {
    // First move — no clock deduction, but add increment
    if (playerColor === 'white') {
      game.whiteRemainingTime = (game.whiteRemainingTime || 0) + incrementMs;
    } else {
      game.blackRemainingTime = (game.blackRemainingTime || 0) + incrementMs;
    }
  }

  // Check for timeout AFTER deducting time
  if (!isUnlimited(game)) {
    if (playerColor === 'white' && game.whiteRemainingTime <= 0) {
      return handleTimeout(gameId, 'white');
    }
    if (playerColor === 'black' && game.blackRemainingTime <= 0) {
      return handleTimeout(gameId, 'black');
    }
  }

  // ── Update position ────────────────────────────────────────────────────────
  const newFen = chess.fen();
  const newPgn = chess.pgn();

  game.moveHistory.push({
    move: moveResult.from + moveResult.to + (moveResult.promotion || ''),
    san: moveResult.san,
    fen: newFen,
    whiteRemainingTime: game.whiteRemainingTime,
    blackRemainingTime: game.blackRemainingTime,
    timestamp: now,
  });

  game.fen = newFen;
  game.pgn = newPgn;
  game.activeColor = chess.turn();
  game.lastMoveTimestamp = now;
  game.takebackOffer = { offeredBy: null, timestamp: null };

  // ── Check for game-ending conditions ──────────────────────────────────────
  const status = getGameStatus(chess);
  let gameEnded = false;

  if (status.isCheckmate) {
    game.gameStatus = 'completed';
    game.result = {
      winner: playerColor, // the player who just moved wins
      condition: 'checkmate',
    };
    game.completedAt = now;
    gameEnded = true;
  } else if (status.isStalemate) {
    game.gameStatus = 'completed';
    game.result = { winner: 'draw', condition: 'stalemate' };
    game.completedAt = now;
    gameEnded = true;
  } else if (status.isInsufficientMaterial) {
    game.gameStatus = 'completed';
    game.result = { winner: 'draw', condition: 'insufficient' };
    game.completedAt = now;
    gameEnded = true;
  } else if (status.isThreefoldRepetition) {
    game.gameStatus = 'completed';
    game.result = { winner: 'draw', condition: 'threefold' };
    game.completedAt = now;
    gameEnded = true;
  } else if (status.isFiftyMoveRule) {
    game.gameStatus = 'completed';
    game.result = { winner: 'draw', condition: 'fifty-move' };
    game.completedAt = now;
    gameEnded = true;
  }

  await game.save();

  return { game, moveResult, status, gameEnded };
}

// ─── Resign ───────────────────────────────────────────────────────────────────

/**
 * Records a resignation, awarding the win to the opponent.
 * @param {string} gameId
 * @param {'white'|'black'} playerColor - The player who is resigning.
 * @returns {object} Updated game document.
 */
export async function resignGame(gameId, playerColor) {
  const winner = playerColor === 'white' ? 'black' : 'white';
  const game = await Game.findOneAndUpdate(
    { gameId, gameStatus: { $in: ['active', 'waiting'] } },
    {
      gameStatus: 'completed',
      result: { winner, condition: 'resignation' },
      completedAt: new Date(),
    },
    { new: true }
  );
  if (!game) return Game.findOne({ gameId });
  return game;
}

// ─── Timeout ──────────────────────────────────────────────────────────────────

/**
 * Records a timeout loss, awarding the win to the opponent.
 * @param {string} gameId
 * @param {'white'|'black'} losingColor
 * @returns {object} Updated game document.
 */
export async function handleTimeout(gameId, losingColor) {
  const winner = losingColor === 'white' ? 'black' : 'white';
  const game = await Game.findOneAndUpdate(
    { gameId, gameStatus: { $in: ['active', 'waiting'] } },
    {
      gameStatus: 'completed',
      result: { winner, condition: 'timeout' },
      completedAt: new Date(),
    },
    { new: true }
  );
  if (!game) return Game.findOne({ gameId });
  return game;
}

// ─── Draw Offers ──────────────────────────────────────────────────────────────

/**
 * Records a draw offer from a player.
 * @param {string} gameId
 * @param {'white'|'black'} playerColor
 * @returns {object} Updated game document.
 */
export async function offerDraw(gameId, playerColor) {
  const game = await Game.findOneAndUpdate(
    { gameId },
    { drawOffer: { offeredBy: playerColor, timestamp: new Date() } },
    { new: true }
  );
  if (!game) throw Object.assign(new Error('Game not found'), { status: 404 });
  return game;
}

/**
 * Accepts a draw offer, completing the game as a draw.
 * @param {string} gameId
 * @returns {object} Updated game document.
 */
export async function acceptDraw(gameId) {
  const game = await Game.findOneAndUpdate(
    { gameId, gameStatus: { $in: ['active', 'waiting'] } },
    {
      gameStatus: 'completed',
      result: { winner: 'draw', condition: 'draw-agreement' },
      drawOffer: { offeredBy: null, timestamp: null },
      completedAt: new Date(),
    },
    { new: true }
  );
  if (!game) return Game.findOne({ gameId });
  return game;
}

/**
 * Declines a draw offer, clearing the pending offer.
 * @param {string} gameId
 * @returns {object} Updated game document.
 */
export async function declineDraw(gameId) {
  const game = await Game.findOneAndUpdate(
    { gameId },
    { drawOffer: { offeredBy: null, timestamp: null } },
    { new: true }
  );
  if (!game) throw Object.assign(new Error('Game not found'), { status: 404 });
  return game;
}

// ─── Takeback ─────────────────────────────────────────────────────────────────

/**
 * Records a takeback offer from a player.
 * @param {string} gameId
 * @param {'white'|'black'} playerColor
 * @returns {object} Updated game document.
 */
export async function offerTakeback(gameId, playerColor) {
  const game = await Game.findOne({ gameId });
  if (!game) throw Object.assign(new Error('Game not found'), { status: 404 });
  if (!game.moveHistory || game.moveHistory.length === 0) {
    throw Object.assign(new Error('No moves to take back'), { status: 400 });
  }

  game.takebackOffer = { offeredBy: playerColor, timestamp: new Date() };
  await game.save();
  return game;
}

/**
 * Declines a takeback offer, clearing the pending offer.
 * @param {string} gameId
 * @returns {object} Updated game document.
 */
export async function declineTakeback(gameId) {
  const game = await Game.findOneAndUpdate(
    { gameId },
    { takebackOffer: { offeredBy: null, timestamp: null } },
    { new: true }
  );
  if (!game) throw Object.assign(new Error('Game not found'), { status: 404 });
  return game;
}

/**
 * Accepts a takeback offer and rolls back the move history (Lichess style).
 * If requester just moved (currently opponent's turn), rolls back 1 half-move.
 * If requester is already on their turn (opponent already replied), rolls back 2 half-moves.
 * @param {string} gameId
 * @returns {object} Updated game document.
 */
export async function acceptTakeback(gameId) {
  const game = await Game.findOne({ gameId });
  if (!game) throw Object.assign(new Error('Game not found'), { status: 404 });
  if (!game.moveHistory || game.moveHistory.length === 0) {
    throw Object.assign(new Error('No moves to take back'), { status: 400 });
  }

  const requesterColor = game.takebackOffer?.offeredBy; // 'white' or 'black'
  const currentTurnColor = game.activeColor === 'w' ? 'white' : 'black';

  // If requester just moved (it is currently opponent's turn), undo 1 half-move.
  // If requester is already on their turn (opponent already responded), undo 2 half-moves so requester can replay their turn.
  let movesToUndo = 1;
  if (requesterColor && requesterColor === currentTurnColor) {
    movesToUndo = Math.min(2, game.moveHistory.length);
  } else {
    movesToUndo = Math.min(1, game.moveHistory.length);
  }

  for (let i = 0; i < movesToUndo; i++) {
    game.moveHistory.pop();
  }

  // Clear takeback offer
  game.takebackOffer = { offeredBy: null, timestamp: null };

  // Reconstruct position and PGN by replaying remaining move history
  const chess = new Chess();
  for (const entry of game.moveHistory) {
    chess.move(entry.san || entry.move);
  }

  game.fen = chess.fen();
  game.pgn = chess.pgn();
  game.activeColor = chess.turn();
  game.lastMoveTimestamp = new Date();

  // If game was completed (e.g. accidental checkmate), restore it to active
  game.gameStatus = 'active';
  game.result = { winner: null, condition: null };
  game.completedAt = null;

  // Restore clocks if available from the target move history entry
  if (game.moveHistory.length > 0) {
    const targetEntry = game.moveHistory[game.moveHistory.length - 1];
    if (targetEntry.whiteRemainingTime != null) {
      game.whiteRemainingTime = targetEntry.whiteRemainingTime;
    }
    if (targetEntry.blackRemainingTime != null) {
      game.blackRemainingTime = targetEntry.blackRemainingTime;
    }
  }

  await game.save();
  return game;
}

// ─── Rematch ──────────────────────────────────────────────────────────────────

/**
 * Records that a player has requested a rematch.
 * @param {string} gameId
 * @param {'white'|'black'} playerColor
 * @returns {object} Updated game document.
 */
export async function requestRematch(gameId, playerColor) {
  const update =
    playerColor === 'white'
      ? { 'rematchRequested.byWhite': true }
      : { 'rematchRequested.byBlack': true };

  const game = await Game.findOneAndUpdate({ gameId }, update, { new: true });
  if (!game) throw Object.assign(new Error('Game not found'), { status: 404 });
  return game;
}

/**
 * Resets game state for a rematch — creates a new starting position,
 * clears history, and resets clocks using the original time control derived
 * from the existing game's initial remaining times.
 * Color assignment (swap) is handled at the lobby/socket layer.
 * @param {string} gameId
 * @returns {object} Updated game document.
 */
export async function resetForRematch(gameId) {
  const existing = await Game.findOne({ gameId });
  if (!existing) {
    throw Object.assign(new Error('Game not found'), { status: 404 });
  }

  // Recalculate initial clock from whatever the original time was
  // (we stored it at game creation; re-derive from first moveHistory entry or fallback)
  const originalWhiteTime = existing.whiteRemainingTime;
  const originalBlackTime = existing.blackRemainingTime;

  // For a rematch we swap colors — the new white clock gets the old black initial time
  // and vice versa. If times were null (unlimited), they stay null.
  const newWhiteTime =
    originalBlackTime !== null
      ? recoverInitialTime(existing, 'black')
      : null;
  const newBlackTime =
    originalWhiteTime !== null
      ? recoverInitialTime(existing, 'white')
      : null;

  const game = await Game.findOneAndUpdate(
    { gameId },
    {
      fen: INITIAL_FEN,
      pgn: '',
      moveHistory: [],
      whiteRemainingTime: newWhiteTime,
      blackRemainingTime: newBlackTime,
      activeColor: 'w',
      lastMoveTimestamp: null,
      gameStatus: 'waiting',
      result: { winner: null, condition: null },
      drawOffer: { offeredBy: null, timestamp: null },
      rematchRequested: { byWhite: false, byBlack: false },
      completedAt: null,
    },
    { new: true }
  );

  return game;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function isUnlimited(game) {
  return (
    game.whiteRemainingTime === null || game.blackRemainingTime === null
  );
}

function getIncrement(game) {
  // Increment is stored in the lobby's timeControl; we don't have it directly
  // on the Game model, so we default to 0 (the socket layer can pass it separately).
  return 0;
}

/**
 * Attempts to recover the initial clock time for a colour by looking at the
 * first entry in moveHistory before the player moved, or by using the
 * current remaining time as a rough proxy. In a real app you would store
 * the initial times on the Game document.
 */
function recoverInitialTime(game, color) {
  if (color === 'white') return game.whiteRemainingTime;
  return game.blackRemainingTime;
}
