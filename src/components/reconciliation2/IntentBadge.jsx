import { Badge } from "@/components/ui/badge";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CreditCard,
  Wallet,
  Receipt,
  HelpCircle,
  Percent,
  Building2,
  Banknote
} from 'lucide-react';

// Intent type configuration
const INTENT_CONFIG = {
  loan_repayment: {
    label: 'Loan Repayment',
    shortLabel: 'Repayment',
    icon: ArrowDownToLine,
    color: 'bg-emerald-100 text-emerald-700 border-emerald-200'
  },
  loan_disbursement: {
    label: 'Loan Disbursement',
    shortLabel: 'Disbursement',
    icon: ArrowUpFromLine,
    color: 'bg-blue-100 text-blue-700 border-blue-200'
  },
  interest_only_payment: {
    label: 'Interest Payment',
    shortLabel: 'Interest',
    icon: Percent,
    color: 'bg-teal-100 text-teal-700 border-teal-200'
  },
  investor_funding: {
    label: 'Investor Funding',
    shortLabel: 'Inv Funding',
    icon: Wallet,
    color: 'bg-purple-100 text-purple-700 border-purple-200'
  },
  investor_withdrawal: {
    label: 'Investor Withdrawal',
    shortLabel: 'Inv W\'drawal',
    icon: Banknote,
    color: 'bg-violet-100 text-violet-700 border-violet-200'
  },
  investor_interest: {
    label: 'Investor Interest',
    shortLabel: 'Inv Interest',
    icon: Percent,
    color: 'bg-indigo-100 text-indigo-700 border-indigo-200'
  },
  operating_expense: {
    label: 'Operating Expense',
    shortLabel: 'Expense',
    icon: Receipt,
    color: 'bg-red-100 text-red-700 border-red-200'
  },
  platform_fee: {
    label: 'Platform Fee',
    shortLabel: 'Fee',
    icon: Building2,
    color: 'bg-orange-100 text-orange-700 border-orange-200'
  },
  transfer: {
    label: 'Internal Transfer',
    shortLabel: 'Transfer',
    icon: CreditCard,
    color: 'bg-slate-100 text-slate-700 border-slate-200'
  },
  unknown: {
    label: 'Unidentified',
    shortLabel: 'Unknown',
    icon: HelpCircle,
    color: 'bg-slate-100 text-slate-500 border-slate-200'
  }
};

// Confidence color thresholds
function getConfidenceColor(confidence) {
  if (confidence >= 90) return 'text-green-600';
  if (confidence >= 70) return 'text-amber-600';
  return 'text-red-500';
}

function getConfidenceBadgeColor(confidence) {
  if (confidence >= 90) return 'bg-green-50 border-green-200';
  if (confidence >= 70) return 'bg-amber-50 border-amber-200';
  return 'bg-red-50 border-red-200';
}

export default function IntentBadge({
  intent,
  confidence = 0,
  showConfidence = true,
  compact = false
}) {
  const config = INTENT_CONFIG[intent] || INTENT_CONFIG.unknown;
  const Icon = config.icon;
  const confidenceColor = getConfidenceColor(confidence);
  const badgeColor = showConfidence ? getConfidenceBadgeColor(confidence) : config.color;

  if (compact) {
    return (
      <Badge
        variant="outline"
        className={`${badgeColor} gap-1 text-xs font-medium`}
      >
        <Icon className="w-3 h-3" />
        {config.shortLabel}
        {showConfidence && (
          <span className={`ml-1 ${confidenceColor} font-semibold`}>
            {Math.round(confidence)}%
          </span>
        )}
      </Badge>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Badge
        variant="outline"
        className={`${config.color} gap-1.5 text-xs font-medium`}
      >
        <Icon className="w-3.5 h-3.5" />
        {config.label}
      </Badge>
      {showConfidence && (
        <span className={`text-xs font-semibold ${confidenceColor}`}>
          {Math.round(confidence)}%
        </span>
      )}
    </div>
  );
}

export { INTENT_CONFIG };
