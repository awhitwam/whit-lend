import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Shield, Calendar } from 'lucide-react';

export default function AlertsSection({ securityMetrics, loansMaturing }) {
  if (securityMetrics.loansWithHighLTV === 0 && loansMaturing.length === 0) return null;

  return (
    <div className="space-y-4">
      {securityMetrics.loansWithHighLTV > 0 && (
        <Card className="bg-gradient-to-r from-red-50 to-orange-50 border-red-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-red-100">
                <Shield className="w-5 h-5 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-red-900">High LTV Warning</h3>
                <p className="text-sm text-red-700">
                  {securityMetrics.loansWithHighLTV} loan{securityMetrics.loansWithHighLTV !== 1 ? 's' : ''} with LTV over 80%
                </p>
              </div>
              <Link to={createPageUrl('Loans?status=Live')}>
                <Button variant="outline" size="sm" className="border-red-300 text-red-700 hover:bg-red-100">
                  Review
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {loansMaturing.length > 0 && (
        <Card className="bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-xl bg-blue-100">
                <Calendar className="w-5 h-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-blue-900">Upcoming Maturities</h3>
                <p className="text-sm text-blue-700">
                  {loansMaturing.length} loan{loansMaturing.length !== 1 ? 's' : ''} maturing in the next 30 days
                </p>
              </div>
              <Link to={createPageUrl('Loans?status=Live')}>
                <Button variant="outline" size="sm" className="border-blue-300 text-blue-700 hover:bg-blue-100">
                  View
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
