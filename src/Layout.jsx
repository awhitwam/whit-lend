import { Link, useLocation, useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  Users,
  FileText,
  Package,
  Menu,
  X,
  Building2,
  Receipt,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  Settings,
  ArrowLeft
} from 'lucide-react';
import { useState, useEffect } from 'react';
import OrganizationSwitcher from '@/components/organization/OrganizationSwitcher';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useOrganization } from '@/lib/OrganizationContext';
import { getOrgItem, setOrgItem } from '@/lib/orgStorage';

const navigation = [
  { name: 'Dashboard', href: 'Dashboard', icon: LayoutDashboard },
  { name: 'Borrowers', href: 'Borrowers', icon: Users },
  { name: 'Loans', href: 'Loans', icon: FileText },
  { name: 'Investors', href: 'Investors', icon: TrendingUp },
  { name: 'Ledger', href: 'Ledger', icon: Building2 },
  { name: 'Expenses', href: 'Expenses', icon: Receipt },
  { name: 'Products', href: 'Products', icon: Package },
  { name: 'Settings', href: 'Config', icon: Settings },
];

export default function Layout({ children, currentPageName }) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = getOrgItem('sidebarCollapsed');
    return saved === 'true';
  });
  const { currentTheme, currentOrganization } = useOrganization();
  const navigate = useNavigate();
  const location = useLocation();

  // Determine if we should show a back button (detail pages, not main nav pages)
  const mainPages = ['Dashboard', 'Borrowers', 'Loans', 'Investors', 'Ledger', 'Expenses', 'Products', 'Config'];
  const showBackButton = !mainPages.includes(currentPageName) && window.history.length > 1;

  useEffect(() => {
    setOrgItem('sidebarCollapsed', sidebarCollapsed);
  }, [sidebarCollapsed]);

  const isActive = (pageName) => {
    return currentPageName === pageName ||
           currentPageName?.startsWith(pageName.replace('s', ''));
  };

  const sidebarWidth = sidebarCollapsed ? 'w-16' : 'w-64';
  const mainPadding = sidebarCollapsed ? 'md:pl-16' : 'md:pl-64';

  return (
    <TooltipProvider delayDuration={0}>
      <div className="min-h-screen bg-slate-50">
        {/* Desktop Sidebar */}
        <aside className={`fixed inset-y-0 left-0 z-50 ${sidebarWidth} bg-slate-900 hidden md:block transition-all duration-300`}>
          {/* Theme accent bar at top */}
          <div
            className="h-1 w-full transition-colors duration-300"
            style={{ backgroundColor: currentTheme.primary }}
          />
          <div className="flex h-full flex-col">
            {/* Logo and Collapse Toggle */}
            <div className="flex h-16 items-center justify-between px-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div
                  className="p-2 rounded-lg flex-shrink-0 transition-colors duration-300"
                  style={{ backgroundColor: currentTheme.primary }}
                >
                  <Building2 className="w-5 h-5 text-white" />
                </div>
                {!sidebarCollapsed && (
                  <span className="text-xl font-bold text-white tracking-tight">WhitLend</span>
                )}
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                className="text-slate-400 hover:text-white hover:bg-slate-800/50 h-8 w-8"
              >
                {sidebarCollapsed ? (
                  <ChevronRight className="w-4 h-4" />
                ) : (
                  <ChevronLeft className="w-4 h-4" />
                )}
              </Button>
            </div>

            {/* Organization Switcher */}
            {!sidebarCollapsed && (
              <div className="px-3 py-4 border-b border-slate-800">
                <OrganizationSwitcher />
              </div>
            )}

            {/* Navigation */}
            <nav className="flex-1 space-y-1 px-2 py-4">
              {navigation.map((item) => {
                const active = isActive(item.href);
                const linkContent = (
                  <Link
                    key={item.name}
                    to={createPageUrl(item.href)}
                    className={`
                      flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all
                      ${sidebarCollapsed ? 'justify-center' : ''}
                      ${active
                        ? 'bg-slate-800 text-white'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }
                    `}
                  >
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    {!sidebarCollapsed && item.name}
                  </Link>
                );

                if (sidebarCollapsed) {
                  return (
                    <Tooltip key={item.name}>
                      <TooltipTrigger asChild>
                        {linkContent}
                      </TooltipTrigger>
                      <TooltipContent side="right" className="bg-slate-800 text-white border-slate-700">
                        {item.name}
                      </TooltipContent>
                    </Tooltip>
                  );
                }

                return linkContent;
              })}
            </nav>

            {/* Footer */}
            {!sidebarCollapsed && (
              <div className="p-4 border-t border-slate-800">
                <p className="text-xs text-slate-500 text-center">
                  © 2024 WhitLend
                </p>
              </div>
            )}
          </div>
        </aside>

        {/* Mobile Header */}
        <header className="md:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-slate-200">
          {/* Theme accent bar */}
          <div
            className="h-1 w-full transition-colors duration-300"
            style={{ backgroundColor: currentTheme.primary }}
          />
          <div className="flex items-center justify-between px-4 h-14">
            <div className="flex items-center gap-2">
              {showBackButton && (
                <button
                  onClick={() => navigate(-1)}
                  className="text-slate-600 hover:text-slate-900 transition-colors p-1 -ml-1 rounded"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              <div
                className="p-1.5 rounded-lg transition-colors duration-300"
                style={{ backgroundColor: currentTheme.primary }}
              >
                <Building2 className="w-4 h-4 text-white" />
              </div>
              <span className="text-lg font-bold text-slate-900">WhitLend</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </Button>
          </div>
        </header>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden fixed inset-0 z-30 bg-black/50" onClick={() => setMobileMenuOpen(false)}>
            <div
              className="absolute top-14 left-0 right-0 bg-white border-b border-slate-200 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Organization Switcher for Mobile */}
              <div className="px-3 py-3 border-b border-slate-200">
                <OrganizationSwitcher />
              </div>
              <nav className="p-2">
                {navigation.map((item) => {
                  const active = isActive(item.href);
                  return (
                    <Link
                      key={item.name}
                      to={createPageUrl(item.href)}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`
                        flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium
                        ${active
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-600 hover:bg-slate-50'
                        }
                      `}
                    >
                      <item.icon className="w-5 h-5" />
                      {item.name}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className={`${mainPadding} pt-14 md:pt-0 transition-all duration-300`}>
          {/* Desktop header with organization name and theme color */}
          <div className="hidden md:block sticky top-0 z-30">
            <div
              className="h-12 flex items-center px-6 transition-colors duration-300"
              style={{ backgroundColor: currentTheme.primary }}
            >
              <div className="flex items-center gap-3">
                {showBackButton && (
                  <button
                    onClick={() => navigate(-1)}
                    className="text-white/70 hover:text-white transition-colors p-1 -ml-1 rounded hover:bg-white/10"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                )}
                <Building2 className="w-5 h-5 text-white/80" />
                <span className="text-white font-medium">
                  {currentOrganization?.name || 'Select Organization'}
                </span>
              </div>
            </div>
          </div>
          {children}
        </main>
      </div>
    </TooltipProvider>
  );
}
