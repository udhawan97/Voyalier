import { useRef } from "react";

import { useTheme, type ThemeChoice } from "../app/theme";
import { DesktopIcon, MoonIcon, SunIcon } from "./icons";

const OPTIONS: { value: ThemeChoice; label: string; icon: React.ReactNode }[] =
  [
    { value: "light", label: "Light", icon: <SunIcon /> },
    { value: "system", label: "System", icon: <DesktopIcon /> },
    { value: "dark", label: "Dark", icon: <MoonIcon /> },
  ];

/** Light / System / Dark as an ARIA radiogroup with roving focus + arrow keys. */
export function ThemeToggle() {
  const [choice, setChoice] = useTheme();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const order = OPTIONS.map((option) => option.value);

  function move(next: ThemeChoice) {
    setChoice(next);
    refs.current[next]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = order.indexOf(choice);
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
      aria-label="Color theme"
      className="voy-theme"
      onKeyDown={handleKeyDown}
    >
      {OPTIONS.map((option) => {
        const active = choice === option.value;
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
            className={`voy-theme__opt${active ? " is-active" : ""}`}
            onClick={() => setChoice(option.value)}
          >
            <span className="voy-theme__icon" aria-hidden="true">
              {option.icon}
            </span>
            <span className="voy-theme__label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
