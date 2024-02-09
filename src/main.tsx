import { createRoot } from 'react-dom/client'
import './globals.css'
import { StrictMode } from 'react'
import { Route, BrowserRouter as Router, Routes } from 'react-router-dom'
import Layout from './layout'

// Page Import
import HomePage from './pages/Home'
import NotFound404 from './pages/NotFound404'

const container = document.getElementById("root")

if (container) {
  const root = createRoot(container)
  root.render(
    <StrictMode>
      <Router>
        <Routes>
          {/* Available Public Route */}
          <Route path="/" element={<Layout><HomePage /></Layout>} />

          {/* Non Routeable */}
          <Route path='*' element={<Layout><NotFound404 /></Layout>} />
        </Routes>
      </Router>
    </StrictMode>
  )
} else {
  console.error("Failed to find the root element")
}