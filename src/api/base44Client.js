import { supabase } from '@/lib/supabaseClient';

// Map entity names to Supabase table names (matching actual database schema)
const tableMap = {
  Borrower: 'borrowers',
  Loan: 'loans',
  LoanProduct: 'loan_products',
  Transaction: 'transactions',
  RepaymentSchedule: 'repayment_schedules',
  Expense: 'expenses',
  ExpenseType: 'expense_types',
  Investor: 'Investor',  // PascalCase in database
  InvestorTransaction: 'InvestorTransaction'  // PascalCase in database
};

// Map column names that differ between code and database
// Format: { tableName: { codeColumnName: dbColumnName } }
const columnMap = {
  borrowers: {
    created_date: 'created_at'
  },
  loans: {
    created_date: 'created_at'
  },
  loan_products: {
    created_date: 'created_at'
  }
};

// Parse order string like '-created_date' into { column: 'created_date', ascending: false }
function parseOrder(orderStr, tableName) {
  if (!orderStr) return null;
  const ascending = !orderStr.startsWith('-');
  let column = orderStr.replace(/^-/, '');

  // Map column name if needed
  if (columnMap[tableName] && columnMap[tableName][column]) {
    column = columnMap[tableName][column];
  }

  return { column, ascending };
}

// Create an entity handler for a specific table
function createEntityHandler(tableName) {
  return {
    // List all records with optional ordering and limit
    async list(orderBy, limit) {
      let query = supabase.from(tableName).select('*');

      const order = parseOrder(orderBy, tableName);
      if (order) {
        query = query.order(order.column, { ascending: order.ascending });
      }

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },

    // Filter records by conditions with optional ordering
    async filter(conditions, orderBy) {
      let query = supabase.from(tableName).select('*');

      // Apply filter conditions
      for (const [key, value] of Object.entries(conditions)) {
        query = query.eq(key, value);
      }

      const order = parseOrder(orderBy, tableName);
      if (order) {
        query = query.order(order.column, { ascending: order.ascending });
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },

    // Create a new record
    async create(data) {
      const { data: created, error } = await supabase
        .from(tableName)
        .insert(data)
        .select()
        .single();

      if (error) throw error;
      return created;
    },

    // Update a record by ID
    async update(id, data) {
      const { data: updated, error } = await supabase
        .from(tableName)
        .update(data)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return updated;
    },

    // Delete a record by ID
    async delete(id) {
      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', id);

      if (error) throw error;
      return true;
    },

    // Batch create multiple records at once (much faster than individual creates)
    async createMany(records) {
      if (!records || records.length === 0) return [];

      const { data: created, error } = await supabase
        .from(tableName)
        .insert(records)
        .select();

      if (error) throw error;
      return created || [];
    },

    // Batch delete by condition (much faster than individual deletes)
    async deleteWhere(conditions) {
      let query = supabase.from(tableName).delete();

      for (const [key, value] of Object.entries(conditions)) {
        query = query.eq(key, value);
      }

      const { error } = await query;
      if (error) throw error;
      return true;
    }
  };
}

// Create the base44-compatible client
const entities = {};
for (const [entityName, tableName] of Object.entries(tableMap)) {
  entities[entityName] = createEntityHandler(tableName);
}

export const base44 = {
  entities
};
