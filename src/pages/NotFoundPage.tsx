import { buttonVariants } from '@/components/ui/button';
import { FC } from 'react';
import { Link } from 'react-router-dom';

const NotFoundPage: FC = () => {
  return (
    <div className="flex flex-col items-center justify-center h-screen text-gray-800 bg-gray-100">
      <h1 className="mb-4 text-6xl font-bold">404</h1>
      <p className="mb-6 text-xl">Oops! The page you're looking for doesn't exist.</p>
      <Link
        to="/"
        className={buttonVariants()}
      >
        Back to Homepage
      </Link>
    </div>
  );
};

export default NotFoundPage;
