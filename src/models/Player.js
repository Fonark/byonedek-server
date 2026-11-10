import mongoose from 'mongoose';

const { Schema, model } = mongoose;

// ─── Schema ───────────────────────────────────────────────────────────────────
const playerSchema = new Schema(
  {
    playerId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    nickname: { type: String, default: 'Anonymous' },
    reconnectToken: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    currentLobbyId: { type: String, default: null },
    currentGameId: { type: String, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

const Player = model('Player', playerSchema);

export default Player;
