import { Router } from 'express';
import { getLobby } from '../services/lobbyService.js';
import { getGame } from '../services/gameService.js';

const router = Router();

// ─── Health ───────────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// ─── Lobby ────────────────────────────────────────────────────────────────────

/**
 * GET /api/lobby/:lobbyId
 * Returns public lobby info without sensitive reconnect tokens.
 */
router.get('/api/lobby/:lobbyId', async (req, res) => {
  try {
    const lobby = await getLobby(req.params.lobbyId);
    if (!lobby) {
      return res.status(404).json({ error: 'Lobby not found' });
    }

    // Strip sensitive data
    const sanitize = (slot) => {
      if (!slot || !slot.playerId) return null;
      return { playerId: slot.playerId, nickname: slot.nickname };
    };

    res.json({
      lobbyId: lobby.lobbyId,
      status: lobby.status,
      timeControl: lobby.timeControl,
      whitePlayer: sanitize(lobby.whitePlayer),
      blackPlayer: sanitize(lobby.blackPlayer),
      gameId: lobby.gameId || null,
      createdAt: lobby.createdAt,
    });
  } catch (err) {
    console.error('[ROUTE] GET /api/lobby/:lobbyId error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

// ─── Game ─────────────────────────────────────────────────────────────────────

/**
 * GET /api/game/:gameId
 * Returns the current game state.
 */
router.get('/api/game/:gameId', async (req, res) => {
  try {
    const game = await getGame(req.params.gameId);
    if (!game) {
      return res.status(404).json({ error: 'Game not found' });
    }

    res.json({
      gameId: game.gameId,
      lobbyId: game.lobbyId,
      fen: game.fen,
      pgn: game.pgn,
      moveHistory: game.moveHistory,
      whiteRemainingTime: game.whiteRemainingTime,
      blackRemainingTime: game.blackRemainingTime,
      activeColor: game.activeColor,
      lastMoveTimestamp: game.lastMoveTimestamp,
      gameStatus: game.gameStatus,
      result: game.result,
      drawOffer: game.drawOffer
        ? { offeredBy: game.drawOffer.offeredBy }
        : null,
      rematchRequested: game.rematchRequested,
      createdAt: game.createdAt,
      completedAt: game.completedAt,
    });
  } catch (err) {
    console.error('[ROUTE] GET /api/game/:gameId error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
});

export default router;
