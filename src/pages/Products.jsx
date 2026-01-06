import { useState } from 'react';
import { api } from '@/api/dataClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Package, MoreHorizontal, Edit, Trash2, TrendingUp, Clock, Copy, Zap, Coins } from 'lucide-react';
import ProductForm from '@/components/product/ProductForm';
import EmptyState from '@/components/ui/EmptyState';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { logProductEvent, AuditAction } from '@/lib/auditLog';

export default function Products() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const queryClient = useQueryClient();
  const { currentOrganization } = useOrganization();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products', currentOrganization?.id],
    queryFn: () => api.entities.LoanProduct.list('-created_date'),
    enabled: !!currentOrganization
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const { _duplicatedFrom, ...productData } = data;
      const newProduct = await api.entities.LoanProduct.create(productData);
      return { newProduct, duplicatedFrom: _duplicatedFrom };
    },
    onSuccess: async ({ newProduct, duplicatedFrom }) => {
      // Audit log: product creation or duplication
      if (duplicatedFrom) {
        await logProductEvent(AuditAction.PRODUCT_DUPLICATE, newProduct, {
          name: newProduct.name,
          duplicated_from_id: duplicatedFrom.id,
          duplicated_from_name: duplicatedFrom.name
        });
      } else {
        await logProductEvent(AuditAction.PRODUCT_CREATE, newProduct, {
          name: newProduct.name,
          interest_rate: newProduct.interest_rate,
          term_months: newProduct.term_months,
          repayment_type: newProduct.repayment_type
        });
      }
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setIsFormOpen(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data, previousData }) => api.entities.LoanProduct.update(id, data).then(result => ({ result, previousData })),
    onSuccess: async ({ result: updatedProduct, previousData }) => {
      // Audit log: product update
      await logProductEvent(AuditAction.PRODUCT_UPDATE, updatedProduct, updatedProduct, previousData);
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setIsFormOpen(false);
      setEditingProduct(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (product) => {
      await api.entities.LoanProduct.delete(product.id);
      return product;
    },
    onSuccess: async (deletedProduct) => {
      // Audit log: product deletion
      await logProductEvent(AuditAction.PRODUCT_DELETE, deletedProduct, {
        name: deletedProduct.name
      });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    }
  });

  const handleSubmit = (data) => {
    if (editingProduct?.id) {
      // Existing product being edited
      updateMutation.mutate({ id: editingProduct.id, data, previousData: editingProduct });
    } else if (editingProduct?._duplicatedFrom) {
      // Duplicating a product
      createMutation.mutate({ ...data, _duplicatedFrom: editingProduct._duplicatedFrom });
    } else {
      // New product
      createMutation.mutate(data);
    }
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    setIsFormOpen(true);
  };

  const handleDuplicate = (product) => {
    const duplicatedProduct = {
      ...product,
      name: `${product.name} (Copy)`,
      _duplicatedFrom: { id: product.id, name: product.name } // Track source for audit
    };
    delete duplicatedProduct.id;
    delete duplicatedProduct.created_date;
    setEditingProduct(duplicatedProduct);
    setIsFormOpen(true);
  };

  const handleClose = () => {
    setIsFormOpen(false);
    setEditingProduct(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Loan Products</h1>
            <p className="text-slate-500 mt-1">Configure and manage loan products</p>
          </div>
          <Button onClick={() => setIsFormOpen(true)} className="bg-slate-900 hover:bg-slate-800">
            <Plus className="w-4 h-4 mr-2" />
            Add Product
          </Button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array(3).fill(0).map((_, i) => (
              <Card key={i} className="h-48 animate-pulse bg-slate-100" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No loan products yet"
            description="Create your first loan product to start issuing loans"
            action={
              <Button onClick={() => setIsFormOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Product
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((product) => {
              const isFixedCharge = product.product_type === 'Fixed Charge';
              const isIrregularIncome = product.product_type === 'Irregular Income';
              const isSpecialType = isFixedCharge || isIrregularIncome;

              return (
                <Card key={product.id} className="hover:shadow-md transition-shadow">
                  <CardHeader className="flex flex-row items-start justify-between pb-2">
                    <div>
                      <CardTitle className="text-lg">{product.name}</CardTitle>
                      {isFixedCharge ? (
                        <Badge
                          variant="outline"
                          className="bg-purple-50 text-purple-700 border-purple-200 mt-2"
                        >
                          <Zap className="w-3 h-3 mr-1" />
                          Fixed Charge Facility
                        </Badge>
                      ) : isIrregularIncome ? (
                        <Badge
                          variant="outline"
                          className="bg-amber-50 text-amber-700 border-amber-200 mt-2"
                        >
                          <Coins className="w-3 h-3 mr-1" />
                          Irregular Income
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className={product.interest_type === 'Reducing'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 mt-2'
                            : 'bg-amber-50 text-amber-700 border-amber-200 mt-2'
                          }
                        >
                          {product.interest_type} Balance
                        </Badge>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEdit(product)}>
                          <Edit className="w-4 h-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDuplicate(product)}>
                          <Copy className="w-4 h-4 mr-2" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => deleteMutation.mutate(product)}
                          className="text-red-600"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {isFixedCharge ? (
                      <div className="text-sm text-slate-600">
                        <p>Regular monthly fee for loan facility access.</p>
                        <p className="mt-2 text-xs text-slate-500">Supports arrangement and exit fees.</p>
                      </div>
                    ) : isIrregularIncome ? (
                      <div className="text-sm text-slate-600">
                        <p>No fixed schedule - record payments as received.</p>
                        <p className="mt-2 text-xs text-slate-500">Principal tracking only.</p>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-4">
                          <div className="flex items-center gap-2">
                            <div className="p-2 rounded-lg bg-blue-100">
                              <TrendingUp className="w-4 h-4 text-blue-600" />
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">Interest</p>
                              <p className="font-semibold">{product.interest_rate}% p.a.</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="p-2 rounded-lg bg-purple-100">
                              <Clock className="w-4 h-4 text-purple-600" />
                            </div>
                            <div>
                              <p className="text-xs text-slate-500">Period</p>
                              <p className="font-semibold">{product.period}</p>
                            </div>
                          </div>
                        </div>

                        <div className="pt-2 border-t space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Calculation:</span>
                            <span className="font-medium text-slate-700">
                              {product.interest_calculation_method === 'daily' ? 'Daily (variable)' : 'Monthly (fixed 365/12)'}
                            </span>
                          </div>
                          {product.interest_alignment && product.period === 'Monthly' && (
                            <div className="flex justify-between text-sm">
                              <span className="text-slate-500">Alignment:</span>
                              <span className="font-medium text-slate-700">
                                {product.interest_alignment === 'period_based' ? 'From start date' : '1st of month'}
                              </span>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Form Dialog */}
        <Dialog open={isFormOpen} onOpenChange={handleClose}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingProduct ? 'Edit Loan Product' : 'Create Loan Product'}
              </DialogTitle>
            </DialogHeader>
            <ProductForm
              product={editingProduct}
              onSubmit={handleSubmit}
              onCancel={handleClose}
              isLoading={createMutation.isPending || updateMutation.isPending}
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}