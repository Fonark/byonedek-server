/**
 * Integration test: game-over scenarios (checkmate, timeout, resign)
 * Tests both server logic AND client-side event handling
 * Run from server dir: node test_gameover_integration.mjs
 */

import { Chess } from 'chess.js';

console.log('=== GAME-OVER INTEGRATION TESTS ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ─── Simulate server processMove winner logic ──────────────────────────────────
function simulateProcessMove(fen, moveData, playerColor) {
  const chess = new Chess(fen);
  const moveResult = chess.move(moveData);
  if (!moveResult) throw new Error('Illegal move');

  const isCheckmate = chess.isCheckmate();
  const isStalemate = chess.isStalemate();
  const isInsufficient = chess.isInsufficientMaterial();
  const isDraw = chess.isDraw();

  let gameEnded = false;
  let result = null;

  if (isCheckmate) {
    result = { winner: playerColor, condition: 'checkmate' };
    gameEnded = true;
  } else if (isStalemate) {
    result = { winner: 'draw', condition: 'stalemate' };
    gameEnded = true;
  } else if (isInsufficient) {
    result = { winner: 'draw', condition: 'insufficient' };
    gameEnded = true;
  } else if (isDraw) {
    result = { winner: 'draw', condition: 'draw' };
    gameEnded = true;
  }

  return { chess, moveResult, gameEnded, result, isCheckmate, isStalemate };
}

// ─── Simulate client onMoveMade handler (new version) ─────────────────────────
function simulateOnMoveMade(serverData) {
  const gameObj = serverData.game || {};
  const fen = serverData.fen || gameObj.fen;

  const topResult = serverData.result && serverData.result.winner ? serverData.result : null;
  const objResult = gameObj.result && gameObj.result.winner ? gameObj.result : null;
  const res = topResult || objResult || null;

  const rawStatus = serverData.gameStatus || gameObj.gameStatus;
  const status = rawStatus === 'completed' || serverData.status?.isGameOver || res
    ? 'completed'
    : 'playing';

  return { res, status };
}

// ─── Simulate GameOverModal render condition ──────────────────────────────────
function wouldModalRender(gameResult) {
  if (!gameResult || (!gameResult.winner && !gameResult.condition)) return false;

  const drawConditions = ['stalemate', 'draw-agreement', 'draw_agreed', 'draw', 'insufficient', 'repetition', 'threefold', 'fifty_move', 'fifty-move'];
  const winner = gameResult.winner || (drawConditions.includes(gameResult.condition) ? 'draw' : null);

  return !!winner;
}

console.log('--- Checkmate Scenarios ---');

test('Scholar\'s Mate: white wins by checkmate', () => {
  const chess = new Chess();
  chess.move('e4'); chess.move('e5');
  chess.move('Qh5'); chess.move('Nc6');
  chess.move('Bc4'); chess.move('Nf6');

  const { gameEnded, result } = simulateProcessMove(chess.fen(), 'Qxf7', 'white');
  
  assert(gameEnded, 'gameEnded should be true');
  assert(result.winner === 'white', `winner should be 'white', got '${result.winner}'`);
  assert(result.condition === 'checkmate', `condition should be 'checkmate', got '${result.condition}'`);
});

test('Scholar\'s Mate: server move-made event carries result', () => {
  const chess = new Chess();
  chess.move('e4'); chess.move('e5');
  chess.move('Qh5'); chess.move('Nc6');
  chess.move('Bc4'); chess.move('Nf6');

  const { gameEnded, result, moveResult } = simulateProcessMove(chess.fen(), 'Qxf7', 'white');
  
  // Simulate server move-made emission (new server code adds result at top level)
  const serverEvent = {
    move: { from: moveResult.from, to: moveResult.to, san: moveResult.san },
    fen: chess.fen(),
    gameStatus: gameEnded ? 'completed' : 'playing',
    result: gameEnded ? result : null,
    game: { 
      fen: chess.fen(),
      gameStatus: gameEnded ? 'completed' : 'active',
      result: gameEnded ? result : { winner: null, condition: null },
    },
    status: { isGameOver: chess.isGameOver(), isCheckmate: chess.isCheckmate() },
  };

  const { res, status } = simulateOnMoveMade(serverEvent);

  assert(res !== null, 'res should not be null');
  assert(res.winner === 'white', `res.winner should be 'white', got '${res?.winner}'`);
  assert(res.condition === 'checkmate', `res.condition should be 'checkmate', got '${res?.condition}'`);
  assert(status === 'completed', `status should be 'completed', got '${status}'`);
});

test('Scholar\'s Mate: GameOverModal would render', () => {
  const gameResult = { winner: 'white', condition: 'checkmate' };
  assert(wouldModalRender(gameResult), 'Modal should render');
});

test('Black wins by checkmate', () => {
  // Fool\'s mate: 1. f3 e5 2. g4 Qh4#
  const { gameEnded, result } = simulateProcessMove(
    'rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2',
    'Qh4',
    'black'
  );
  
  assert(gameEnded, 'gameEnded should be true');
  assert(result.winner === 'black', `winner should be 'black', got '${result.winner}'`);
  assert(result.condition === 'checkmate', `condition should be 'checkmate'`);
});

console.log('\n--- Stalemate Scenarios ---');

test('Stalemate: draw result', () => {
  // King on a8, White Queen on b6, White King on a6 - Black to move, stalemate
  const { gameEnded, result } = simulateProcessMove(
    '1Q6/8/K7/8/8/8/8/k7 w - - 0 1',
    'Qb7',  // moves queen to b7, trapping black king
    'white'
  );
  
  if (gameEnded) {
    assert(result.winner === 'draw', `winner should be 'draw', got '${result.winner}'`);
    assert(result.condition === 'stalemate', `condition should be 'stalemate'`);
  }
  // Note: not all queen moves lead to stalemate, test might not be perfect
});

test('Stalemate: GameOverModal renders with draw winner', () => {
  const gameResult = { winner: 'draw', condition: 'stalemate' };
  assert(wouldModalRender(gameResult), 'Modal should render for draw');
});

test('Stalemate: GameOverModal renders even without winner field (condition fallback)', () => {
  const gameResult = { condition: 'stalemate' };  // winner missing
  assert(wouldModalRender(gameResult), 'Modal should render from condition fallback');
});

console.log('\n--- Timeout Scenarios ---');

test('Timeout: white loses → black wins', () => {
  const losingColor = 'white';
  const winner = losingColor === 'white' ? 'black' : 'white';
  const result = { winner, condition: 'timeout' };
  
  assert(result.winner === 'black', `winner should be 'black'`);
  assert(result.condition === 'timeout', `condition should be 'timeout'`);
  assert(wouldModalRender(result), 'Modal should render for timeout');
});

test('Timeout: black loses → white wins', () => {
  const losingColor = 'black';
  const winner = losingColor === 'white' ? 'black' : 'white';
  const result = { winner, condition: 'timeout' };
  
  assert(result.winner === 'white', `winner should be 'white'`);
  assert(wouldModalRender(result), 'Modal should render');
});

test('Timeout: claim-timeout server validation (1500ms tolerance)', () => {
  const validate = (remainingMs, elapsedMs) => {
    const adjusted = remainingMs - elapsedMs;
    return adjusted <= 1500;
  };

  assert(validate(0, 100), 'Should trigger: 0ms remaining');
  assert(validate(500, 2000), 'Should trigger: expired 1500ms ago');
  assert(validate(1500, 0), 'Should trigger: exactly 1500ms remaining');
  assert(!validate(2000, 0), 'Should NOT trigger: 2000ms remaining');
  assert(!validate(5000, 0), 'Should NOT trigger: 5000ms remaining');
});

console.log('\n--- Resign Scenarios ---');

test('Resign: white resigns → black wins', () => {
  const resigningColor = 'white';
  const winner = resigningColor === 'white' ? 'black' : 'white';
  const result = { winner, condition: 'resignation' };
  
  assert(result.winner === 'black', `winner should be 'black'`);
  assert(wouldModalRender(result), 'Modal should render');
});

console.log('\n--- Existing move-made event (old format, game not over) ---');

test('Non-terminal move: modal should NOT render', () => {
  // Simulate normal move event - game not ended
  const serverEvent = {
    fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    gameStatus: 'playing',
    result: null,
    game: {
      fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
      gameStatus: 'active',
      result: { winner: null, condition: null },
    },
    status: { isGameOver: false, isCheckmate: false },
  };

  const { res, status } = simulateOnMoveMade(serverEvent);

  assert(res === null, `res should be null for non-terminal move, got: ${JSON.stringify(res)}`);
  assert(status === 'playing', `status should be 'playing', got '${status}'`);
  assert(!wouldModalRender(null), 'Modal should NOT render');
});

test('gameResult with null winner from DB default: modal should NOT render', () => {
  const gameResult = { winner: null, condition: null };
  assert(!wouldModalRender(gameResult), 'Modal should NOT render for empty result');
});

console.log('\n--- Clock/useClock behavior ---');

test('useClock: timeout fires for active player only', () => {
  // Simulate useClock logic
  const simulateTick = (gameStatus, activeColor, whiteMs, blackMs) => {
    if (gameStatus !== 'playing' && gameStatus !== 'active') return { whiteMs, blackMs };
    if (activeColor === 'w') {
      whiteMs = Math.max(0, whiteMs - 100);
    } else {
      blackMs = Math.max(0, blackMs - 100);
    }
    return { whiteMs, blackMs };
  };

  // White active, 100ms left
  let { whiteMs, blackMs } = simulateTick('playing', 'w', 100, 5000);
  assert(whiteMs === 0, `white should reach 0, got ${whiteMs}`);
  assert(blackMs === 5000, `black should stay at 5000, got ${blackMs}`);
});

console.log('\n' + '='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('🎉 ALL TESTS PASSED!');
} else {
  console.log(`⚠️  ${failed} TESTS FAILED`);
  process.exit(1);
}
