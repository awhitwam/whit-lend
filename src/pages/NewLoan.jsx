import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileText, AlertCircle } from 'lucide-react';
import LoanApplicationForm from '@/components/loan/LoanApplicationForm';
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function NewLoan() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const preselectedBorrowerId = urlParams.get('borrower');
  const queryClient = useQueryClient();

  const { data: borrowers = [], isLoading: borrowersLoading } = useQuery({
    queryKey: ['borrowers'],
    queryFn: () => api.entities.Borrower.list()
  });

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['products'],
    queryFn: () => api.entities.LoanProduct.list()
  });

  const createLoanMutation = useMutation({
    mutationFn: async ({ loanData, schedule }) => {
      const loan = await api.entities.Loan.create(loanData);
      
      // Create repayment schedule entries
      const scheduleWithLoanId = schedule.map(row => ({
        ...row,
        loan_id: loan.id
      }));
      
      await api.entities.RepaymentSchedule.bulkCreate(scheduleWithLoanId);
      
      return loan;
    },
    onSuccess: (loan) => {
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      navigate(createPageUrl(`LoanDetails?id=${loan.id}`));
    }
  });

  const handleSubmit = (loanData, schedule) => {
    createLoanMutation.mutate({ loanData, schedule });
  };

  const isLoading = borrowersLoading || productsLoading;
  const activeBorrowers = borrowers.filter(b => b.status === 'Active');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        {/* Back Button */}
        <Link to={createPageUrl('Loans')}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Loans
          </Button>
        </Link>

        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">New Loan Application</h1>
          <p className="text-slate-500 mt-1">Create a new loan and generate repayment schedule</p>
        </div>

        {/* Alerts */}
        {activeBorrowers.length === 0 && !borrowersLoading && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No active borrowers found. Please <Link to={createPageUrl('Borrowers')} className="font-medium underline">add a borrower</Link> first.
            </AlertDescription>
          </Alert>
        )}

        {products.length === 0 && !productsLoading && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              No loan products found. Please <Link to={createPageUrl('Products')} className="font-medium underline">create a loan product</Link> first.
            </AlertDescription>
          </Alert>
        )}

        {/* Form */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Loan Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-96 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
              </div>
            ) : (
              <LoanApplicationForm
                borrowers={activeBorrowers}
                products={products}
                onSubmit={handleSubmit}
                isLoading={createLoanMutation.isPending}
                preselectedBorrowerId={preselectedBorrowerId}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}