import { FC } from "react";
import { Button } from "./ui/button";

interface EmptyStateProps {
  title?: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

const EmptyState: FC<EmptyStateProps> = ({
  title = "No results found",
  message,
  actionLabel,
  onAction,
  className = "",
}) => {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-muted-foreground ${className}`.trim()}
    >
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground">{message}</p>
      {actionLabel && onAction && (
        <Button type="button" variant="outline" className="mt-2" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
};

export default EmptyState;
