import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getDateRangePresets, getActivePresetKey } from '@/lib/dateRangePresets';

/**
 * Quick-select row for a report period (UK tax years and calendar years).
 *
 * Purely presentational: it owns no state and reports the chosen preset back as its
 * descriptor, so the page sets both date strings. A button highlights whenever the
 * current From/To pair equals its range exactly, so hand-editing either date input
 * leaves no button active - indicating a custom range.
 *
 * @param {Object} props
 * @param {string} props.fromDate Current start date, 'yyyy-MM-dd'
 * @param {string} props.toDate Current end date, 'yyyy-MM-dd'
 * @param {(preset: {from: string, to: string}) => void} props.onSelect Called with the chosen preset
 * @param {string} [props.className] Extra classes for the wrapper
 */
export default function DateRangePresetButtons({ fromDate, toDate, onSelect, className }) {
  const presets = getDateRangePresets();
  const activeKey = getActivePresetKey(fromDate, toDate);

  return (
    <div className={cn('flex items-center gap-1.5 flex-wrap', className)}>
      {presets.map(preset => {
        const isActive = preset.key === activeKey;
        return (
          <Button
            key={preset.key}
            type="button"
            variant={isActive ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2.5 text-xs"
            title={preset.hint}
            aria-pressed={isActive}
            onClick={() => onSelect(preset)}
          >
            {preset.label}
          </Button>
        );
      })}
    </div>
  );
}
