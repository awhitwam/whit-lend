import { AlertTriangle, Info, XCircle } from 'lucide-react';

const ALERT_STYLES = {
  error: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    icon: XCircle,
    iconColor: 'text-red-500'
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    icon: AlertTriangle,
    iconColor: 'text-amber-500'
  },
  info: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-700',
    icon: Info,
    iconColor: 'text-blue-500'
  }
};

export default function GuardrailAlerts({ alerts = [] }) {
  if (!alerts || alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((alert, index) => {
        const style = ALERT_STYLES[alert.type] || ALERT_STYLES.info;
        const Icon = style.icon;

        return (
          <div
            key={index}
            className={`flex items-start gap-2 p-2 rounded-lg border ${style.bg} ${style.border}`}
          >
            <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${style.iconColor}`} />
            <div className={`text-sm ${style.text}`}>
              {alert.title && (
                <p className="font-medium">{alert.title}</p>
              )}
              <p>{alert.message}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Helper function to create guardrail alerts
export function createGuardrailAlerts(context) {
  const alerts = [];
  const { loan, investor, split, entry } = context;

  // Loan guardrails
  if (loan) {
    // Check loan status
    if (loan.status === 'Closed' || loan.status === 'Written Off') {
      alerts.push({
        type: 'error',
        title: 'Loan Closed',
        message: `This loan is ${loan.status.toLowerCase()}. Cannot apply payments.`
      });
    }

    // Check principal exceeds balance
    if (split?.principal && loan.outstanding_balance !== undefined) {
      if (split.principal > loan.outstanding_balance) {
        alerts.push({
          type: 'error',
          title: 'Principal Exceeds Balance',
          message: `Principal payment (${split.principal.toFixed(2)}) exceeds outstanding balance (${loan.outstanding_balance.toFixed(2)})`
        });
      }
    }

    // Check for overpayment
    if (split?.interest && loan.accrued_interest !== undefined) {
      if (split.interest > loan.accrued_interest * 1.1) {
        alerts.push({
          type: 'warning',
          title: 'Interest Overpayment',
          message: `Interest payment exceeds accrued interest by more than 10%`
        });
      }
    }

    // Early payment warning
    if (entry?.statement_date && loan.next_payment_date) {
      const entryDate = new Date(entry.statement_date);
      const dueDate = new Date(loan.next_payment_date);
      const daysDiff = Math.floor((dueDate - entryDate) / (1000 * 60 * 60 * 24));

      if (daysDiff > 14) {
        alerts.push({
          type: 'info',
          title: 'Early Payment',
          message: `Payment received ${daysDiff} days before due date`
        });
      }
    }

    // Late payment warning
    if (entry?.statement_date && loan.next_payment_date) {
      const entryDate = new Date(entry.statement_date);
      const dueDate = new Date(loan.next_payment_date);
      const daysDiff = Math.floor((entryDate - dueDate) / (1000 * 60 * 60 * 24));

      if (daysDiff > 7) {
        alerts.push({
          type: 'warning',
          title: 'Late Payment',
          message: `Payment received ${daysDiff} days after due date`
        });
      }
    }
  }

  // Investor guardrails
  if (investor) {
    // Check investor status
    if (investor.status === 'Inactive') {
      alerts.push({
        type: 'warning',
        title: 'Inactive Investor',
        message: 'This investor is marked as inactive'
      });
    }

    // Check withdrawal exceeds balance
    if (split?.capital && investor.current_capital_balance !== undefined) {
      if (split.capital > investor.current_capital_balance) {
        alerts.push({
          type: 'error',
          title: 'Withdrawal Exceeds Balance',
          message: `Withdrawal amount exceeds investor capital balance`
        });
      }
    }
  }

  return alerts;
}
