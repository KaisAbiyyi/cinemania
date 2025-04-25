import { FC } from 'react';
import { Button } from './ui/button';
import { CardDescription, CardTitle } from './ui/card';
import { RotateCcw } from 'lucide-react';

interface ErrorStateProps {
    message: string;
    onRetry?: () => void;
}

const ErrorState: FC<ErrorStateProps> = ({ message, onRetry }) => {
    return (
        <div className="flex flex-col items-center justify-center gap-4">
            <div className="flex items-center gap-2">
                <CardTitle>Oops!</CardTitle>
                <CardDescription>{message}</CardDescription>
            </div>
            {onRetry && (
                <Button
                className='cursor-pointer'
                    onClick={onRetry}>
                    <RotateCcw />
                    Try Again
                </Button>
            )}
        </div>
    );
};

export default ErrorState;