import {
  useEffect,
  useId,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from "react";

import { plural, t } from "../app/i18n";
import { Field } from "./fields";

export interface ComboboxItem {
  /** The value written into the field when this item is chosen. */
  value: string;
  /** Optional label shown instead of `value`. Defaults to `value`. */
  label?: string;
  /** Optional muted note (e.g. "from a previous stay"). */
  detail?: string;
}

type NativeInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "value" | "onChange" | "type"
>;

interface ComboboxProps extends NativeInputProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * Fetch suggestions for the current text. Called on focus and (debounced) on
   * input. Must draw only on local data — no per-keystroke network geocoding.
   */
  fetchSuggestions: (query: string) => Promise<ComboboxItem[]>;
  error?: string;
  hint?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  /** Debounce for input-driven fetches, in ms. Focus fetches are immediate. */
  debounceMs?: number;
}

/**
 * An accessible combobox (WAI-ARIA APG "combobox with list autocomplete,
 * manually-selected"): a text input paired with a suggestion listbox.
 *
 * Free text is always valid — suggestions never gate what the user can type.
 * The control presents as a plain text field until local suggestions actually
 * exist for it, so a field with nothing to suggest carries no empty-combobox
 * semantics. Navigation is keyboard-first (Down/Up/Home/End/Enter/Escape) with
 * `aria-activedescendant`, and the popup uses no animation, so it is correct
 * under reduced-motion and at high zoom (it scrolls within a bounded height).
 */
export function Combobox({
  id,
  label,
  value,
  onChange,
  fetchSuggestions,
  error,
  hint,
  required,
  inputRef,
  debounceMs = 150,
  className,
  onBlur,
  onFocus,
  ...rest
}: ComboboxProps) {
  const listId = useId();
  const optionBaseId = useId();
  const [items, setItems] = useState<ComboboxItem[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // The control only takes on combobox semantics once it has had something to
  // suggest; before that it is an ordinary text field.
  const [everHadItems, setEverHadItems] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const focusedRef = useRef(false);
  // Set when the user dismisses the list (Escape/selection) so an in-flight or
  // debounced fetch cannot pop it back open; cleared the next time they type or
  // press ArrowDown.
  const suppressOpenRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // `openOnResults` distinguishes a focus "warm" (populate the list but keep it
  // closed, so it doesn't pop open the moment the field is autofocused) from a
  // typing/ArrowDown fetch (open the list when there are results).
  async function runFetch(query: string, openOnResults: boolean) {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    let next: ComboboxItem[];
    try {
      next = await fetchSuggestions(query);
    } catch {
      next = []; // suggestions are an aid; a failure must never block typing
    }
    // Ignore a stale response or one that resolved after the field blurred.
    if (requestId !== requestRef.current || !focusedRef.current) return;
    setItems(next);
    if (next.length > 0) setEverHadItems(true);
    setActiveIndex(-1);
    setOpen(openOnResults && next.length > 0 && !suppressOpenRef.current);
  }

  function scheduleFetch(query: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void runFetch(query, true), debounceMs);
  }

  function handleChange(nextValue: string) {
    suppressOpenRef.current = false; // typing re-enables suggestions
    onChange(nextValue);
    scheduleFetch(nextValue);
  }

  function dismiss() {
    if (timerRef.current) clearTimeout(timerRef.current);
    suppressOpenRef.current = true;
    setOpen(false);
    setActiveIndex(-1);
  }

  function commit(item: ComboboxItem) {
    onChange(item.value);
    dismiss();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        suppressOpenRef.current = false;
        if (items.length > 0) {
          setOpen(true);
          setActiveIndex(0);
        } else {
          // Nothing warmed yet — fetch now and let results open the list.
          void runFetch(value, true);
        }
        return;
      }
      if (items.length > 0) {
        setActiveIndex((index) => (index + 1) % items.length);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (items.length > 0) {
        suppressOpenRef.current = false;
        setOpen(true);
        setActiveIndex((index) =>
          index <= 0 ? items.length - 1 : index - 1,
        );
      }
    } else if (event.key === "Home" && open) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && open) {
      event.preventDefault();
      setActiveIndex(items.length - 1);
    } else if (event.key === "Enter") {
      if (open && activeIndex >= 0 && activeIndex < items.length) {
        event.preventDefault();
        commit(items[activeIndex]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        // Close the suggestion list first, and keep the event from bubbling to a
        // surrounding dialog — a second Escape (list already closed) closes that.
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }
    }
  }

  const isCombobox = everHadItems;
  const expanded = isCombobox ? open && items.length > 0 : undefined;
  const activeId =
    open && activeIndex >= 0 ? `${optionBaseId}-${activeIndex}` : undefined;

  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      {(aria) => (
        <div className="voy-combobox">
          <input
            id={id}
            ref={inputRef}
            type="text"
            className={`voy-input${className ? ` ${className}` : ""}`}
            required={required}
            value={value}
            role={isCombobox ? "combobox" : undefined}
            aria-autocomplete={isCombobox ? "list" : undefined}
            aria-expanded={expanded}
            // Only reference the listbox while it is actually in the DOM.
            aria-controls={expanded ? listId : undefined}
            aria-activedescendant={activeId}
            autoComplete="off"
            onChange={(event) => handleChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={(event) => {
              focusedRef.current = true;
              void runFetch(value, false); // warm the list; don't pop it open
              onFocus?.(event);
            }}
            onBlur={(event) => {
              focusedRef.current = false;
              // Close after the click on an option (if any) has been handled.
              setOpen(false);
              setActiveIndex(-1);
              onBlur?.(event);
            }}
            {...aria}
            {...rest}
          />
          {/* Count is announced politely; the active option is conveyed by
              aria-activedescendant on the input. */}
          <span className="voy-sr-only" role="status">
            {open && items.length > 0
              ? plural("combobox.available", items.length)
              : ""}
          </span>
          {open && items.length > 0 ? (
            <ul
              id={listId}
              role="listbox"
              className="voy-combobox__list"
              aria-label={t("combobox.listLabel", { label })}
            >
              {items.map((item, index) => (
                <li
                  key={`${item.value}-${index}`}
                  id={`${optionBaseId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={`voy-combobox__option${
                    index === activeIndex ? " voy-combobox__option--active" : ""
                  }`}
                  // Keep input focus so blur/selection order stays correct.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(item);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="voy-combobox__value">
                    {item.label ?? item.value}
                  </span>
                  {item.detail ? (
                    <span className="voy-combobox__detail">{item.detail}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </Field>
  );
}
