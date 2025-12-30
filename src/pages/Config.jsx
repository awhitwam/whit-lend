import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CheckCircle2, Palette } from 'lucide-react';
import { useOrganization } from '@/lib/OrganizationContext';
import { getThemeOptions } from '@/lib/organizationThemes';
import { supabase } from '@/lib/supabaseClient';
import { toast } from 'sonner';

export default function Config() {
  const { canAdmin, currentOrganization, refreshOrganizations, currentTheme } = useOrganization();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="p-4 md:p-6 space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">General Settings</h1>
          <p className="text-slate-500 mt-1">Configure your organization settings</p>
        </div>

        {/* Organization Theme Selector */}
        {canAdmin() && currentOrganization && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="w-5 h-5" style={{ color: currentTheme.primary }} />
                Organization Theme
              </CardTitle>
              <CardDescription>
                Choose a color theme for {currentOrganization.name} to easily identify which organization you're working in
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-4 md:grid-cols-8 gap-3">
                {getThemeOptions().map((theme) => {
                  const isSelected = (currentOrganization?.settings?.theme || 'emerald') === theme.value;
                  return (
                    <button
                      key={theme.value}
                      onClick={async () => {
                        try {
                          // Update organization settings in Supabase
                          const currentSettings = currentOrganization.settings || {};
                          const newSettings = { ...currentSettings, theme: theme.value };

                          const { error } = await supabase
                            .from('organizations')
                            .update({ settings: newSettings })
                            .eq('id', currentOrganization.id);

                          if (error) throw error;

                          // Refresh organizations to pick up the new theme
                          await refreshOrganizations();
                          toast.success(`Theme changed to ${theme.label}`);
                        } catch (err) {
                          console.error('Error updating theme:', err);
                          toast.error('Failed to update theme');
                        }
                      }}
                      className={`
                        flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all
                        ${isSelected
                          ? 'border-slate-900 bg-slate-50 shadow-md'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }
                      `}
                    >
                      <div
                        className={`w-8 h-8 rounded-full ${isSelected ? 'ring-2 ring-offset-2 ring-slate-400' : ''}`}
                        style={{ backgroundColor: theme.color }}
                      />
                      <span className="text-xs font-medium text-slate-700">{theme.label}</span>
                      {isSelected && (
                        <CheckCircle2 className="w-4 h-4 text-slate-700" />
                      )}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {!canAdmin() && (
          <Card>
            <CardContent className="p-6">
              <p className="text-slate-500">
                You need admin permissions to change organization settings.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
