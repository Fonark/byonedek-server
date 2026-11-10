import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// ─── Sub-schema: Player Slot ─────────────────────────────────────────────────
const playerSlotSchema = new Schema(
  {
    playerId: { type: String, default: null },
    nickname: { type: String, default: null },
    reconnectToken: { type: String, default: null },
    socketId: { type: String, default: null },
  },
  { _id: false }
);

// ─── Sub-schema: Time Control ────────────────────────────────────────────────
const timeControlSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['bullet', 'blitz', 'rapid', 'unlimited', 'custom'],
      default: 'rapid',
    },
    minutes: { type: Number, default: 10 },
    increment: { type: Number, default: 0 },
    isUnlimited: { type: Boolean, default: false },
  },
  { _id: false }
);

// ─── Main Schema ─────────────────────────────────────────────────────────────
const lobbySchema = new Schema(
  {
    lobbyId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['waiting', 'ready', 'playing', 'completed', 'abandoned'],
      default: 'waiting',
    },
    hostId: {
      type: String,
      required: true,
    },
    whitePlayer: { type: playerSlotSchema, default: () => ({}) },
    blackPlayer: { type: playerSlotSchema, default: () => ({}) },
    timeControl: { type: timeControlSchema, default: () => ({}) },
    gameId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: false, versionKey: false }
);

// ─── TTL Index: expire waiting lobbies after 2 hours ─────────────────────────
lobbySchema.index(
  { createdAt: 1 },
  {
    expireAfterSeconds: 7200,
    partialFilterExpression: { status: 'waiting' },
  }
);

// ─── Auto-update updatedAt ────────────────────────────────────────────────────
lobbySchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

lobbySchema.pre('findOneAndUpdate', function (next) {
  this.set({ updatedAt: new Date() });
  next();
});

const Lobby = model('Lobby', lobbySchema);

export default Lobby;
