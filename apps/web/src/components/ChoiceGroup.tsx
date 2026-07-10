import { useRef } from "react";

export interface Choice<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

interface ChoiceGroupProps<T extends string> {
  label: string;
  value: T;
  options: Choice<T>[];
  onChange: (value: T) => void;
}

/** A one-of-N segmented control as an ARIA radiogroup with roving focus. */
export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: ChoiceGroupProps<T>) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const order = options.map((option) => option.value);

  function move(next: T) {
    onChange(next);
    refs.current[next]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = order.indexOf(value);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(order[(index + 1) % order.length]);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(order[(index - 1 + order.length) % order.length]);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="voy-choice"
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[option.value] = node;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            className={`voy-choice__opt${active ? " is-active" : ""}`}
            onClick={() => onChange(option.value)}
          >
            <span className="voy-choice__label">{option.label}</span>
            {option.hint ? (
              <span className="voy-choice__hint">{option.hint}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
