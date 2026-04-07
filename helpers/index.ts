export const generatePagination = (page: number = 1, limit: number = 10) => {
  const skip = (page - 1) * limit;
  return { skip, take: limit };
};

export const generateMeta = (total: number, page: number, limit: number) => {
  return {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasNext: page * limit < total,
    hasPrev: page > 1
  };
};

export const calculateSalesMetrics = (sales: any[]) => {
  const totalSales = sales.reduce((sum, sale) => sum + sale.total, 0);
  const totalItems = sales.reduce((sum, sale) => 
    sum + sale.saleItems.reduce((itemSum: number, item: any) => itemSum + item.quantity, 0), 0);
  const averageSale = sales.length > 0 ? totalSales / sales.length : 0;

  return { totalSales, totalItems, averageSale, transactionCount: sales.length };
};

export const calculateInventoryMetrics = (inventories: any[]) => {
  const totalValue = inventories.reduce((sum, inv) => 
    sum + (inv.quantity * (inv.storePrice || inv.product.basePrice)), 0);
  const totalItems = inventories.reduce((sum, inv) => sum + inv.quantity, 0);
  const lowStockItems = inventories.filter(inv => 
    inv.quantity < (inv.reorderLevel || 10)).length;

  return { totalValue, totalItems, lowStockItems };
};

export const formatDateRange = (startDate?: string, endDate?: string) => {
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();
  return { start, end };
};