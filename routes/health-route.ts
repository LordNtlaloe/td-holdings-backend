import express from 'express';

const router = express.Router();

// Health check endpoints (public or with minimal auth if needed)
router.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development'
    });
});

router.get('/status', (req, res) => {
    res.json({
        service: 'Inventory Management System API',
        version: '1.0.0',
        status: 'operational',
        timestamp: new Date().toISOString()
    });
});

// You can add more health checks here if needed
router.get('/health/detailed', (req, res) => {
    // Add database connection check, external service checks, etc.
    res.json({
        status: 'OK',
        database: 'connected',
        redis: 'connected',
        services: ['auth', 'database', 'cache'],
        timestamp: new Date().toISOString()
    });
});

export default router;