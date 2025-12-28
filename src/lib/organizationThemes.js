// Organization color themes for visual differentiation
// Each theme has a primary color for accents and a sidebar background variant

export const organizationThemes = {
  emerald: {
    name: 'Emerald',
    primary: 'rgb(16, 185, 129)',      // emerald-500
    primaryHover: 'rgb(5, 150, 105)',  // emerald-600
    sidebar: 'rgb(15, 23, 42)',        // slate-900 (default)
    sidebarAccent: 'rgb(16, 185, 129)', // emerald-500
    badge: 'bg-emerald-500',
    badgeText: 'text-white',
    ring: 'ring-emerald-500'
  },
  blue: {
    name: 'Blue',
    primary: 'rgb(59, 130, 246)',      // blue-500
    primaryHover: 'rgb(37, 99, 235)',  // blue-600
    sidebar: 'rgb(15, 23, 42)',        // slate-900
    sidebarAccent: 'rgb(59, 130, 246)', // blue-500
    badge: 'bg-blue-500',
    badgeText: 'text-white',
    ring: 'ring-blue-500'
  },
  purple: {
    name: 'Purple',
    primary: 'rgb(139, 92, 246)',      // violet-500
    primaryHover: 'rgb(124, 58, 237)', // violet-600
    sidebar: 'rgb(15, 23, 42)',        // slate-900
    sidebarAccent: 'rgb(139, 92, 246)', // violet-500
    badge: 'bg-violet-500',
    badgeText: 'text-white',
    ring: 'ring-violet-500'
  },
  orange: {
    name: 'Orange',
    primary: 'rgb(249, 115, 22)',      // orange-500
    primaryHover: 'rgb(234, 88, 12)',  // orange-600
    sidebar: 'rgb(15, 23, 42)',        // slate-900
    sidebarAccent: 'rgb(249, 115, 22)', // orange-500
    badge: 'bg-orange-500',
    badgeText: 'text-white',
    ring: 'ring-orange-500'
  },
  rose: {
    name: 'Rose',
    primary: 'rgb(244, 63, 94)',       // rose-500
    primaryHover: 'rgb(225, 29, 72)',  // rose-600
    sidebar: 'rgb(15, 23, 42)',        // slate-900
    sidebarAccent: 'rgb(244, 63, 94)', // rose-500
    badge: 'bg-rose-500',
    badgeText: 'text-white',
    ring: 'ring-rose-500'
  },
  teal: {
    name: 'Teal',
    primary: 'rgb(20, 184, 166)',      // teal-500
    primaryHover: 'rgb(13, 148, 136)', // teal-600
    sidebar: 'rgb(15, 23, 42)',        // slate-900
    sidebarAccent: 'rgb(20, 184, 166)', // teal-500
    badge: 'bg-teal-500',
    badgeText: 'text-white',
    ring: 'ring-teal-500'
  },
  amber: {
    name: 'Amber',
    primary: 'rgb(245, 158, 11)',      // amber-500
    primaryHover: 'rgb(217, 119, 6)',  // amber-600
    sidebar: 'rgb(15, 23, 42)',        // slate-900
    sidebarAccent: 'rgb(245, 158, 11)', // amber-500
    badge: 'bg-amber-500',
    badgeText: 'text-white',
    ring: 'ring-amber-500'
  },
  indigo: {
    name: 'Indigo',
    primary: 'rgb(99, 102, 241)',      // indigo-500
    primaryHover: 'rgb(79, 70, 229)',  // indigo-600
    sidebar: 'rgb(15, 23, 42)',        // slate-900
    sidebarAccent: 'rgb(99, 102, 241)', // indigo-500
    badge: 'bg-indigo-500',
    badgeText: 'text-white',
    ring: 'ring-indigo-500'
  }
};

export const defaultTheme = 'emerald';

export function getOrganizationTheme(organization) {
  const themeKey = organization?.settings?.theme || defaultTheme;
  return organizationThemes[themeKey] || organizationThemes[defaultTheme];
}

export function getThemeOptions() {
  return Object.entries(organizationThemes).map(([key, theme]) => ({
    value: key,
    label: theme.name,
    color: theme.primary
  }));
}
