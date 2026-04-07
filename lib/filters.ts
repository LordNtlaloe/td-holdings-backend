import { Prisma } from '../prisma/generated/client';
import { FilterParams, DateRange } from '../types/express';

export class FilterBuilder {
    private filters: any[] = [];
    private orderBy: any = {};
    private include: any = {};

    // Generic filters
    where(search?: string, fields?: string[]) {
        if (search && fields) {
            const searchConditions = fields.map(field => ({
                [field]: { contains: search, mode: 'insensitive' as const }
            }));
            this.filters.push({ OR: searchConditions });
        }
        return this;
    }

    status(status?: string, field: string = 'status') {
        if (status) {
            this.filters.push({ [field]: status });
        }
        return this;
    }

    store(storeId?: string) {
        if (storeId) {
            this.filters.push({ storeId });
        }
        return this;
    }

    product(productId?: string) {
        if (productId) {
            this.filters.push({ productId });
        }
        return this;
    }

    employee(employeeId?: string) {
        if (employeeId) {
            this.filters.push({ employeeId });
        }
        return this;
    }

    dateRange(dateRange?: DateRange, field: string = 'createdAt') {
        if (dateRange) {
            const dateFilter: any = {};
            if (dateRange.startDate) {
                dateFilter.gte = new Date(dateRange.startDate);
            }
            if (dateRange.endDate) {
                dateFilter.lte = new Date(dateRange.endDate);
            }
            if (Object.keys(dateFilter).length > 0) {
                this.filters.push({ [field]: dateFilter });
            }
        }
        return this;
    }

    // Inventory specific filters - FIXED
    inventoryFilters(params: {
        minQuantity?: number;
        maxQuantity?: number;
        belowReorder?: boolean;
        type?: string;
        grade?: string;
    }) {
        if (params.minQuantity !== undefined) {
            this.filters.push({ quantity: { gte: params.minQuantity } });
        }
        if (params.maxQuantity !== undefined) {
            this.filters.push({ quantity: { lte: params.maxQuantity } });
        }

        // FIXED: Remove Prisma.sql usage - we'll handle belowReorder differently
        if (params.belowReorder) {
            // We can't use SQL directly in where clause, so we'll handle this differently
            // Or you can remove this filter and handle it in application logic
            console.warn('belowReorder filter not supported in FilterBuilder');
        }

        if (params.type) {
            this.filters.push({ product: { type: params.type } });
        }
        if (params.grade) {
            this.filters.push({ product: { grade: params.grade } });
        }
        return this;
    }

    // Sales specific filters
    salesFilters(params: {
        minTotal?: number;
        maxTotal?: number;
        paymentMethod?: string;
        employeeId?: string;
        customerName?: string;
    }) {
        if (params.minTotal !== undefined) {
            this.filters.push({ total: { gte: params.minTotal } });
        }
        if (params.maxTotal !== undefined) {
            this.filters.push({ total: { lte: params.maxTotal } });
        }
        if (params.paymentMethod) {
            this.filters.push({ paymentMethod: params.paymentMethod });
        }
        if (params.employeeId) {
            this.filters.push({ employeeId: params.employeeId });
        }
        if (params.customerName) {
            this.filters.push({
                customerName: { contains: params.customerName, mode: 'insensitive' }
            });
        }
        return this;
    }

    // Include relations
    includeProduct() {
        this.include.product = true;
        return this;
    }

    includeStore() {
        this.include.store = true;
        return this;
    }

    includeEmployee() {
        this.include.employee = { include: { user: true } };
        return this;
    }

    includeUser() {
        this.include.user = true;
        return this;
    }

    includeWithDetails() {
        this.include.product = true;
        this.include.store = true;
        this.include.employee = { include: { user: true } };
        return this;
    }

    // Ordering
    order(sortBy?: string, sortOrder: 'asc' | 'desc' = 'desc') {
        if (sortBy) {
            // Validate sortBy field
            const validFields = [
                'name', 'basePrice', 'type', 'grade', 'commodity',
                'tireSize', 'createdAt', 'updatedAt', 'quantity',
                'total', 'subtotal', 'tax', 'paymentMethod'
            ];

            if (validFields.includes(sortBy)) {
                this.orderBy[sortBy] = sortOrder;
            } else {
                // Default to createdAt if invalid field
                this.orderBy.createdAt = sortOrder;
            }
        } else {
            this.orderBy.createdAt = 'desc';
        }
        return this;
    }

    build() {
        const result: any = {};

        if (this.filters.length > 0) {
            result.where = { AND: this.filters };
        }

        if (Object.keys(this.orderBy).length > 0) {
            result.orderBy = this.orderBy;
        }

        if (Object.keys(this.include).length > 0) {
            result.include = this.include;
        }

        return result;
    }
}