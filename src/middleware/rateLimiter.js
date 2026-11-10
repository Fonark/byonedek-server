import rateLimit from 'express-rate-limit';

/**
 * General API rate limiter.
 * Allows up to 100 requests per 15-minute window per IP.
 */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,  // Return rate-limit info in the `RateLimit-*` headers
  legacyHeaders: false,    // Disable the `X-RateLimit-*` headers
  message: {
    error: 'Too many requests from this IP, please try again after 15 minutes.',
  },
  skip: (req) => req.path === '/health', // Don't rate-limit health checks
});

/**
 * Socket event rate limiter configuration.
 * This object can be used to configure per-socket rate limiting in socket handlers.
 */
export const socketLimiterConfig = {
  maxEventsPerSecond: 10,
  maxMoveEventsPerSecond: 5,
  windowMs: 1000,
};
