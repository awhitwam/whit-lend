import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPasswordValidation } from '@/lib/passwordValidation';

const requirements = [
  { key: 'minLength', label: 'At least 8 characters' },
  { key: 'hasUppercase', label: 'One uppercase letter (A-Z)' },
  { key: 'hasLowercase', label: 'One lowercase letter (a-z)' },
  { key: 'hasNumber', label: 'One number (0-9)' },
  { key: 'hasSpecialChar', label: 'One special character (!@#$%^&*...)' }
];

export function PasswordRequirements({ password, className }) {
  const validation = getPasswordValidation(password);

  return (
    <ul className={cn('space-y-1 text-xs', className)}>
      {requirements.map(({ key, label }) => {
        const met = validation[key];
        return (
          <li key={key} className="flex items-center gap-1.5">
            {met ? (
              <Check className="w-3 h-3 text-emerald-600 flex-shrink-0" />
            ) : (
              <X className="w-3 h-3 text-slate-400 flex-shrink-0" />
            )}
            <span className={cn(met ? 'text-emerald-600' : 'text-slate-500')}>
              {label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default PasswordRequirements;
