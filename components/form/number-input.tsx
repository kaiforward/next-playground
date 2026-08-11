import { forwardRef } from "react";
import { InputField, type InputFieldProps } from "./input-field";

type NumberInputProps = Omit<InputFieldProps, "type">;

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(props, ref) {
    return <InputField ref={ref} type="number" {...props} />;
  },
);
