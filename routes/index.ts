import express from "express";

import authRoutes from "./auth";
import employeeRoutes from "./employees";
import storeRoutes from "./store";
import productRoutes from "./product";
import salesRoutes from "./sales";
import dashboardRoutes from "./dashboard";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/employees", employeeRoutes);
router.use("/stores", storeRoutes);
router.use("/products", productRoutes);
router.use("/sales", salesRoutes);
router.use("/dashboard", dashboardRoutes);

export default router;
