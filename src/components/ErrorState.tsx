import { FC } from 'react';
import { Button } from './ui/button';
import { RotateCcw } from 'lucide-react';

interface ErrorStateProps {
    title?: string;
    message: string;
    onRetry?: () => void;
    retryLabel?: string;
    className?: string;
}

const ErrorState: FC<ErrorStateProps> = ({
    title = 'Oops!',
    message,
    onRetry,
    retryLabel = 'Try Again',
    className = '',
}) => {
    return (
        <div
            role="alert"
            aria-live="assertive"
            className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-6 text-center ${className}`.trim()}
        >
            <div className="flex flex-col items-center gap-1">
                <h2 className="text-lg font-semibold leading-none text-destructive">{title}</h2>
                <p className="text-sm text-muted-foreground">{message}</p>
            </div>
            {onRetry && (
                <Button
                    type="button"
                    className="cursor-pointer"
                    onClick={onRetry}
                >
                    <RotateCcw />
                    {retryLabel}
                </Button>
            )}
        </div>
    );
};

export default ErrorState;