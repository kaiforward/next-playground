"use client";

import Select, { type StylesConfig } from "react-select";
import { tv, type VariantProps } from "tailwind-variants";

export type SelectOption<T = string> = { value: T; label: string };

const selectInputVariants = tv({
  slots: {
    label: "block font-medium mb-1",
    container: "",
    error: "mt-1 text-red-400",
  },
  variants: {
    size: {
      sm: {
        label: "text-xs text-white/50 uppercase tracking-wider",
        error: "text-xs",
      },
      md: {
        label: "text-sm text-white/70 mb-1.5",
        error: "text-xs",
      },
    },
  },
  defaultVariants: {
    size: "sm",
  },
});

type SelectInputVariants = VariantProps<typeof selectInputVariants>;

interface SelectInputProps<T = string> extends SelectInputVariants {
  label?: string;
  error?: string;
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Convert value to string for react-select's internal comparison. Required for non-primitive value types. */
  valueKey?: (value: T) => string;
  placeholder?: string;
  isSearchable?: boolean;
  id?: string;
}

const darkStyles: StylesConfig<SelectOption, false> = {
  control: (base, state) => ({
    ...base,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderColor: state.isFocused
      ? "rgb(59,130,246)"
      : "rgba(255,255,255,0.1)",
    borderRadius: "0.5rem",
    minHeight: "2.25rem",
    boxShadow: state.isFocused ? "0 0 0 1px rgb(59,130,246)" : "none",
    "&:hover": {
      borderColor: state.isFocused
        ? "rgb(59,130,246)"
        : "rgba(255,255,255,0.2)",
    },
  }),
  singleValue: (base) => ({
    ...base,
    color: "white",
    fontSize: "0.875rem",
  }),
  input: (base) => ({
    ...base,
    color: "white",
    fontSize: "0.875rem",
  }),
  placeholder: (base) => ({
    ...base,
    color: "rgba(255,255,255,0.3)",
    fontSize: "0.875rem",
  }),
  menu: (base) => ({
    ...base,
    backgroundColor: "rgb(17,24,39)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "0.5rem",
    zIndex: 50,
  }),
  menuList: (base) => ({
    ...base,
    padding: "0.25rem",
  }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isFocused
      ? "rgba(255,255,255,0.1)"
      : "transparent",
    color: state.isSelected ? "rgb(96,165,250)" : "white",
    fontSize: "0.875rem",
    borderRadius: "0.375rem",
    padding: "0.375rem 0.75rem",
    cursor: "pointer",
    "&:active": {
      backgroundColor: "rgba(255,255,255,0.15)",
    },
  }),
  indicatorSeparator: () => ({ display: "none" }),
  dropdownIndicator: (base) => ({
    ...base,
    color: "rgba(255,255,255,0.4)",
    padding: "0 0.5rem",
    "&:hover": { color: "rgba(255,255,255,0.6)" },
  }),
  clearIndicator: (base) => ({
    ...base,
    color: "rgba(255,255,255,0.4)",
    "&:hover": { color: "rgba(255,255,255,0.6)" },
  }),
  noOptionsMessage: (base) => ({
    ...base,
    color: "rgba(255,255,255,0.4)",
    fontSize: "0.875rem",
  }),
  menuPortal: (base) => ({
    ...base,
    zIndex: 9999,
  }),
};

export function SelectInput<T = string>({
  label,
  error,
  options,
  value,
  onChange,
  valueKey,
  placeholder = "Select...",
  isSearchable = true,
  size,
  id,
}: SelectInputProps<T>) {
  const toKey = valueKey ?? ((v: T) => String(v));
  const currentKey = toKey(value);
  const styles = selectInputVariants({ size });
  const selected = options.find((o) => toKey(o.value) === currentKey) ?? null;

  return (
    <div>
      {label && (
        <label htmlFor={id} className={styles.label()}>
          {label}
        </label>
      )}
      <Select<SelectOption<T>, false>
        inputId={id}
        options={options}
        value={selected}
        onChange={(opt) => {
          if (opt) onChange(opt.value);
        }}
        getOptionValue={(o) => toKey(o.value)}
        placeholder={placeholder}
        isSearchable={isSearchable}
        styles={darkStyles as unknown as StylesConfig<SelectOption<T>, false>}
        menuPortalTarget={typeof document !== "undefined" ? document.body : null}
      />
      {error && <p className={styles.error()}>{error}</p>}
    </div>
  );
}
