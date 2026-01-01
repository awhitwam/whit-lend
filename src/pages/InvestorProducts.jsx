import { useState } from 'react';
import { api } from '@/api/dataClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Package, MoreHorizontal, Edit, Trash2, Clock, Copy, Percent, Calendar, PenLine } from 'lucide-react';
import InvestorProductForm from '@/components/investor/InvestorProductForm';
import EmptyState from '@/components/ui/EmptyState';
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { useOrganization } from '@/lib/OrganizationContext';

export default function InvestorProducts() {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const queryClient = useQueryClient();
  const { currentOrganization, isLoadingOrgs } = useOrganization();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['investorProducts', currentOrganization?.id],
    queryFn: () => api.entities.InvestorProduct.list('-created_at'),
    enabled: !!currentOrganization?.id
  });

  const createMutation = useMutation({
    mutationFn: (data) => api.entities.InvestorProduct.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investorProducts'] });
      setIsFormOpen(false);
    },
    onError: (error) => {
      console.error('Create investor product error:', error);
      alert('Failed to create product: ' + error.message);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => api.entities.InvestorProduct.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investorProducts'] });
      setIsFormOpen(false);
      setEditingProduct(null);
    },
    onError: (error) => {
      console.error('Update investor product error:', error);
      alert('Failed to update product: ' + error.message);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => api.entities.InvestorProduct.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['investorProducts'] });
    },
    onError: (error) => {
      console.error('Delete investor product error:', error);
      alert('Failed to delete product: ' + error.message);
    }
  });

  const handleSubmit = (data) => {
    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data });
    } else {
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
    };
    delete duplicatedProduct.id;
    delete duplicatedProduct.created_at;
    setEditingProduct(duplicatedProduct);
    setIsFormOpen(true);
  };

  const handleClose = () => {
    setIsFormOpen(false);
    setEditingProduct(null);
  };

  const formatFrequency = (freq) => {
    switch (freq) {
      case 'monthly': return 'Monthly';
      case 'quarterly': return 'Quarterly';
      case 'annually': return 'Annually';
      default: return freq;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Investor Products</h1>
            <p className="text-slate-500 mt-1">Configure interest rates and terms for investor accounts</p>
          </div>
          <Button onClick={() => setIsFormOpen(true)} className="bg-slate-900 hover:bg-slate-800">
            <Plus className="w-4 h-4 mr-2" />
            Add Product
          </Button>
        </div>

        {/* Content */}
        {isLoading || isLoadingOrgs || !currentOrganization ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array(3).fill(0).map((_, i) => (
              <Card key={i} className="h-48 animate-pulse bg-slate-100" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No investor products yet"
            description="Create your first investor product to configure interest rates for investor accounts"
            action={
              <Button onClick={() => setIsFormOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Product
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {products.map((product) => (
              <Card key={product.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-start justify-between pb-2">
                  <div>
                    <CardTitle className="text-lg">{product.name}</CardTitle>
                    <Badge
                      variant="outline"
                      className={product.status === 'Active'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 mt-2'
                        : 'bg-slate-50 text-slate-500 border-slate-200 mt-2'
                      }
                    >
                      {product.status}
                    </Badge>
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
                        onClick={() => deleteMutation.mutate(product.id)}
                        className="text-red-600"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Calculation Type Badge */}
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={product.interest_calculation_type === 'manual'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-blue-50 text-blue-700 border-blue-200'
                      }
                    >
                      {product.interest_calculation_type === 'manual' ? (
                        <><PenLine className="w-3 h-3 mr-1" /> Manual Entry</>
                      ) : (
                        <><Percent className="w-3 h-3 mr-1" /> Auto Calculate</>
                      )}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {product.interest_calculation_type !== 'manual' && (
                      <>
                        <div className="flex items-center gap-2">
                          <div className="p-2 rounded-lg bg-blue-100">
                            <Percent className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Interest Rate</p>
                            <p className="font-semibold">{product.interest_rate_per_annum}% p.a.</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="p-2 rounded-lg bg-purple-100">
                            <Clock className="w-4 h-4 text-purple-600" />
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Posting</p>
                            <p className="font-semibold">{formatFrequency(product.interest_posting_frequency)}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 col-span-2">
                          <div className="p-2 rounded-lg bg-green-100">
                            <Calendar className="w-4 h-4 text-green-600" />
                          </div>
                          <div>
                            <p className="text-xs text-slate-500">Posting Day</p>
                            <p className="font-semibold">
                              {product.interest_posting_day === 1 ? '1st' :
                               product.interest_posting_day === 2 ? '2nd' :
                               product.interest_posting_day === 3 ? '3rd' :
                               `${product.interest_posting_day || 1}th`} of month
                            </p>
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="pt-2 border-t space-y-2">
                    {product.min_balance_for_interest > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Min for Interest:</span>
                        <span className="font-medium text-slate-700">
                          {formatCurrency(product.min_balance_for_interest)}
                        </span>
                      </div>
                    )}
                    {product.min_balance_for_withdrawals > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Min for Withdrawal:</span>
                        <span className="font-medium text-slate-700">
                          {formatCurrency(product.min_balance_for_withdrawals)}
                        </span>
                      </div>
                    )}
                    {product.description && (
                      <p className="text-xs text-slate-500 pt-1">{product.description}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Form Dialog */}
        <Dialog open={isFormOpen} onOpenChange={handleClose}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingProduct ? 'Edit Investor Product' : 'Create Investor Product'}
              </DialogTitle>
            </DialogHeader>
            <InvestorProductForm
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
