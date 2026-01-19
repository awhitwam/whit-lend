import { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  Save,
  ArrowLeft,
  Loader2,
  Eye,
  Code,
  Paperclip,
  Info,
  Search
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/dataClient';
import { useOrganization } from '@/lib/OrganizationContext';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabaseClient';
import { ATTACHABLE_REPORTS, renderTemplate, buildPlaceholderData } from '@/lib/letterGenerator';
import { format } from 'date-fns';
import { formatCurrency, calculateAccruedInterestWithTransactions } from '@/components/loan/LoanCalculator';

const CATEGORIES = ['General', 'Settlement', 'Statements', 'Legal', 'Reminders'];

const PLACEHOLDER_GROUPS = [
  {
    name: 'Borrower',
    placeholders: [
      { key: 'borrower_name', description: 'Primary borrower name', example: 'John Smith' },
      { key: 'borrower_first_name', description: 'Borrower first name', example: 'John' },
      { key: 'borrower_last_name', description: 'Borrower last name', example: 'Smith' },
      { key: 'borrower_address', description: 'Borrower full address', example: '123 Main St, London, SW1A 1AA' },
    ]
  },
  {
    name: 'Loan',
    placeholders: [
      { key: 'loan_reference', description: 'Loan reference number', example: 'WL-2024-0042' },
      { key: 'loan_description', description: 'Loan description/purpose', example: 'Bridge loan for property acquisition' },
      { key: 'loan_start_date', description: 'Loan start date', example: '01 January 2024' },
      { key: 'principal_amount', description: 'Original loan principal', example: '£250,000.00' },
      { key: 'current_balance', description: 'Current principal balance', example: '£245,000.00' },
      { key: 'interest_rate', description: 'Current interest rate', example: '8.5' },
      { key: 'maturity_date', description: 'Loan maturity date', example: '15 March 2025' },
      { key: 'original_term', description: 'Original end date (start + original term)', example: '01 June 2025' },
      { key: 'loan_end_date', description: 'Current end date (start + duration)', example: '01 December 2025' },
      { key: 'loan_term', description: 'Term end date (original if set, else current)', example: '01 June 2025' },
    ]
  },
  {
    name: 'Property / Security',
    placeholders: [
      { key: 'property_address', description: 'Primary security address', example: '45 Park Lane, London, W1K 1PN' },
      { key: 'first_charge_addresses', description: 'First charge security addresses', example: '45 Park Lane, London, W1K 1PN' },
      { key: 'second_charge_addresses', description: 'Second charge security addresses', example: '12 High Street, Manchester, M1 1AA' },
      { key: 'all_security_addresses', description: 'All security addresses', example: '45 Park Lane, London; 12 High Street, Manchester' },
    ]
  },
  {
    name: 'Live Balance',
    placeholders: [
      { key: 'live_principal_balance', description: 'Principal balance today', example: '£245,000.00' },
      { key: 'live_interest_balance', description: 'Interest owed today', example: '£3,500.00' },
      { key: 'live_fees_balance', description: 'Outstanding fees', example: '£500.00' },
      { key: 'live_settlement_total', description: 'Settlement total today', example: '£249,000.00' },
    ]
  },
  {
    name: 'Settlement',
    placeholders: [
      { key: 'settlement_date', description: 'Settlement date (when attaching settlement)', example: '28 January 2025' },
      { key: 'settlement_principal', description: 'Principal portion', example: '£245,000.00' },
      { key: 'settlement_interest', description: 'Interest portion', example: '£12,450.00' },
      { key: 'settlement_fees', description: 'Fees portion', example: '£500.00' },
      { key: 'settlement_total', description: 'Total settlement amount', example: '£257,950.00' },
    ]
  },
  {
    name: 'Company',
    placeholders: [
      { key: 'company_name', description: 'Your organization name', example: 'ABC Lending Ltd' },
      { key: 'company_address', description: 'Your organization address', example: '10 Finance Street, London, EC2A 1AA' },
      { key: 'today_date', description: 'Current date (use +/- days e.g. {{today_date+14}})', example: format(new Date(), 'dd MMMM yyyy') },
    ]
  },
  {
    name: 'Free Text',
    placeholders: [
      { key: 'free_text_1', description: 'Custom text field 1 (enter at merge time)', example: '[Enter at merge]' },
      { key: 'free_text_2', description: 'Custom text field 2 (enter at merge time)', example: '[Enter at merge]' },
      { key: 'free_text_3', description: 'Custom text field 3 (enter at merge time)', example: '[Enter at merge]' },
    ]
  },
  {
    name: 'Signature',
    placeholders: [
      { key: 'signature', description: 'Your signature image (upload in Settings → User)', example: '[Signature Image]' },
    ]
  },
];

export default function LetterTemplateEditor() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const templateId = searchParams.get('id');
  const isEditing = !!templateId;

  const queryClient = useQueryClient();
  const { currentOrganization } = useOrganization();
  const { user } = useAuth();

  // Fetch user profile for signature
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
    enabled: !!user?.id
  });

  const [activeTab, setActiveTab] = useState('edit');
  const [previewLoanId, setPreviewLoanId] = useState('');
  const quillRef = useRef(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'General',
    subject_template: '',
    body_template: '',
    email_body_template: '',
    default_attachments: [],
    is_active: true
  });

  // Fetch existing template if editing
  const { data: template, isLoading: templateLoading } = useQuery({
    queryKey: ['letter-template', templateId],
    queryFn: async () => {
      if (!templateId) return null;
      const templates = await api.entities.LetterTemplate.filter({ id: templateId });
      return templates[0] || null;
    },
    enabled: !!templateId
  });

  // Fetch loans for preview selector
  const { data: loans = [] } = useQuery({
    queryKey: ['loans-for-preview'],
    queryFn: () => api.entities.Loan.list('-created_at'),
  });

  // Fetch selected loan details with borrower, transactions, and product for live settlement calc
  const { data: selectedLoanData, isLoading: isLoadingLoanData, error: loanDataError } = useQuery({
    queryKey: ['loan-preview-details', previewLoanId],
    queryFn: async () => {
      if (!previewLoanId) return null;

      // Use filter with id since getById doesn't exist
      const loans = await api.entities.Loan.filter({ id: previewLoanId });
      const loan = loans[0];
      if (!loan) return null;

      // Fetch borrower
      let borrower = null;
      if (loan.borrower_id) {
        const borrowers = await api.entities.Borrower.filter({ id: loan.borrower_id });
        borrower = borrowers[0] || null;
      }

      // Fetch loan properties with enriched property data
      const loanPropertyLinks = await api.entities.LoanProperty.filter({ loan_id: loan.id, status: 'Active' });
      const enrichedLoanProperties = await Promise.all(loanPropertyLinks.map(async (link) => {
        const properties = await api.entities.Property.filter({ id: link.property_id });
        return {
          ...link,
          property: properties[0] || null
        };
      }));

      // Get primary property for backward compatibility
      const property = enrichedLoanProperties[0]?.property || null;

      // Fetch transactions for live settlement calculation
      const transactions = await api.entities.Transaction.filter({ loan_id: loan.id });

      // Fetch schedule for accurate interest calculation (required for roll-up/serviced loans)
      const schedule = await api.entities.RepaymentSchedule.filter({ loan_id: loan.id }, 'installment_number');

      // Fetch product if available
      let product = null;
      if (loan.product_id) {
        const products = await api.entities.LoanProduct.filter({ id: loan.product_id });
        product = products[0] || null;
      }

      return { loan, borrower, property, loanProperties: enrichedLoanProperties, transactions, schedule, product };
    },
    enabled: !!previewLoanId,
    staleTime: 0 // Always refetch when loan ID changes
  });

  // Populate form when template loads
  useEffect(() => {
    if (template) {
      setFormData({
        name: template.name || '',
        description: template.description || '',
        category: template.category || 'General',
        subject_template: template.subject_template || '',
        body_template: template.body_template || '',
        email_body_template: template.email_body_template || '',
        default_attachments: template.default_attachments || [],
        is_active: template.is_active !== false
      });
    }
  }, [template]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async (data) => {
      if (isEditing) {
        return api.entities.LetterTemplate.update(templateId, data);
      }
      return api.entities.LetterTemplate.create(data);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['letter-templates'] });
      queryClient.invalidateQueries({ queryKey: ['letter-template', templateId] });
      toast.success(isEditing ? 'Template updated' : 'Template created');
      // If creating a new template, update the URL to include the new ID so subsequent saves work as updates
      if (!isEditing && result?.id) {
        navigate(`/LetterTemplateEditor?id=${result.id}`, { replace: true });
      }
    },
    onError: (err) => {
      toast.error('Failed to save template: ' + err.message);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Template name is required');
      return;
    }
    if (!formData.body_template.trim()) {
      toast.error('Letter body is required');
      return;
    }
    saveMutation.mutate(formData);
  };

  // Quill editor configuration
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

  const insertPlaceholder = (key) => {
    const placeholder = `{{${key}}}`;
    const quill = quillRef.current?.getEditor();

    if (quill) {
      // Get current selection/cursor position
      const range = quill.getSelection();
      if (range) {
        // Insert at cursor position
        quill.insertText(range.index, placeholder);
        // Move cursor after the inserted text
        quill.setSelection(range.index + placeholder.length);
      } else {
        // No selection, append to end
        const length = quill.getLength();
        quill.insertText(length - 1, placeholder);
      }
      // Update form data from editor content
      setFormData(prev => ({ ...prev, body_template: quill.root.innerHTML }));
    } else {
      // Fallback: append to end
      setFormData(prev => ({ ...prev, body_template: prev.body_template + placeholder }));
    }
    toast.success(`Inserted {{${key}}}`);
  };

  const toggleAttachment = (key) => {
    setFormData(prev => ({
      ...prev,
      default_attachments: prev.default_attachments.includes(key)
        ? prev.default_attachments.filter(k => k !== key)
        : [...prev.default_attachments, key]
    }));
  };

  // Build preview data - use real loan data if selected, otherwise sample data
  const previewData = useMemo(() => {
    // Default sample data
    const sampleData = {
      borrower_name: 'John Smith',
      borrower_address: '123 Main Street, London, SW1A 1AA',
      loan_reference: 'WL-2024-0042',
      loan_description: 'Bridge loan for property acquisition',
      loan_start_date: '01 January 2024',
      principal_amount: '£250,000.00',
      current_balance: '£245,000.00',
      interest_rate: '8.5',
      maturity_date: '15 March 2025',
      property_address: '45 Park Lane, London, W1K 1PN',
      live_principal_balance: '£245,000.00',
      live_interest_balance: '£3,500.00',
      live_fees_balance: '£500.00',
      live_settlement_total: '£249,000.00',
      settlement_date: format(new Date(), 'dd MMMM yyyy'),
      settlement_principal: '£245,000.00',
      settlement_interest: '£12,450.00',
      settlement_fees: '£500.00',
      settlement_total: '£257,950.00',
      company_name: currentOrganization?.name || 'Your Company',
      company_address: [
        currentOrganization?.address_line1,
        currentOrganization?.city,
        currentOrganization?.postcode
      ].filter(Boolean).join(', ') || '10 Finance Street, London',
      today_date: format(new Date(), 'dd MMMM yyyy'),
      free_text_1: '[Enter at merge]',
      free_text_2: '[Enter at merge]',
      free_text_3: '[Enter at merge]',
      signature: '[Signature Image]',
    };

    // If a loan is selected, use real data
    if (selectedLoanData) {
      const { loan, borrower, property, loanProperties, transactions, schedule, product } = selectedLoanData;

      // Calculate live settlement figures using the schedule (same as LoanDetails page)
      let liveSettlement = null;
      if (loan && transactions) {
        // Pass schedule to get accurate interest calculation for roll-up/serviced loans
        const liveCalc = calculateAccruedInterestWithTransactions(loan, transactions, new Date(), schedule || [], product);
        const principalRemaining = liveCalc.principalRemaining || 0;
        const interestRemaining = liveCalc.interestRemaining ?? 0;
        const feesRemaining = loan.exit_fee || 0;
        liveSettlement = {
          principalRemaining,
          interestRemaining,
          feesRemaining,
          settlementTotal: principalRemaining + Math.max(0, interestRemaining) + feesRemaining
        };
      }

      return buildPlaceholderData({
        loan,
        borrower,
        organization: currentOrganization,
        property,
        product,
        settlementData: null,
        interestBalance: 0,
        liveSettlement,
        userProfile,
        loanProperties
      });
    }

    // For sample data, add the real signature if available
    if (userProfile?.signature_image_url) {
      sampleData.signature = userProfile.signature_image_url;
      sampleData.signature_image_url = userProfile.signature_image_url;
    }

    return sampleData;
  }, [selectedLoanData, currentOrganization, userProfile]);

  const renderedSubject = useMemo(() => {
    return renderTemplate(formData.subject_template, previewData);
  }, [formData.subject_template, previewData]);

  const renderedBody = useMemo(() => {
    return renderTemplate(formData.body_template, previewData);
  }, [formData.body_template, previewData]);

  if (templateLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => navigate('/LetterTemplates')}>
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">
                {isEditing ? 'Edit Template' : 'New Letter Template'}
              </h1>
              <p className="text-slate-500 text-sm">
                Create reusable letter templates with dynamic placeholders
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 mr-4">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(v) => setFormData(prev => ({ ...prev, is_active: v }))}
              />
              <Label htmlFor="is_active" className="text-sm">Active</Label>
            </div>
            <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Template
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Info Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Template Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="name">Template Name *</Label>
                    <Input
                      id="name"
                      value={formData.name}
                      onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="e.g., Settlement Quote Letter"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Select
                      value={formData.category}
                      onValueChange={(v) => setFormData(prev => ({ ...prev, category: v }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(cat => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Input
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Brief description of when to use this template"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="subject">Subject Line</Label>
                  <Input
                    id="subject"
                    value={formData.subject_template}
                    onChange={(e) => setFormData(prev => ({ ...prev, subject_template: e.target.value }))}
                    placeholder="e.g., Settlement Quote - {{loan_reference}}"
                  />
                  <p className="text-xs text-slate-500">
                    Used as the "Re:" line in the letter and email subject
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email_body">Email Body (optional)</Label>
                  <Textarea
                    id="email_body"
                    value={formData.email_body_template}
                    onChange={(e) => setFormData(prev => ({ ...prev, email_body_template: e.target.value }))}
                    placeholder="e.g., Please find attached {{template_name}} regarding your loan (Reference: {{loan_reference}})."
                    rows={3}
                  />
                  <p className="text-xs text-slate-500">
                    Default email body text when sending this letter via email. Supports the same placeholders as the letter body.
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Letter Body Card */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Letter Body *</CardTitle>
                  <Tabs value={activeTab} onValueChange={setActiveTab}>
                    <TabsList className="h-8">
                      <TabsTrigger value="edit" className="text-xs h-7 px-3">
                        <Code className="w-3 h-3 mr-1" />
                        Edit
                      </TabsTrigger>
                      <TabsTrigger value="preview" className="text-xs h-7 px-3">
                        <Eye className="w-3 h-3 mr-1" />
                        Preview
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </CardHeader>
              <CardContent>
                {activeTab === 'edit' ? (
                  <div className="letter-editor">
                    <ReactQuill
                      ref={quillRef}
                      theme="snow"
                      value={formData.body_template}
                      onChange={(value) => setFormData(prev => ({ ...prev, body_template: value }))}
                      modules={quillModules}
                      formats={quillFormats}
                      placeholder="Dear {{borrower_name}},

Re: Loan Reference {{loan_reference}}
Property: {{property_address}}

[Your letter content here...]

Yours sincerely,

{{company_name}}"
                      style={{ minHeight: '400px' }}
                    />
                    <style>{`
                      .letter-editor .ql-container {
                        min-height: 350px;
                        font-size: 14px;
                      }
                      .letter-editor .ql-editor {
                        min-height: 350px;
                      }
                    `}</style>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Loan Selector for Preview */}
                    <div className="flex items-center gap-3 p-3 bg-slate-100 rounded-lg">
                      <Search className="w-4 h-4 text-slate-500" />
                      <Label className="text-sm whitespace-nowrap">Preview with loan:</Label>
                      <Select
                        value={previewLoanId || '_sample'}
                        onValueChange={(v) => setPreviewLoanId(v === '_sample' ? '' : v)}
                      >
                        <SelectTrigger className="flex-1 bg-white">
                          <SelectValue placeholder="Select a loan to preview with real data..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_sample">
                            <span className="text-slate-500">Use sample data</span>
                          </SelectItem>
                          {loans.map(loan => (
                            <SelectItem key={loan.id} value={loan.id}>
                              {loan.loan_number || loan.id.slice(0, 8)} - {loan.borrower_name || 'Unknown'} - {formatCurrency(loan.principal_amount)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {previewLoanId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreviewLoanId('')}
                          className="text-xs"
                        >
                          Clear
                        </Button>
                      )}
                      {isLoadingLoanData && (
                        <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                      )}
                    </div>

                    {/* Show selected loan info for debugging */}
                    {previewLoanId && selectedLoanData && (
                      <div className="text-xs bg-green-50 p-2 rounded border border-green-200">
                        Using data from: {selectedLoanData.loan?.loan_number} - {selectedLoanData.borrower?.business || selectedLoanData.borrower?.first_name || 'No borrower'}
                      </div>
                    )}
                    {previewLoanId && !isLoadingLoanData && !selectedLoanData && (
                      <div className="text-xs bg-yellow-50 p-2 rounded border border-yellow-200">
                        No loan data returned for ID: {previewLoanId}
                      </div>
                    )}
                    {loanDataError && (
                      <div className="text-xs bg-red-50 p-2 rounded border border-red-200 text-red-700">
                        Error loading loan: {loanDataError.message}
                      </div>
                    )}

                    {/* Letter Preview */}
                    <div className="border rounded-lg p-6 bg-white min-h-[400px]">
                      {/* Preview Header */}
                      <div className="text-right border-b pb-4 mb-4">
                      {/* Logo */}
                      {currentOrganization?.logo_url && (
                        <div className="flex justify-end mb-2">
                          <img
                            src={currentOrganization.logo_url}
                            alt={`${currentOrganization.name} logo`}
                            className="h-16 w-auto max-w-[150px] object-contain"
                          />
                        </div>
                      )}
                      <p className="font-bold text-lg">{currentOrganization?.name || 'Your Company'}</p>
                      {currentOrganization?.address_line1 && (
                        <p className="text-sm text-slate-600">{currentOrganization.address_line1}</p>
                      )}
                      {(currentOrganization?.city || currentOrganization?.postcode) && (
                        <p className="text-sm text-slate-600">
                          {[currentOrganization.city, currentOrganization.postcode].filter(Boolean).join(' ')}
                        </p>
                      )}
                      {currentOrganization?.phone && (
                        <p className="text-sm text-slate-600">Tel: {currentOrganization.phone}</p>
                      )}
                      {currentOrganization?.email && (
                        <p className="text-sm text-slate-600">Email: {currentOrganization.email}</p>
                      )}
                    </div>

                    {/* Subject */}
                    {renderedSubject && (
                      <p className="font-semibold text-sm mb-4">Re: {renderedSubject}</p>
                    )}

                      {/* Body */}
                      <div className="text-sm prose prose-sm max-w-none template-preview-body">
                        {renderedBody ? (
                          <div dangerouslySetInnerHTML={{ __html: renderedBody }} />
                        ) : (
                          <span className="text-slate-400 italic">Enter letter content to see preview...</span>
                        )}
                      </div>
                      <style>{`
                        .template-preview-body ul {
                          list-style-type: disc;
                          padding-left: 1.5em;
                          margin: 0.5em 0;
                        }
                        .template-preview-body ol {
                          list-style-type: decimal;
                          padding-left: 1.5em;
                          margin: 0.5em 0;
                        }
                        .template-preview-body li {
                          margin: 0.25em 0;
                        }
                        .template-preview-body img.signature-image {
                          max-height: 60px;
                          max-width: 200px;
                          display: block;
                          margin: 8px 0;
                        }
                      `}</style>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Default Attachments Card */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Paperclip className="w-4 h-4" />
                  Default Attachments
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-slate-500 mb-4">
                  These reports will be pre-selected when using this template
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {ATTACHABLE_REPORTS.map(report => (
                    <div
                      key={report.key}
                      className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-all ${
                        formData.default_attachments.includes(report.key)
                          ? 'border-blue-500 bg-blue-50'
                          : 'hover:bg-slate-50'
                      }`}
                      onClick={() => toggleAttachment(report.key)}
                    >
                      <Checkbox
                        checked={formData.default_attachments.includes(report.key)}
                        onCheckedChange={() => toggleAttachment(report.key)}
                      />
                      <div>
                        <p className="text-sm font-medium">{report.name}</p>
                        <p className="text-xs text-slate-500">{report.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Placeholders */}
          <div className="space-y-4">
            <Card className="sticky top-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Info className="w-4 h-4" />
                  Available Placeholders
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
                <p className="text-xs text-slate-500">
                  Click a placeholder to insert it at the cursor position in the letter body
                </p>

                {PLACEHOLDER_GROUPS.map(group => (
                  <div key={group.name}>
                    <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">
                      {group.name}
                    </h4>
                    <div className="space-y-1">
                      {group.placeholders.map(p => (
                        <button
                          key={p.key}
                          type="button"
                          onClick={() => insertPlaceholder(p.key)}
                          className="w-full text-left p-2 rounded border hover:bg-blue-50 hover:border-blue-300 transition-all group"
                        >
                          <div className="flex items-center justify-between">
                            <code className="text-xs font-mono text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                              {`{{${p.key}}}`}
                            </code>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">{p.description}</p>
                          <p className="text-xs text-slate-400 italic">e.g., {p.example}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
