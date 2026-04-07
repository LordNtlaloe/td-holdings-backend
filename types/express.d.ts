import { User, Role, Employee } from '@prisma/client';

declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                email: string;
                role: Role;
                storeId?: string;
                employeeId?: string;
            };
        }
    }
}

export interface PaginationParams {
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
}

export interface DateRange {
    startDate?: string;
    endDate?: string;
}

export interface FilterParams {
    search?: string;
    status?: string;
    type?: string;
    storeId?: string;
    productId?: string;
    employeeId?: string;
}