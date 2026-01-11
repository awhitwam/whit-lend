import { cn } from '@/lib/utils';
import { calculatePasswordStrength, getStrengthLevel, getStrengthLabel } from '@/lib/passwordValidation';

const strengthColors = {
  weak: 'bg-red-500',
  medium: 'bg-amber-500',
  strong: 'bg-emerald-500'
};

const strengthBgColors = {
  weak: 'bg-red-100',
  medium: 'bg-amber-100',
  strong: 'bg-emerald-100'
};

const strengthTextColors = {
  weak: 'text-red-600',
  medium: 'text-amber-600',
  strong: 'text-emerald-600'
};

export function PasswordStrengthIndicator({ password, className }) {
  const strength = calculatePasswordStrength(password);
  const strengthLevel = getStrengthLevel(password);
  const strengthLabel = getStrengthLabel(password);

  if (!password || strength === 0) return null;

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex justify-between items-center">
        <span className="text-xs text-slate-500">Password strength</span>
        <span className={cn('text-xs font-medium', strengthTextColors[strengthLevel])}>
          {strengthLabel}
        </span>
      </div>
      <div className={cn('h-1.5 w-full rounded-full', strengthBgColors[strengthLevel])}>
        <div
          className={cn('h-full rounded-full transition-all duration-300', strengthColors[strengthLevel])}
          style={{ width: `${strength}%` }}
        />
      </div>
    </div>
  );
}

export default PasswordStrengthIndicator;
