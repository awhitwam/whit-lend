import { FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useOrganization } from '@/lib/OrganizationContext';
import LetterTemplateManager from '@/components/letters/LetterTemplateManager';

export default function LetterTemplates() {
  const { canAdmin, currentOrganization, currentTheme } = useOrganization();

  if (!canAdmin()) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="p-4 md:p-6">
          <Card>
            <CardContent className="p-6">
              <p className="text-slate-500">
                You need admin permissions to manage letter templates.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Letter Templates</h1>
          <p className="text-slate-500 mt-1">Create and manage reusable letter templates for borrower correspondence</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" style={{ color: currentTheme?.primary || '#3b82f6' }} />
              Templates
            </CardTitle>
            <CardDescription>
              Templates for {currentOrganization?.name || 'your organization'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LetterTemplateManager />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
