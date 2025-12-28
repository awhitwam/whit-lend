import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from './LoanCalculator';
import { format, differenceInMonths } from 'date-fns';
import {
  Building2,
  Edit,
  History,
  Trash2,
  Landmark,
  AlertTriangle,
  MoreVertical,
  Home,
  Building,
  TreePine,
  Warehouse
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export default function PropertyCard({
  loanProperty,
  lastValuationDate,
  onEdit,
  onViewHistory,
  onRemove
}) {
  const { property, firstChargeHolder } = loanProperty;
  const STALE_MONTHS = 12;

  // Calculate security value
  const propertyValue = property?.current_value || 0;
  const securityValue = loanProperty.charge_type === 'Second Charge'
    ? Math.max(0, propertyValue - (loanProperty.first_charge_balance || 0))
    : propertyValue;

  // Check if valuation is stale
  const isStale = lastValuationDate
    ? differenceInMonths(new Date(), new Date(lastValuationDate)) >= STALE_MONTHS
    : true;

  const getPropertyTypeIcon = (type) => {
    switch (type) {
      case 'Residential':
        return <Home className="w-5 h-5" />;
      case 'Commercial':
        return <Building className="w-5 h-5" />;
      case 'Land':
        return <TreePine className="w-5 h-5" />;
      case 'Mixed Use':
        return <Warehouse className="w-5 h-5" />;
      default:
        return <Building2 className="w-5 h-5" />;
    }
  };

  const getPropertyTypeColor = (type) => {
    switch (type) {
      case 'Residential':
        return 'bg-blue-100 text-blue-600';
      case 'Commercial':
        return 'bg-purple-100 text-purple-600';
      case 'Land':
        return 'bg-green-100 text-green-600';
      case 'Mixed Use':
        return 'bg-amber-100 text-amber-600';
      default:
        return 'bg-slate-100 text-slate-600';
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-3">
            <div className={`p-2 rounded-lg ${getPropertyTypeColor(property?.property_type)}`}>
              {getPropertyTypeIcon(property?.property_type)}
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">{property?.address}</h3>
              <p className="text-sm text-slate-500">
                {property?.city}{property?.postcode ? `, ${property.postcode}` : ''}
              </p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onViewHistory}>
                <History className="w-4 h-4 mr-2" />
                Valuation History
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onRemove} className="text-red-600">
                <Trash2 className="w-4 h-4 mr-2" />
                Remove from Loan
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <p className="text-xs text-slate-500">Current Value</p>
            <p className="font-semibold">{formatCurrency(propertyValue)}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Security Value</p>
            <p className="font-semibold text-emerald-600">{formatCurrency(securityValue)}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={`${
            loanProperty.charge_type === 'First Charge'
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-amber-100 text-amber-700'
          }`}>
            {loanProperty.charge_type}
          </Badge>
          <Badge variant="outline">{property?.property_type}</Badge>
          {isStale && (
            <Badge className="bg-red-100 text-red-700">
              <AlertTriangle className="w-3 h-3 mr-1" />
              Valuation Due
            </Badge>
          )}
        </div>

        {loanProperty.charge_type === 'Second Charge' && (
          <div className="mt-3 p-2 bg-slate-50 rounded-lg">
            <div className="flex items-center gap-2 text-sm">
              <Landmark className="w-4 h-4 text-slate-400" />
              <span className="text-slate-600">
                First Charge: <span className="font-medium">{firstChargeHolder?.name || 'Unknown'}</span>
              </span>
            </div>
            <p className="text-sm text-slate-500 ml-6">
              Balance: {formatCurrency(loanProperty.first_charge_balance || 0)}
            </p>
          </div>
        )}

        {lastValuationDate && (
          <div className="mt-2 text-xs text-slate-400">
            Last valued: {format(new Date(lastValuationDate), 'dd MMM yyyy')}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
