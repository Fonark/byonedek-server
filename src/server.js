import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mongoose from 'mongoose';
import { generalLimiter } from './middleware/rateLimiter.js';
import router from './routes/index.js';
import { initSocketHandler } from './socket/index.js';

const app = express();
const httpServer = createServer(app);

// ─── CORS ───────────────────────────────────────────────────────────────────
// Support multiple origins: local dev + production Vercel URL
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:4173',
  process.env.CLIENT_URL,
].filter(Boolean);

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    if (allowedOrigins.some((o) => origin === o || origin.endsWith('.vercel.app'))) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(generalLimiter);

// ─── Socket.IO ──────────────────────────────────────────────────────────────
const io = new Server(httpServer, {
  cors: corsOptions,
  transports: ['websocket', 'polling'],
});

// ─── Health Endpoint ─────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/', router);

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ─── Global Error Handler ────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
});

// ─── MongoDB Connection ──────────────────────────────────────────────────────
const MONGODB_URI =
  process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chess-app';

async function connectDB() {
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('[DB] Connected to MongoDB:', MONGODB_URI);
  } catch (err) {
    console.error('[DB] MongoDB connection failed:', err.message);
    process.exit(1);
  }
}

// ─── Socket Handler ───────────────────────────────────────────────────────────
initSocketHandler(io);

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '5000', 10);

async function start() {
  await connectDB();
  httpServer.listen(PORT, () => {
    console.log(
      `[SERVER] Running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`
    );
  });
}

start().catch((err) => {
  console.error('[STARTUP] Fatal error:', err);
  process.exit(1);
});

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('[SERVER] SIGTERM received, shutting down gracefully…');
  await mongoose.disconnect();
  httpServer.close(() => process.exit(0));
});

process.on('SIGINT', async () => {
  console.log('[SERVER] SIGINT received, shutting down gracefully…');
  await mongoose.disconnect();
  httpServer.close(() => process.exit(0));
});

export { io };
