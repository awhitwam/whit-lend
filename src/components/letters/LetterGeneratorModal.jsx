import { useState, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { format, isValid } from 'date-fns';
import { formatCurrency, calculateSettlementAmount, buildSettlementData } from '../loan/LoanCalculator';
import {
  generateLoanStatementPDFBytes,
  generateSettlementStatementPDFBytes
} from '../loan/LoanPDFGenerator';
import {
  renderTemplate,
  buildPlaceholderData,
  generateLetterPDF,
  mergePDFs,
  downloadPDF,
  pdfToDataUrl,
  ATTACHABLE_REPORTS
} from '@/lib/letterGenerator';
import { api } from '@/api/dataClient';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import {
  FileText,
  Download,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Edit,
  Eye,
  Paperclip,
  Calendar,
  FileCheck,
  AlertCircle,
  Cloud,
  Mail,
  Send
} from 'lucide-react';
import { toast } from 'sonner';
import { useGoogleDrive } from '@/hooks/useGoogleDrive';
import EmailComposeModal from '@/components/email/EmailComposeModal';
import { logLetterEvent, AuditAction } from '@/lib/auditLog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Multi-step modal for generating letters with attached reports
 *
 * Steps:
 * 1. Select template
 * 2. Edit/preview letter content
 * 3. Select reports to attach (with settlement date if needed)
 * 4. Download/send
 */
export default function LetterGeneratorModal({
  isOpen,
  onClose,
  loan,
  borrower,
  organization,
  schedule = [],
  transactions = [],
  product = null,
  loanProperties = [],
  interestCalc = null
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { isConnected: googleDriveConnected, baseFolderId, uploadFile: uploadToGoogleDrive } = useGoogleDrive();

  // Google Drive readiness check
  const isDriveReady = googleDriveConnected && baseFolderId;
  const driveDisabledReason = !googleDriveConnected
    ? 'Google Drive not connected. Go to Settings to connect.'
    : !baseFolderId
      ? 'No base folder configured. Go to Settings to select a folder.'
      : null;

  // Step management
  const [step, setStep] = useState(1);
  const STEPS = ['template', 'content', 'attachments', 'delivery'];

  // Template selection
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  // User profile (for signature)
  const { data: userProfile } = useQuery({
    queryKey: ['user-profile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('user_profiles')
        .select('signature_image_url')
        .eq('id', user.id)
        .single();
      if (error) return null;
      return data;
    },
    enabled: !!user?.id && isOpen
  });

  // Letter content
  const [subject, setSubject] = useState('');
  const [bodyContent, setBodyContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);

  // Attachments
  const [selectedAttachments, setSelectedAttachments] = useState([]);
  const [settlementDate, setSettlementDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [settlementData, setSettlementData] = useState(null);

  // Free text fields
  const [freeTextFields, setFreeTextFields] = useState({
    free_text_1: '',
    free_text_2: '',
    free_text_3: ''
  });

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPdfUrl, setGeneratedPdfUrl] = useState(null);
  const [isSavingToDrive, setIsSavingToDrive] = useState(false);

  // Email compose modal
  const [showEmailCompose, setShowEmailCompose] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailError, setEmailError] = useState(null);

  // Fetch templates
  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['letter-templates'],
    queryFn: () => api.entities.LetterTemplate.list('name'),
    enabled: isOpen
  });

  // Get selected template
  const selectedTemplate = useMemo(() => {
    return templates.find(t => t.id === selectedTemplateId);
  }, [templates, selectedTemplateId]);

  // Calculate live settlement figures - use interestCalc prop passed from LoanDetails
  // interestCalc is liveInterestCalc from LoanDetails which already has principalRemaining and interestRemaining
  const liveSettlement = useMemo(() => {
    if (!loan || !interestCalc) {
      console.log('[LetterGenerator] liveSettlement: missing loan or interestCalc', { loan: !!loan, interestCalc });
      return null;
    }

    // Use the values directly from interestCalc (which is liveInterestCalc from LoanDetails)
    // This is the same calculation shown in the LoanDetails Settlement card
    const principalRemaining = interestCalc.principalRemaining ?? 0;
    const interestRemaining = interestCalc.interestRemaining ?? 0;
    const feesRemaining = loan.exit_fee || 0;
    const settlementTotal = principalRemaining + Math.max(0, interestRemaining) + feesRemaining;

    console.log('[LetterGenerator] liveSettlement calculation:', {
      principalRemaining,
      interestRemaining,
      feesRemaining,
      settlementTotal,
      interestCalcKeys: Object.keys(interestCalc)
    });

    // Settlement = Principal + Interest (if positive) + Exit Fee
    // This matches LoanDetails: settlementTotal = principalRemaining + Math.max(0, settlementInterestOwed) + outstandingFees
    return {
      principalRemaining,
      interestRemaining,
      feesRemaining,
      settlementTotal
    };
  }, [loan, interestCalc]);

  // Build placeholder data
  const placeholderData = useMemo(() => {
    const primaryProperty = loanProperties[0]?.property;
    console.log('[LetterGenerator] Building placeholder data:', {
      loanPropertiesCount: loanProperties?.length,
      loanProperties: loanProperties?.map(lp => ({
        charge_type: lp.charge_type,
        property_address: lp.property?.address,
        property_city: lp.property?.city,
        property_postcode: lp.property?.postcode
      })),
      borrower_name: borrower?.business || borrower?.full_name,
      loan_number: loan?.loan_number
    });
    const data = buildPlaceholderData({
      loan,
      borrower,
      organization,
      property: primaryProperty,
      product,
      settlementData,
      interestBalance: interestCalc?.interestBalance,
      liveSettlement,
      userProfile,
      loanProperties,
      schedule
    });
    console.log('[LetterGenerator] Generated placeholder data:', {
      first_charge_addresses: data.first_charge_addresses,
      second_charge_addresses: data.second_charge_addresses,
      all_security_addresses: data.all_security_addresses,
      property_address: data.property_address,
      borrower_name: data.borrower_name
    });
    // Override free text fields with user input (if provided)
    if (freeTextFields.free_text_1) data.free_text_1 = freeTextFields.free_text_1;
    if (freeTextFields.free_text_2) data.free_text_2 = freeTextFields.free_text_2;
    if (freeTextFields.free_text_3) data.free_text_3 = freeTextFields.free_text_3;
    return data;
  }, [loan, borrower, organization, loanProperties, product, settlementData, interestCalc, liveSettlement, freeTextFields, userProfile, schedule]);

  // Rendered content with placeholders substituted
  const renderedSubject = useMemo(() => {
    return renderTemplate(subject, placeholderData);
  }, [subject, placeholderData]);

  const renderedBody = useMemo(() => {
    return renderTemplate(bodyContent, placeholderData);
  }, [bodyContent, placeholderData]);

  // Quill editor configuration (same as LetterTemplateEditor)
  const quillModules = useMemo(() => ({
    toolbar: [
      [{ 'header': [1, 2, 3, false] }],
      [{ 'size': ['small', false, 'large', 'huge'] }],
      ['bold', 'italic', 'underline'],
      [{ 'list': 'ordered' }, { 'list': 'bullet' }],
      [{ 'indent': '-1' }, { 'indent': '+1' }],
      [{ 'align': [] }],
      ['clean']
    ],
  }), []);

  const quillFormats = [
    'header', 'size',
    'bold', 'italic', 'underline',
    'list', 'bullet', 'indent',
    'align'
  ];

  // When template is selected, populate content
  useEffect(() => {
    if (selectedTemplate) {
      setSubject(selectedTemplate.subject_template || '');
      setBodyContent(selectedTemplate.body_template || '');
      // Auto-select default attachments
      if (selectedTemplate.default_attachments?.length > 0) {
        setSelectedAttachments(selectedTemplate.default_attachments);
      }
      // Reset free text fields
      setFreeTextFields({
        free_text_1: '',
        free_text_2: '',
        free_text_3: ''
      });
    }
  }, [selectedTemplate]);

  // Calculate settlement data when settlement report is selected
  // Uses shared buildSettlementData for consistent calculations with SettleLoanModal
  useEffect(() => {
    if (selectedAttachments.includes('settlement_statement') && settlementDate && loan) {
      try {
        // Use shared function - no organization/borrower needed here, will be added when generating PDF
        const data = buildSettlementData(loan, settlementDate, transactions, schedule, product, null, null);
        if (data) {
          // Add legacy fields for placeholder compatibility
          setSettlementData({
            ...data,
            principalBalance: data.principalRemaining,
            interestBalance: data.interestRemaining,
            totalBalance: data.totalSettlement
          });
        } else {
          setSettlementData(null);
        }
      } catch (err) {
        console.error('Error calculating settlement:', err);
        setSettlementData(null);
      }
    } else {
      setSettlementData(null);
    }
  }, [selectedAttachments, settlementDate, loan, schedule, transactions, product]);

  // Toggle attachment selection
  const toggleAttachment = (key) => {
    setSelectedAttachments(prev =>
      prev.includes(key)
        ? prev.filter(k => k !== key)
        : [...prev, key]
    );
  };

  // Generate final PDF
  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const pdfBytesArray = [];

      // 1. Generate letter PDF
      const letterBytes = await generateLetterPDF({
        subject: renderedSubject,
        body: renderedBody,
        organization,
        recipientName: borrower?.business ||
          `${borrower?.first_name || ''} ${borrower?.last_name || ''}`.trim() ||
          loan.borrower_name,
        recipientAddress: [
          borrower?.address_line1,
          borrower?.city,
          borrower?.postcode
        ].filter(Boolean).join(', ')
      });
      pdfBytesArray.push(new Uint8Array(letterBytes));

      // 2. Generate attached reports
      for (const attachmentKey of selectedAttachments) {
        let reportBytes = null;

        if (attachmentKey === 'loan_statement') {
          reportBytes = generateLoanStatementPDFBytes(
            loan,
            schedule,
            transactions,
            product,
            interestCalc,
            organization
          );
        } else if (attachmentKey === 'settlement_statement' && settlementData) {
          // Pass schedule directly - same as SettleLoanModal for consistent PDF output
          reportBytes = generateSettlementStatementPDFBytes(
            loan,
            {
              ...settlementData,
              organization,
              borrower
            },
            schedule,
            transactions,
            product
          );
        }

        if (reportBytes) {
          pdfBytesArray.push(new Uint8Array(reportBytes));
        }
      }

      // 3. Merge all PDFs with page numbers
      const mergedPdf = await mergePDFs(pdfBytesArray, { addPageNumbers: true });

      // Create preview URL
      const url = pdfToDataUrl(mergedPdf);
      setGeneratedPdfUrl(url);

      // Store for download
      window._generatedLetterPdf = mergedPdf;

      toast.success('Letter generated successfully');
    } catch (err) {
      console.error('Error generating letter:', err);
      toast.error('Failed to generate letter: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // Download PDF
  const handleDownload = () => {
    if (window._generatedLetterPdf) {
      // Format: YYYY-MM-DD LoanNumber BorrowerName TemplateName.pdf
      const dateStr = format(new Date(), 'yyyy-MM-dd');
      const loanNumber = loan?.loan_number || loan?.id || 'unknown';
      const borrowerName = borrower?.business ||
        `${borrower?.first_name || ''} ${borrower?.last_name || ''}`.trim() ||
        loan?.borrower_name || 'Borrower';
      const safeBorrowerName = borrowerName.replace(/[^a-zA-Z0-9\s-]/g, '');
      const templateName = selectedTemplate?.name || 'Letter';
      const safeTemplateName = templateName.replace(/[^a-zA-Z0-9\s-]/g, '');
      const filename = `${dateStr} ${loanNumber} ${safeBorrowerName} ${safeTemplateName}.pdf`;

      downloadPDF(window._generatedLetterPdf, filename);

      // Audit log the letter download
      logLetterEvent(AuditAction.LETTER_CREATE, {
        id: null,
        subject: subject,
        template_name: selectedTemplate?.name
      }, loan, {
        delivery_method: 'download',
        attached_reports: selectedAttachments.join(', ')
      });

      toast.success('Letter downloaded');
    }
  };

  // Save to Google Drive
  const handleSaveToGoogleDrive = async () => {
    if (!window._generatedLetterPdf) {
      toast.error('No PDF to save');
      return;
    }

    setIsSavingToDrive(true);
    try {
      // Build filename: YYYY-MM-DD LoanNumber BorrowerName TemplateName.pdf
      const dateStr = format(new Date(), 'yyyy-MM-dd');
      const loanNumber = loan?.loan_number || loan?.id || 'unknown';
      const borrowerName = borrower?.business ||
        `${borrower?.first_name || ''} ${borrower?.last_name || ''}`.trim() ||
        loan?.borrower_name || 'Borrower';
      const safeBorrowerName = borrowerName.replace(/[^a-zA-Z0-9\s-]/g, '');
      const templateName = selectedTemplate?.name || 'Letter';
      const safeTemplateName = templateName.replace(/[^a-zA-Z0-9\s-]/g, '');
      const filename = `${dateStr} ${loanNumber} ${safeBorrowerName} ${safeTemplateName}.pdf`;

      // Convert PDF bytes to base64
      const pdfBytes = window._generatedLetterPdf;
      const base64 = btoa(
        new Uint8Array(pdfBytes).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      // Upload to Google Drive
      const result = await uploadToGoogleDrive({
        fileName: filename,
        fileContent: base64,
        mimeType: 'application/pdf',
        borrowerId: borrower?.unique_number || borrower?.id?.toString() || 'unknown',
        borrowerDescription: borrowerName,
        loanId: loan?.loan_number || loan?.id?.toString() || 'unknown',
        loanDescription: loan?.description || ''
      });

      if (result.success) {
        // Audit log the letter saved to Google Drive
        logLetterEvent(AuditAction.LETTER_CREATE, {
          id: null,
          subject: subject,
          template_name: selectedTemplate?.name
        }, loan, {
          delivery_method: 'drive',
          google_drive_folder: result.folderPath,
          attached_reports: selectedAttachments.join(', ')
        });

        toast.success(`Saved to Google Drive: ${result.folderPath}`);
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (err) {
      console.error('Error saving to Google Drive:', err);
      toast.error('Failed to save to Google Drive: ' + err.message);
    } finally {
      setIsSavingToDrive(false);
    }
  };

  // Send via Email - opens email compose modal
  const handleSendEmail = () => {
    setEmailError(null);
    setShowEmailCompose(true);
  };

  // Build default email body from template or use fallback
  const getDefaultEmailBody = () => {
    // If template has an email body template, render it with placeholders
    if (selectedTemplate?.email_body_template) {
      return renderTemplate(selectedTemplate.email_body_template, placeholderData);
    }
    // Default email body
    const borrowerName = borrower?.business ||
      `${borrower?.first_name || ''} ${borrower?.last_name || ''}`.trim() ||
      loan?.borrower_name || 'Borrower';
    return `Dear ${borrowerName},\n\nPlease find attached the letter regarding your loan (Reference: ${loan?.loan_number || 'N/A'}).\n\nIf you have any questions, please do not hesitate to contact us.\n\nKind regards,\n${organization?.name || 'The Lender'}`;
  };

  // Get filename for the email attachment
  const getLetterFilename = () => {
    const dateStr = format(new Date(), 'yyyy-MM-dd');
    const loanNumber = loan?.loan_number || loan?.id || 'unknown';
    const borrowerName = borrower?.business ||
      `${borrower?.first_name || ''} ${borrower?.last_name || ''}`.trim() ||
      loan?.borrower_name || 'Borrower';
    const safeBorrowerName = borrowerName.replace(/[^a-zA-Z0-9\s-]/g, '');
    const templateName = selectedTemplate?.name || 'Letter';
    const safeTemplateName = templateName.replace(/[^a-zA-Z0-9\s-]/g, '');
    return `${dateStr} ${loanNumber} ${safeBorrowerName} ${safeTemplateName}.pdf`;
  };

  // Send email via Edge Function
  const handleEmailSend = async ({ to, subject: emailSubject, body: emailBody }) => {
    setIsSendingEmail(true);
    setEmailError(null);

    try {
      if (!window._generatedLetterPdf) {
        throw new Error('No PDF generated');
      }

      // Convert PDF bytes to base64
      const pdfBytes = window._generatedLetterPdf;
      const pdfBase64 = btoa(
        new Uint8Array(pdfBytes).reduce((data, byte) => data + String.fromCharCode(byte), '')
      );

      // Get current session for auth token
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Not authenticated');
      }

      // Call Edge Function to send email
      const { data, error } = await supabase.functions.invoke('send-email-attachment', {
        body: {
          recipientEmail: to,
          subject: emailSubject,
          textBody: emailBody,
          attachment: {
            type: 'pdf',
            base64: pdfBase64,
            fileName: getLetterFilename()
          }
        }
      });

      if (error) {
        throw new Error(error.message || 'Failed to send email');
      }

      // Auto-save to Google Drive if connected
      let driveFileUrl = null;
      if (googleDriveConnected) {
        try {
          const borrowerName = borrower?.business ||
            `${borrower?.first_name || ''} ${borrower?.last_name || ''}`.trim() ||
            loan?.borrower_name || 'Borrower';

          const driveResult = await uploadToGoogleDrive({
            fileName: getLetterFilename(),
            fileContent: pdfBase64,
            mimeType: 'application/pdf',
            borrowerId: borrower?.unique_number || borrower?.id?.toString() || 'unknown',
            borrowerDescription: borrowerName,
            loanId: loan?.loan_number || loan?.id?.toString() || 'unknown',
            loanDescription: loan?.description || ''
          });

          if (driveResult.success && driveResult.fileUrl) {
            driveFileUrl = driveResult.fileUrl;
          }
        } catch (driveErr) {
          // Don't fail the email send if Drive upload fails, just log it
          console.warn('Failed to auto-save to Google Drive:', driveErr);
        }
      }

      // Record in generated_letters
      await api.entities.GeneratedLetter.create({
        template_id: selectedTemplateId || null,
        loan_id: loan?.id,
        borrower_id: borrower?.id,
        subject: emailSubject,
        body_rendered: bodyContent,
        placeholder_values: placeholderData,
        attached_reports: selectedAttachments,
        settlement_date: settlementData ? settlementDate : null,
        delivery_method: 'email',
        recipient_email: to,
        template_name: selectedTemplate?.name || 'Custom Letter',
        google_drive_file_url: driveFileUrl,
        created_by: user?.id
      });

      // Audit log the letter sent via email
      logLetterEvent(AuditAction.LETTER_CREATE, {
        id: null,
        subject: emailSubject,
        template_name: selectedTemplate?.name
      }, loan, {
        delivery_method: 'email',
        recipient_email: to,
        attached_reports: selectedAttachments.join(', ')
      });

      queryClient.invalidateQueries({ queryKey: ['loan-letters', loan?.id] });
      toast.success(driveFileUrl ? 'Email sent and saved to Google Drive' : 'Email sent successfully');
      setShowEmailCompose(false);
      handleClose();
    } catch (err) {
      console.error('Error sending email:', err);
      setEmailError(err.message || 'Failed to send email');
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Reset state when closing
  const handleClose = () => {
    setStep(1);
    setSelectedTemplateId('');
    setSubject('');
    setBodyContent('');
    setSelectedAttachments([]);
    setSettlementDate(format(new Date(), 'yyyy-MM-dd'));
    setSettlementData(null);
    setGeneratedPdfUrl(null);
    setIsEditing(false);
    setFreeTextFields({ free_text_1: '', free_text_2: '', free_text_3: '' });
    if (generatedPdfUrl) {
      URL.revokeObjectURL(generatedPdfUrl);
    }
    window._generatedLetterPdf = null;
    onClose();
  };

  // Navigation
  const canProceed = () => {
    switch (step) {
      case 1: return !!selectedTemplateId;
      case 2: return bodyContent.trim().length > 0;
      case 3: return true; // Attachments are optional
      case 4: return !!generatedPdfUrl;
      default: return false;
    }
  };

  const goNext = () => {
    if (step === 3) {
      // Generate PDF before going to delivery step
      handleGenerate();
    }
    setStep(prev => Math.min(prev + 1, 4));
  };

  const goBack = () => {
    setStep(prev => Math.max(prev - 1, 1));
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Generate Letter
          </DialogTitle>
          <DialogDescription>
            Step {step} of 4: {
              step === 1 ? 'Select a template' :
              step === 2 ? 'Review and edit content' :
              step === 3 ? 'Select reports to attach' :
              'Download or send'
            }
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 py-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
                ${i + 1 === step ? 'bg-blue-600 text-white' :
                  i + 1 < step ? 'bg-green-100 text-green-700' :
                  'bg-slate-100 text-slate-500'}`}
              >
                {i + 1 < step ? '✓' : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-8 h-0.5 mx-1 ${i + 1 < step ? 'bg-green-300' : 'bg-slate-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step 1: Template Selection */}
        {step === 1 && (
          <div className="space-y-4">
            {templatesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : templates.length === 0 ? (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No letter templates found. Please create templates in the settings.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="grid gap-3">
                {templates.filter(t => t.is_active !== false).map(template => (
                  <Card
                    key={template.id}
                    className={`cursor-pointer transition-all hover:shadow-md ${
                      selectedTemplateId === template.id
                        ? 'ring-2 ring-blue-500 bg-blue-50/50'
                        : 'hover:bg-slate-50'
                    }`}
                    onClick={() => setSelectedTemplateId(template.id)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold">{template.name}</h3>
                          {template.description && (
                            <p className="text-sm text-slate-600 mt-1">{template.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <Badge variant="outline">{template.category || 'General'}</Badge>
                            {template.default_attachments?.length > 0 && (
                              <Badge variant="secondary" className="flex items-center gap-1">
                                <Paperclip className="w-3 h-3" />
                                {template.default_attachments.length} attachment(s)
                              </Badge>
                            )}
                          </div>
                        </div>
                        {selectedTemplateId === template.id && (
                          <FileCheck className="w-5 h-5 text-blue-600" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2: Content Editing */}
        {step === 2 && (
          <div className="space-y-4">
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
                  <><Edit className="w-4 h-4 mr-1" /> Edit</>
                )}
              </Button>
            </div>

            {isEditing ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Subject Line</Label>
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Letter subject..."
                  />
                </div>
                <div className="space-y-2">
                  <Label>Letter Body</Label>
                  <div className="letter-editor">
                    <ReactQuill
                      theme="snow"
                      value={bodyContent}
                      onChange={setBodyContent}
                      modules={quillModules}
                      formats={quillFormats}
                      placeholder="Enter letter content..."
                      style={{ minHeight: '300px' }}
                    />
                    <style>{`
                      .letter-editor .ql-container {
                        min-height: 250px;
                        font-size: 14px;
                      }
                      .letter-editor .ql-editor {
                        min-height: 250px;
                      }
                    `}</style>
                  </div>
                  <p className="text-xs text-slate-500">
                    Available placeholders: {Object.keys(placeholderData).map(k => `{{${k}}}`).join(', ')}
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* Free Text Fields - show inputs for any free_text placeholders used in the template */}
                {(() => {
                  const usedFreeText = [];
                  const content = (subject || '') + (bodyContent || '');
                  if (content.includes('{{free_text_1}}')) usedFreeText.push({ key: 'free_text_1', label: 'Custom Text 1' });
                  if (content.includes('{{free_text_2}}')) usedFreeText.push({ key: 'free_text_2', label: 'Custom Text 2' });
                  if (content.includes('{{free_text_3}}')) usedFreeText.push({ key: 'free_text_3', label: 'Custom Text 3' });

                  if (usedFreeText.length === 0) return null;

                  return (
                    <Card className="border-amber-200 bg-amber-50 mb-4">
                      <CardContent className="p-4 space-y-3">
                        <p className="text-sm font-medium text-amber-800">
                          This template uses custom text fields. Enter values below:
                        </p>
                        {usedFreeText.map(field => (
                          <div key={field.key} className="space-y-1">
                            <Label className="text-sm">{field.label}</Label>
                            <Input
                              value={freeTextFields[field.key]}
                              onChange={(e) => setFreeTextFields(prev => ({
                                ...prev,
                                [field.key]: e.target.value
                              }))}
                              placeholder={`Enter ${field.label.toLowerCase()}...`}
                            />
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  );
                })()}

                <Card className="border-slate-200">
                  <CardContent className="p-4 space-y-4">
                    {/* Organization Header with Logo */}
                    <div className="text-right border-b pb-3">
                      {/* Logo on right, above org name */}
                      {organization?.logo_url && (
                        <img
                          src={organization.logo_url}
                          alt={`${organization.name} logo`}
                          className="h-12 w-auto object-contain mb-2 ml-auto"
                        />
                      )}
                      <p className="font-bold">{organization?.name}</p>
                      {organization?.address_line1 && (
                        <p className="text-sm text-slate-600">{organization.address_line1}</p>
                      )}
                      {(organization?.city || organization?.postcode) && (
                        <p className="text-sm text-slate-600">
                          {[organization.city, organization.postcode].filter(Boolean).join(' ')}
                        </p>
                      )}
                    </div>

                  {/* Subject */}
                  {renderedSubject && (
                    <p className="font-semibold text-sm">Re: {renderedSubject}</p>
                  )}

                  {/* Body - render HTML content */}
                  <div className="text-sm bg-slate-50 p-4 rounded min-h-[200px] prose prose-sm max-w-none letter-preview-body">
                    {renderedBody ? (
                      <div dangerouslySetInnerHTML={{ __html: renderedBody }} />
                    ) : (
                      <span className="text-slate-400 italic">No content</span>
                    )}
                  </div>
                  <style>{`
                    .letter-preview-body ul {
                      list-style-type: disc;
                      padding-left: 1.5em;
                      margin: 0.5em 0;
                    }
                    .letter-preview-body ol {
                      list-style-type: decimal;
                      padding-left: 1.5em;
                      margin: 0.5em 0;
                    }
                    .letter-preview-body li {
                      margin: 0.25em 0;
                    }
                    .letter-preview-body img.signature-image {
                      max-height: 60px;
                      max-width: 200px;
                      display: block;
                      margin: 8px 0;
                    }
                  `}</style>

                  {/* Signature */}
                  <div className="text-sm pt-4">
                    <p className="font-bold">{organization?.name}</p>
                  </div>
                </CardContent>
              </Card>
              </>
            )}
          </div>
        )}

        {/* Step 3: Attachments */}
        {step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Select reports to attach to the letter. They will be merged into a single PDF with continuous page numbers.
            </p>

            <div className="grid gap-3">
              {ATTACHABLE_REPORTS.map(report => (
                <Card
                  key={report.key}
                  className={`cursor-pointer transition-all ${
                    selectedAttachments.includes(report.key)
                      ? 'ring-2 ring-blue-500 bg-blue-50/50'
                      : 'hover:bg-slate-50'
                  }`}
                  onClick={() => toggleAttachment(report.key)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={selectedAttachments.includes(report.key)}
                        onCheckedChange={() => toggleAttachment(report.key)}
                      />
                      <div className="flex-1">
                        <h3 className="font-semibold">{report.name}</h3>
                        <p className="text-sm text-slate-600">{report.description}</p>

                        {/* Settlement date input */}
                        {report.key === 'settlement_statement' && selectedAttachments.includes(report.key) && (
                          <div className="mt-3 flex items-center gap-2" onClick={e => e.stopPropagation()}>
                            <Calendar className="w-4 h-4 text-slate-400" />
                            <Label className="text-sm">Settlement Date:</Label>
                            <Input
                              type="date"
                              value={settlementDate}
                              onChange={(e) => setSettlementDate(e.target.value)}
                              className="w-auto"
                            />
                          </div>
                        )}

                        {/* Show calculated settlement figures */}
                        {report.key === 'settlement_statement' && settlementData && selectedAttachments.includes(report.key) && (
                          <div className="mt-2 text-sm bg-slate-100 p-2 rounded">
                            <p>Principal: {formatCurrency(settlementData.principalBalance)}</p>
                            <p>Interest: {formatCurrency(settlementData.interestBalance)}</p>
                            <p className="font-semibold">Total: {formatCurrency(settlementData.totalBalance)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {selectedAttachments.length === 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  No attachments selected. The letter will be generated without any reports.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        {/* Step 4: Delivery */}
        {step === 4 && (
          <div className="space-y-4">
            {isGenerating ? (
              <div className="flex flex-col items-center justify-center py-8 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <p className="text-slate-600">Generating PDF...</p>
              </div>
            ) : generatedPdfUrl ? (
              <>
                {/* Preview */}
                <Card>
                  <CardContent className="p-4">
                    <div className="aspect-[8.5/11] bg-slate-100 rounded overflow-hidden">
                      <iframe
                        src={generatedPdfUrl}
                        className="w-full h-full border-0"
                        title="Letter Preview"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Download, Google Drive, and Send buttons */}
                <div className="flex flex-wrap justify-center gap-3">
                  <Button onClick={handleDownload} size="lg">
                    <Download className="w-4 h-4 mr-2" />
                    Download PDF
                  </Button>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            onClick={handleSaveToGoogleDrive}
                            variant="outline"
                            size="lg"
                            disabled={isSavingToDrive || !isDriveReady}
                            className={!isDriveReady ? "opacity-50" : ""}
                          >
                            {isSavingToDrive ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <Cloud className="w-4 h-4 mr-2" />
                            )}
                            {isSavingToDrive ? 'Saving...' : 'Save to Google Drive'}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {driveDisabledReason && (
                        <TooltipContent>
                          <p>{driveDisabledReason}</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            onClick={handleSendEmail}
                            variant="outline"
                            size="lg"
                            disabled={isSendingEmail || !isDriveReady}
                            className={`border-purple-300 text-purple-700 hover:bg-purple-50 ${!isDriveReady ? "opacity-50" : ""}`}
                          >
                            {isSendingEmail ? (
                              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            ) : (
                              <Mail className="w-4 h-4 mr-2" />
                            )}
                            Send via Email
                          </Button>
                        </span>
                      </TooltipTrigger>
                      {driveDisabledReason && (
                        <TooltipContent>
                          <p>{driveDisabledReason}</p>
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </div>

                {/* Summary */}
                <div className="text-sm text-slate-600 text-center">
                  Letter{selectedAttachments.length > 0 && ` + ${selectedAttachments.length} attachment(s)`}
                </div>
              </>
            ) : (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Failed to generate PDF. Please go back and try again.
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter className="flex justify-between">
          <div>
            {step > 1 && (
              <Button variant="outline" onClick={goBack}>
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose}>
              {step === 4 ? 'Close' : 'Cancel'}
            </Button>
            {step < 4 && (
              <Button onClick={goNext} disabled={!canProceed()}>
                {step === 3 ? 'Generate' : 'Continue'}
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>

      {/* Email Compose Modal */}
      <EmailComposeModal
        isOpen={showEmailCompose}
        onClose={() => setShowEmailCompose(false)}
        defaultTo={borrower?.email || ''}
        defaultSubject={renderedSubject || `Letter - ${loan?.loan_number}`}
        defaultBody={getDefaultEmailBody()}
        attachmentName={getLetterFilename()}
        onSend={handleEmailSend}
        isSending={isSendingEmail}
        error={emailError}
      />
    </Dialog>
  );
}
