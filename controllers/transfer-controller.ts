import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { FilterBuilder } from "../lib/filters";
import { generatePagination, generateMeta } from "../helpers";
import { Prisma } from "../prisma/generated/client";

export const getTransfers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      sortBy, 
      sortOrder, 
      search,
      fromStoreId,
      toStoreId,
      productId,
      status,
      startDate,
      endDate 
    } = req.query;
    
    const { skip, take } = generatePagination(Number(page), Number(limit));

    const filterBuilder = new FilterBuilder()
      .where(search as string, ['reason', 'notes'])
      .status(fromStoreId as string, 'fromStoreId')
      .status(toStoreId as string, 'toStoreId')
      .product(productId as string)
      .status(status as string, 'status')
      .dateRange({ startDate: startDate as string, endDate: endDate as string })
      .includeWithDetails()
      .order(sortBy as string, sortOrder as 'asc' | 'desc');

    const filters = filterBuilder.build();

    const [transfers, total] = await Promise.all([
      prisma.productTransfer.findMany({
        ...filters,
        skip,
        take,
        include: {
          product: true,
          fromStore: true,
          toStore: true,
          fromInventory: {
            include: { store: true }
          },
          toInventory: {
            include: { store: true }
          },
          transferredByUser: {
            select: {
              firstName: true,
              lastName: true,
              email: true
            }
          }
        }
      }),
      prisma.productTransfer.count({ where: filters.where })
    ]);

    res.json({
      data: transfers,
      meta: generateMeta(total, Number(page), Number(limit))
    });
  } catch (error) {
    console.error("Get transfers error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getTransferById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Ensure id is a string (not string[])
    const transferId = Array.isArray(id) ? id[0] : id;

    const transfer = await prisma.productTransfer.findUnique({
      where: { id: transferId },
      include: {
        product: true,
        fromStore: true,
        toStore: true,
        fromInventory: {
          include: { store: true, product: true }
        },
        toInventory: {
          include: { store: true, product: true }
        },
        transferredByUser: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            role: true
          }
        }
      }
    });

    if (!transfer) {
      res.status(404).json({ error: "Transfer not found" });
      return;
    }

    // Get related inventory histories
    const histories = await prisma.inventoryHistory.findMany({
      where: {
        OR: [
          { referenceId: transferId, referenceType: 'TRANSFER_OUT' },
          { referenceId: transferId, referenceType: 'TRANSFER_IN' }
        ]
      },
      include: {
        inventory: {
          include: {
            store: true,
            product: true
          }
        },
        user: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      transfer,
      histories
    });
  } catch (error) {
    console.error("Get transfer error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const createTransfer = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      productId,
      fromStoreId,
      toStoreId,
      quantity,
      reason,
      notes
    } = req.body;

    if (!productId || !fromStoreId || !toStoreId || !quantity || quantity <= 0) {
      res.status(400).json({ 
        error: "Product ID, from store ID, to store ID, and positive quantity are required" 
      });
      return;
    }

    if (fromStoreId === toStoreId) {
      res.status(400).json({ error: "Cannot transfer to the same store" });
      return;
    }

    // Validate stores and product
    const [fromStore, toStore, product] = await Promise.all([
      prisma.store.findUnique({ where: { id: fromStoreId } }),
      prisma.store.findUnique({ where: { id: toStoreId } }),
      prisma.product.findUnique({ where: { id: productId } })
    ]);

    if (!fromStore) {
      res.status(404).json({ error: "From store not found" });
      return;
    }

    if (!toStore) {
      res.status(404).json({ error: "To store not found" });
      return;
    }

    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    // Check source inventory
    const fromInventory = await prisma.inventory.findUnique({
      where: {
        productId_storeId: {
          productId,
          storeId: fromStoreId
        }
      }
    });

    if (!fromInventory) {
      res.status(400).json({ error: "Product not available in source store" });
      return;
    }

    if (fromInventory.quantity < quantity) {
      res.status(400).json({ 
        error: `Insufficient stock in source store. Available: ${fromInventory.quantity}, Requested: ${quantity}` 
      });
      return;
    }

    // Get or create destination inventory
    let toInventory = await prisma.inventory.findUnique({
      where: {
        productId_storeId: {
          productId,
          storeId: toStoreId
        }
      }
    });

    if (!toInventory) {
      toInventory = await prisma.inventory.create({
        data: {
          productId,
          storeId: toStoreId,
          quantity: 0
        }
      });
    }

    // Process transfer in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create transfer record
      const transfer = await tx.productTransfer.create({
        data: {
          productId,
          fromInventoryId: fromInventory.id,
          toInventoryId: toInventory.id,
          fromStoreId,
          toStoreId,
          quantity,
          transferredBy: (req as any).user?.id,
          status: 'PENDING',
          reason: reason || '',
          notes: notes || ''
        }
      });

      // Update source inventory
      await tx.inventory.update({
        where: { id: fromInventory.id },
        data: { quantity: { decrement: quantity } }
      });

      // Create source inventory history
      await tx.inventoryHistory.create({
        data: {
          inventoryId: fromInventory.id,
          changeType: 'TRANSFER_OUT',
          quantityChange: -quantity,
          previousQuantity: fromInventory.quantity,
          newQuantity: fromInventory.quantity - quantity,
          referenceId: transfer.id,
          referenceType: 'TRANSFER_OUT',
          notes: `Transfer to ${toStore.name}`,
          createdBy: (req as any).user?.id
        }
      });

      // Update destination inventory
      await tx.inventory.update({
        where: { id: toInventory.id },
        data: { quantity: { increment: quantity } }
      });

      // Create destination inventory history
      await tx.inventoryHistory.create({
        data: {
          inventoryId: toInventory.id,
          changeType: 'TRANSFER_IN',
          quantityChange: quantity,
          previousQuantity: toInventory.quantity,
          newQuantity: toInventory.quantity + quantity,
          referenceId: transfer.id,
          referenceType: 'TRANSFER_IN',
          notes: `Transfer from ${fromStore.name}`,
          createdBy: (req as any).user?.id
        }
      });

      return transfer;
    });

    // Create activity log
    await prisma.activityLog.create({
      data: {
        userId: (req as any).user?.id,
        action: 'TRANSFER_CREATED',
        entityType: 'TRANSFER',
        entityId: result.id,
        details: {
          productId,
          fromStoreId,
          toStoreId,
          quantity,
          reason
        }
      }
    });

    res.status(201).json({
      message: "Transfer created successfully",
      transfer: result
    });
  } catch (error) {
    console.error("Create transfer error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const updateTransferStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    // Ensure id is a string (not string[])
    const transferId = Array.isArray(id) ? id[0] : id;

    if (!status || !['COMPLETED', 'IN_TRANSIT', 'CANCELLED', 'REJECTED'].includes(status)) {
      res.status(400).json({ 
        error: "Valid status (COMPLETED, IN_TRANSIT, CANCELLED, REJECTED) is required" 
      });
      return;
    }

    const transfer = await prisma.productTransfer.findUnique({
      where: { id: transferId },
      include: {
        product: true,
        fromStore: true,
        toStore: true
      }
    });

    if (!transfer) {
      res.status(404).json({ error: "Transfer not found" });
      return;
    }

    // If cancelling a pending transfer, reverse the inventory changes
    if (status === 'CANCELLED' && transfer.status === 'PENDING') {
      await prisma.$transaction(async (tx) => {
        // Reverse source inventory
        await tx.inventory.update({
          where: { id: transfer.fromInventoryId },
          data: { quantity: { increment: transfer.quantity } }
        });

        // Reverse destination inventory
        await tx.inventory.update({
          where: { id: transfer.toInventoryId },
          data: { quantity: { decrement: transfer.quantity } }
        });

        // Update transfer status
        await tx.productTransfer.update({
          where: { id: transferId },
          data: { 
            status: 'CANCELLED',
            cancelledAt: new Date(),
            notes: notes || transfer.notes
          } as any // Use type assertion to handle cancelledAt
        });
      });
    } else if (status === 'COMPLETED' && transfer.status !== 'COMPLETED') {
      // Mark as completed
      await prisma.productTransfer.update({
        where: { id: transferId },
        data: { 
          status: 'COMPLETED',
          completedAt: new Date(),
          notes: notes || transfer.notes
        } as any // Use type assertion to handle completedAt
      });
    } else {
      // Update status only
      await prisma.productTransfer.update({
        where: { id: transferId },
        data: { 
          status: status as any,
          notes: notes || transfer.notes
        }
      });
    }

    // Create activity log
    await prisma.activityLog.create({
      data: {
        userId: (req as any).user?.id,
        action: 'TRANSFER_STATUS_UPDATED',
        entityType: 'TRANSFER',
        entityId: transferId,
        details: { 
          previousStatus: transfer.status,
          newStatus: status,
          notes
        }
      }
    });

    res.json({ 
      message: `Transfer ${status.toLowerCase()} successfully`,
      transfer: await prisma.productTransfer.findUnique({ where: { id: transferId } })
    });
  } catch (error) {
    console.error("Update transfer status error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getPendingTransfers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeId } = req.query;

    const where: any = { status: 'PENDING' };
    if (storeId) {
      where.OR = [
        { fromStoreId: storeId as string },
        { toStoreId: storeId as string }
      ];
    }

    const pendingTransfers = await prisma.productTransfer.findMany({
      where,
      include: {
        product: true,
        fromStore: true,
        toStore: true,
        transferredByUser: {
          select: {
            firstName: true,
            lastName: true
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    // Group by store
    const groupedByStore = pendingTransfers.reduce((acc, transfer) => {
      const key = `${transfer.fromStore.name} → ${transfer.toStore.name}`;
      if (!acc[key]) {
        acc[key] = {
          fromStore: transfer.fromStore,
          toStore: transfer.toStore,
          transfers: [],
          totalItems: 0,
          totalQuantity: 0
        };
      }
      acc[key].transfers.push(transfer);
      acc[key].totalItems++;
      acc[key].totalQuantity += transfer.quantity;
      return acc;
    }, {} as Record<string, any>);

    res.json({
      total: pendingTransfers.length,
      groupedByStore,
      transfers: pendingTransfers
    });
  } catch (error) {
    console.error("Get pending transfers error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getTransferReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      storeId, 
      productId, 
      startDate, 
      endDate,
      groupBy = 'day' // day, week, month, product, store
    } = req.query;

    const where: any = {};

    if (storeId) {
      where.OR = [
        { fromStoreId: storeId as string },
        { toStoreId: storeId as string }
      ];
    }
    if (productId) where.productId = productId as string;
    
    // Date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    let reportData: any;

    switch (groupBy) {
      case 'day':
        reportData = await prisma.$queryRaw`
          SELECT 
            DATE("createdAt") as date,
            COUNT(*) as transfer_count,
            SUM(quantity) as total_quantity,
            COUNT(DISTINCT "productId") as unique_products,
            COUNT(DISTINCT "fromStoreId") as source_stores,
            COUNT(DISTINCT "toStoreId") as destination_stores,
            SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END) as cancelled
          FROM "ProductTransfer"
          WHERE ${productId ? Prisma.sql`"productId" = ${productId}` : Prisma.sql`1=1`}
            AND ${startDate ? Prisma.sql`"createdAt" >= ${new Date(startDate as string)}` : Prisma.sql`1=1`}
            AND ${endDate ? Prisma.sql`"createdAt" <= ${new Date(endDate as string)}` : Prisma.sql`1=1`}
            AND ${storeId ? Prisma.sql`("fromStoreId" = ${storeId} OR "toStoreId" = ${storeId})` : Prisma.sql`1=1`}
          GROUP BY DATE("createdAt")
          ORDER BY date DESC
        `;
        break;

      case 'product':
        reportData = await prisma.$queryRaw`
          SELECT 
            p.id,
            p.name,
            p.type,
            p.grade,
            COUNT(pt.id) as transfer_count,
            SUM(pt.quantity) as total_quantity,
            COUNT(DISTINCT pt."fromStoreId") as source_stores,
            COUNT(DISTINCT pt."toStoreId") as destination_stores,
            AVG(pt.quantity) as avg_transfer_size,
            SUM(CASE WHEN pt.status = 'COMPLETED' THEN pt.quantity ELSE 0 END) as completed_quantity,
            SUM(CASE WHEN pt.status = 'PENDING' THEN pt.quantity ELSE 0 END) as pending_quantity
          FROM "ProductTransfer" pt
          JOIN "Product" p ON p.id = pt."productId"
          WHERE ${productId ? Prisma.sql`pt."productId" = ${productId}` : Prisma.sql`1=1`}
            AND ${startDate ? Prisma.sql`pt."createdAt" >= ${new Date(startDate as string)}` : Prisma.sql`1=1`}
            AND ${endDate ? Prisma.sql`pt."createdAt" <= ${new Date(endDate as string)}` : Prisma.sql`1=1`}
            AND ${storeId ? Prisma.sql`(pt."fromStoreId" = ${storeId} OR pt."toStoreId" = ${storeId})` : Prisma.sql`1=1`}
          GROUP BY p.id, p.name, p.type, p.grade
          ORDER BY total_quantity DESC
        `;
        break;

      case 'store':
        reportData = await prisma.$queryRaw`
          SELECT 
            s.id,
            s.name,
            s.location,
            SUM(CASE WHEN pt."fromStoreId" = s.id THEN 1 ELSE 0 END) as outgoing_count,
            SUM(CASE WHEN pt."fromStoreId" = s.id THEN pt.quantity ELSE 0 END) as outgoing_quantity,
            SUM(CASE WHEN pt."toStoreId" = s.id THEN 1 ELSE 0 END) as incoming_count,
            SUM(CASE WHEN pt."toStoreId" = s.id THEN pt.quantity ELSE 0 END) as incoming_quantity,
            COUNT(DISTINCT CASE WHEN pt."fromStoreId" = s.id THEN pt."productId" END) as outgoing_products,
            COUNT(DISTINCT CASE WHEN pt."toStoreId" = s.id THEN pt."productId" END) as incoming_products
          FROM "ProductTransfer" pt
          JOIN "Store" s ON s.id IN (pt."fromStoreId", pt."toStoreId")
          WHERE ${productId ? Prisma.sql`pt."productId" = ${productId}` : Prisma.sql`1=1`}
            AND ${startDate ? Prisma.sql`pt."createdAt" >= ${new Date(startDate as string)}` : Prisma.sql`1=1`}
            AND ${endDate ? Prisma.sql`pt."createdAt" <= ${new Date(endDate as string)}` : Prisma.sql`1=1`}
            AND ${storeId ? Prisma.sql`(pt."fromStoreId" = ${storeId} OR pt."toStoreId" = ${storeId})` : Prisma.sql`1=1`}
          GROUP BY s.id, s.name, s.location
          ORDER BY (outgoing_quantity + incoming_quantity) DESC
        `;
        break;

      default:
        // Store-to-store matrix
        reportData = await prisma.$queryRaw`
          SELECT 
            fs.name as from_store,
            ts.name as to_store,
            COUNT(pt.id) as transfer_count,
            SUM(pt.quantity) as total_quantity,
            COUNT(DISTINCT pt."productId") as unique_products,
            AVG(pt.quantity) as avg_transfer_size,
            MIN(pt."createdAt") as first_transfer,
            MAX(pt."createdAt") as last_transfer
          FROM "ProductTransfer" pt
          JOIN "Store" fs ON fs.id = pt."fromStoreId"
          JOIN "Store" ts ON ts.id = pt."toStoreId"
          WHERE ${productId ? Prisma.sql`pt."productId" = ${productId}` : Prisma.sql`1=1`}
            AND ${startDate ? Prisma.sql`pt."createdAt" >= ${new Date(startDate as string)}` : Prisma.sql`1=1`}
            AND ${endDate ? Prisma.sql`pt."createdAt" <= ${new Date(endDate as string)}` : Prisma.sql`1=1`}
            AND ${storeId ? Prisma.sql`(pt."fromStoreId" = ${storeId} OR pt."toStoreId" = ${storeId})` : Prisma.sql`1=1`}
          GROUP BY fs.name, ts.name
          ORDER BY total_quantity DESC
        `;
    }

    // Get summary statistics
    const summary = await prisma.productTransfer.aggregate({
      where,
      _sum: { quantity: true },
      _count: true,
      _avg: { quantity: true }
    });

    const statusSummary = await prisma.productTransfer.groupBy({
      by: ['status'],
      where,
      _count: true,
      _sum: { quantity: true }
    });

    res.json({
      report: reportData,
      summary: {
        totalTransfers: summary._count,
        totalQuantity: summary._sum.quantity || 0,
        averageQuantity: summary._avg.quantity || 0,
        statusBreakdown: statusSummary.reduce((acc, item) => {
          acc[item.status] = {
            count: item._count,
            quantity: item._sum.quantity || 0
          };
          return acc;
        }, {} as Record<string, any>)
      },
      parameters: {
        storeId,
        productId,
        groupBy,
        dateRange: {
          start: startDate || 'N/A',
          end: endDate || 'N/A'
        }
      }
    });
  } catch (error) {
    console.error("Get transfer report error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const bulkCreateTransfers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { transfers } = req.body; // Array of transfer objects

    if (!Array.isArray(transfers) || transfers.length === 0) {
      res.status(400).json({ error: "Transfers array is required" });
      return;
    }

    const results = await prisma.$transaction(async (tx) => {
      const createdTransfers = [];

      for (const transferData of transfers) {
        const {
          productId,
          fromStoreId,
          toStoreId,
          quantity,
          reason,
          notes
        } = transferData;

        // Validate
        if (!productId || !fromStoreId || !toStoreId || !quantity || quantity <= 0) {
          continue; // Skip invalid transfers
        }

        if (fromStoreId === toStoreId) {
          continue; // Skip same-store transfers
        }

        // Check source inventory
        const fromInventory = await tx.inventory.findUnique({
          where: {
            productId_storeId: {
              productId,
              storeId: fromStoreId
            }
          }
        });

        if (!fromInventory || fromInventory.quantity < quantity) {
          continue; // Skip if insufficient stock
        }

        // Get or create destination inventory
        let toInventory = await tx.inventory.findUnique({
          where: {
            productId_storeId: {
              productId,
              storeId: toStoreId
            }
          }
        });

        if (!toInventory) {
          toInventory = await tx.inventory.create({
            data: {
              productId,
              storeId: toStoreId,
              quantity: 0
            }
          });
        }

        // Create transfer
        const transfer = await tx.productTransfer.create({
          data: {
            productId,
            fromInventoryId: fromInventory.id,
            toInventoryId: toInventory.id,
            fromStoreId,
            toStoreId,
            quantity,
            transferredBy: (req as any).user?.id,
            status: 'PENDING',
            reason: reason || '',
            notes: notes || ''
          }
        });

        // Update inventories
        await tx.inventory.update({
          where: { id: fromInventory.id },
          data: { quantity: { decrement: quantity } }
        });

        await tx.inventory.update({
          where: { id: toInventory.id },
          data: { quantity: { increment: quantity } }
        });

        // Create history records
        await tx.inventoryHistory.create({
          data: {
            inventoryId: fromInventory.id,
            changeType: 'TRANSFER_OUT',
            quantityChange: -quantity,
            previousQuantity: fromInventory.quantity,
            newQuantity: fromInventory.quantity - quantity,
            referenceId: transfer.id,
            referenceType: 'TRANSFER_OUT',
            notes: `Bulk transfer to ${toStoreId}`,
            createdBy: (req as any).user?.id
          }
        });

        await tx.inventoryHistory.create({
          data: {
            inventoryId: toInventory.id,
            changeType: 'TRANSFER_IN',
            quantityChange: quantity,
            previousQuantity: toInventory.quantity,
            newQuantity: toInventory.quantity + quantity,
            referenceId: transfer.id,
            referenceType: 'TRANSFER_IN',
            notes: `Bulk transfer from ${fromStoreId}`,
            createdBy: (req as any).user?.id
          }
        });

        createdTransfers.push(transfer);
      }

      return createdTransfers;
    });

    // Create activity log
    await prisma.activityLog.create({
      data: {
        userId: (req as any).user?.id,
        action: 'BULK_TRANSFERS_CREATED',
        entityType: 'TRANSFER',
        entityId: 'multiple',
        details: { 
          attempted: transfers.length,
          successful: results.length,
          failed: transfers.length - results.length
        }
      }
    });

    res.status(201).json({
      message: `Created ${results.length} transfers successfully`,
      results,
      summary: {
        attempted: transfers.length,
        successful: results.length,
        failed: transfers.length - results.length
      }
    });
  } catch (error) {
    console.error("Bulk create transfers error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};