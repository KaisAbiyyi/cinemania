import { createRoot } from 'react-dom/client'
import './globals.css'
import { StrictMode } from 'react'
import { Route, BrowserRouter, Routes } from 'react-router-dom'
import Layout from './layout'

// Page Import
import HomePage from './pages/Home'
import NotFound404 from './pages/NotFound404'
import ContentDetail from './pages/ContentDetail'
import PersonDetail from './pages/PersonDetail'
import SearchPage from './pages/SearchPage'
import TrendingPage from './pages/TrendingPage'
import MoviePage from './pages/MoviePage'

const container = document.getElementById("root")

if (container) {
  const root = createRoot(container)
  root.render(
    <StrictMode>
      <BrowserRouter>
        <Routes>
          {/* Available Public Route */}
          <Route path="/" element={<Layout><HomePage /></Layout>} />
          <Route path='/trending' element={<Layout><TrendingPage /></Layout>} />
          <Route path='/tv/:id' element={<Layout><ContentDetail /></Layout>} />
          <Route path="/movie" element={<Layout><MoviePage /></Layout>} />
          <Route path='/movie/:id' element={<Layout><ContentDetail /></Layout>} />
          <Route path='/person/:id' element={<Layout><PersonDetail /></Layout>} />
          <Route path='/search' element={<Layout><SearchPage /></Layout>} />

          {/* Non Routeable */}
          <Route path='*' element={<Layout><NotFound404 /></Layout>} />
        </Routes>
      </BrowserRouter>
    </StrictMode>
  )
} else {
  console.error("Failed to find the root element")
}