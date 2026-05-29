import type { CSSProperties } from "react";

interface ToggleSwitchProps {
  /** Current on/off state */
  checked: boolean;
  /** Called with the next state when toggled */
  onChange: (next: boolean) => void;
  /** Accessible name (use this OR ariaLabelledby) */
  ariaLabel?: string;
  /** Id of an element that labels this switch */
  ariaLabelledby?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
  title?: string;
  style?: CSSProperties;
}

/**
 * Accessible toggle switch built on the shared `.toggle-switch` / `.toggle-knob`
 * design-system markup. Adds role="switch" + aria-checked so screen readers can
 * perceive and announce the on/off state (which the bare <button> pattern lacked).
 */
export default function ToggleSwitch({
  checked,
  onChange,
  ariaLabel,
  ariaLabelledby,
  id,
  disabled,
  className,
  title,
  style,
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledby}
      title={title}
      disabled={disabled}
      style={style}
      className={`toggle-switch ${checked ? "on" : ""}${className ? ` ${className}` : ""}`}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
    >
      <span className="toggle-knob" />
    </button>
  );
}
