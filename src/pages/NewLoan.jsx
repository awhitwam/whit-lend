import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { api } from '@/api/dataClient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useOrganization } from '@/lib/OrganizationContext';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, FileText, AlertCircle } from 'lucide-react';
import LoanApplicationForm from '@/components/loan/LoanApplicationForm';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { regenerateLoanSchedule } from '@/components/loan/LoanScheduleManager';

export default function NewLoan() {
  const navigate = useNavigate();
  const urlParams = new URLSearchParams(window.location.search);
  const preselectedBorrowerId = urlParams.get('borrower');
  const queryClient = useQueryClient();
  const { currentOrganization } = useOrganization();

  const { data: borrowers = [], isLoading: borrowersLoading } = useQuery({
    queryKey: ['borrowers', currentOrganization?.id],
    queryFn: () => api.entities.Borrower.list(),
    enabled: !!currentOrganization
  });

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ['products', currentOrganization?.id],
    queryFn: () => api.entities.LoanProduct.list(),
    enabled: !!currentOrganization
  });

  const createLoanMutation = useMutation({
    mutationFn: async ({ loanData, schedule }) => {
      // DEBUG: Log the loan data being sent to the database
      console.log('=== LOAN CREATE DEBUG ===');
      console.log('Full loanData:', JSON.stringify(loanData, null, 2));
      console.log('Fields with empty strings:');
      Object.entries(loanData).forEach(([key, value]) => {
        if (value === '') console.log(`  ${key}: "" (empty string)`);
        if (value === null) console.log(`  ${key}: null`);
        if (value === undefined) console.log(`  ${key}: undefined`);
      });
      console.log('=========================');

      const loan = await api.entities.Loan.create(loanData);

      // For Roll-Up & Serviced loans, use the scheduler system to generate the schedule
      // This ensures proper roll-up interest calculation and schedule structure
      const isRollUpServiced = loanData.product_type === 'Roll-Up & Serviced';

      if (isRollUpServiced) {
        console.log('=== Roll-Up & Serviced: Using scheduler system ===');
        // Create disbursement first so scheduler has transaction data
        if (loan.start_date && loan.status !== 'Pending') {
          const grossAmount = loan.principal_amount;
          const deductedFee = loan.arrangement_fee || 0;
          const additionalFees = loan.additional_deducted_fees || 0;
          const netAmount = loan.net_disbursed || (grossAmount - deductedFee - additionalFees);

          if (netAmount >= 0) {
            const deductionParts = [];
            if (deductedFee > 0) deductionParts.push(`£${deductedFee.toFixed(2)} arrangement fee`);
            if (additionalFees > 0) deductionParts.push(`£${additionalFees.toFixed(2)} additional fees`);
            const disbursementNotes = deductionParts.length > 0
              ? `Initial loan disbursement (${deductionParts.join(' + ')} deducted)`
              : 'Initial loan disbursement';

            await api.entities.Transaction.create({
              loan_id: loan.id,
              borrower_id: loan.borrower_id,
              date: loan.start_date,
              type: 'Disbursement',
              gross_amount: grossAmount,
              deducted_fee: deductedFee,
              amount: netAmount,
              principal_applied: grossAmount,
              interest_applied: 0,
              fees_applied: deductedFee,
              notes: disbursementNotes
            });
          }
        }

        // Now generate the schedule using the scheduler system
        await regenerateLoanSchedule(loan.id);
        return loan;
      }

      // Standard loan flow - create schedule from preview
      const scheduleWithLoanId = schedule.map(row => ({
        ...row,
        loan_id: loan.id
      }));

      await api.entities.RepaymentSchedule.bulkCreate(scheduleWithLoanId);

      // Create initial Disbursement transaction if loan is released (has start_date)
      if (loan.start_date && loan.status !== 'Pending') {
        const grossAmount = loan.principal_amount;
        const deductedFee = loan.arrangement_fee || 0;
        const deductedInterest = loan.advance_interest || 0;  // Support advance interest at loan creation
        const netAmount = loan.net_disbursed || (grossAmount - deductedFee - deductedInterest);

        if (netAmount >= 0) {
          // Build disbursement notes
          const deductionParts = [];
          if (deductedFee > 0) deductionParts.push(`£${deductedFee.toFixed(2)} arrangement fee`);
          if (deductedInterest > 0) deductionParts.push(`£${deductedInterest.toFixed(2)} advance interest`);
          const disbursementNotes = deductionParts.length > 0
            ? `Initial loan disbursement (${deductionParts.join(' + ')} deducted)`
            : 'Initial loan disbursement';

          const disbursement = await api.entities.Transaction.create({
            loan_id: loan.id,
            borrower_id: loan.borrower_id,
            date: loan.start_date,
            type: 'Disbursement',
            gross_amount: grossAmount,
            deducted_fee: deductedFee,
            deducted_interest: deductedInterest,
            amount: netAmount,  // Net cash paid
            principal_applied: grossAmount,  // Full gross goes to principal
            interest_applied: 0,  // Interest is handled by linked repayment
            fees_applied: deductedFee,
            notes: disbursementNotes
          });

          // If there's deducted interest, create a linked repayment transaction
          if (deductedInterest > 0) {
            await api.entities.Transaction.create({
              loan_id: loan.id,
              borrower_id: loan.borrower_id,
              date: loan.start_date,
              type: 'Repayment',
              amount: deductedInterest,
              principal_applied: 0,
              interest_applied: deductedInterest,
              fees_applied: 0,
              linked_disbursement_id: disbursement.id,
              notes: 'Advance interest deducted from disbursement'
            });
          }
        }
      }

      return loan;
    },
    onSuccess: (loan) => {
      console.log('=== Loan created successfully ===', loan.id);
      queryClient.invalidateQueries({ queryKey: ['loans'] });
      navigate(createPageUrl(`LoanDetails?id=${loan.id}`));
    },
    onError: (error) => {
      console.error('=== Loan creation failed ===', error);
    }
  });

  const handleSubmit = (loanData, schedule) => {
    createLoanMutation.mutate({ loanData, schedule });
  };

  const isLoading = borrowersLoading || productsLoading;
  const activeBorrowers = borrowers.filter(b => b.status === 'Active');

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
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