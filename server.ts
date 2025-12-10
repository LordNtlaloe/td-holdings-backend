import express, { Request, Response, NextFunction } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cors from "cors";
import routes from "./routes";

const app = express();
const PORT = process.env.PORT || 4000;

// ================== Middleware ==================
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Global rate limiter (you already have per-route ones in auth routes too)
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP
    message: "Too many requests from this IP, please try again later.",
  })
);

// ================== Routes ==================
app.use("/api", routes);


// ================== Error Handling ==================

// Global error handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("❌ Global error handler:", err.stack);
  res.status(500).json({ error: "Something went wrong!" });
});

// 404 handler (must come last!)
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" });
});

// ================== Start Server ==================
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  console.log(`📚 Environment: ${process.env.NODE_ENV || "development"}`);
});

export default app;
