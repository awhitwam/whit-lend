import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Receipt, Edit, Trash2, Settings, FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import ExpenseForm from '@/components/expense/ExpenseForm';
import EmptyState from '@/components/ui/EmptyState';
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
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  
  const queryClient = useQueryClient();

  const { data: expenses = [], isLoading: expensesLoading } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => api.entities.Expense.list('-date')
  });

  const { data: expenseTypes = [], isLoading: typesLoading } = useQuery({
    queryKey: ['expense-types'],
    queryFn: () => api.entities.ExpenseType.list('name')
  });

  const { data: loans = [] } = useQuery({
    queryKey: ['loans'],
    queryFn: () => api.entities.Loan.list('-created_date')
  });

  const createExpenseMutation = useMutation({
    mutationFn: (data) => api.entities.Expense.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setIsExpenseDialogOpen(false);
      setEditingExpense(null);
    }
  });

  const updateExpenseMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.Expense.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setIsExpenseDialogOpen(false);
      setEditingExpense(null);
    }
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: (id) => api.entities.Expense.delete(id),
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
      updateExpenseMutation.mutate({ id: editingExpense.id, data });
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
      <div className="max-w-7xl mx-auto p-6 space-y-6">
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
          <Card>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Linked Loan</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
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
                                deleteExpenseMutation.mutate(expense.id);
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
          }
        }}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Manage Expense Types</DialogTitle>
            </DialogHeader>
            
            <form onSubmit={handleTypeSubmit} className="space-y-4 mb-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Input
                    placeholder="Type name"
                    value={typeName}
                    onChange={(e) => setTypeName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Input
                    placeholder="Description (optional)"
                    value={typeDescription}
                    onChange={(e) => setTypeDescription(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={createTypeMutation.isPending || updateTypeMutation.isPending}>
                  {editingType ? 'Update' : 'Add'} Type
                </Button>
                {editingType && (
                  <Button type="button" variant="outline" onClick={() => {
                    setEditingType(null);
                    setTypeName('');
                    setTypeDescription('');
                  }}>
                    Cancel
                  </Button>
                )}
                {!editingType && (
                  <Button type="button" variant="outline" onClick={() => setIsTypeDialogOpen(false)}>
                    Done
                  </Button>
                )}
              </div>
            </form>

            <div className="border-t pt-4">
              <h4 className="font-medium mb-3">Existing Types</h4>
              <div className="space-y-2">
                {typesLoading ? (
                  <div className="text-sm text-slate-500">Loading...</div>
                ) : expenseTypes.length === 0 ? (
                  <div className="text-sm text-slate-500">No types yet</div>
                ) : (
                  expenseTypes.map(type => (
                    <div key={type.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                      <div>
                        <p className="font-medium">{type.name}</p>
                        {type.description && (
                          <p className="text-xs text-slate-500">{type.description}</p>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditType(type)}
                        >
                          <Edit className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600"
                          onClick={() => {
                            if (confirm('Delete this type?')) {
                              deleteTypeMutation.mutate(type.id);
                            }
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}