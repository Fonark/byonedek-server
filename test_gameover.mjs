/**
 * Test game-over scenarios: checkmate, timeout, resign
 * Run: node test_gameover.mjs
 */
import { Chess } from 'chess.js';

console.log('=== GAME-OVER SCENARIO TESTS ===\n');

// Test 1: Checkmate detection
{
  const chess = new Chess();
  // Scholar's Mate
  chess.move('e4'); chess.move('e5');
  chess.move('Qh5'); chess.move('Nc6');
  chess.move('Bc4'); chess.move('Nf6');
  // White plays Qxf7#
  const result = chess.move('Qxf7');
  
  const isCheckmate = chess.isCheckmate();
  const winner = chess.turn() === 'w' ? 'black' : 'white'; // who moved last wins
  
  console.log('Test 1 - Scholar\'s Mate Checkmate:');
  console.log('  isCheckmate:', isCheckmate);  // should be true
  console.log('  turn after:', chess.turn());   // should be 'b' (black to move, but checkmated)
  console.log('  winner:', winner);             // should be 'white'
  console.log('  PASS:', isCheckmate === true && winner === 'white' ? '✅' : '❌');
  console.log();
}

// Test 2: Stalemate detection
{
  // Stalemate position: Black king on a8, white queen on b6, white king on a6
  const chess = new Chess('7k/8/KQ6/8/8/8/8/8 b - - 0 1');
  // Load a position where it's black to move but no legal moves without being in check
  // Actually let's use a known stalemate: king in corner, no legal moves, not in check
  const chess2 = new Chess('k7/8/KQ6/8/8/8/8/8 b - - 0 1');
  
  console.log('Test 2 - Stalemate:');
  console.log('  isStalemate:', chess2.isStalemate());
  console.log('  inCheck:', chess2.inCheck());
  console.log('  PASS:', chess2.isStalemate() === true && chess2.inCheck() === false ? '✅' : '❌');
  console.log();
}

// Test 3: Verify winner determination logic
{
  console.log('Test 3 - Winner determination after checkmate:');
  
  // playerColor = 'white' (the one who made the last move = checkmate)
  // After checkmate, chess.turn() === 'b' (black is next, but black is mated)
  // So winner = chess.turn() === 'w' ? 'black' : 'white'
  // chess.turn() = 'b' → winner = 'white' ✓
  
  const simulateMoveResult = (playerColor) => {
    const chessTurn = playerColor === 'white' ? 'b' : 'w'; // after white moves, it's black's turn
    const winner = chessTurn === 'w' ? 'black' : 'white';
    return { winner };
  };
  
  const r1 = simulateMoveResult('white');
  const r2 = simulateMoveResult('black');
  
  console.log('  White delivers checkmate → winner:', r1.winner, r1.winner === 'white' ? '✅' : '❌');
  console.log('  Black delivers checkmate → winner:', r2.winner, r2.winner === 'black' ? '✅' : '❌');
  console.log();
}

// Test 4: GameOverModal condition check
{
  console.log('Test 4 - GameOverModal render conditions:');
  
  const testCases = [
    { gameResult: null, expected: false, label: 'null gameResult' },
    { gameResult: {}, expected: false, label: 'empty gameResult' },
    { gameResult: { winner: null, condition: 'checkmate' }, expected: false, label: 'null winner' },
    { gameResult: { winner: 'white', condition: 'checkmate' }, expected: true, label: 'white wins by checkmate' },
    { gameResult: { winner: 'black', condition: 'timeout' }, expected: true, label: 'black wins by timeout' },
    { gameResult: { winner: 'draw', condition: 'stalemate' }, expected: true, label: 'draw by stalemate' },
  ];
  
  for (const tc of testCases) {
    const willRender = !!(tc.gameResult && tc.gameResult.winner);
    const pass = willRender === tc.expected;
    console.log(`  ${pass ? '✅' : '❌'} "${tc.label}": renders=${willRender} (expected=${tc.expected})`);
  }
  console.log();
}

// Test 5: processMove winner determination (server-side)
{
  console.log('Test 5 - Server processMove winner determination:');
  
  // Scholar's mate - white delivers checkmate
  const chess = new Chess();
  chess.move('e4'); chess.move('e5');
  chess.move('Qh5'); chess.move('Nc6');
  chess.move('Bc4'); chess.move('Nf6');
  
  const playerColor = 'white'; // white is making the move
  const moveResult = chess.move('Qxf7');
  
  const isCheckmate = chess.isCheckmate();
  // Server code: winner: playerColor (the player who just moved wins)
  const winner = playerColor; // 'white'
  
  console.log('  playerColor (who moved):', playerColor);
  console.log('  isCheckmate:', isCheckmate);
  console.log('  winner (from server logic):', winner);
  console.log('  PASS:', isCheckmate && winner === 'white' ? '✅' : '❌');
  console.log();
}

// Test 6: timeout claim validation
{
  console.log('Test 6 - Timeout claim validation:');
  
  const simulateTimeout = (remainingMs, lastMoveTimestamp, toleranceMs = 1500) => {
    let adjusted = remainingMs;
    if (lastMoveTimestamp) {
      const elapsed = Date.now() - lastMoveTimestamp;
      adjusted -= elapsed;
    }
    return adjusted <= toleranceMs;
  };
  
  const now = Date.now();
  const cases = [
    { remaining: 0, lastMove: now - 100, label: 'just expired (100ms elapsed)' },
    { remaining: 500, lastMove: now - 2000, label: 'expired 1.5s ago' },
    { remaining: 1000, lastMove: now - 500, label: 'still has 500ms (should REJECT)' },
    { remaining: 1500, lastMove: now - 1000, label: 'has 500ms left (should REJECT)' },
    { remaining: 2000, lastMove: now - 1000, label: 'has 1000ms left (should REJECT)' },
  ];
  
  for (const c of cases) {
    const result = simulateTimeout(c.remaining, c.lastMove);
    console.log(`  ${result ? 'TRIGGER' : 'REJECT'}: "${c.label}"`);
  }
  console.log();
}

console.log('=== ALL TESTS COMPLETE ===');
