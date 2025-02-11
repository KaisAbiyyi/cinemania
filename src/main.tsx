import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css'; // Import TailwindCSS or global styles
import MainLayout from './components/layouts/MainLayout';
import HomePage from './pages/home/HomePage';
import NotFoundPage from './pages/NotFoundPage';


const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout><HomePage /></MainLayout>}>
          {/* Child routes */}
        </Route>

        {/* Fallback route */}
        <Route path="*" element={
          <MainLayout>
            <NotFoundPage />
          </MainLayout>
        } />
      </Routes>
    </BrowserRouter>
  );
};

// Render the application
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
