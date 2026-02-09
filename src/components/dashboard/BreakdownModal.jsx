import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatCurrency } from '@/components/loan/LoanCalculator';
import { Search, X } from 'lucide-react';

export default function BreakdownModal({
  activeBreakdown,
  setActiveBreakdown,
  searchTerm,
  setSearchTerm,
  breakdownTitles,
  breakdownDescriptions,
  getFilteredBreakdown
}) {
  const navigate = useNavigate();

  return (
    <Dialog open={!!activeBreakdown} onOpenChange={(open) => { if (!open) { setActiveBreakdown(null); setSearchTerm(''); } }}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{breakdownTitles[activeBreakdown]}</DialogTitle>
          <DialogDescription>
            {breakdownDescriptions[activeBreakdown]} - Click a row to view loan details
          </DialogDescription>
        </DialogHeader>

        {/* Search Box */}
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Search by borrower or loan #..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Results Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b">
                <th className="text-left py-2 px-2 text-sm font-medium text-slate-500">Loan #</th>
                <th className="text-left py-2 px-2 text-sm font-medium text-slate-500">Borrower</th>
                <th className="text-right py-2 px-2 text-sm font-medium text-slate-500">
                  {activeBreakdown === 'borrowers' ? 'Status' : 'Amount'}
                </th>
              </tr>
            </thead>
            <tbody>
              {getFilteredBreakdown(activeBreakdown).map(item => (
                <tr
                  key={item.loan.id}
                  className="border-b hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={() => {
                    navigate(createPageUrl(`LoanDetails?id=${item.loan.id}`));
                    setActiveBreakdown(null);
                    setSearchTerm('');
                  }}
                >
                  <td className="py-2.5 px-2 text-sm font-mono text-slate-600">#{item.loan.loan_number}</td>
                  <td className="py-2.5 px-2 text-sm font-medium text-slate-900">{item.loan.borrower_name}</td>
                  <td className="py-2.5 px-2 text-right text-sm font-mono font-semibold text-slate-700">
                    {activeBreakdown === 'borrowers' ? (
                      <span className="text-emerald-600">{item.loan.status}</span>
                    ) : (
                      formatCurrency(item.value)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            {activeBreakdown !== 'borrowers' && (
              <tfoot className="sticky bottom-0 bg-white border-t-2">
                <tr className="font-bold">
                  <td colSpan={2} className="py-2.5 px-2 text-sm text-slate-900">
                    Total ({getFilteredBreakdown(activeBreakdown).length} loans)
                  </td>
                  <td className="py-2.5 px-2 text-right text-sm font-mono text-slate-900">
                    {formatCurrency(getFilteredBreakdown(activeBreakdown).reduce((sum, d) => sum + (d.value || 0), 0))}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>

          {getFilteredBreakdown(activeBreakdown).length === 0 && (
            <div className="py-8 text-center text-slate-500">
              {searchTerm ? 'No loans match your search' : 'No data available'}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
