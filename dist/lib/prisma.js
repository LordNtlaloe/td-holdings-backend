"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const adapter_neon_1 = require("@prisma/adapter-neon");
const serverless_1 = require("@neondatabase/serverless");
const ws_1 = __importDefault(require("ws"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
serverless_1.neonConfig.webSocketConstructor = ws_1.default;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    throw new Error('DATABASE_URL is not defined');
}
console.log('Initializing database connection...');
const adapter = new adapter_neon_1.PrismaNeon({ connectionString });
const prisma = new client_1.PrismaClient({
    adapter,
    log: ['error', 'warn']
});
exports.prisma = prisma;
//# sourceMappingURL=prisma.js.map