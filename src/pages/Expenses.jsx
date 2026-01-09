import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Receipt, Edit, Trash2, Settings, FileText, ChevronLeft, ChevronRight, Landmark } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import ExpenseForm from '@/components/expense/ExpenseForm';
import EmptyState from '@/components/ui/EmptyState';
import { logExpenseEvent, AuditAction } from '@/lib/auditLog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function Expenses() {
  const [searchTerm, setSearchTerm] = useState('');
  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
  const [isTypeDialogOpen, setIsTypeDialogOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [editingType, setEditingType] = useState(null);
  const [typeName, setTypeName] = useState('');
  const [typeDescription, setTypeDescription] = useState('');
  const [typeSearchTerm, setTypeSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const queryClient = useQueryClient();
  const { currentOrganization } = useOrganization();

  const { data: expenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ['expenses', currentOrganization?.id],
    queryFn: () => api.entities.Expense.listAll('-date'),
    enabled: !!currentOrganization
  });

  const { data: expenseTypes = [], isLoading: typesLoading } = useQuery({
    queryKey: ['expense-types', currentOrganization?.id],
    queryFn: () => api.entities.ExpenseType.list('name'),
    enabled: !!currentOrganization
  });

  const { data: loans = [] } = useQuery({
    queryKey: ['loans', currentOrganization?.id],
    queryFn: () => api.entities.Loan.list('-created_date'),
    enabled: !!currentOrganization
  });

  // Fetch reconciliation entries to show which expenses are matched to bank statements
  const { data: reconciliationEntries = [] } = useQuery({
    queryKey: ['expense-reconciliation-entries', currentOrganization?.id],
    queryFn: () => api.entities.ReconciliationEntry.list(),
    enabled: !!currentOrganization
  });

  // Fetch bank statements to show details about matched entries
  const { data: bankStatements = [] } = useQuery({
    queryKey: ['bank-statements', currentOrganization?.id],
    queryFn: () => api.entities.BankStatement.list(),
    enabled: !!currentOrganization && reconciliationEntries.length > 0
  });

  // Build a map of expense ID -> array of bank statement details for quick lookup
  const reconciliationMap = new Map();
  reconciliationEntries
    .filter(entry => entry.expense_id)
    .forEach(entry => {
      const bankStatement = bankStatements.find(bs => bs.id === entry.bank_statement_id);
      const existing = reconciliationMap.get(entry.expense_id) || [];
      existing.push({ entry, bankStatement });
      reconciliationMap.set(entry.expense_id, existing);
    });

  // Set for simple boolean checks
  const reconciledExpenseIds = new Set(reconciliationMap.keys());

  const createExpenseMutation = useMutation({
    mutationFn: async (data) => {
      const result = await api.entities.Expense.create(data);
      logExpenseEvent(AuditAction.EXPENSE_CREATE, result || { id: 'new', ...data }, {
        amount: data.amount,
        type_name: data.type_name,
        date: data.date,
        description: data.description,
        loan_id: data.loan_id
      });
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setIsExpenseDialogOpen(false);
      setEditingExpense(null);
    }
  });

  const updateExpenseMutation = useMutation({
    mutationFn: async ({ id, data, previousExpense }) => {
      const result = await api.entities.Expense.update(id, data);
      logExpenseEvent(AuditAction.EXPENSE_UPDATE, result || { id, ...data }, {
        amount: data.amount,
        type_name: data.type_name,
        date: data.date,
        description: data.description,
        loan_id: data.loan_id
      }, previousExpense);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setIsExpenseDialogOpen(false);
      setEditingExpense(null);
    }
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async ({ id, expense }) => {
      await api.entities.Expense.delete(id);
      logExpenseEvent(AuditAction.EXPENSE_DELETE, expense, {
        amount: expense.amount,
        type_name: expense.type_name,
        date: expense.date,
        description: expense.description
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    }
  });

  const createTypeMutation = useMutation({
    mutationFn: (data) => api.entities.ExpenseType.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-types'] });
      setTypeName('');
      setTypeDescription('');
    }
  });

  const updateTypeMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.ExpenseType.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-types'] });
      setIsTypeDialogOpen(false);
      setTypeName('');
      setTypeDescription('');
      setEditingType(null);
    }
  });

  const deleteTypeMutation = useMutation({
    mutationFn: (id) => api.entities.ExpenseType.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-types'] });
    }
  });

  const handleExpenseSubmit = (data) => {
    if (editingExpense) {
      updateExpenseMutation.mutate({ id: editingExpense.id, data, previousExpense: editingExpense });
    } else {
      createExpenseMutation.mutate(data);
    }
  };

  const handleTypeSubmit = (e) => {
    e.preventDefault();
    const data = { name: typeName, description: typeDescription };
    if (editingType) {
      updateTypeMutation.mutate({ id: editingType.id, data });
    } else {
      createTypeMutation.mutate(data);
    }
  };

  const handleEditType = (type) => {
    setEditingType(type);
    setTypeName(type.name);
    setTypeDescription(type.description || '');
    setIsTypeDialogOpen(true);
  };

  const filteredExpenses = expenses.filter(expense => {
    const searchLower = searchTerm.toLowerCase();
    return (
      expense.type_name?.toLowerCase().includes(searchLower) ||
      expense.description?.toLowerCase().includes(searchLower) ||
      expense.borrower_name?.toLowerCase().includes(searchLower)
    );
  });

  const totalExpenses = filteredExpenses.reduce((sum, exp) => sum + (exp.amount || 0), 0);

  // Pagination
  const totalPages = Math.ceil(filteredExpenses.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedExpenses = filteredExpenses.slice(startIndex, endIndex);

  const handleSearchChange = (value) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleItemsPerPageChange = (value) => {
    setItemsPerPage(parseInt(value));
    setCurrentPage(1);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Expenses</h1>
            <p className="text-slate-500 mt-1">Track and manage business expenses</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => {
              setEditingType(null);
              setTypeName('');
              setTypeDescription('');
              setIsTypeDialogOpen(true);
            }}>
              <Settings className="w-4 h-4 mr-2" />
              Manage Types
            </Button>
            <Button onClick={() => {
              setEditingExpense(null);
              setIsExpenseDialogOpen(true);
            }} className="bg-slate-900 hover:bg-slate-800">
              <Plus className="w-4 h-4 mr-2" />
              Add Expense
            </Button>
          </div>
        </div>

        {/* Summary */}
        <Card className="bg-gradient-to-br from-red-50 to-red-100/50 border-red-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-red-600 font-medium">Total Expenses</p>
                <p className="text-xs text-red-500 mt-1">{filteredExpenses.length} transactions</p>
              </div>
              <p className="text-3xl font-bold text-red-900">{formatCurrency(totalExpenses)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              placeholder="Search expenses..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-600">Show:</span>
            <Select value={itemsPerPage.toString()} onValueChange={handleItemsPerPageChange}>
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-slate-600">per page</span>
          </div>
        </div>

        {/* Expenses List */}
        {expensesLoading ? (
          <Card>
            <CardContent className="p-8 space-y-4">
              {Array(6).fill(0).map((_, i) => (
                <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
              ))}
            </CardContent>
          </Card>
        ) : filteredExpenses.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={searchTerm ? "No expenses match your search" : "No expenses yet"}
            description={searchTerm ? "Try adjusting your search" : "Start tracking your business expenses"}
            action={
              !searchTerm && (
                <Button onClick={() => setIsExpenseDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Expense
                </Button>
              )
            }
          />
        ) : (
          <TooltipProvider>
          <Card>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Linked Loan</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-8 text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Landmark className="w-3 h-3 text-slate-400 mx-auto" />
                      </TooltipTrigger>
                      <TooltipContent><p>Bank Reconciled</p></TooltipContent>
                    </Tooltip>
                  </TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedExpenses.map(expense => (
                  <TableRow key={expense.id} className="hover:bg-slate-50">
                    <TableCell className="font-medium">
                      {format(new Date(expense.date), 'MMM dd, yyyy')}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{expense.type_name}</Badge>
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {expense.description || '-'}
                    </TableCell>
                    <TableCell>
                      {expense.loan_id ? (
                        <Link 
                          to={createPageUrl(`LoanDetails?id=${expense.loan_id}`)}
                          className="text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <FileText className="w-3 h-3" />
                          {expense.borrower_name}
                        </Link>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-red-600">
                      {formatCurrency(expense.amount)}
                    </TableCell>
                    <TableCell className="text-center">
                      {reconciledExpenseIds.has(expense.id) ? (
                        (() => {
                          const matches = reconciliationMap.get(expense.id) || [];
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Landmark className="w-3.5 h-3.5 text-emerald-500 cursor-help mx-auto" />
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs">
                                <div className="space-y-2">
                                  <p className="font-medium text-emerald-400">
                                    Matched to {matches.length > 1 ? `${matches.length} bank entries` : 'Bank Statement'}
                                  </p>
                                  {matches.map((match, idx) => {
                                    const bs = match?.bankStatement;
                                    return (
                                      <div key={idx} className={matches.length > 1 ? 'border-t border-slate-600 pt-1' : ''}>
                                        {bs ? (
                                          <>
                                            <p className="text-xs"><span className="text-slate-400">Date:</span> {format(new Date(bs.statement_date), 'dd/MM/yyyy')}</p>
                                            <p className="text-xs"><span className="text-slate-400">Amount:</span> {formatCurrency(Math.abs(bs.amount))}</p>
                                            <p className="text-xs"><span className="text-slate-400">Source:</span> {bs.bank_source}</p>
                                            {bs.description && <p className="text-xs text-slate-300 truncate max-w-[200px]">{bs.description}</p>}
                                          </>
                                        ) : (
                                          <p className="text-xs text-slate-400">Bank statement details unavailable</p>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          );
                        })()
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <Edit className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => {
                            setEditingExpense(expense);
                            setIsExpenseDialogOpen(true);
                          }}>
                            <Edit className="w-4 h-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => {
                              if (confirm('Delete this expense?')) {
                                deleteExpenseMutation.mutate({ id: expense.id, expense });
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filteredExpenses.length > 0 && (
              <div className="flex items-center justify-between px-4 py-4 border-t">
                <div className="text-sm text-slate-600">
                  Showing {startIndex + 1} to {Math.min(endIndex, filteredExpenses.length)} of {filteredExpenses.length} entries
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <div className="text-sm text-slate-600">
                    Page {currentPage} of {totalPages}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
          </TooltipProvider>
        )}

        {/* Expense Form Dialog */}
        <Dialog open={isExpenseDialogOpen} onOpenChange={(open) => {
          setIsExpenseDialogOpen(open);
          if (!open) setEditingExpense(null);
        }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingExpense ? 'Edit' : 'Add'} Expense
              </DialogTitle>
            </DialogHeader>
            <ExpenseForm
              expense={editingExpense}
              expenseTypes={expenseTypes}
              loans={loans}
              onSubmit={handleExpenseSubmit}
              onCancel={() => {
                setIsExpenseDialogOpen(false);
                setEditingExpense(null);
              }}
              isLoading={createExpenseMutation.isPending || updateExpenseMutation.isPending}
            />
          </DialogContent>
        </Dialog>

        {/* Expense Types Dialog */}
        <Dialog open={isTypeDialogOpen} onOpenChange={(open) => {
          setIsTypeDialogOpen(open);
          if (!open) {
            setEditingType(null);
            setTypeName('');
            setTypeDescription('');
            setTypeSearchTerm('');
          }
        }}>
          <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Manage Expense Types</DialogTitle>
              <p className="text-sm text-slate-500">
                {expenseTypes.length} expense type{expenseTypes.length !== 1 ? 's' : ''} configured
              </p>
            </DialogHeader>

            {/* Add/Edit Form */}
            <form onSubmit={handleTypeSubmit} className="space-y-3 p-4 bg-slate-50 rounded-lg border">
              <div className="text-sm font-medium text-slate-700">
                {editingType ? 'Edit Type' : 'Add New Type'}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  placeholder="Type name *"
                  value={typeName}
                  onChange={(e) => setTypeName(e.target.value)}
                  required
                />
                <Input
                  placeholder="Description (optional)"
                  value={typeDescription}
                  onChange={(e) => setTypeDescription(e.target.value)}
                />
              </div>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  disabled={createTypeMutation.isPending || updateTypeMutation.isPending}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  {editingType ? 'Update Type' : 'Add Type'}
                </Button>
                {editingType && (
                  <Button type="button" variant="outline" size="sm" onClick={() => {
                    setEditingType(null);
                    setTypeName('');
                    setTypeDescription('');
                  }}>
                    Cancel
                  </Button>
                )}
              </div>
            </form>

            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
              <Input
                placeholder="Search expense types..."
                value={typeSearchTerm}
                onChange={(e) => setTypeSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Types Grid */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {typesLoading ? (
                <div className="text-sm text-slate-500 text-center py-8">Loading...</div>
              ) : expenseTypes.length === 0 ? (
                <div className="text-center py-8">
                  <Receipt className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500">No expense types yet</p>
                  <p className="text-xs text-slate-400">Add your first type above</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {expenseTypes
                    .filter(type =>
                      !typeSearchTerm ||
                      type.name.toLowerCase().includes(typeSearchTerm.toLowerCase()) ||
                      (type.description && type.description.toLowerCase().includes(typeSearchTerm.toLowerCase()))
                    )
                    .map(type => (
                      <div
                        key={type.id}
                        className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                          editingType?.id === type.id
                            ? 'bg-blue-50 border-blue-200'
                            : 'bg-white hover:bg-slate-50 border-slate-200'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{type.name}</p>
                          {type.description && (
                            <p className="text-xs text-slate-500 truncate">{type.description}</p>
                          )}
                        </div>
                        <div className="flex gap-1 ml-2 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handleEditType(type)}
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => {
                              if (confirm(`Delete "${type.name}"?`)) {
                                deleteTypeMutation.mutate(type.id);
                              }
                            }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))
                  }
                  {typeSearchTerm && expenseTypes.filter(type =>
                    type.name.toLowerCase().includes(typeSearchTerm.toLowerCase()) ||
                    (type.description && type.description.toLowerCase().includes(typeSearchTerm.toLowerCase()))
                  ).length === 0 && (
                    <div className="col-span-2 text-center py-6 text-sm text-slate-500">
                      No types matching "{typeSearchTerm}"
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end pt-3 border-t">
              <Button variant="outline" onClick={() => setIsTypeDialogOpen(false)}>
                Done
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}