import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient;

declare global {
    var __global_prisma__: PrismaClient | undefined;
}

if (process.env.NODE_ENV === "production") {
    prisma = new PrismaClient();
} else {
    if (!global.__global_prisma__) {
        global.__global_prisma__ = new PrismaClient();
    }
    prisma = global.__global_prisma__;
}

export { prisma };