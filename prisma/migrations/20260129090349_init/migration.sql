-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'SUPERVISOR', 'CASHIER', 'WAREHOUSE');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ON_LEAVE', 'TERMINATED');

-- CreateEnum
CREATE TYPE "ReviewPeriod" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('TIRE', 'BALE');

-- CreateEnum
CREATE TYPE "TireCategory" AS ENUM ('NEW', 'SECOND_HAND');

-- CreateEnum
CREATE TYPE "TireUsage" AS ENUM ('FOUR_BY_FOUR', 'REGULAR', 'TRUCK');

-- CreateEnum
CREATE TYPE "ProductGrade" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('MOBILE', 'CASH', 'CARD', 'CREDIT');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InventoryChangeType" AS ENUM ('PURCHASE', 'SALE', 'TRANSFER_OUT', 'TRANSFER_IN', 'ADJUSTMENT', 'RETURN', 'DAMAGE');

-- CreateEnum
CREATE TYPE "CentralChangeType" AS ENUM ('STOCK_RECEIVED', 'ALLOCATED', 'DEALLOCATED', 'ADJUSTMENT', 'DAMAGE', 'RETURN');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AllocationType" AS ENUM ('INITIAL_STOCK', 'RESTOCK', 'TRANSFER', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "SortOrder" AS ENUM ('asc', 'desc');

-- CreateEnum
CREATE TYPE "StoreType" AS ENUM ('MAIN', 'BRANCH', 'OUTLET', 'WAREHOUSE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "lastLogin" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "revoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "replacedById" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "type" "StoreType" NOT NULL DEFAULT 'BRANCH',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "isMainStore" BOOLEAN NOT NULL DEFAULT false,
    "weekdayHours" TEXT NOT NULL DEFAULT '8:00 AM - 6:00 PM',
    "saturdayHours" TEXT DEFAULT '9:00 AM - 4:00 PM',
    "sundayHours" TEXT DEFAULT '10:00 AM - 2:00 PM',
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "distanceInfo" TEXT DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basePrice" DOUBLE PRECISION NOT NULL,
    "type" "ProductType" NOT NULL,
    "grade" "ProductGrade" NOT NULL,
    "commodity" TEXT,
    "tireCategory" "TireCategory",
    "tireUsage" "TireUsage",
    "tireSize" TEXT,
    "loadIndex" TEXT,
    "speedRating" TEXT,
    "warrantyPeriod" TEXT,
    "baleWeight" DOUBLE PRECISION,
    "baleCategory" TEXT,
    "originCountry" TEXT,
    "importDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CentralInventory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "totalQuantity" INTEGER NOT NULL DEFAULT 0,
    "allocated" INTEGER NOT NULL DEFAULT 0,
    "available" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER DEFAULT 50,
    "optimalLevel" INTEGER DEFAULT 200,
    "lastRestockDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CentralInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CentralInventoryLog" (
    "id" TEXT NOT NULL,
    "centralInventoryId" TEXT NOT NULL,
    "changeType" "CentralChangeType" NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "previousTotal" INTEGER NOT NULL,
    "newTotal" INTEGER NOT NULL,
    "previousAllocated" INTEGER NOT NULL,
    "newAllocated" INTEGER NOT NULL,
    "previousAvailable" INTEGER NOT NULL,
    "newAvailable" INTEGER NOT NULL,
    "previousReserved" INTEGER NOT NULL,
    "newReserved" INTEGER NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CentralInventoryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryAllocation" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fromStoreId" TEXT,
    "toStoreId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'PENDING',
    "allocationType" "AllocationType" NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "allocatedBy" TEXT NOT NULL,
    "allocatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "InventoryAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Inventory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER DEFAULT 10,
    "optimalLevel" INTEGER DEFAULT 50,
    "storePrice" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductTransfer" (
    "id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "fromInventoryId" TEXT NOT NULL,
    "toInventoryId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "fromStoreId" TEXT NOT NULL,
    "toStoreId" TEXT NOT NULL,
    "transferredBy" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProductTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryHistory" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "changeType" "InventoryChangeType" NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "previousQuantity" INTEGER NOT NULL,
    "newQuantity" INTEGER NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreProduct" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT,
    "total" DOUBLE PRECISION NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "tax" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentMethod" "PaymentMethodType" NOT NULL,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "customerPhone" TEXT,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleItem" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoidedSale" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "voidedBy" TEXT NOT NULL,
    "reason" TEXT,
    "originalTotal" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoidedSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "hireDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "terminationDate" TIMESTAMP(3),
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeTransfer" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fromStoreId" TEXT NOT NULL,
    "toStoreId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "transferredBy" TEXT NOT NULL,
    "transferDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceReview" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "period" "ReviewPeriod" NOT NULL,
    "score" INTEGER NOT NULL,
    "feedback" TEXT,
    "goals" TEXT[],
    "strengths" TEXT[],
    "areasForImprovement" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_storeId_idx" ON "User"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_tokenHash_idx" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE INDEX "VerificationCode_userId_idx" ON "VerificationCode"("userId");

-- CreateIndex
CREATE INDEX "VerificationCode_code_idx" ON "VerificationCode"("code");

-- CreateIndex
CREATE INDEX "VerificationCode_expiresAt_idx" ON "VerificationCode"("expiresAt");

-- CreateIndex
CREATE INDEX "PasswordReset_userId_idx" ON "PasswordReset"("userId");

-- CreateIndex
CREATE INDEX "PasswordReset_tokenHash_idx" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordReset_expiresAt_idx" ON "PasswordReset"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Store_email_key" ON "Store"("email");

-- CreateIndex
CREATE INDEX "Store_name_idx" ON "Store"("name");

-- CreateIndex
CREATE INDEX "Store_city_idx" ON "Store"("city");

-- CreateIndex
CREATE INDEX "Store_type_idx" ON "Store"("type");

-- CreateIndex
CREATE INDEX "Store_isMainStore_idx" ON "Store"("isMainStore");

-- CreateIndex
CREATE UNIQUE INDEX "Product_name_key" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_type_idx" ON "Product"("type");

-- CreateIndex
CREATE INDEX "Product_grade_idx" ON "Product"("grade");

-- CreateIndex
CREATE INDEX "Product_name_idx" ON "Product"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CentralInventory_productId_key" ON "CentralInventory"("productId");

-- CreateIndex
CREATE INDEX "CentralInventory_productId_idx" ON "CentralInventory"("productId");

-- CreateIndex
CREATE INDEX "CentralInventory_available_idx" ON "CentralInventory"("available");

-- CreateIndex
CREATE INDEX "CentralInventory_totalQuantity_idx" ON "CentralInventory"("totalQuantity");

-- CreateIndex
CREATE INDEX "CentralInventoryLog_centralInventoryId_idx" ON "CentralInventoryLog"("centralInventoryId");

-- CreateIndex
CREATE INDEX "CentralInventoryLog_createdAt_idx" ON "CentralInventoryLog"("createdAt");

-- CreateIndex
CREATE INDEX "CentralInventoryLog_changeType_idx" ON "CentralInventoryLog"("changeType");

-- CreateIndex
CREATE INDEX "CentralInventoryLog_referenceType_referenceId_idx" ON "CentralInventoryLog"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "InventoryAllocation_productId_idx" ON "InventoryAllocation"("productId");

-- CreateIndex
CREATE INDEX "InventoryAllocation_fromStoreId_idx" ON "InventoryAllocation"("fromStoreId");

-- CreateIndex
CREATE INDEX "InventoryAllocation_toStoreId_idx" ON "InventoryAllocation"("toStoreId");

-- CreateIndex
CREATE INDEX "InventoryAllocation_status_idx" ON "InventoryAllocation"("status");

-- CreateIndex
CREATE INDEX "InventoryAllocation_allocatedAt_idx" ON "InventoryAllocation"("allocatedAt");

-- CreateIndex
CREATE INDEX "Inventory_storeId_idx" ON "Inventory"("storeId");

-- CreateIndex
CREATE INDEX "Inventory_productId_idx" ON "Inventory"("productId");

-- CreateIndex
CREATE INDEX "Inventory_quantity_idx" ON "Inventory"("quantity");

-- CreateIndex
CREATE UNIQUE INDEX "Inventory_productId_storeId_key" ON "Inventory"("productId", "storeId");

-- CreateIndex
CREATE INDEX "ProductTransfer_fromInventoryId_idx" ON "ProductTransfer"("fromInventoryId");

-- CreateIndex
CREATE INDEX "ProductTransfer_toInventoryId_idx" ON "ProductTransfer"("toInventoryId");

-- CreateIndex
CREATE INDEX "ProductTransfer_productId_idx" ON "ProductTransfer"("productId");

-- CreateIndex
CREATE INDEX "ProductTransfer_fromStoreId_idx" ON "ProductTransfer"("fromStoreId");

-- CreateIndex
CREATE INDEX "ProductTransfer_toStoreId_idx" ON "ProductTransfer"("toStoreId");

-- CreateIndex
CREATE INDEX "ProductTransfer_status_idx" ON "ProductTransfer"("status");

-- CreateIndex
CREATE INDEX "ProductTransfer_createdAt_idx" ON "ProductTransfer"("createdAt");

-- CreateIndex
CREATE INDEX "InventoryHistory_inventoryId_idx" ON "InventoryHistory"("inventoryId");

-- CreateIndex
CREATE INDEX "InventoryHistory_createdAt_idx" ON "InventoryHistory"("createdAt");

-- CreateIndex
CREATE INDEX "InventoryHistory_referenceType_referenceId_idx" ON "InventoryHistory"("referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "StoreProduct_storeId_idx" ON "StoreProduct"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreProduct_productId_storeId_key" ON "StoreProduct"("productId", "storeId");

-- CreateIndex
CREATE INDEX "Sale_employeeId_idx" ON "Sale"("employeeId");

-- CreateIndex
CREATE INDEX "Sale_storeId_idx" ON "Sale"("storeId");

-- CreateIndex
CREATE INDEX "Sale_createdAt_idx" ON "Sale"("createdAt");

-- CreateIndex
CREATE INDEX "Sale_paymentMethod_idx" ON "Sale"("paymentMethod");

-- CreateIndex
CREATE INDEX "SaleItem_saleId_idx" ON "SaleItem"("saleId");

-- CreateIndex
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleItem_saleId_productId_key" ON "SaleItem"("saleId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "VoidedSale_saleId_key" ON "VoidedSale"("saleId");

-- CreateIndex
CREATE INDEX "VoidedSale_saleId_idx" ON "VoidedSale"("saleId");

-- CreateIndex
CREATE INDEX "VoidedSale_createdAt_idx" ON "VoidedSale"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_storeId_idx" ON "Employee"("storeId");

-- CreateIndex
CREATE INDEX "Employee_role_idx" ON "Employee"("role");

-- CreateIndex
CREATE INDEX "Employee_position_idx" ON "Employee"("position");

-- CreateIndex
CREATE INDEX "Employee_status_idx" ON "Employee"("status");

-- CreateIndex
CREATE INDEX "Employee_hireDate_idx" ON "Employee"("hireDate");

-- CreateIndex
CREATE INDEX "EmployeeTransfer_employeeId_idx" ON "EmployeeTransfer"("employeeId");

-- CreateIndex
CREATE INDEX "EmployeeTransfer_fromStoreId_idx" ON "EmployeeTransfer"("fromStoreId");

-- CreateIndex
CREATE INDEX "EmployeeTransfer_toStoreId_idx" ON "EmployeeTransfer"("toStoreId");

-- CreateIndex
CREATE INDEX "EmployeeTransfer_transferDate_idx" ON "EmployeeTransfer"("transferDate");

-- CreateIndex
CREATE INDEX "PerformanceReview_employeeId_idx" ON "PerformanceReview"("employeeId");

-- CreateIndex
CREATE INDEX "PerformanceReview_reviewerId_idx" ON "PerformanceReview"("reviewerId");

-- CreateIndex
CREATE INDEX "PerformanceReview_createdAt_idx" ON "PerformanceReview"("createdAt");

-- CreateIndex
CREATE INDEX "PerformanceReview_period_idx" ON "PerformanceReview"("period");

-- CreateIndex
CREATE INDEX "ActivityLog_userId_idx" ON "ActivityLog"("userId");

-- CreateIndex
CREATE INDEX "ActivityLog_entityType_entityId_idx" ON "ActivityLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "RefreshToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CentralInventory" ADD CONSTRAINT "CentralInventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CentralInventoryLog" ADD CONSTRAINT "CentralInventoryLog_centralInventoryId_fkey" FOREIGN KEY ("centralInventoryId") REFERENCES "CentralInventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CentralInventoryLog" ADD CONSTRAINT "CentralInventoryLog_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAllocation" ADD CONSTRAINT "InventoryAllocation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAllocation" ADD CONSTRAINT "InventoryAllocation_fromStoreId_fkey" FOREIGN KEY ("fromStoreId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAllocation" ADD CONSTRAINT "InventoryAllocation_toStoreId_fkey" FOREIGN KEY ("toStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryAllocation" ADD CONSTRAINT "InventoryAllocation_allocatedBy_fkey" FOREIGN KEY ("allocatedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTransfer" ADD CONSTRAINT "ProductTransfer_fromInventoryId_fkey" FOREIGN KEY ("fromInventoryId") REFERENCES "Inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTransfer" ADD CONSTRAINT "ProductTransfer_toInventoryId_fkey" FOREIGN KEY ("toInventoryId") REFERENCES "Inventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTransfer" ADD CONSTRAINT "ProductTransfer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTransfer" ADD CONSTRAINT "ProductTransfer_fromStoreId_fkey" FOREIGN KEY ("fromStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTransfer" ADD CONSTRAINT "ProductTransfer_toStoreId_fkey" FOREIGN KEY ("toStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductTransfer" ADD CONSTRAINT "ProductTransfer_transferredBy_fkey" FOREIGN KEY ("transferredBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryHistory" ADD CONSTRAINT "InventoryHistory_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "Inventory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryHistory" ADD CONSTRAINT "InventoryHistory_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProduct" ADD CONSTRAINT "StoreProduct_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreProduct" ADD CONSTRAINT "StoreProduct_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleItem" ADD CONSTRAINT "SaleItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoidedSale" ADD CONSTRAINT "VoidedSale_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTransfer" ADD CONSTRAINT "EmployeeTransfer_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTransfer" ADD CONSTRAINT "EmployeeTransfer_fromStoreId_fkey" FOREIGN KEY ("fromStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTransfer" ADD CONSTRAINT "EmployeeTransfer_toStoreId_fkey" FOREIGN KEY ("toStoreId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeTransfer" ADD CONSTRAINT "EmployeeTransfer_transferredBy_fkey" FOREIGN KEY ("transferredBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceReview" ADD CONSTRAINT "PerformanceReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
