"use client";

import Select, { type StylesConfig } from "react-select";
import { tv, type VariantProps } from "tailwind-variants";
import { formSlots, formSizeVariants } from "./form-slots";

export type SelectOption<T = string> = { value: T; label: string };

const selectInputVariants = tv({
  slots: {
    label: formSlots.label,
    container: "",
    error: formSlots.error,
  },
  variants: {
    size: {
      sm: {
        label: formSizeVariants.sm.label,
        error: formSizeVariants.sm.error,
      },
      md: {
        label: formSizeVariants.md.label,
        error: formSizeVariants.md.error,
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

function darkStyles<T>(): StylesConfig<SelectOption<T>, false> {
  return {
    control: (base, state) => ({
      ...base,
      backgroundColor: "#161b22",
      borderColor: state.isFocused
        ? "#c75b39"
        : "rgba(139,148,158,0.15)",
      borderRadius: "0",
      minHeight: "2.25rem",
      boxShadow: state.isFocused ? "0 0 0 1px #c75b39" : "none",
      "&:hover": {
        borderColor: state.isFocused
          ? "#c75b39"
          : "rgba(139,148,158,0.30)",
      },
    }),
    singleValue: (base) => ({
      ...base,
      color: "#c9d1d9",
      fontSize: "0.875rem",
    }),
    input: (base) => ({
      ...base,
      color: "#c9d1d9",
      fontSize: "0.875rem",
    }),
    placeholder: (base) => ({
      ...base,
      color: "#545d68",
      fontSize: "0.875rem",
    }),
    menu: (base) => ({
      ...base,
      backgroundColor: "#161b22",
      border: "1px solid rgba(139,148,158,0.15)",
      borderRadius: "0",
      zIndex: 50,
    }),
    menuList: (base) => ({
      ...base,
      padding: "0.25rem",
    }),
    option: (base, state) => ({
      ...base,
      backgroundColor: state.isFocused
        ? "#1c2129"
        : "transparent",
      color: state.isSelected ? "#c75b39" : "#c9d1d9",
      fontSize: "0.875rem",
      borderRadius: "0",
      padding: "0.375rem 0.75rem",
      cursor: "pointer",
      "&:active": {
        backgroundColor: "#242a33",
      },
    }),
    indicatorSeparator: () => ({ display: "none" }),
    dropdownIndicator: (base) => ({
      ...base,
      color: "#545d68",
      padding: "0 0.5rem",
      "&:hover": { color: "#8b949e" },
    }),
    clearIndicator: (base) => ({
      ...base,
      color: "#545d68",
      "&:hover": { color: "#8b949e" },
    }),
    noOptionsMessage: (base) => ({
      ...base,
      color: "#545d68",
      fontSize: "0.875rem",
    }),
    menuPortal: (base) => ({
      ...base,
      zIndex: 9999,
    }),
  };
}

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
        styles={darkStyles<T>()}
        menuPortalTarget={typeof document !== "undefined" ? document.body : null}
      />
      {error && <p className={styles.error()}>{error}</p>}
    </div>
  );
}
