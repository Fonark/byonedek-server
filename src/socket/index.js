/**
 * Socket.IO handler — full real-time chess multiplayer implementation.
 * Implements all game events: lobby creation, joining, moves, clock, resign,
 * draw, rematch, reconnection, and disconnect handling.
 */

import * as lobbyService from '../services/lobbyService.js';
import * as gameService from '../services/gameService.js';
import { getLobby } from '../services/lobbyService.js';
import { getActiveGameByLobbyId } from '../services/gameService.js';
import Lobby from '../models/Lobby.js';
import Game from '../models/Game.js';

// ── In-memory session maps ─────────────────────────────────────────────────────
// socketId → { playerId, lobbyId, gameId, color, reconnectToken, nickname }
const activeConnections = new Map();

// lobbyId → Set<socketId>
const lobbyRooms = new Map();

// Disconnect timers — to handle brief disconnects gracefully
const disconnectTimers = new Map(); // socketId → timeout handle

// Turn timers — fires when player's clock reaches 0
const turnTimers = new Map(); // lobbyId → timeout handle

export function clearTurnTimeout(lobbyId) {
  if (turnTimers.has(lobbyId)) {
    clearTimeout(turnTimers.get(lobbyId));
    turnTimers.delete(lobbyId);
  }
}

export function scheduleTurnTimeout(io, lobbyId, game) {
  clearTurnTimeout(lobbyId);

  if (!game || (game.gameStatus !== 'active' && game.gameStatus !== 'playing')) return;

  const activeColor = game.activeColor; // 'w' or 'b'
  let remainingMs = activeColor === 'w' ? game.whiteRemainingTime : game.blackRemainingTime;

  if (remainingMs === null || remainingMs === undefined) return; // Unlimited time control

  // If game has lastMoveTimestamp, deduct elapsed time
  if (game.lastMoveTimestamp) {
    const elapsed = Date.now() - new Date(game.lastMoveTimestamp).getTime();
    remainingMs = Math.max(0, remainingMs - elapsed);
  }

  const losingColor = activeColor === 'w' ? 'white' : 'black';

  if (remainingMs <= 0) {
    triggerTimeout(io, lobbyId, game.gameId, losingColor);
    return;
  }

  const timer = setTimeout(async () => {
    await triggerTimeout(io, lobbyId, game.gameId, losingColor);
  }, remainingMs);

  turnTimers.set(lobbyId, timer);
}

async function triggerTimeout(io, lobbyId, gameId, losingColor) {
  clearTurnTimeout(lobbyId);
  try {
    const updatedGame = await gameService.handleTimeout(gameId, losingColor);
    io.to(lobbyId).emit('game-over', {
      winner: updatedGame.result?.winner,
      condition: 'timeout',
      result: updatedGame.result,
      game: sanitizeGame(updatedGame),
    });
    broadcastClockUpdate(io, lobbyId, updatedGame);
    console.log(`[SOCKET] Game ${gameId} in lobby ${lobbyId} ended by timeout. Winner: ${updatedGame.result?.winner}`);
  } catch (err) {
    console.error(`[SOCKET] triggerTimeout error for game ${gameId}:`, err);
  }
}

// ── Helper: broadcast clock state ─────────────────────────────────────────────
export function broadcastClockUpdate(io, lobbyId, game) {
  io.to(lobbyId).emit('clock-updated', {
    whiteRemainingTime: game.whiteRemainingTime,
    blackRemainingTime: game.blackRemainingTime,
    whiteClock: game.whiteRemainingTime,
    blackClock: game.blackRemainingTime,
    activeColor: game.activeColor,
    lastMoveTimestamp: game.lastMoveTimestamp,
    isUnlimited: game.whiteRemainingTime === null,
  });
}

// ── Helper: get sanitized game state for clients ───────────────────────────────
function sanitizeGame(game) {
  return {
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
    drawOffer: game.drawOffer,
    rematchRequested: game.rematchRequested,
  };
}

// ── Helper: get sanitized lobby state for clients ──────────────────────────────
function sanitizeLobby(lobby) {
  return {
    lobbyId: lobby.lobbyId,
    status: lobby.status,
    timeControl: lobby.timeControl,
    whitePlayer: lobby.whitePlayer
      ? { nickname: lobby.whitePlayer.nickname, playerId: lobby.whitePlayer.playerId }
      : null,
    blackPlayer: lobby.blackPlayer
      ? { nickname: lobby.blackPlayer.nickname, playerId: lobby.blackPlayer.playerId }
      : null,
    gameId: lobby.gameId,
  };
}

// ── Main socket initializer ────────────────────────────────────────────────────
export function initSocketHandler(io) {
  io.on('connection', (socket) => {
    console.log(`[SOCKET] Connected: ${socket.id}`);

    // ── CREATE LOBBY ──────────────────────────────────────────────────────────
    socket.on('create-lobby', async (data, callback) => {
      try {
        const { nickname, color, timeControl } = data || {};

        // Create lobby + player
        const { lobby, player, reconnectToken } = await lobbyService.createLobby({
          nickname,
          color,
          timeControl,
        });

        // Create the game
        const game = await gameService.createGame({
          lobbyId: lobby.lobbyId,
          timeControl: lobby.timeControl,
        });

        // Link game to lobby
        await Lobby.findOneAndUpdate(
          { lobbyId: lobby.lobbyId },
          { gameId: game.gameId }
        );
        lobby.gameId = game.gameId;

        // Update player's socketId in lobby
        const colorField =
          lobby.whitePlayer && lobby.whitePlayer.playerId === player.playerId
            ? 'whitePlayer.socketId'
            : 'blackPlayer.socketId';
        await Lobby.findOneAndUpdate(
          { lobbyId: lobby.lobbyId },
          { [colorField]: socket.id }
        );

        const playerColor =
          lobby.whitePlayer && lobby.whitePlayer.playerId === player.playerId
            ? 'white'
            : 'black';

        // Store session
        activeConnections.set(socket.id, {
          playerId: player.playerId,
          lobbyId: lobby.lobbyId,
          gameId: game.gameId,
          color: playerColor,
          reconnectToken,
          nickname: player.nickname,
        });

        // Track lobby room
        if (!lobbyRooms.has(lobby.lobbyId)) {
          lobbyRooms.set(lobby.lobbyId, new Set());
        }
        lobbyRooms.get(lobby.lobbyId).add(socket.id);
        socket.join(lobby.lobbyId);

        const responseData = {
          lobbyId: lobby.lobbyId,
          gameId: game.gameId,
          color: playerColor,
          nickname: player.nickname,
          reconnectToken,
          lobby: sanitizeLobby(lobby),
          game: sanitizeGame(game),
        };

        socket.emit('lobby-created', responseData);

        if (typeof callback === 'function') {
          callback(responseData);
        }

        console.log(`[SOCKET] Lobby created: ${lobby.lobbyId} by ${player.nickname}`);
      } catch (err) {
        console.error('[SOCKET] create-lobby error:', err);
        socket.emit('error', { message: err.message || 'Failed to create lobby' });
        if (typeof callback === 'function') {
          callback({ error: err.message || 'Failed to create lobby' });
        }
      }
    });

    // ── JOIN LOBBY ────────────────────────────────────────────────────────────
    socket.on('join-lobby', async (data, callback) => {
      try {
        const { lobbyId, nickname, reconnectToken } = data || {};

        if (!lobbyId) {
          const errPayload = { message: 'lobbyId is required' };
          socket.emit('error', errPayload);
          if (typeof callback === 'function') callback({ error: errPayload.message });
          return;
        }

        // ── Reconnection path ────────────────────────────────────────────────
        if (reconnectToken) {
          const lobby = await lobbyService.getLobbyByReconnectToken(reconnectToken);
          // Only reconnect if the token belongs to this exact lobby!
          if (lobby && lobby.lobbyId === lobbyId) {
            const isWhite =
              lobby.whitePlayer && lobby.whitePlayer.reconnectToken === reconnectToken;
            const isBlack =
              lobby.blackPlayer && lobby.blackPlayer.reconnectToken === reconnectToken;

            if (isWhite || isBlack) {
              const playerColor = isWhite ? 'white' : 'black';
              const colorField = isWhite ? 'whitePlayer.socketId' : 'blackPlayer.socketId';
              const playerSlot = isWhite ? lobby.whitePlayer : lobby.blackPlayer;

              // Cancel pending abandon timer
              const timerKey = `${lobby.lobbyId}_${playerColor}`;
              if (disconnectTimers.has(timerKey)) {
                clearTimeout(disconnectTimers.get(timerKey));
                disconnectTimers.delete(timerKey);
              }

              // Update socketId
              await Lobby.findOneAndUpdate(
                { lobbyId: lobby.lobbyId },
                { [colorField]: socket.id }
              );

              const game = await getActiveGameByLobbyId(lobby.lobbyId);

              activeConnections.set(socket.id, {
                playerId: playerSlot.playerId,
                lobbyId: lobby.lobbyId,
                gameId: game ? game.gameId : null,
                color: playerColor,
                reconnectToken,
                nickname: playerSlot.nickname,
              });

              if (!lobbyRooms.has(lobby.lobbyId)) {
                lobbyRooms.set(lobby.lobbyId, new Set());
              }
              lobbyRooms.get(lobby.lobbyId).add(socket.id);
              socket.join(lobby.lobbyId);

              // Determine effective lobby status (don't send 'abandoned' as playing)
              const effectiveStatus = lobby.status === 'abandoned' ? 'waiting' : lobby.status;
              const effectiveGameStatus = game ? game.gameStatus : effectiveStatus;

              const reconPayload = {
                lobbyId: lobby.lobbyId,
                gameId: game ? game.gameId : null,
                color: playerColor,
                playerColor,
                reconnectToken,
                status: effectiveStatus,
                gameStatus: effectiveGameStatus,
                fen: game ? game.fen : null,
                whiteClock: game ? game.whiteRemainingTime : null,
                blackClock: game ? game.blackRemainingTime : null,
                activeColor: game ? game.activeColor : 'w',
                moveHistory: game ? game.moveHistory : [],
                lobby: sanitizeLobby(lobby),
                game: game ? sanitizeGame(game) : null,
                whitePlayer: lobby.whitePlayer,
                blackPlayer: lobby.blackPlayer,
              };

              socket.emit('reconnected', reconPayload);
              if (typeof callback === 'function') callback(reconPayload);

              socket.to(lobby.lobbyId).emit('player-reconnected', {
                color: playerColor,
                nickname: playerSlot.nickname,
              });

              // If game was active, resume clock & turn timer
              if (game && (game.gameStatus === 'active' || game.gameStatus === 'playing')) {
                broadcastClockUpdate(io, lobby.lobbyId, game);
                scheduleTurnTimeout(io, lobby.lobbyId, game);
              }

              console.log(`[SOCKET] Reconnected: ${playerSlot.nickname} (${playerColor}) to ${lobby.lobbyId}`);
              return;
            }
          }
          // Token invalid or belongs to another lobby — fall through to normal join
        }

        // ── Normal join path ─────────────────────────────────────────────────
        const { lobby, player, reconnectToken: newToken } =
          await lobbyService.joinLobby({ lobbyId, nickname });

        const game = await gameService.getGameByLobbyId(lobbyId);

        const isWhite = lobby.whitePlayer && lobby.whitePlayer.playerId === player.playerId;
        const playerColor = isWhite ? 'white' : 'black';

        const colorField = isWhite ? 'whitePlayer.socketId' : 'blackPlayer.socketId';
        await Lobby.findOneAndUpdate({ lobbyId }, { [colorField]: socket.id });

        activeConnections.set(socket.id, {
          playerId: player.playerId,
          lobbyId,
          gameId: game ? game.gameId : null,
          color: playerColor,
          reconnectToken: newToken,
          nickname: player.nickname,
        });

        if (!lobbyRooms.has(lobbyId)) {
          lobbyRooms.set(lobbyId, new Set());
        }
        lobbyRooms.get(lobbyId).add(socket.id);
        socket.join(lobbyId);

        const joinedPayload = {
          lobbyId,
          gameId: game ? game.gameId : null,
          color: playerColor,
          nickname: player.nickname,
          reconnectToken: newToken,
          lobby: sanitizeLobby(lobby),
        };

        socket.emit('lobby-joined', joinedPayload);
        if (typeof callback === 'function') callback(joinedPayload);

        io.to(lobbyId).emit('lobby-updated', {
          lobbyId,
          status: lobby.status,
          lobby: sanitizeLobby(lobby),
          whitePlayer: lobby.whitePlayer,
          blackPlayer: lobby.blackPlayer,
        });

        // Both players connected — start game
        if (lobby.status === 'ready' && game) {
          // Set game to active
          await Game.findOneAndUpdate(
            { gameId: game.gameId },
            { gameStatus: 'active', lastMoveTimestamp: new Date() }
          );
          const freshGame = await gameService.getGame(game.gameId);

          await Lobby.findOneAndUpdate({ lobbyId }, { status: 'playing' });

          const gameStartedData = {
            gameId: freshGame.gameId,
            lobbyId,
            fen: freshGame.fen,
            pgn: freshGame.pgn,
            moveHistory: freshGame.moveHistory,
            whiteRemainingTime: freshGame.whiteRemainingTime,
            blackRemainingTime: freshGame.blackRemainingTime,
            whiteClock: freshGame.whiteRemainingTime,
            blackClock: freshGame.blackRemainingTime,
            activeColor: freshGame.activeColor,
            gameStatus: 'playing',
            status: 'playing',
            game: sanitizeGame(freshGame),
            lobby: sanitizeLobby({ ...lobby.toObject(), status: 'playing' }),
            whitePlayer: lobby.whitePlayer,
            blackPlayer: lobby.blackPlayer,
            whiteNickname: lobby.whitePlayer?.nickname || 'White',
            blackNickname: lobby.blackPlayer?.nickname || 'Black',
          };

          io.to(lobbyId).emit('game-started', gameStartedData);

          broadcastClockUpdate(io, lobbyId, freshGame);
          scheduleTurnTimeout(io, lobbyId, freshGame);
        }

        console.log(`[SOCKET] ${player.nickname} joined lobby ${lobbyId} as ${playerColor}`);
      } catch (err) {
        console.error('[SOCKET] join-lobby error:', err);
        socket.emit('error', { message: err.message || 'Failed to join lobby' });
        if (typeof callback === 'function') callback({ error: err.message || 'Failed to join lobby' });
      }
    });

    // ── MAKE MOVE ─────────────────────────────────────────────────────────────
    socket.on('make-move', async (data) => {
      try {
        const { gameId, move, lobbyId } = data || {};
        const session = activeConnections.get(socket.id);

        if (!session) {
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        // Get increment from lobby time control
        const lobby = await getLobby(session.lobbyId || lobbyId);
        const increment = lobby && lobby.timeControl && !lobby.timeControl.isUnlimited
          ? (Number(lobby.timeControl.increment) || 0)
          : 0;

        const { game, moveResult, status, gameEnded } = await gameService.processMove({
          gameId: gameId || session.gameId,
          move,
          playerColor: session.color,
          increment,
        });

        io.to(session.lobbyId).emit('move-made', {
          move: {
            from: moveResult.from,
            to: moveResult.to,
            san: moveResult.san,
            promotion: moveResult.promotion || null,
            flags: moveResult.flags,
          },
          fen: game.fen,
          pgn: game.pgn,
          moveHistory: game.moveHistory,
          whiteRemainingTime: game.whiteRemainingTime,
          blackRemainingTime: game.blackRemainingTime,
          whiteClock: game.whiteRemainingTime,
          blackClock: game.blackRemainingTime,
          activeColor: game.activeColor,
          game: sanitizeGame(game),
          status,
        });

        if (gameEnded) {
          clearTurnTimeout(session.lobbyId);
          await Lobby.findOneAndUpdate({ lobbyId: session.lobbyId }, { status: 'completed' });
          io.to(session.lobbyId).emit('game-over', {
            winner: game.result?.winner,
            condition: game.result?.condition,
            result: {
              winner: game.result?.winner,
              condition: game.result?.condition,
            },
            game: sanitizeGame(game),
          });
        } else {
          broadcastClockUpdate(io, session.lobbyId, game);
          scheduleTurnTimeout(io, session.lobbyId, game);
        }
      } catch (err) {
        console.error('[SOCKET] make-move error:', err);
        socket.emit('error', { message: err.message || 'Invalid move' });
      }
    });

    // ── RESIGN ────────────────────────────────────────────────────────────────
    socket.on('resign', async (data) => {
      try {
        const session = activeConnections.get(socket.id);
        if (!session) {
          socket.emit('error', { message: 'Not authenticated' });
          return;
        }

        clearTurnTimeout(session.lobbyId);
        const game = await gameService.resignGame(
          session.gameId || data?.gameId,
          session.color
        );

        io.to(session.lobbyId).emit('game-over', {
          result: game.result,
          game: sanitizeGame(game),
        });
      } catch (err) {
        console.error('[SOCKET] resign error:', err);
        socket.emit('error', { message: err.message || 'Failed to resign' });
      }
    });

    // ── OFFER DRAW ────────────────────────────────────────────────────────────
    socket.on('offer-draw', async (data) => {
      try {
        const session = activeConnections.get(socket.id);
        if (!session) return;

        const game = await gameService.offerDraw(
          session.gameId || data?.gameId,
          session.color
        );

        io.to(session.lobbyId).emit('draw-offered', {
          offeredBy: session.color,
          game: sanitizeGame(game),
        });
      } catch (err) {
        console.error('[SOCKET] offer-draw error:', err);
        socket.emit('error', { message: err.message || 'Failed to offer draw' });
      }
    });

    // ── ACCEPT DRAW ───────────────────────────────────────────────────────────
    socket.on('accept-draw', async (data) => {
      try {
        const session = activeConnections.get(socket.id);
        if (!session) return;

        clearTurnTimeout(session.lobbyId);
        const game = await gameService.acceptDraw(session.gameId || data?.gameId);

        io.to(session.lobbyId).emit('game-over', {
          result: game.result,
          game: sanitizeGame(game),
        });
      } catch (err) {
        console.error('[SOCKET] accept-draw error:', err);
        socket.emit('error', { message: err.message || 'Failed to accept draw' });
      }
    });

    // ── DECLINE DRAW ──────────────────────────────────────────────────────────
    socket.on('decline-draw', async (data) => {
      try {
        const session = activeConnections.get(socket.id);
        if (!session) return;

        const game = await gameService.declineDraw(session.gameId || data?.gameId);

        io.to(session.lobbyId).emit('draw-declined', {
          declinedBy: session.color,
          game: sanitizeGame(game),
        });
      } catch (err) {
        console.error('[SOCKET] decline-draw error:', err);
        socket.emit('error', { message: err.message || 'Failed to decline draw' });
      }
    });

    // ── REQUEST REMATCH ───────────────────────────────────────────────────────
    socket.on('request-rematch', async (data) => {
      try {
        const session = activeConnections.get(socket.id);
        if (!session) return;

        const game = await gameService.requestRematch(
          session.gameId || data?.gameId,
          session.color
        );

        io.to(session.lobbyId).emit('rematch-requested', {
          requestedBy: session.color,
          game: sanitizeGame(game),
        });

        // Both players accepted — start new game
        if (game.rematchRequested.byWhite && game.rematchRequested.byBlack) {
          // Swap colors: get lobby, swap player slots
          const lobby = await getLobby(session.lobbyId);
          const oldWhite = lobby.whitePlayer;
          const oldBlack = lobby.blackPlayer;

          // Create a fresh game
          const newGame = await gameService.createGame({
            lobbyId: session.lobbyId,
            timeControl: lobby.timeControl,
          });

          // Swap color assignments
          await Lobby.findOneAndUpdate(
            { lobbyId: session.lobbyId },
            {
              whitePlayer: oldBlack,
              blackPlayer: oldWhite,
              gameId: newGame.gameId,
              status: 'playing',
            }
          );
          await Game.findOneAndUpdate(
            { gameId: newGame.gameId },
            { gameStatus: 'active', lastMoveTimestamp: new Date() }
          );

          const freshGame = await gameService.getGame(newGame.gameId);
          const freshLobby = await getLobby(session.lobbyId);

          // Update in-memory sessions with swapped colors
          for (const [sid, conn] of activeConnections.entries()) {
            if (conn.lobbyId === session.lobbyId) {
              const wasWhite = conn.color === 'white';
              activeConnections.set(sid, {
                ...conn,
                gameId: newGame.gameId,
                color: wasWhite ? 'black' : 'white',
              });
            }
          }

          // Emit rematch-started individually so each player gets their new correct color
          for (const [sid, conn] of activeConnections.entries()) {
            if (conn.lobbyId === session.lobbyId) {
              const targetSocket = io.sockets.sockets.get(sid);
              if (targetSocket) {
                targetSocket.emit('rematch-started', {
                  game: sanitizeGame(freshGame),
                  lobby: sanitizeLobby(freshLobby),
                  playerColor: conn.color,
                  gameId: freshGame.gameId,
                  fen: freshGame.fen,
                  whiteClock: freshGame.whiteRemainingTime,
                  blackClock: freshGame.blackRemainingTime,
                  activeColor: freshGame.activeColor,
                  whiteNickname: freshLobby.whitePlayer?.nickname,
                  blackNickname: freshLobby.blackPlayer?.nickname,
                });
              }
            }
          }

          broadcastClockUpdate(io, session.lobbyId, freshGame);
          scheduleTurnTimeout(io, session.lobbyId, freshGame);
        }
      } catch (err) {
        console.error('[SOCKET] request-rematch error:', err);
        socket.emit('error', { message: err.message || 'Failed to request rematch' });
      }
    });

    // ── CLAIM TIMEOUT ─────────────────────────────────────────────────────────
    socket.on('claim-timeout', async (data) => {
      try {
        const session = activeConnections.get(socket.id);
        const lobbyId = session?.lobbyId || data?.lobbyId;
        const gameId = session?.gameId || data?.gameId;
        if (!lobbyId || !gameId) return;

        const game = await gameService.getGame(gameId);
        if (!game || (game.gameStatus !== 'active' && game.gameStatus !== 'playing')) return;

        const activeColor = game.activeColor;
        const losingColor = activeColor === 'w' ? 'white' : 'black';
        let remainingMs = activeColor === 'w' ? game.whiteRemainingTime : game.blackRemainingTime;

        if (remainingMs === null || remainingMs === undefined) return; // Unlimited

        if (game.lastMoveTimestamp) {
          const elapsed = Date.now() - new Date(game.lastMoveTimestamp).getTime();
          remainingMs -= elapsed;
        }

        // Allow up to 1.5s tolerance for network latency
        if (remainingMs <= 1500) {
          await triggerTimeout(io, lobbyId, gameId, losingColor);
        }
      } catch (err) {
        console.error('[SOCKET] claim-timeout error:', err);
      }
    });

    // ── DISCONNECT ────────────────────────────────────────────────────────────
    socket.on('disconnect', async (reason) => {
      console.log(`[SOCKET] Disconnected: ${socket.id} — ${reason}`);

      const session = activeConnections.get(socket.id);

      if (session) {
        const { lobbyId, color, nickname } = session;

        // Remove from room tracking
        if (lobbyRooms.has(lobbyId)) {
          lobbyRooms.get(lobbyId).delete(socket.id);
        }

        // Notify opponent
        socket.to(lobbyId).emit('player-disconnected', { color, nickname });

        // Set timeout to abandon game if player doesn't reconnect
        const timer = setTimeout(async () => {
          try {
            const lobby = await getLobby(lobbyId);
            if (!lobby) return;

            const game = await gameService.getGameByLobbyId(lobbyId);
            if (game && game.gameStatus === 'active') {
              // Forfeit the disconnected player
              const updatedGame = await gameService.resignGame(game.gameId, color);
              io.to(lobbyId).emit('game-over', {
                result: { ...updatedGame.result, reason: 'disconnect' },
                game: sanitizeGame(updatedGame),
              });
            }

            await Lobby.findOneAndUpdate({ lobbyId }, { status: 'abandoned' });
          } catch (err) {
            console.error('[SOCKET] disconnect cleanup error:', err);
          }
        }, 30000); // 30-second grace period

        const timerKey = `${lobbyId}_${color}`;
        disconnectTimers.set(timerKey, timer);

        // Remove from active connections (but keep in DB for reconnect)
        activeConnections.delete(socket.id);
      }
    });
  });
}

export default initSocketHandler;
