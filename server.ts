import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import routes from './routes';
import { errorHandler } from './middleware/error-middleware';
import { rateLimiter } from './middleware/rate-limiter-middleware';
import { prisma } from './lib/prisma';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
const NODE_ENV = process.env.NODE_ENV || 'development';

// ============ SECURITY MIDDLEWARE ============
app.use(helmet({
  contentSecurityPolicy: NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));

// ============ CORS CONFIGURATION ============
const corsOptions = {
  origin: NODE_ENV === 'production'
    ? [FRONTEND_URL]
    : [FRONTEND_URL, 'http://localhost:4000', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  exposedHeaders: ['set-cookie', 'Content-Length', 'X-Total-Count'],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));
// Remove the problematic app.options('*', cors(corsOptions)) line
// CORS is already handled by app.use(cors(corsOptions)) above

// ============ PERFORMANCE MIDDLEWARE ============
app.use(compression());

// ============ REQUEST PARSING ============
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============ LOGGING ============
if (NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else if (NODE_ENV === 'production') {
  app.use(morgan('combined', {
    skip: (req, res) => res.statusCode < 400, // Only log errors in production
  }));
}

// Custom logging middleware
app.use((req, res, next) => {
  if (NODE_ENV === 'development') {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    console.log('Headers:', req.headers);
    console.log('Body:', req.body);
  }
  next();
});

// ============ RATE LIMITING ============
// Apply rate limiting to all routes except health check
app.use('/api', (req, res, next) => {
  if (req.path === '/health') {
    return next();
  }
  return rateLimiter(req, res, next);
});

// ============ HEALTH CHECKS ============
app.get('/health', (req, res) => {
  const healthcheck = {
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    status: 'healthy',
    service: 'inventory-management-api',
    version: process.env.npm_package_version || '1.0.0',
    environment: NODE_ENV,
    database: 'connected', // You can add DB health check here
  };

  res.status(200).json(healthcheck);
});

app.get('/health/readiness', async (req, res) => {
  try {
    // Check database connection
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: 'ready',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        redis: 'connected', // If you use Redis
        // Add other services
      }
    });
  } catch (error) {
    console.error('Readiness check failed:', error);
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: 'Database connection failed'
    });
  }
});

app.get('/health/liveness', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    uptime: process.uptime()
  });
});

// ============ STATIC FILES (if needed) ============
// app.use('/uploads', express.static('uploads'));
// app.use('/public', express.static('public'));

// ============ API ROUTES ============
app.use('/api', routes);

// ============ ERROR HANDLING ============
// 404 Handler
app.use((req, res, next) => {
  res.status(404).json({
    error: 'NOT_FOUND',
    message: `Route ${req.originalUrl} not found`,
    timestamp: new Date().toISOString(),
    path: req.originalUrl,
    method: req.method
  });
});

// Global error handler
app.use(errorHandler);

// ============ GRACEFUL SHUTDOWN ============
const gracefulShutdown = (signal: string) => {
  console.log(`\n${signal} received. Starting graceful shutdown...`);

  // Close server
  server.close(async () => {
    console.log('HTTP server closed');

    // Close database connections
    try {
      await prisma.$disconnect();
      console.log('Database connections closed');
    } catch (error) {
      console.error('Error closing database connections:', error);
    }

    // Close other connections (Redis, etc.)

    console.log('Graceful shutdown completed');
    process.exit(0);
  });

  // Force shutdown after timeout
  setTimeout(() => {
    console.error('Could not close connections in time, forcing shutdown');
    process.exit(1);
  }, 10000);
};

// Listen for shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ============ START SERVER ============
const server = app.listen(PORT, () => {
  console.log(`
  🚀 Server running in ${NODE_ENV} mode
  📡 Port: ${PORT}
  🌐 Frontend: ${FRONTEND_URL}
  📅 Started: ${new Date().toISOString()}
  📊 Health: http://localhost:${PORT}/health
  📚 API Docs: http://localhost:${PORT}/api/docs (if configured)
  `);
});

// Handle server errors
server.on('error', (error: Error & { code?: string }) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  } else {
    console.error('Server error:', error);
    process.exit(1);
  }
});

export default app;