import { useState, useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from './LoanCalculator';
import { differenceInMonths } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
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
  TrendingUp,
  MessageSquare,
  ExternalLink
} from 'lucide-react';
import { usePropertyDocumentCounts, DOCUMENT_TYPES } from './PropertyDocuments';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  const { documents } = usePropertyDocumentCounts(property?.id);
  const [thumbnailUrl, setThumbnailUrl] = useState(null);
  const [showImageLightbox, setShowImageLightbox] = useState(false);
  const STALE_VALUATION_MONTHS = 12;
  const STALE_BALANCE_MONTHS = 6;

  // Get the first photo for the thumbnail
  const firstPhoto = documents.find(d => d.document_type === 'photo' && d.storage_path && d.mime_type?.startsWith('image/'));

  // Load thumbnail for first photo
  useEffect(() => {
    if (firstPhoto?.storage_path) {
      supabase.storage
        .from('property-documents')
        .createSignedUrl(firstPhoto.storage_path, 3600)
        .then(({ data, error }) => {
          if (!error && data?.signedUrl) {
            setThumbnailUrl(data.signedUrl);
          }
        });
    } else {
      setThumbnailUrl(null);
    }
  }, [firstPhoto?.storage_path]);

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
      case 'Development Build':
        return <Building2 className="w-5 h-5" />;
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
      case 'Development Build':
        return 'bg-orange-100 text-orange-600';
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
            {/* Property thumbnail or type icon */}
            {thumbnailUrl ? (
              <button
                onClick={() => setShowImageLightbox(true)}
                className="w-16 h-16 rounded-lg overflow-hidden flex-shrink-0 bg-slate-100 hover:ring-2 hover:ring-blue-400 transition-all cursor-pointer"
              >
                <img
                  src={thumbnailUrl}
                  alt={property?.address}
                  className="w-full h-full object-cover"
                />
              </button>
            ) : (
              <div className={`w-16 h-16 rounded-lg flex items-center justify-center ${getPropertyTypeColor(property?.property_type)}`}>
                {getPropertyTypeIcon(property?.property_type)}
              </div>
            )}
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
                {loanProperty.first_charge_balance > 0 && (
                  <span className="text-slate-500">
                    ({formatCurrency(loanProperty.first_charge_balance)})
                  </span>
                )}
              </div>
            )}

            {/* Notes/Comments */}
            {loanProperty.notes && (
              <div className="mt-3 flex items-start gap-2 text-sm bg-slate-50 p-2 rounded-lg">
                <MessageSquare className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                <span className="text-slate-600 whitespace-pre-wrap">{loanProperty.notes}</span>
              </div>
            )}

            {/* Document links display */}
            {documents.some(d => d.external_url) && (
              <PropertyDocumentsDisplay documents={documents} />
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

      {/* Image Lightbox */}
      <Dialog open={showImageLightbox} onOpenChange={setShowImageLightbox}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{property?.address}</DialogTitle>
          </DialogHeader>
          {thumbnailUrl && (
            <div className="flex items-center justify-center">
              <img
                src={thumbnailUrl}
                alt={property?.address}
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// Component to display document links on the card
function PropertyDocumentsDisplay({ documents }) {
  // Only show linked documents (external URLs)
  const linkDocuments = documents.filter(d => d.external_url);

  const handleOpenLink = (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  if (linkDocuments.length === 0) {
    return null;
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-1.5">
        {linkDocuments.map((doc) => {
          const typeConfig = DOCUMENT_TYPES[doc.document_type] || DOCUMENT_TYPES.other;
          const Icon = typeConfig.icon;
          return (
            <button
              key={doc.id}
              onClick={() => handleOpenLink(doc.external_url)}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-800 transition-colors"
              title={doc.title}
            >
              <Icon className="w-3 h-3" />
              <span className="truncate max-w-[80px]">{typeConfig.label}</span>
              <ExternalLink className="w-2.5 h-2.5 text-slate-400" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
