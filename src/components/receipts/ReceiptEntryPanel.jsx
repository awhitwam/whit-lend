import { Button } from '@/components/ui/button';
import { Receipt, User, Building, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import ReceiptEntryContent from './ReceiptEntryContent';

/**
 * Docked bottom panel for receipt entry
 * Slides up from the bottom, keeping page content visible above
 *
 * Used from LoanDetails and BorrowerDetails pages
 *
 * Modes:
 * - loan: Borrower & loan locked, single receipt entry
 * - borrower: Borrower locked, select from borrower's loans, multi-row
 */
export default function ReceiptEntryPanel({
  open,
  onOpenChange,
  mode = 'loan',
  borrowerId,
  borrower = null,
  loanId = null,
  loan = null,
  onFileComplete = null
}) {
  // Build title based on mode and available data
  const getTitle = () => {
    if (mode === 'loan' && loan) {
      return `Receipt for Loan #${loan.loan_number}`;
    }
    if (borrower) {
      const name = borrower.full_name || borrower.business || 'Borrower';
      return `Receipt for ${name}`;
    }
    return 'Record Receipt';
  };

  // Get borrower display info
  const getBorrowerDisplay = () => {
    if (!borrower) return null;
    const name = borrower.full_name || borrower.business || 'Unknown';
    const hasBusiness = borrower.business && borrower.full_name;
    return { name, business: hasBusiness ? borrower.business : null };
  };

  const borrowerDisplay = getBorrowerDisplay();

  const handleFileComplete = () => {
    onFileComplete?.();
    onOpenChange(false);
  };

  return (
    <div
      className={cn(
        'fixed bottom-0 left-0 md:left-64 right-0 z-40 bg-white border-t shadow-2xl',
        'transform transition-transform duration-300 ease-out',
        open ? 'translate-y-0' : 'translate-y-full'
      )}
      style={{ maxHeight: '60vh' }}
    >
      {/* Panel Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-slate-50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-slate-600" />
            <span className="font-medium text-slate-900">{getTitle()}</span>
          </div>

          {/* Borrower badge */}
          {borrowerDisplay && (
            <div className="flex items-center gap-1.5 text-sm text-slate-500 border-l pl-3">
              {borrower?.business ? (
                <Building className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <User className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>{borrowerDisplay.name}</span>
              {borrowerDisplay.business && (
                <span className="text-slate-400">({borrowerDisplay.business})</span>
              )}
            </div>
          )}

          {/* Loan badge */}
          {mode === 'loan' && loan && (
            <div className="flex items-center gap-2 text-sm border-l pl-3">
              {loan.product_name && (
                <span className="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-xs">
                  {loan.product_name}
                </span>
              )}
              {loan.description && (
                <span className="text-slate-500 truncate max-w-[200px]">
                  {loan.description}
                </span>
              )}
            </div>
          )}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onOpenChange(false)}
          className="h-7 w-7 p-0"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      {/* Content - scrollable */}
      <div className="overflow-y-auto" style={{ maxHeight: 'calc(60vh - 48px)' }}>
        <div className="p-4">
          <ReceiptEntryContent
            mode={mode}
            lockedBorrowerId={borrowerId}
            lockedBorrower={borrower}
            lockedLoanId={loanId}
            lockedLoan={loan}
            compact={true}
            onFileComplete={handleFileComplete}
          />
        </div>
      </div>
    </div>
  );
}
