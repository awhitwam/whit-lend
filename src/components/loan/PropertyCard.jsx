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
  Warehouse,
  TrendingUp
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
  lastFirstChargeBalanceDate,
  onEdit,
  onUpdateValuation,
  onViewHistory,
  onRemove
}) {
  const { property, firstChargeHolder } = loanProperty;
  const STALE_VALUATION_MONTHS = 12;
  const STALE_BALANCE_MONTHS = 6;

  // Calculate security value
  const propertyValue = property?.current_value || 0;
  const securityValue = loanProperty.charge_type === 'Second Charge'
    ? Math.max(0, propertyValue - (loanProperty.first_charge_balance || 0))
    : propertyValue;

  // Check if valuation is stale
  const isStale = lastValuationDate
    ? differenceInMonths(new Date(), new Date(lastValuationDate)) >= STALE_VALUATION_MONTHS
    : true;

  // Calculate first charge balance age (for second charges)
  const balanceAgeMonths = lastFirstChargeBalanceDate
    ? differenceInMonths(new Date(), new Date(lastFirstChargeBalanceDate))
    : null;

  const isBalanceStale = loanProperty.charge_type === 'Second Charge' &&
    (balanceAgeMonths === null || balanceAgeMonths >= STALE_BALANCE_MONTHS);

  // Calculate valuation age in months
  const valuationAgeMonths = lastValuationDate
    ? differenceInMonths(new Date(), new Date(lastValuationDate))
    : null;

  // Get colors for age card: returns bg, border, text colors
  const getAgeColors = (months, staleThreshold) => {
    if (months === null) return { bg: 'bg-slate-100', border: 'border-slate-200', text: 'text-slate-500', value: 'text-slate-600' };
    if (months < staleThreshold) return { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-600', value: 'text-emerald-700' };
    if (months < staleThreshold * 2) return { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-600', value: 'text-amber-700' };
    return { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-600', value: 'text-red-700' };
  };

  const valuationColors = getAgeColors(valuationAgeMonths, STALE_VALUATION_MONTHS);
  const balanceColors = getAgeColors(balanceAgeMonths, STALE_BALANCE_MONTHS);

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
        {/* Header with address and menu */}
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
              <DropdownMenuItem onClick={onUpdateValuation}>
                <TrendingUp className="w-4 h-4 mr-2" />
                Update Valuation
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

        {/* Main content: Values on left, Age cards on right */}
        <div className="flex gap-3">
          {/* Left side: Values and badges */}
          <div className="flex-1">
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
            </div>

            {/* First Charge holder info for second charges */}
            {loanProperty.charge_type === 'Second Charge' && (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Landmark className="w-4 h-4 text-slate-400" />
                <span className="text-slate-600">
                  {firstChargeHolder?.name || 'Unknown Lender'}
                </span>
              </div>
            )}
          </div>

          {/* Right side: Age indicator cards */}
          <div className="flex flex-col gap-2">
            {/* Valuation Age Card */}
            <div className={`px-3 py-2 rounded-lg border ${valuationColors.bg} ${valuationColors.border} text-center min-w-[80px]`}>
              <p className={`text-xs ${valuationColors.text} font-medium`}>Valuation</p>
              <p className={`text-xl font-bold ${valuationColors.value}`}>
                {valuationAgeMonths !== null ? `${valuationAgeMonths}m` : '?'}
              </p>
              {isStale && <AlertTriangle className={`w-4 h-4 mx-auto ${valuationColors.text}`} />}
            </div>

            {/* First Charge Balance Age Card (for second charges only) */}
            {loanProperty.charge_type === 'Second Charge' && (
              <div className={`px-3 py-2 rounded-lg border ${balanceColors.bg} ${balanceColors.border} text-center min-w-[80px]`}>
                <p className={`text-xs ${balanceColors.text} font-medium`}>1st Chg Bal</p>
                <p className={`text-xl font-bold ${balanceColors.value}`}>
                  {balanceAgeMonths !== null ? `${balanceAgeMonths}m` : '?'}
                </p>
                <p className={`text-xs ${balanceColors.text}`}>
                  {formatCurrency(loanProperty.first_charge_balance || 0)}
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
