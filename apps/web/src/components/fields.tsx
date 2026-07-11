import type {
  InputHTMLAttributes,
  ReactNode,
  Ref,
  TextareaHTMLAttributes,
} from "react";

interface FieldShellProps {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  children: (aria: {
    "aria-invalid"?: true;
    "aria-describedby"?: string;
  }) => ReactNode;
}

/** Layout + a11y wiring for one labelled control (label, hint, inline error). */
export function Field({
  id,
  label,
  error,
  hint,
  required,
  children,
}: FieldShellProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`voy-field${error ? " voy-field--invalid" : ""}`}>
      <label
        className={`voy-field__label${required ? " voy-field__label--req" : ""}`}
        htmlFor={id}
      >
        {label}
      </label>
      {hint ? (
        <p className="voy-field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {children({
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {error ? (
        <p className="voy-field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id"
> {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
}

export function TextField({
  id,
  label,
  error,
  hint,
  required,
  inputRef,
  className,
  ...rest
}: TextFieldProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      {(aria) => (
        <input
          id={id}
          ref={inputRef}
          className={`voy-input${className ? ` ${className}` : ""}`}
          required={required}
          {...aria}
          {...rest}
        />
      )}
    </Field>
  );
}

interface TextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id"
> {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

export function TextArea({
  id,
  label,
  error,
  hint,
  required,
  textareaRef,
  className,
  ...rest
}: TextAreaProps) {
  return (
    <Field id={id} label={label} error={error} hint={hint} required={required}>
      {(aria) => (
        <textarea
          id={id}
          ref={textareaRef}
          className={`voy-input voy-textarea${className ? ` ${className}` : ""}`}
          required={required}
          {...aria}
          {...rest}
        />
      )}
    </Field>
  );
}
