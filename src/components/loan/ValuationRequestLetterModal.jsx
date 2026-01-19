import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format, differenceInMonths } from 'date-fns';
import { formatCurrency } from './LoanCalculator';
import { generateValuationRequestPDF as generatePDF } from './LoanPDFGenerator';
import {
  FileText,
  Download,
  Mail,
  Send,
  Loader2,
  Building2,
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  Edit,
  Eye
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';

const DEFAULT_HEADER = `Re: Request for Updated Property Valuation Evidence

Dear {borrowerName},

We are writing regarding your loan facility referenced above. As part of our ongoing loan management procedures, we require updated valuation evidence for the property/properties securing this loan.

Our records indicate that the most recent valuation on file is now over 12 months old.`;

const DEFAULT_FOOTER = `Please arrange for a current market valuation to be carried out by a RICS qualified surveyor and provide us with a copy of the valuation report within 28 days of the date of this letter.

If you have any questions regarding this request, please do not hesitate to contact us.

Yours sincerely,`;

export default function ValuationRequestLetterModal({
  isOpen,
  onClose,
  loan,
  loanProperties = [],
  borrower,
  organization,
  ltvMetrics = null
}) {
  const [step, setStep] = useState('preview'); // 'preview' | 'delivery'
  const [headerText, setHeaderText] = useState(
    organization?.settings?.letter_header || DEFAULT_HEADER
  );
  const [footerText, setFooterText] = useState(
    organization?.settings?.letter_footer || DEFAULT_FOOTER
  );
  const [recipientEmail, setRecipientEmail] = useState(
    borrower?.email || ''
  );
  const [isSending, setIsSending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const borrowerName = borrower?.business ||
    `${borrower?.first_name || ''} ${borrower?.last_name || ''}`.trim() ||
    'The Borrower';

  // Calculate valuation ages for display
  const propertiesWithAge = loanProperties.map(lp => {
    const property = lp.property || lp;
    let ageMonths = null;
    if (lp.lastValuationDate) {
      ageMonths = differenceInMonths(new Date(), new Date(lp.lastValuationDate));
    }
    return { ...lp, property, ageMonths };
  });

  const staleProperties = propertiesWithAge.filter(p => p.ageMonths === null || p.ageMonths >= 12);

  const handleDownloadPDF = () => {
    try {
      const doc = generatePDF({
        loan,
        loanProperties: propertiesWithAge,
        borrower,
        organization,
        headerText,
        footerText,
        ltvMetrics
      });

      const safeBorrowerName = borrowerName.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 20);
      doc.save(`valuation-request-${loan.loan_number || 'loan'}-${safeBorrowerName}-${format(new Date(), 'yyyy-MM-dd')}.pdf`);

      toast.success('Letter downloaded successfully');
    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error('Failed to generate PDF: ' + error.message);
    }
  };

  const handleSendEmail = async () => {
    if (!recipientEmail) {
      toast.error('Please enter a recipient email address');
      return;
    }

    setIsSending(true);
    try {
      // Generate PDF as base64
      const doc = generatePDF({
        loan,
        loanProperties: propertiesWithAge,
        borrower,
        organization,
        headerText,
        footerText,
        ltvMetrics
      });
      const pdfBase64 = doc.output('datauristring').split(',')[1];
      const fileName = `valuation-request-${loan.loan_number || 'loan'}-${format(new Date(), 'yyyy-MM-dd')}.pdf`;

      // Call edge function to send email
      const { data, error } = await supabase.functions.invoke('send-valuation-letter', {
        body: {
          recipientEmail,
          subject: `Request for Updated Property Valuation - Loan #${loan.loan_number || loan.id?.slice(0, 8)}`,
          borrowerName,
          loanNumber: loan.loan_number || loan.id?.slice(0, 8),
          organizationName: organization?.name || 'The Lender',
          pdfBase64,
          fileName
        }
      });

      if (error) throw error;

      toast.success('Letter sent successfully to ' + recipientEmail);
      onClose();
    } catch (error) {
      console.error('Email sending error:', error);
      toast.error('Failed to send email: ' + (error.message || 'Unknown error'));
    } finally {
      setIsSending(false);
    }
  };

  const resetAndClose = () => {
    setStep('preview');
    setIsEditing(false);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={resetAndClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-amber-600" />
            Valuation Request Letter
          </DialogTitle>
          <DialogDescription>
            {step === 'preview'
              ? 'Preview and customize the letter before sending'
              : 'Choose how to deliver the letter'
            }
          </DialogDescription>
        </DialogHeader>

        {step === 'preview' && (
          <div className="space-y-4">
            {/* Stale Valuations Warning */}
            {staleProperties.length > 0 && (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                  {staleProperties.length} property valuations are over 12 months old
                </AlertDescription>
              </Alert>
            )}

            {/* Edit/Preview Toggle */}
            <div className="flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditing(!isEditing)}
              >
                {isEditing ? (
                  <><Eye className="w-4 h-4 mr-1" /> Preview</>
                ) : (
                  <><Edit className="w-4 h-4 mr-1" /> Edit Text</>
                )}
              </Button>
            </div>

            {/* Letter Preview / Edit */}
            <Card className="border-slate-200">
              <CardContent className="p-4 space-y-4">
                {/* Organization Header */}
                <div className="text-center border-b pb-3">
                  <p className="font-bold text-lg">{organization?.name || 'Organization'}</p>
                  {organization?.address_line1 && (
                    <p className="text-sm text-slate-600">{organization.address_line1}</p>
                  )}
                  {(organization?.city || organization?.postcode) && (
                    <p className="text-sm text-slate-600">
                      {[organization.city, organization.postcode].filter(Boolean).join(' ')}
                    </p>
                  )}
                </div>

                {/* Date */}
                <p className="text-sm">{format(new Date(), 'dd MMMM yyyy')}</p>

                {/* Recipient */}
                <div className="text-sm">
                  <p className="font-semibold">{borrowerName}</p>
                  {borrower?.address && <p className="text-slate-600">{borrower.address}</p>}
                  {(borrower?.city || borrower?.zipcode) && (
                    <p className="text-slate-600">
                      {[borrower.city, borrower.zipcode].filter(Boolean).join(' ')}
                    </p>
                  )}
                </div>

                {/* Header Text */}
                {isEditing ? (
                  <div className="space-y-2">
                    <Label>Letter Opening</Label>
                    <Textarea
                      value={headerText}
                      onChange={(e) => setHeaderText(e.target.value)}
                      rows={6}
                      className="text-sm"
                      placeholder="Enter the opening text of your letter..."
                    />
                    <p className="text-xs text-slate-500">
                      Use {'{borrowerName}'} to insert the borrower's name
                    </p>
                  </div>
                ) : (
                  <div className="text-sm whitespace-pre-wrap bg-slate-50 p-3 rounded">
                    {headerText.replace(/{borrowerName}/g, borrowerName)}
                  </div>
                )}

                {/* Loan Details */}
                <div className="bg-slate-50 p-3 rounded">
                  <p className="font-semibold text-sm mb-2">LOAN DETAILS</p>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-slate-600">Loan Reference:</span>{' '}
                      <span className="font-medium">#{loan.loan_number || loan.id?.slice(0, 8)}</span>
                    </div>
                    <div>
                      <span className="text-slate-600">Principal:</span>{' '}
                      <span className="font-medium">{formatCurrency(loan.principal_amount)}</span>
                    </div>
                    <div>
                      <span className="text-slate-600">Status:</span>{' '}
                      <Badge variant="outline" className="ml-1">{loan.status}</Badge>
                    </div>
                    {ltvMetrics?.ltv != null && (
                      <div>
                        <span className="text-slate-600">Current LTV:</span>{' '}
                        <span className="font-medium">{ltvMetrics.ltv.toFixed(1)}%</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Security Details */}
                <div className="bg-slate-50 p-3 rounded">
                  <p className="font-semibold text-sm mb-2">SECURITY DETAILS</p>
                  {propertiesWithAge.length > 0 ? (
                    <div className="space-y-2">
                      {propertiesWithAge.map((lp, idx) => (
                        <div key={lp.id || idx} className="flex items-start gap-2 text-sm border-b border-slate-200 pb-2 last:border-0">
                          <Building2 className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="font-medium">{lp.property?.address || 'Unknown Address'}</p>
                            <div className="flex items-center gap-2 text-xs text-slate-600">
                              <span>{lp.property?.property_type}</span>
                              <span>•</span>
                              <Badge variant="outline" className="text-xs">
                                {lp.charge_type === 'Second Charge' ? '2nd Charge' : '1st Charge'}
                              </Badge>
                              <span>•</span>
                              <span>{formatCurrency(lp.property?.current_value || 0)}</span>
                            </div>
                            <div className="flex items-center gap-1 mt-1">
                              <span className={`text-xs ${
                                lp.ageMonths === null || lp.ageMonths >= 24 ? 'text-red-600' :
                                lp.ageMonths >= 12 ? 'text-amber-600' : 'text-emerald-600'
                              }`}>
                                {lp.ageMonths !== null
                                  ? `Last valued: ${lp.ageMonths} months ago`
                                  : 'No valuation on record'
                                }
                              </span>
                              {(lp.ageMonths === null || lp.ageMonths >= 12) && (
                                <AlertTriangle className="w-3 h-3 text-amber-500" />
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 italic">No properties linked to this loan</p>
                  )}
                </div>

                {/* Footer Text */}
                {isEditing ? (
                  <div className="space-y-2">
                    <Label>Letter Closing</Label>
                    <Textarea
                      value={footerText}
                      onChange={(e) => setFooterText(e.target.value)}
                      rows={5}
                      className="text-sm"
                      placeholder="Enter the closing text of your letter..."
                    />
                  </div>
                ) : (
                  <div className="text-sm whitespace-pre-wrap bg-slate-50 p-3 rounded">
                    {footerText}
                  </div>
                )}

                {/* Signature */}
                <div className="text-sm">
                  <p className="font-bold">{organization?.name}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 'delivery' && (
          <div className="space-y-4">
            <Tabs defaultValue="download" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="download">
                  <Download className="w-4 h-4 mr-2" />
                  Download PDF
                </TabsTrigger>
                <TabsTrigger value="email">
                  <Mail className="w-4 h-4 mr-2" />
                  Send by Email
                </TabsTrigger>
              </TabsList>

              <TabsContent value="download" className="mt-4">
                <Card>
                  <CardContent className="p-6 text-center space-y-4">
                    <FileText className="w-12 h-12 mx-auto text-slate-400" />
                    <div>
                      <h3 className="font-semibold">Download as PDF</h3>
                      <p className="text-sm text-slate-600 mt-1">
                        Save the letter as a PDF file to print or email manually
                      </p>
                    </div>
                    <Button onClick={handleDownloadPDF} className="w-full">
                      <Download className="w-4 h-4 mr-2" />
                      Download PDF
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="email" className="mt-4">
                <Card>
                  <CardContent className="p-6 space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="email">Recipient Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={recipientEmail}
                        onChange={(e) => setRecipientEmail(e.target.value)}
                        placeholder="borrower@example.com"
                      />
                    </div>

                    <Alert className="border-blue-200 bg-blue-50">
                      <Mail className="h-4 w-4 text-blue-600" />
                      <AlertDescription className="text-blue-800 text-sm">
                        The letter will be sent as a PDF attachment
                      </AlertDescription>
                    </Alert>

                    <Button
                      onClick={handleSendEmail}
                      className="w-full bg-blue-600 hover:bg-blue-700"
                      disabled={isSending || !recipientEmail}
                    >
                      {isSending ? (
                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...</>
                      ) : (
                        <><Send className="w-4 h-4 mr-2" /> Send Email</>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}

        <DialogFooter className="flex justify-between">
          {step === 'preview' ? (
            <>
              <Button variant="outline" onClick={resetAndClose}>
                Cancel
              </Button>
              <Button onClick={() => setStep('delivery')}>
                Continue
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('preview')}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
              <Button variant="outline" onClick={resetAndClose}>
                Close
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
