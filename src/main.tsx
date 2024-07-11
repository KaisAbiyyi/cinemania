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
import TVPage from './pages/TVPage'
import MovieNowPlayingPage from './pages/MovieNowPlayingPage'
import MovieUpcoming from './pages/MovieUpcoming'
import MovieTopRated from './pages/MovieTopRated'
import TVAiringToday from './pages/TVAiringToday'
import TvOnTheAir from './pages/TVOnTheAir'
import TVTopRated from './pages/TVTopRated'

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
          <Route path="/tv" element={<Layout><TVPage /></Layout>} />
          <Route path='/tv/airing-today' element={<Layout><TVAiringToday /></Layout>} />
          <Route path='/tv/on-the-air' element={<Layout><TvOnTheAir /></Layout>} />
          <Route path='/tv/top-rated' element={<Layout><TVTopRated /></Layout>} />
          <Route path='/tv/:id' element={<Layout><ContentDetail /></Layout>} />
          <Route path="/movie" element={<Layout><MoviePage /></Layout>} />
          <Route path='/movie/now-playing' element={<Layout><MovieNowPlayingPage /></Layout>} />
          <Route path='/movie/upcoming' element={<Layout><MovieUpcoming /></Layout>} />
          <Route path='/movie/top-rated' element={<Layout><MovieTopRated /></Layout>} />
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