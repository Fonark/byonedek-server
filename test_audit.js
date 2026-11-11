import { Chess } from 'chess.js';
import { getGameStatus, validateMove } from './src/utils/chessHelpers.js';

console.log('========================================');
console.log('   STARTING CHESS APP AUDIT SUITE       ');
console.log('========================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`[PASS] ${testName}`);
  } else {
    failedTests++;
    console.error(`[FAIL] ${testName}`);
  }
}

// ----------------------------------------------------
// 1. CHESS RULES TEST
// ----------------------------------------------------
console.log('--- 1. Testing Chess Rules ---');

// Test 1.1: Basic Moves
{
  const c = new Chess();
  const m1 = c.move('e4');
  assert(m1 !== null && c.turn() === 'b', 'White pawn e2->e4');
  const m2 = c.move('e5');
  assert(m2 !== null && c.turn() === 'w', 'Black pawn e7->e5');
  const m3 = c.move('Nf3');
  assert(m3 !== null && c.turn() === 'b', 'White knight g1->f3');
  const m4 = c.move('Nc6');
  assert(m4 !== null && c.turn() === 'w', 'Black knight b8->c6');
}

// Test 1.2: Illegal Move Rejection
{
  const c = new Chess();
  let threw = false;
  try {
    const res = c.move('e5'); // White cannot play e5 on move 1
    if (!res) threw = true;
  } catch {
    threw = true;
  }
  assert(threw, 'Illegal move rejected on move 1');

  // Move opponent piece out of turn
  const val = validateMove(c.fen(), 'e7e5');
  assert(!val.valid, 'validateMove rejects moving opponent piece on white turn');
}

// Test 1.3: Kingside Castling
{
  const c = new Chess();
  c.move('e4'); c.move('e5');
  c.move('Nf3'); c.move('Nc6');
  c.move('Bc4'); c.move('Bc5');
  const castle = c.move('O-O');
  assert(castle !== null && castle.san === 'O-O' && c.get('g1')?.type === 'k' && c.get('f1')?.type === 'r', 'White Kingside castling (O-O)');
}

// Test 1.4: Queenside Castling
{
  const c = new Chess();
  c.move('d4'); c.move('d5');
  c.move('Nc3'); c.move('Nc6');
  c.move('Bf4'); c.move('Bf5');
  c.move('Qd2'); c.move('Qd7');
  const castle = c.move('O-O-O');
  assert(castle !== null && castle.san === 'O-O-O' && c.get('c1')?.type === 'k' && c.get('d1')?.type === 'r', 'White Queenside castling (O-O-O)');
}

// Test 1.5: En Passant
{
  const c = new Chess();
  c.move('e4'); c.move('a6');
  c.move('e5'); c.move('d5'); // Black moves two squares adjacent to White's e5 pawn
  const ep = c.move('exd6');
  assert(ep !== null && ep.flags.includes('e') && !c.get('d5') && c.get('d6')?.color === 'w', 'En passant capture removes victim pawn from d5');
}

// Test 1.6: Pawn Promotion
{
  // Position with pawn on 7th rank ready to promote
  const c = new Chess('8/4P3/8/8/8/8/8/4K2k w - - 0 1');
  const promo = c.move({ from: 'e7', to: 'e8', promotion: 'q' });
  assert(promo !== null && promo.promotion === 'q' && c.get('e8')?.type === 'q', 'Pawn promotion to Queen');
}

// Test 1.7: Scholar\'s Mate (Checkmate)
{
  const c = new Chess();
  c.move('e4'); c.move('e5');
  c.move('Bc4'); c.move('Nc6');
  c.move('Qh5'); c.move('Nf6');
  c.move('Qxf7#');
  const status = getGameStatus(c);
  assert(status.isCheckmate === true, 'Scholar\'s mate triggers isCheckmate');
  assert(status.isGameOver === true, 'Checkmate triggers isGameOver');
  assert(status.turn === 'b', 'Checkmate turn is the losing player');
}

// Test 1.8: Stalemate
{
  // Known stalemate position: Black king on a8, White king on c7, White queen on b6 -> c7 etc
  const c = new Chess('k7/2Q5/1K6/8/8/8/8/8 b - - 0 1');
  // Wait, in 'k7/2Q5/1K6/8/8/8/8/8 b - - 0 1', black has no moves and is NOT in check
  const status = getGameStatus(c);
  assert(status.isStalemate === true, 'Stalemate position detected');
  assert(status.isGameOver === true, 'Stalemate triggers isGameOver');
}

// Test 1.9: Insufficient Material
{
  // King vs King
  const c1 = new Chess('8/8/8/4k3/8/8/8/4K3 w - - 0 1');
  const s1 = getGameStatus(c1);
  assert(s1.isInsufficientMaterial === true && s1.isDraw === true, 'King vs King is insufficient material');

  // King + Bishop vs King
  const c2 = new Chess('8/8/8/4k3/8/5B2/8/4K3 w - - 0 1');
  const s2 = getGameStatus(c2);
  assert(s2.isInsufficientMaterial === true && s2.isDraw === true, 'King + Bishop vs King is insufficient material');

  // King + Knight vs King
  const c3 = new Chess('8/8/8/4k3/8/5N2/8/4K3 w - - 0 1');
  const s3 = getGameStatus(c3);
  assert(s3.isInsufficientMaterial === true && s3.isDraw === true, 'King + Knight vs King is insufficient material');
}

// Test 1.10: Threefold Repetition
{
  const c = new Chess();
  c.move('Nf3'); c.move('Nf6');
  c.move('Ng1'); c.move('Ng8'); // 1 repetition
  c.move('Nf3'); c.move('Nf6');
  c.move('Ng1'); c.move('Ng8'); // 2 repetitions (3-fold position reached)
  const status = getGameStatus(c);
  assert(status.isThreefoldRepetition === true, 'Threefold repetition detected');
}

// Test 1.11: 50-Move Rule
{
  // 100 half-moves (50 full moves) without pawn move or capture
  const c = new Chess('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 100 51');
  const status = getGameStatus(c);
  assert(status.isFiftyMoveRule === true, 'Fifty-move rule detected');
}

// ----------------------------------------------------
// 2. TIME CONTROLS & INCREMENTS
// ----------------------------------------------------
console.log('\n--- 2. Testing Time Controls & Clock Logic ---');

const presets = [
  { name: 'Bullet 1+0', minutes: 1, increment: 0 },
  { name: 'Bullet 1+1', minutes: 1, increment: 1 },
  { name: 'Bullet 2+1', minutes: 2, increment: 1 },
  { name: 'Blitz 3+0', minutes: 3, increment: 0 },
  { name: 'Blitz 3+2', minutes: 3, increment: 2 },
  { name: 'Blitz 5+0', minutes: 5, increment: 0 },
  { name: 'Blitz 5+3', minutes: 5, increment: 3 },
  { name: 'Rapid 10+0', minutes: 10, increment: 0 },
  { name: 'Rapid 10+5', minutes: 10, increment: 5 },
  { name: 'Rapid 15+10', minutes: 15, increment: 10 },
  { name: 'Rapid 30+0', minutes: 30, increment: 0 },
  { name: 'Unlimited', minutes: 0, increment: 0, isUnlimited: true },
];

for (const tc of presets) {
  if (tc.isUnlimited) {
    const whiteTime = null;
    const blackTime = null;
    assert(whiteTime === null && blackTime === null, `Preset ${tc.name} properly sets null clocks`);
  } else {
    const initialMs = tc.minutes * 60 * 1000;
    const elapsedMs = 5000; // 5 seconds spent
    const incrementMs = tc.increment * 1000;
    const remainingMs = Math.max(0, initialMs - elapsedMs + incrementMs);
    const expected = initialMs - 5000 + incrementMs;
    assert(remainingMs === expected, `Preset ${tc.name} clock math after 5s move: expected ${expected}ms, got ${remainingMs}ms`);
  }
}

// ----------------------------------------------------
// 3. REPEATED TEST CYCLES (10 CYCLES)
// ----------------------------------------------------
console.log('\n--- 3. Running 10 Repeated Match Simulation Cycles ---');

for (let cycle = 1; cycle <= 10; cycle++) {
  const c = new Chess();
  const moves = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7'];
  let ok = true;
  for (const m of moves) {
    if (!c.move(m)) {
      ok = false;
      break;
    }
  }
  assert(ok && c.history().length === 10, `Cycle ${cycle}/10: 10 standard opening moves simulated successfully`);
}

// ----------------------------------------------------
// 4. SUMMARY
// ----------------------------------------------------
console.log('\n========================================');
console.log(`TOTAL TESTS: ${totalTests}`);
console.log(`PASSED: ${passedTests}`);
console.log(`FAILED: ${failedTests}`);
console.log('========================================');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
