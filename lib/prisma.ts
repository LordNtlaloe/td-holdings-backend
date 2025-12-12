import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { neonConfig } from '@neondatabase/serverless'
import ws from 'ws'
import dotenv from 'dotenv'

dotenv.config()

// IMPORTANT: Set WebSocket constructor for Node.js
neonConfig.webSocketConstructor = ws

const connectionString = process.env.DIRECT_URL

if (!connectionString) {
    throw new Error('DATABASE_URL is not defined')
}

console.log('Initializing database connection...')

if(connectionString){
    console.log('Database connected...')

}
const adapter = new PrismaNeon({ connectionString })

const prisma = new PrismaClient({
    adapter,
    log: ['error', 'warn']
})

export { prisma }