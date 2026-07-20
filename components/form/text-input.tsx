import { forwardRef } from "react";
import { InputField, type InputFieldProps } from "./input-field";

type TextInputProps = Omit<InputFieldProps, "hint">;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput(props, ref) {
    return <InputField ref={ref} {...props} />;
  },
);
