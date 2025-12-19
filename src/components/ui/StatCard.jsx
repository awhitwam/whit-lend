import { cn } from "@/lib/utils";

export default function StatCard({ 
  title, 
  value, 
  subtitle, 
  icon: Icon, 
  trend, 
  trendUp,
  className,
  iconClassName 
}) {
  return (
    <div className={cn(
      "bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-shadow",
      className
    )}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="text-2xl font-bold text-slate-900 tracking-tight">{value}</p>
          {subtitle && (
            <p className="text-xs text-slate-400">{subtitle}</p>
          )}
          {trend && (
            <div className={cn(
              "inline-flex items-center gap-1 text-xs font-medium mt-2 px-2 py-0.5 rounded-full",
              trendUp ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
            )}>
              {trend}
            </div>
          )}
        </div>
        {Icon && (
          <div className={cn(
            "p-3 rounded-xl",
            iconClassName || "bg-slate-100"
          )}>
            <Icon className="w-5 h-5 text-slate-600" />
          </div>
        )}
      </div>
    </div>
  );
}