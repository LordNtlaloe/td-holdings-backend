import { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { FilterBuilder } from "../lib/filters";
import { generatePagination, generateMeta, calculateSalesMetrics } from "../helpers";
import { Prisma } from "../prisma/generated/client";

// Types for raw query results
interface DailyTrendItem {
  date: Date;
  sales_count: number;
  total_revenue: number;
  avg_sale_amount: number;
  active_employees: number;
  unique_customers: number;
  total_tax: number;
}

interface TopProductItem {
  id: string;
  name: string;
  type: string;
  grade: string;
  total_quantity: number;
  total_revenue: number;
  sales_count: number;
  avg_price: number;
}

interface TopEmployeeItem {
  id: string;
  employee_name: string;
  position: string;
  sales_count: number;
  total_revenue: number;
  avg_sale_amount: number;
  unique_customers: number;
}

interface PaymentDistributionItem {
  paymentMethod: string;
  transaction_count: number;
  total_revenue: number;
  avg_transaction: number;
}

export const getSales = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 20,
      sortBy,
      sortOrder,
      search,
      storeId,
      employeeId,
      paymentMethod,
      minTotal,
      maxTotal,
      startDate,
      endDate
    } = req.query;

    const { skip, take } = generatePagination(Number(page), Number(limit));

    const filterBuilder = new FilterBuilder()
      .where(search as string, ['customerName', 'customerEmail', 'customerPhone'])
      .store(storeId as string)
      .employee(employeeId as string)
      .salesFilters({
        minTotal: minTotal ? Number(minTotal) : undefined,
        maxTotal: maxTotal ? Number(maxTotal) : undefined,
        paymentMethod: paymentMethod as string
      })
      .dateRange({ startDate: startDate as string, endDate: endDate as string })
      .includeWithDetails()
      .order(sortBy as string, sortOrder as 'asc' | 'desc');

    const filters = filterBuilder.build();

    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        ...filters,
        skip,
        take,
        include: {
          employee: {
            include: { user: true }
          },
          store: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true
            }
          },
          saleItems: {
            include: { product: true }
          },
          voidedSale: true
        }
      }),
      prisma.sale.count({ where: filters.where })
    ]);

    // Calculate metrics
    const metrics = calculateSalesMetrics(sales);

    res.json({
      data: sales,
      metrics,
      meta: generateMeta(total, Number(page), Number(limit))
    });
  } catch (error) {
    console.error("Get sales error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getSaleById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    // Ensure id is a string (not string[])
    const saleId = Array.isArray(id) ? id[0] : id;

    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        employee: {
          include: { user: true }
        },
        store: true,
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            role: true
          }
        },
        saleItems: {
          include: { product: true }
        },
        voidedSale: true
      }
    });

    if (!sale) {
      res.status(404).json({ error: "Sale not found" });
      return;
    }

    res.json(sale);
  } catch (error) {
    console.error("Get sale error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const createSale = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      employeeId,
      storeId,
      userId,
      subtotal,
      tax,
      total,
      paymentMethod,
      customerName,
      customerEmail,
      customerPhone,
      items // Array of { productId, quantity, price }
    } = req.body;

    if (!employeeId || !storeId || !subtotal || !tax || !total || !paymentMethod || !items || !Array.isArray(items)) {
      res.status(400).json({
        error: "Employee ID, store ID, subtotal, tax, total, payment method, and items are required"
      });
      return;
    }

    // Validate employee and store
    const [employee, store] = await Promise.all([
      prisma.employee.findUnique({
        where: { id: employeeId },
        include: { store: true }
      }),
      prisma.store.findUnique({ where: { id: storeId } })
    ]);

    if (!employee) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    if (!store) {
      res.status(404).json({ error: "Store not found" });
      return;
    }

    // Check if employee belongs to the store
    if (employee.storeId !== storeId) {
      res.status(400).json({ error: "Employee does not belong to the specified store" });
      return;
    }

    // Validate all items and check inventory
    const inventoryChecks = await Promise.all(
      items.map(async (item: any) => {
        const inventory = await prisma.inventory.findUnique({
          where: {
            productId_storeId: {
              productId: item.productId,
              storeId
            }
          }
        });

        if (!inventory) {
          throw new Error(`Product ${item.productId} not found in store inventory`);
        }

        if (inventory.quantity < item.quantity) {
          throw new Error(`Insufficient stock for product ${item.productId}. Available: ${inventory.quantity}, Requested: ${item.quantity}`);
        }

        return { item, inventory };
      })
    );

    // Process sale in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create sale
      const sale = await tx.sale.create({
        data: {
          employeeId,
          storeId,
          userId: userId || (req as any).user?.id,
          subtotal: Number(subtotal),
          tax: Number(tax),
          total: Number(total),
          paymentMethod: paymentMethod as any,
          customerName,
          customerEmail,
          customerPhone
        }
      });

      // Create sale items and update inventory
      const saleItems = await Promise.all(
        items.map(async (item: any) => {
          const saleItem = await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: item.productId,
              quantity: item.quantity,
              price: item.price
            }
          });

          // Update inventory
          await tx.inventory.update({
            where: {
              productId_storeId: {
                productId: item.productId,
                storeId
              }
            },
            data: {
              quantity: { decrement: item.quantity }
            }
          });

          // Create inventory history
          await tx.inventoryHistory.create({
            data: {
              inventoryId: (await tx.inventory.findUnique({
                where: {
                  productId_storeId: {
                    productId: item.productId,
                    storeId
                  }
                }
              }))!.id,
              changeType: 'SALE',
              quantityChange: -item.quantity,
              previousQuantity: (await tx.inventory.findUnique({
                where: {
                  productId_storeId: {
                    productId: item.productId,
                    storeId
                  }
                }
              }))!.quantity + item.quantity,
              newQuantity: (await tx.inventory.findUnique({
                where: {
                  productId_storeId: {
                    productId: item.productId,
                    storeId
                  }
                }
              }))!.quantity,
              referenceId: sale.id,
              referenceType: 'SALE',
              notes: `Sale #${sale.id}`,
              createdBy: (req as any).user?.id
            }
          });

          return saleItem;
        })
      );

      return { sale, saleItems };
    });

    // Create activity log
    await prisma.activityLog.create({
      data: {
        userId: (req as any).user?.id,
        action: 'SALE_CREATED',
        entityType: 'SALE',
        entityId: result.sale.id,
        details: {
          storeId,
          employeeId,
          total,
          paymentMethod,
          itemCount: items.length
        }
      }
    });

    res.status(201).json({
      message: "Sale created successfully",
      sale: result.sale,
      items: result.saleItems
    });
  } catch (error: any) {
    console.error("Create sale error:", error);
    if (error.message.includes('Insufficient stock') || error.message.includes('not found in store inventory')) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
  }
};

export const voidSale = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      res.status(400).json({ error: "Reason is required for voiding sale" });
      return;
    }

    // Ensure id is a string (not string[])
    const saleId = Array.isArray(id) ? id[0] : id;

    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        saleItems: {
          include: { product: true }
        },
        voidedSale: true
      }
    });

    if (!sale) {
      res.status(404).json({ error: "Sale not found" });
      return;
    }

    if ((sale as any).voidedSale) {
      res.status(400).json({ error: "Sale is already voided" });
      return;
    }

    // Process void in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Restore inventory for each item
      await Promise.all(
        (sale as any).saleItems.map(async (item: any) => {
          await tx.inventory.update({
            where: {
              productId_storeId: {
                productId: item.productId,
                storeId: sale.storeId
              }
            },
            data: {
              quantity: { increment: item.quantity }
            }
          });

          // Create inventory history for restoration
          await tx.inventoryHistory.create({
            data: {
              inventoryId: (await tx.inventory.findUnique({
                where: {
                  productId_storeId: {
                    productId: item.productId,
                    storeId: sale.storeId
                  }
                }
              }))!.id,
              changeType: 'RETURN',
              quantityChange: item.quantity,
              previousQuantity: (await tx.inventory.findUnique({
                where: {
                  productId_storeId: {
                    productId: item.productId,
                    storeId: sale.storeId
                  }
                }
              }))!.quantity - item.quantity,
              newQuantity: (await tx.inventory.findUnique({
                where: {
                  productId_storeId: {
                    productId: item.productId,
                    storeId: sale.storeId
                  }
                }
              }))!.quantity,
              referenceId: sale.id,
              referenceType: 'VOID_SALE',
              notes: `Sale #${sale.id} voided`,
              createdBy: (req as any).user?.id
            }
          });
        })
      );

      // Create voided sale record
      const voidedSale = await tx.voidedSale.create({
        data: {
          saleId: saleId,
          voidedBy: (req as any).user?.id,
          reason,
          originalTotal: sale.total
        }
      });

      return voidedSale;
    });

    // Create activity log
    await prisma.activityLog.create({
      data: {
        userId: (req as any).user?.id,
        action: 'SALE_VOIDED',
        entityType: 'SALE',
        entityId: saleId,
        details: {
          reason,
          originalTotal: sale.total,
          itemCount: (sale as any).saleItems.length
        }
      }
    });

    res.json({
      message: "Sale voided successfully",
      voidedSale: result
    });
  } catch (error) {
    console.error("Void sale error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getSalesReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      storeId,
      employeeId,
      paymentMethod,
      startDate,
      endDate,
      groupBy = 'day' // day, week, month, year, product, employee, store
    } = req.query;

    const where: any = {};

    if (storeId) where.storeId = storeId;
    if (employeeId) where.employeeId = employeeId;
    if (paymentMethod) where.paymentMethod = paymentMethod;

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
            COUNT(*) as sales_count,
            SUM(total) as total_revenue,
            SUM(subtotal) as total_subtotal,
            SUM(tax) as total_tax,
            AVG(total) as avg_sale_amount,
            COUNT(DISTINCT "employeeId") as active_employees,
            COUNT(DISTINCT "customerName") as unique_customers
          FROM "Sale"
          WHERE ${storeId ? Prisma.sql`"storeId" = ${storeId}` : Prisma.sql`1=1`}
            AND ${employeeId ? Prisma.sql`"employeeId" = ${employeeId}` : Prisma.sql`1=1`}
            AND ${paymentMethod ? Prisma.sql`"paymentMethod" = ${paymentMethod}` : Prisma.sql`1=1`}
            AND ${startDate ? Prisma.sql`"createdAt" >= ${new Date(startDate as string)}` : Prisma.sql`1=1`}
            AND ${endDate ? Prisma.sql`"createdAt" <= ${new Date(endDate as string)}` : Prisma.sql`1=1`}
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
            COUNT(DISTINCT s.id) as sales_count,
            SUM(si.quantity) as total_quantity,
            SUM(si.quantity * si.price) as total_revenue,
            AVG(si.price) as avg_price,
            COUNT(DISTINCT s."storeId") as stores_sold,
            COUNT(DISTINCT s."employeeId") as employees_sold
          FROM "SaleItem" si
          JOIN "Product" p ON p.id = si."productId"
          JOIN "Sale" s ON s.id = si."saleId"
          WHERE ${storeId ? Prisma.sql`s."storeId" = ${storeId}` : Prisma.sql`1=1`}
            AND ${employeeId ? Prisma.sql`s."employeeId" = ${employeeId}` : Prisma.sql`1=1`}
            AND ${startDate ? Prisma.sql`s."createdAt" >= ${new Date(startDate as string)}` : Prisma.sql`1=1`}
            AND ${endDate ? Prisma.sql`s."createdAt" <= ${new Date(endDate as string)}` : Prisma.sql`1=1`}
          GROUP BY p.id, p.name, p.type, p.grade
          ORDER BY total_revenue DESC
        `;
        break;

      case 'employee':
        reportData = await prisma.$queryRaw`
          SELECT 
            e.id,
            u."firstName" || ' ' || u."lastName" as employee_name,
            e.position,
            e.role,
            COUNT(s.id) as sales_count,
            SUM(s.total) as total_revenue,
            AVG(s.total) as avg_sale_amount,
            SUM(s.tax) as total_tax_collected,
            COUNT(DISTINCT s."customerName") as unique_customers,
            MIN(s."createdAt") as first_sale,
            MAX(s."createdAt") as last_sale
          FROM "Sale" s
          JOIN "Employee" e ON e.id = s."employeeId"
          JOIN "User" u ON u.id = e."userId"
          WHERE ${storeId ? Prisma.sql`s."storeId" = ${storeId}` : Prisma.sql`1=1`}
            AND ${employeeId ? Prisma.sql`s."employeeId" = ${employeeId}` : Prisma.sql`1=1`}
            AND ${startDate ? Prisma.sql`s."createdAt" >= ${new Date(startDate as string)}` : Prisma.sql`1=1`}
            AND ${endDate ? Prisma.sql`s."createdAt" <= ${new Date(endDate as string)}` : Prisma.sql`1=1`}
          GROUP BY e.id, u."firstName", u."lastName", e.position, e.role
          ORDER BY total_revenue DESC
        `;
        break;

      case 'store':
        reportData = await prisma.$queryRaw`
          SELECT 
            st.id,
            st.name,
            st.location,
            COUNT(s.id) as sales_count,
            SUM(s.total) as total_revenue,
            AVG(s.total) as avg_sale_amount,
            COUNT(DISTINCT s."employeeId") as active_employees,
            COUNT(DISTINCT s."customerName") as unique_customers,
            SUM(s.tax) as total_tax_collected
          FROM "Sale" s
          JOIN "Store" st ON st.id = s."storeId"
          WHERE ${storeId ? Prisma.sql`s."storeId" = ${storeId}` : Prisma.sql`1=1`}
            AND ${employeeId ? Prisma.sql`s."employeeId" = ${employeeId}` : Prisma.sql`1=1`}
            AND ${startDate ? Prisma.sql`s."createdAt" >= ${new Date(startDate as string)}` : Prisma.sql`1=1`}
            AND ${endDate ? Prisma.sql`s."createdAt" <= ${new Date(endDate as string)}` : Prisma.sql`1=1`}
          GROUP BY st.id, st.name, st.location
          ORDER BY total_revenue DESC
        `;
        break;

      default:
        // Daily summary
        reportData = await prisma.$queryRaw`
          SELECT 
            DATE("createdAt") as date,
            "paymentMethod",
            COUNT(*) as transaction_count,
            SUM(total) as total_revenue,
            AVG(total) as avg_transaction
          FROM "Sale"
          WHERE ${storeId ? Prisma.sql`"storeId" = ${storeId}` : Prisma.sql`1=1`}
            AND ${employeeId ? Prisma.sql`"employeeId" = ${employeeId}` : Prisma.sql`1=1`}
            AND ${startDate ? Prisma.sql`"createdAt" >= ${new Date(startDate as string)}` : Prisma.sql`1=1`}
            AND ${endDate ? Prisma.sql`"createdAt" <= ${new Date(endDate as string)}` : Prisma.sql`1=1`}
          GROUP BY DATE("createdAt"), "paymentMethod"
          ORDER BY date DESC, total_revenue DESC
        `;
    }

    // Get summary statistics
    const summary = await prisma.sale.aggregate({
      where,
      _sum: { total: true, subtotal: true, tax: true },
      _count: true,
      _avg: { total: true }
    });

    res.json({
      report: reportData,
      summary: {
        totalSales: summary._count,
        totalRevenue: summary._sum.total || 0,
        totalTax: summary._sum.tax || 0,
        averageSale: summary._avg.total || 0,
        dateRange: {
          start: startDate || 'N/A',
          end: endDate || 'N/A'
        }
      },
      parameters: {
        storeId,
        employeeId,
        paymentMethod,
        groupBy
      }
    });
  } catch (error) {
    console.error("Get sales report error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getSalesTrend = async (req: Request, res: Response): Promise<void> => {
  try {
    const { storeId, period = '30d' } = req.query;

    // Calculate date range
    const endDate = new Date();
    let startDate = new Date();

    switch (period) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      case '1y':
        startDate.setFullYear(startDate.getFullYear() - 1);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    // Get daily sales trend
    const dailyTrend = await prisma.$queryRaw<DailyTrendItem[]>`
      SELECT 
        DATE(s."createdAt") as date,
        COUNT(*) as sales_count,
        SUM(s.total) as total_revenue,
        AVG(s.total) as avg_sale_amount,
        COUNT(DISTINCT s."employeeId") as active_employees,
        COUNT(DISTINCT s."customerName") as unique_customers,
        SUM(s.tax) as total_tax
      FROM "Sale" s
      WHERE ${storeId ? Prisma.sql`s."storeId" = ${storeId}` : Prisma.sql`1=1`}
        AND s."createdAt" >= ${startDate}
        AND s."createdAt" <= ${endDate}
      GROUP BY DATE(s."createdAt")
      ORDER BY date ASC
    `;

    // Get top products
    const topProducts = await prisma.$queryRaw<TopProductItem[]>`
      SELECT 
        p.id,
        p.name,
        p.type,
        p.grade,
        SUM(si.quantity) as total_quantity,
        SUM(si.quantity * si.price) as total_revenue,
        COUNT(DISTINCT si."saleId") as sales_count,
        AVG(si.price) as avg_price
      FROM "SaleItem" si
      JOIN "Product" p ON p.id = si."productId"
      JOIN "Sale" s ON s.id = si."saleId"
      WHERE ${storeId ? Prisma.sql`s."storeId" = ${storeId}` : Prisma.sql`1=1`}
        AND s."createdAt" >= ${startDate}
        AND s."createdAt" <= ${endDate}
      GROUP BY p.id, p.name, p.type, p.grade
      ORDER BY total_revenue DESC
      LIMIT 10
    `;

    // Get top employees
    const topEmployees = await prisma.$queryRaw<TopEmployeeItem[]>`
      SELECT 
        e.id,
        u."firstName" || ' ' || u."lastName" as employee_name,
        e.position,
        COUNT(s.id) as sales_count,
        SUM(s.total) as total_revenue,
        AVG(s.total) as avg_sale_amount,
        COUNT(DISTINCT s."customerName") as unique_customers
      FROM "Sale" s
      JOIN "Employee" e ON e.id = s."employeeId"
      JOIN "User" u ON u.id = e."userId"
      WHERE ${storeId ? Prisma.sql`s."storeId" = ${storeId}` : Prisma.sql`1=1`}
        AND s."createdAt" >= ${startDate}
        AND s."createdAt" <= ${endDate}
      GROUP BY e.id, u."firstName", u."lastName", e.position
      ORDER BY total_revenue DESC
      LIMIT 10
    `;

    // Get payment method distribution
    const paymentDistribution = await prisma.$queryRaw<PaymentDistributionItem[]>`
      SELECT 
        "paymentMethod",
        COUNT(*) as transaction_count,
        SUM(total) as total_revenue,
        AVG(total) as avg_transaction
      FROM "Sale"
      WHERE ${storeId ? Prisma.sql`"storeId" = ${storeId}` : Prisma.sql`1=1`}
        AND "createdAt" >= ${startDate}
        AND "createdAt" <= ${endDate}
      GROUP BY "paymentMethod"
      ORDER BY total_revenue DESC
    `;

    // Calculate metrics
    const metrics = {
      totalSales: dailyTrend.reduce((sum, day) => sum + Number(day.sales_count), 0),
      totalRevenue: dailyTrend.reduce((sum, day) => sum + Number(day.total_revenue), 0),
      totalTax: dailyTrend.reduce((sum, day) => sum + Number(day.total_tax), 0),
      avgDailySales: dailyTrend.length > 0
        ? dailyTrend.reduce((sum, day) => sum + Number(day.sales_count), 0) / dailyTrend.length
        : 0,
      avgSaleAmount: dailyTrend.length > 0
        ? dailyTrend.reduce((sum, day) => sum + Number(day.total_revenue), 0) /
        dailyTrend.reduce((sum, day) => sum + Number(day.sales_count), 0)
        : 0,
      peakDay: dailyTrend.length > 0
        ? dailyTrend.reduce((max, day) =>
          Number(day.total_revenue) > Number(max.total_revenue) ? day : max
          , dailyTrend[0])
        : null
    };

    res.json({
      period: {
        startDate,
        endDate,
        days: dailyTrend.length
      },
      dailyTrend,
      topProducts,
      topEmployees,
      paymentDistribution,
      metrics
    });
  } catch (error) {
    console.error("Get sales trend error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const getVoidedSales = async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      page = 1,
      limit = 20,
      startDate,
      endDate,
      storeId
    } = req.query;

    const { skip, take } = generatePagination(Number(page), Number(limit));

    const where: any = {};

    if (storeId) where.sale = { storeId };

    // Date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) where.createdAt.lte = new Date(endDate as string);
    }

    const [voidedSales, total] = await Promise.all([
      prisma.voidedSale.findMany({
        where,
        skip,
        take,
        include: {
          sale: {
            include: {
              store: true,
              employee: {
                include: { user: true }
              },
              saleItems: {
                include: { product: true }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.voidedSale.count({ where })
    ]);

    // Calculate summary
    const summary = {
      totalVoided: total,
      totalAmount: voidedSales.reduce((sum, vs) => sum + vs.originalTotal, 0),
      averageVoidAmount: total > 0
        ? voidedSales.reduce((sum, vs) => sum + vs.originalTotal, 0) / total
        : 0,
      byStore: voidedSales.reduce((acc, vs) => {
        const storeName = vs.sale.store.name;
        acc[storeName] = (acc[storeName] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    };

    res.json({
      data: voidedSales,
      summary,
      meta: generateMeta(total, Number(page), Number(limit))
    });
  } catch (error) {
    console.error("Get voided sales error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};