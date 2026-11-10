import { Chess } from 'chess.js';

/**
 * Creates and returns a new Chess game instance at the starting position.
 * @returns {Chess}
 */
export function createNewGame() {
  return new Chess();
}

/**
 * Validates a move against a given FEN position.
 * @param {string} fen - The FEN string of the current position.
 * @param {string|object} move - The move in UCI string ('e2e4'), SAN ('e4'), or { from, to, promotion } object.
 * @returns {{ valid: true, game: Chess, move: object } | { valid: false, error: string }}
 */
export function validateMove(fen, move) {
  try {
    const chess = new Chess(fen);
    const result = chess.move(move);
    if (result === null) {
      return { valid: false, error: 'Illegal move' };
    }
    return { valid: true, game: chess, move: result };
  } catch (err) {
    return { valid: false, error: err.message || 'Invalid move' };
  }
}

/**
 * Returns the current status flags for a Chess instance.
 * @param {Chess} chess
 * @returns {{
 *   isCheck: boolean,
 *   isCheckmate: boolean,
 *   isStalemate: boolean,
 *   isDraw: boolean,
 *   isInsufficientMaterial: boolean,
 *   isThreefoldRepetition: boolean,
 *   isFiftyMoveRule: boolean,
 *   isGameOver: boolean,
 *   turn: 'w'|'b'
 * }}
 */
export function getGameStatus(chess) {
  const isCheckmate = chess.isCheckmate();
  const isStalemate = chess.isStalemate();
  const isInsufficientMaterial = chess.isInsufficientMaterial();
  const isThreefoldRepetition = chess.isThreefoldRepetition();
  // chess.js v1 exposes isDraw() which covers stalemate, insufficient material,
  // threefold repetition and the fifty-move rule.
  const isDraw = chess.isDraw();
  // Fifty-move rule: a draw condition reported inside isDraw but not via a
  // dedicated flag in chess.js v1 — we detect it by elimination.
  const isFiftyMoveRule =
    isDraw && !isStalemate && !isInsufficientMaterial && !isThreefoldRepetition;

  return {
    isCheck: chess.inCheck(),
    isCheckmate,
    isStalemate,
    isDraw,
    isInsufficientMaterial,
    isThreefoldRepetition,
    isFiftyMoveRule,
    isGameOver: chess.isGameOver(),
    turn: chess.turn(),
  };
}

/**
 * Returns an array of legal move objects for a given square in a FEN position.
 * @param {string} fen
 * @param {string} square - e.g. 'e2'
 * @returns {object[]} Array of move objects (from chess.js)
 */
export function getLegalMoves(fen, square) {
  try {
    const chess = new Chess(fen);
    return chess.moves({ square, verbose: true });
  } catch {
    return [];
  }
}

/**
 * Applies a move to a FEN position and returns the resulting FEN.
 * @param {string} fen
 * @param {string|object} move
 * @returns {string|null} New FEN string, or null if the move is invalid.
 */
export function applyMove(fen, move) {
  try {
    const chess = new Chess(fen);
    const result = chess.move(move);
    if (result === null) return null;
    return chess.fen();
  } catch {
    return null;
  }
}
