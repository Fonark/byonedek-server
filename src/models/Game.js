import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// ─── Sub-schema: Move History Entry ─────────────────────────────────────────
const moveEntrySchema = new Schema(
  {
    move: { type: String },
    san: { type: String },
    fen: { type: String },
    whiteRemainingTime: { type: Number, default: null },
    blackRemainingTime: { type: Number, default: null },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ─── Sub-schema: Result ───────────────────────────────────────────────────────
const resultSchema = new Schema(
  {
    winner: {
      type: String,
      enum: ['white', 'black', 'draw', null],
      default: null,
    },
    condition: {
      type: String,
      enum: [
        'checkmate',
        'resignation',
        'timeout',
        'stalemate',
        'insufficient',
        'threefold',
        'fifty-move',
        'draw-agreement',
        null,
      ],
      default: null,
    },
  },
  { _id: false }
);

// ─── Sub-schema: Draw Offer ───────────────────────────────────────────────────
const drawOfferSchema = new Schema(
  {
    offeredBy: {
      type: String,
      enum: ['white', 'black', null],
      default: null,
    },
    timestamp: { type: Date, default: null },
  },
  { _id: false }
);

// ─── Sub-schema: Takeback Offer ───────────────────────────────────────────────
const takebackOfferSchema = new Schema(
  {
    offeredBy: {
      type: String,
      enum: ['white', 'black', null],
      default: null,
    },
    timestamp: { type: Date, default: null },
  },
  { _id: false }
);

// ─── Sub-schema: Rematch Requested ───────────────────────────────────────────
const rematchSchema = new Schema(
  {
    byWhite: { type: Boolean, default: false },
    byBlack: { type: Boolean, default: false },
  },
  { _id: false }
);

// ─── Main Schema ──────────────────────────────────────────────────────────────
const gameSchema = new Schema(
  {
    gameId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    lobbyId: {
      type: String,
      required: true,
      index: true,
    },
    fen: {
      type: String,
      required: true,
    },
    pgn: { type: String, default: '' },
    moveHistory: { type: [moveEntrySchema], default: [] },
    whiteRemainingTime: { type: Number, default: null }, // ms
    blackRemainingTime: { type: Number, default: null }, // ms
    activeColor: {
      type: String,
      enum: ['w', 'b'],
      default: 'w',
    },
    lastMoveTimestamp: { type: Date, default: null },
    gameStatus: {
      type: String,
      enum: ['waiting', 'active', 'completed'],
      default: 'waiting',
    },
    result: { type: resultSchema, default: () => ({}) },
    drawOffer: { type: drawOfferSchema, default: () => ({}) },
    takebackOffer: { type: takebackOfferSchema, default: () => ({}) },
    rematchRequested: { type: rematchSchema, default: () => ({}) },
    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { versionKey: false }
);

const Game = model('Game', gameSchema);

export default Game;
