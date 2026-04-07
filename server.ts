import express, { Request, Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import routes from "./routes";

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(helmet());
app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true
}));

// Rate limiting
app.use(rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: "Too many requests from this IP, please try again later."
}));

app.use("/api", routes)

app.get("/", (req: Request, res: Response) => {
    res.json({
        message: "TypeScript Auth API running with Prisma & JWT",
        version: "1.0.0",
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
    res.status(200).json({ status: "OK", uptime: process.uptime() });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: any) => {
    console.error(err.stack);
    res.status(500).json({ error: "Something went wrong!" });
});

// 404 handler
app.use("*", (req: Request, res: Response) => {
    res.status(404).json({ error: "Route not found" });
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});