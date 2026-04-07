/*
  Warnings:

  - The values [PURCHASE] on the enum `InventoryChangeType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `CentralInventory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CentralInventoryLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `InventoryAllocation` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "InventoryChangeType_new" AS ENUM ('STOCK_RECEIVED', 'SALE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'RETURN', 'DAMAGE', 'INITIAL_SETUP');
ALTER TABLE "InventoryHistory" ALTER COLUMN "changeType" TYPE "InventoryChangeType_new" USING ("changeType"::text::"InventoryChangeType_new");
ALTER TYPE "InventoryChangeType" RENAME TO "InventoryChangeType_old";
ALTER TYPE "InventoryChangeType_new" RENAME TO "InventoryChangeType";
DROP TYPE "public"."InventoryChangeType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "CentralInventory" DROP CONSTRAINT "CentralInventory_productId_fkey";

-- DropForeignKey
ALTER TABLE "CentralInventoryLog" DROP CONSTRAINT "CentralInventoryLog_centralInventoryId_fkey";

-- DropForeignKey
ALTER TABLE "CentralInventoryLog" DROP CONSTRAINT "CentralInventoryLog_createdBy_fkey";

-- DropForeignKey
ALTER TABLE "InventoryAllocation" DROP CONSTRAINT "InventoryAllocation_allocatedBy_fkey";

-- DropForeignKey
ALTER TABLE "InventoryAllocation" DROP CONSTRAINT "InventoryAllocation_fromStoreId_fkey";

-- DropForeignKey
ALTER TABLE "InventoryAllocation" DROP CONSTRAINT "InventoryAllocation_productId_fkey";

-- DropForeignKey
ALTER TABLE "InventoryAllocation" DROP CONSTRAINT "InventoryAllocation_toStoreId_fkey";

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "description" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rating" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "reviewCount" INTEGER DEFAULT 0;

-- DropTable
DROP TABLE "CentralInventory";

-- DropTable
DROP TABLE "CentralInventoryLog";

-- DropTable
DROP TABLE "InventoryAllocation";

-- DropEnum
DROP TYPE "AllocationStatus";

-- DropEnum
DROP TYPE "AllocationType";

-- DropEnum
DROP TYPE "CentralChangeType";

-- DropEnum
DROP TYPE "SortOrder";

-- CreateTable
CREATE TABLE "ProductReview" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReceipt" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "receivedBy" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplier" TEXT,
    "invoiceNumber" TEXT,
    "costPerUnit" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductReview_productId_idx" ON "ProductReview"("productId");

-- CreateIndex
CREATE INDEX "ProductReview_userId_idx" ON "ProductReview"("userId");

-- CreateIndex
CREATE INDEX "ProductReview_rating_idx" ON "ProductReview"("rating");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReview_productId_userId_key" ON "ProductReview"("productId", "userId");

-- CreateIndex
CREATE INDEX "StockReceipt_productId_idx" ON "StockReceipt"("productId");

-- CreateIndex
CREATE INDEX "StockReceipt_receivedBy_idx" ON "StockReceipt"("receivedBy");

-- CreateIndex
CREATE INDEX "StockReceipt_receivedAt_idx" ON "StockReceipt"("receivedAt");

-- CreateIndex
CREATE INDEX "StockReceipt_invoiceNumber_idx" ON "StockReceipt"("invoiceNumber");

-- CreateIndex
CREATE INDEX "InventoryHistory_changeType_idx" ON "InventoryHistory"("changeType");

-- CreateIndex
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");

-- CreateIndex
CREATE INDEX "StoreProduct_productId_idx" ON "StoreProduct"("productId");

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductReview" ADD CONSTRAINT "ProductReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_receivedBy_fkey" FOREIGN KEY ("receivedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
