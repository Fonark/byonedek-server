import { Chess } from 'chess.js';

console.log('=== TESTING TAKEBACK LOGIC ===');

// Mock Game object mimicking Game model
function createMockGame() {
  return {
    gameId: 'test-game',
    lobbyId: 'test-lobby',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    pgn: '',
    moveHistory: [],
    whiteRemainingTime: 300000,
    blackRemainingTime: 300000,
    activeColor: 'w',
    gameStatus: 'active',
    result: { winner: null, condition: null },
    takebackOffer: { offeredBy: null, timestamp: null },
  };
}

function mockProcessMove(game, moveObj, color) {
  const chess = new Chess(game.fen);
  const res = chess.move(moveObj);
  if (!res) throw new Error('Illegal move: ' + JSON.stringify(moveObj));

  const newFen = chess.fen();
  game.moveHistory.push({
    move: res.from + res.to + (res.promotion || ''),
    san: res.san,
    fen: newFen,
    whiteRemainingTime: color === 'white' ? game.whiteRemainingTime - 5000 : game.whiteRemainingTime,
    blackRemainingTime: color === 'black' ? game.blackRemainingTime - 5000 : game.blackRemainingTime,
    timestamp: new Date(),
  });

  game.fen = newFen;
  game.pgn = chess.pgn();
  game.activeColor = chess.turn();
  if (color === 'white') game.whiteRemainingTime -= 5000;
  else game.blackRemainingTime -= 5000;

  if (chess.isGameOver()) {
    game.gameStatus = 'completed';
    game.result = { winner: color, condition: chess.isCheckmate() ? 'checkmate' : 'stalemate' };
  }
}

function mockAcceptTakeback(game) {
  const requesterColor = game.takebackOffer?.offeredBy;
  const currentTurnColor = game.activeColor === 'w' ? 'white' : 'black';

  let movesToUndo = 1;
  if (requesterColor && requesterColor === currentTurnColor) {
    movesToUndo = Math.min(2, game.moveHistory.length);
  } else {
    movesToUndo = Math.min(1, game.moveHistory.length);
  }

  for (let i = 0; i < movesToUndo; i++) {
    game.moveHistory.pop();
  }

  game.takebackOffer = { offeredBy: null, timestamp: null };

  const chess = new Chess();
  for (const entry of game.moveHistory) {
    chess.move(entry.san || entry.move);
  }

  game.fen = chess.fen();
  game.pgn = chess.pgn();
  game.activeColor = chess.turn();

  game.gameStatus = 'active';
  game.result = { winner: null, condition: null };

  if (game.moveHistory.length > 0) {
    const target = game.moveHistory[game.moveHistory.length - 1];
    if (target.whiteRemainingTime != null) game.whiteRemainingTime = target.whiteRemainingTime;
    if (target.blackRemainingTime != null) game.blackRemainingTime = target.blackRemainingTime;
  } else {
    game.whiteRemainingTime = 300000;
    game.blackRemainingTime = 300000;
  }
}

// Test 1: White 1. e4 blunder, requests takeback immediately (Black's turn)
console.log('\n--- Test 1: Immediate Takeback after 1. e4 ---');
const g1 = createMockGame();
mockProcessMove(g1, 'e4', 'white');
console.assert(g1.activeColor === 'b', 'Active color should be b');
console.assert(g1.moveHistory.length === 1, 'Move history length should be 1');

g1.takebackOffer = { offeredBy: 'white', timestamp: new Date() };
mockAcceptTakeback(g1);

console.assert(g1.moveHistory.length === 0, 'Move history should be empty');
console.assert(g1.fen === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 'FEN should be initial');
console.assert(g1.activeColor === 'w', 'Active color should be w');
console.log('✅ Test 1 passed: 1. e4 rolled back to starting position, White can move again.');

// Test 2: White 1. e4, Black 1... e5, White 2. Nf3. Black wants to take back 1... e5
console.log('\n--- Test 2: Takeback after opponent already replied ---');
const g2 = createMockGame();
mockProcessMove(g2, 'e4', 'white');
mockProcessMove(g2, 'e5', 'black');
mockProcessMove(g2, 'Nf3', 'white');
console.assert(g2.activeColor === 'b', 'Active color should be b');
console.assert(g2.moveHistory.length === 3, 'Move history length should be 3');

// Black requests takeback
g2.takebackOffer = { offeredBy: 'black', timestamp: new Date() };
mockAcceptTakeback(g2);

console.assert(g2.moveHistory.length === 1, 'Move history should now have 1 move (1. e4)');
console.assert(g2.activeColor === 'b', 'Active color should be b (Black can choose a different move than e5)');
const c2 = new Chess();
c2.move('e4');
console.assert(g2.fen === c2.fen(), 'FEN matches 1. e4');
console.log('✅ Test 2 passed: 2 moves rolled back to 1. e4, Black gets their turn back.');

// Test 3: Takeback after blunder into Fool\'s Mate
console.log('\n--- Test 3: Takeback after Checkmate Blunder ---');
const g3 = createMockGame();
mockProcessMove(g3, 'f3', 'white');
mockProcessMove(g3, 'e5', 'black');
mockProcessMove(g3, 'g4', 'white');
mockProcessMove(g3, 'Qh4#', 'black');
console.assert(g3.gameStatus === 'completed', 'Game should be completed');
console.assert(g3.result.winner === 'black', 'Black should be winner');

// White requests takeback of the g4 blunder, Black accepts
g3.takebackOffer = { offeredBy: 'white', timestamp: new Date() };
mockAcceptTakeback(g3);

console.assert(g3.gameStatus === 'active', 'Game should be restored to active');
console.assert(g3.result.winner === null, 'Winner should be reset to null');
console.assert(g3.activeColor === 'w', 'Active color is white');
console.assert(g3.moveHistory.length === 2, 'History has 2 moves: f3, e5');
console.log('✅ Test 3 passed: Checkmate undone, game resumes normally.');

console.log('\n🎉 ALL TAKEBACK TESTS PASSED!');
