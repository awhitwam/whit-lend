import { Receipt } from 'lucide-react';
import ReceiptEntryContent from '@/components/receipts/ReceiptEntryContent';

/**
 * Standalone Receipts page
 * Uses ReceiptEntryContent in standalone mode for full functionality
 */
export default function Receipts() {
  return (
    <div className="px-6 py-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Receipt className="w-6 h-6" />
          Receipts
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Record loan repayments and allocate to capital, interest, and fees
        </p>
      </div>

      {/* Receipt Entry Content */}
      <ReceiptEntryContent mode="standalone" />
    </div>
  );
}
