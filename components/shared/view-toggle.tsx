/**
 * components/shared/view-toggle.tsx
 * A two-option segmented toggle (e.g. Grouped / List). One treatment shared by
 * the Jobs and Customers headers so the control reads identically across the
 * app. Anchored + in-flow (no floating UI). Communicates state via aria-pressed.
 */

export interface ViewToggleOption<T extends string> {
  value: T;
  label: string;
}

export interface ViewToggleProps<T extends string> {
  value: T;
  options: [ViewToggleOption<T>, ViewToggleOption<T>];
  onChange: (v: T) => void;
  ariaLabel: string;
}

export function ViewToggle<T extends string>({ value, options, onChange, ariaLabel }: ViewToggleProps<T>) {
  return (
    <div className="view-seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          className={value === o.value ? "on" : ""}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
