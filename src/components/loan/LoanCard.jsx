import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from './LoanCalculator';
import { format } from 'date-fns';
import { ChevronRight, Calendar, Banknote, TrendingUp, User } from 'lucide-react';

export default function LoanCard({ loan }) {
  const getStatusColor = (status) => {
    const colors = {
      'Pending': 'bg-slate-100 text-slate-700 border-slate-200',
      'Approved': 'bg-blue-50 text-blue-700 border-blue-200',
      'Active': 'bg-emerald-50 text-emerald-700 border-emerald-200',
      'Closed': 'bg-slate-100 text-slate-600 border-slate-200',
      'Defaulted': 'bg-red-50 text-red-700 border-red-200'
    };
    return colors[status] || colors['Pending'];
  };

  const principalRemaining = loan.principal_amount - (loan.principal_paid || 0);
  const interestRemaining = loan.total_interest - (loan.interest_paid || 0);
  const totalOutstanding = principalRemaining + interestRemaining;
  const progressPercent = ((loan.principal_paid || 0) + (loan.interest_paid || 0)) / loan.total_repayable * 100;

  return (
    <Card className="hover:shadow-md transition-shadow group">
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <User className="w-4 h-4 text-slate-400" />
              <h3 className="font-semibold text-slate-900">{loan.borrower_name}</h3>
            </div>
            <p className="text-sm text-slate-500">{loan.product_name}</p>
          </div>
          <Badge className={getStatusColor(loan.status)}>{loan.status}</Badge>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Banknote className="w-3.5 h-3.5" />
              Principal
            </div>
            <p className="font-semibold">{formatCurrency(loan.principal_amount)}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <TrendingUp className="w-3.5 h-3.5" />
              Interest
            </div>
            <p className="font-semibold text-amber-600">{loan.interest_rate}% ({loan.interest_type})</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Calendar className="w-3.5 h-3.5" />
              Start Date
            </div>
            <p className="font-medium text-sm">{format(new Date(loan.start_date), 'MMM dd, yyyy')}</p>
          </div>
          <div className="space-y-1">
            <div className="text-xs text-slate-500">Outstanding</div>
            <p className="font-semibold text-red-600">{formatCurrency(totalOutstanding)}</p>
          </div>
        </div>

        {loan.status === 'Active' && (
          <div className="mb-4">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-slate-500">Repayment Progress</span>
              <span className="font-medium">{progressPercent.toFixed(1)}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(progressPercent, 100)}%` }}
              />
            </div>
          </div>
        )}

        <Link to={createPageUrl(`LoanDetails?id=${loan.id}`)}>
          <Button variant="ghost" className="w-full group-hover:bg-slate-50">
            View Details
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}