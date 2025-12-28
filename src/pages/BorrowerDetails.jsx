import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Edit,
  Phone,
  Mail,
  MapPin,
  CreditCard,
  Plus,
  FileText,
  User,
  Calendar,
  Trash2,
  Archive,
  DollarSign,
  Loader2
} from 'lucide-react';
import BorrowerForm from '@/components/borrower/BorrowerForm';
import BorrowerPaymentModal from '@/components/borrower/BorrowerPaymentModal';
import LoanCard from '@/components/loan/LoanCard';
import { formatCurrency, applyManualPayment } from '@/components/loan/LoanCalculator';
import { toast } from 'sonner';
import { format } from 'date-fns';

export default function BorrowerDetails() {
  const urlParams = new URLSearchParams(window.location.search);
  const borrowerId = urlParams.get('id');
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: borrower, isLoading: borrowerLoading } = useQuery({
    queryKey: ['borrower', borrowerId],
    queryFn: async () => {
      const borrowers = await api.entities.Borrower.filter({ id: borrowerId });
      return borrowers[0];
    },
    enabled: !!borrowerId
  });

  const { data: loans = [], isLoading: loansLoading } = useQuery({
    queryKey: ['borrower-loans', borrowerId],
    queryFn: async () => {
      const allLoans = await api.entities.Loan.filter({ borrower_id: borrowerId }, '-created_date');
      return allLoans.filter(loan => !loan.is_deleted);
    },
    enabled: !!borrowerId
  });

  const { data: transactions = [] } = useQuery({
    queryKey: ['borrower-transactions', borrowerId],
    queryFn: () => api.entities.Transaction.filter({ borrower_id: borrowerId }, '-date'),
    enabled: !!borrowerId
  });

  const updateMutation = useMutation({
    mutationFn: (data) => api.entities.Borrower.update(borrowerId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['borrower', borrowerId] });
      setIsEditOpen(false);
    }
  });

  const deleteOrArchiveMutation = useMutation({
    mutationFn: async () => {
      if (loans.length === 0) {
        // Delete if no loans
        await api.entities.Borrower.delete(borrowerId);
        return { action: 'deleted' };
      } else {
        // Archive if has loans
        await api.entities.Borrower.update(borrowerId, {
          is_archived: true,
          archived_by: user?.email || 'unknown',
          archived_date: new Date().toISOString()
        });
        return { action: 'archived' };
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['borrowers'] });
      navigate(createPageUrl('Borrowers'));
    }
  });

  // Multi-loan payment mutation
  const borrowerPaymentMutation = useMutation({
    mutationFn: async (paymentData) => {
      setIsProcessingPayment(true);
      toast.loading('Processing payment...', { id: 'borrower-payment' });

      const results = [];

      // Process each loan allocation
      for (const allocation of paymentData.allocations) {
        // Fetch loan and schedule
        const [loanData] = await api.entities.Loan.filter({ id: allocation.loan_id });
        const scheduleData = await api.entities.RepaymentSchedule.filter(
          { loan_id: allocation.loan_id },
          'installment_number'
        );

        if (!loanData) continue;

        // Apply manual payment to this loan
        const { updates, principalReduction, creditAmount } = applyManualPayment(
          allocation.interest_amount,
          allocation.principal_amount,
          scheduleData,
          loanData.overpayment_credit || 0,
          paymentData.overpayment_option
        );

        let totalPrincipalApplied = 0;
        let totalInterestApplied = 0;

        // Update schedule rows
        for (const update of updates) {
          await api.entities.RepaymentSchedule.update(update.id, {
            interest_paid: update.interest_paid,
            principal_paid: update.principal_paid,
            status: update.status
          });
          totalPrincipalApplied += update.principalApplied;
          totalInterestApplied += update.interestApplied;
        }

        // Create transaction for this loan
        await api.entities.Transaction.create({
          loan_id: allocation.loan_id,
          borrower_id: paymentData.borrower_id,
          amount: allocation.interest_amount + allocation.principal_amount,
          date: paymentData.date,
          type: 'Repayment',
          reference: paymentData.reference,
          notes: paymentData.notes || `Multi-loan payment`,
          principal_applied: totalPrincipalApplied,
          interest_applied: totalInterestApplied
        });

        // Update loan totals
        const newPrincipalPaid = (loanData.principal_paid || 0) + totalPrincipalApplied;
        const newInterestPaid = (loanData.interest_paid || 0) + totalInterestApplied;

        const updateData = {
          principal_paid: newPrincipalPaid,
          interest_paid: newInterestPaid,
          overpayment_credit: creditAmount
        };

        // Check if loan is fully paid
        if (newPrincipalPaid >= loanData.principal_amount && newInterestPaid >= loanData.total_interest) {
          updateData.status = 'Closed';
        }

        await api.entities.Loan.update(allocation.loan_id, updateData);

        results.push({
          loan_id: allocation.loan_id,
          principal_applied: totalPrincipalApplied,
          interest_applied: totalInterestApplied
        });
      }

      return results;
    },
    onSuccess: async () => {
      setIsProcessingPayment(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['borrower-loans', borrowerId] }),
        queryClient.invalidateQueries({ queryKey: ['borrower-transactions', borrowerId] }),
        queryClient.invalidateQueries({ queryKey: ['loans'] })
      ]);
      toast.success('Payment recorded successfully', { id: 'borrower-payment' });
      setIsPaymentOpen(false);
    },
    onError: (error) => {
      setIsProcessingPayment(false);
      toast.error('Failed to record payment: ' + error.message, { id: 'borrower-payment' });
    }
  });

  const handleDeleteOrArchive = () => {
    const action = loans.length === 0 ? 'delete' : 'archive';
    const message = loans.length === 0 
      ? 'Are you sure you want to delete this borrower? This action cannot be undone.'
      : `This borrower has ${loans.length} loan(s). They will be archived instead of deleted. Continue?`;
    
    if (window.confirm(message)) {
      deleteOrArchiveMutation.mutate();
    }
  };

  if (borrowerLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
        <div className="h-64 bg-white rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (!borrower) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 md:p-6">
        <div className="text-center py-20">
          <h2 className="text-2xl font-bold text-slate-900">Borrower not found</h2>
          <Link to={createPageUrl('Borrowers')}>
            <Button className="mt-4">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Borrowers
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const activeLoans = loans.filter(l => l.status === 'Active');
  const totalBorrowed = loans.reduce((sum, l) => sum + (l.principal_amount || 0), 0);
  const totalRepaid = transactions.filter(t => t.type === 'Repayment').reduce((sum, t) => sum + (t.amount || 0), 0);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        {/* Back Button */}
        <Link to={createPageUrl('Borrowers')}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Borrowers
          </Button>
        </Link>

        {/* Profile Header */}
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-slate-800 to-slate-700 p-6 text-white">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center">
                  <User className="w-8 h-8" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold">{borrower.first_name} {borrower.last_name}</h1>
                  <p className="text-slate-300">ID: {borrower.id_number}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Badge 
                  className={borrower.status === 'Active' 
                    ? 'bg-emerald-500/20 text-emerald-200 border-emerald-400' 
                    : 'bg-red-500/20 text-red-200 border-red-400'
                  }
                >
                  {borrower.status}
                </Badge>
                <Button variant="secondary" size="sm" onClick={() => setIsEditOpen(true)}>
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </Button>
                {loans.filter(l => l.status === 'Live' || l.status === 'Active').length > 0 && (
                  <Button
                    size="sm"
                    onClick={() => setIsPaymentOpen(true)}
                    className="bg-emerald-600 hover:bg-emerald-700"
                  >
                    <DollarSign className="w-4 h-4 mr-2" />
                    Record Payment
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteOrArchive}
                  disabled={deleteOrArchiveMutation.isPending}
                >
                  {loans.length === 0 ? (
                    <>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </>
                  ) : (
                    <>
                      <Archive className="w-4 h-4 mr-2" />
                      Archive
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-slate-100">
                  <Phone className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Phone</p>
                  <p className="font-medium">{borrower.phone}</p>
                </div>
              </div>
              {borrower.email && (
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-slate-100">
                    <Mail className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Email</p>
                    <p className="font-medium text-sm">{borrower.email}</p>
                  </div>
                </div>
              )}
              {borrower.address && (
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-slate-100">
                    <MapPin className="w-4 h-4 text-slate-600" />
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Address</p>
                    <p className="font-medium text-sm">{borrower.address}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-slate-100">
                  <Calendar className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500">Member Since</p>
                  <p className="font-medium">{format(new Date(borrower.created_date), 'MMM dd, yyyy')}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Active Loans</p>
                  <p className="text-2xl font-bold">{activeLoans.length}</p>
                </div>
                <div className="p-3 rounded-xl bg-blue-100">
                  <FileText className="w-5 h-5 text-blue-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Total Borrowed</p>
                  <p className="text-2xl font-bold">{formatCurrency(totalBorrowed)}</p>
                </div>
                <div className="p-3 rounded-xl bg-purple-100">
                  <CreditCard className="w-5 h-5 text-purple-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-500">Total Repaid</p>
                  <p className="text-2xl font-bold">{formatCurrency(totalRepaid)}</p>
                </div>
                <div className="p-3 rounded-xl bg-emerald-100">
                  <CreditCard className="w-5 h-5 text-emerald-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs defaultValue="loans" className="space-y-4">
          <TabsList>
            <TabsTrigger value="loans">Loans ({loans.length})</TabsTrigger>
            <TabsTrigger value="transactions">Transactions ({transactions.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="loans" className="space-y-4">
            <div className="flex justify-end">
              <Link to={createPageUrl(`NewLoan?borrower=${borrowerId}`)}>
                <Button size="sm">
                  <Plus className="w-4 h-4 mr-2" />
                  New Loan
                </Button>
              </Link>
            </div>
            {loans.length === 0 ? (
              <Card className="border-dashed border-2">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <FileText className="w-12 h-12 text-slate-300 mb-4" />
                  <p className="text-slate-500">No loans found</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {loans.map((loan) => (
                  <LoanCard key={loan.id} loan={loan} />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="transactions">
            {transactions.length === 0 ? (
              <Card className="border-dashed border-2">
                <CardContent className="flex flex-col items-center justify-center py-12">
                  <CreditCard className="w-12 h-12 text-slate-300 mb-4" />
                  <p className="text-slate-500">No transactions found</p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <div className="divide-y">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-lg ${tx.type === 'Repayment' ? 'bg-emerald-100' : 'bg-blue-100'}`}>
                            <CreditCard className={`w-4 h-4 ${tx.type === 'Repayment' ? 'text-emerald-600' : 'text-blue-600'}`} />
                          </div>
                          <div>
                            <p className="font-medium">{tx.type}</p>
                            <p className="text-sm text-slate-500">{format(new Date(tx.date), 'MMM dd, yyyy')}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`font-semibold ${tx.type === 'Repayment' ? 'text-emerald-600' : 'text-blue-600'}`}>
                            {tx.type === 'Repayment' ? '+' : '-'}{formatCurrency(tx.amount)}
                          </p>
                          {tx.reference && <p className="text-xs text-slate-500">{tx.reference}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* Edit Dialog */}
        <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edit Borrower</DialogTitle>
            </DialogHeader>
            <BorrowerForm
              borrower={borrower}
              onSubmit={(data) => updateMutation.mutate(data)}
              onCancel={() => setIsEditOpen(false)}
              isLoading={updateMutation.isPending}
            />
          </DialogContent>
        </Dialog>

        {/* Borrower Payment Modal */}
        <BorrowerPaymentModal
          isOpen={isPaymentOpen}
          onClose={() => setIsPaymentOpen(false)}
          borrower={borrower}
          loans={loans}
          onSubmit={(data) => borrowerPaymentMutation.mutate(data)}
          isLoading={borrowerPaymentMutation.isPending || isProcessingPayment}
        />
      </div>
    </div>
  );
}