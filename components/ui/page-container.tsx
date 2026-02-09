import { tv, type VariantProps } from "tailwind-variants";

const pageContainerVariants = tv({
  base: "mx-auto px-4 py-8",
  variants: {
    size: {
      sm: "max-w-3xl",
      md: "max-w-4xl",
      lg: "max-w-7xl",
    },
  },
  defaultVariants: {
    size: "lg",
  },
});

type PageContainerVariants = VariantProps<typeof pageContainerVariants>;

interface PageContainerProps
  extends React.HTMLAttributes<HTMLDivElement>,
    PageContainerVariants {}

export function PageContainer({
  size,
  className,
  children,
  ...props
}: PageContainerProps) {
  return (
    <div className={pageContainerVariants({ size, className })} {...props}>
      {children}
    </div>
  );
}
