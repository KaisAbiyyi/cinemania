import { createRoot } from 'react-dom/client'
import './globals.css'
import { StrictMode } from 'react'
import { Route, BrowserRouter, Routes } from 'react-router-dom'
import Layout from './layout'

// Page Import
import HomePage from './pages/index'
import NotFound404 from './pages/NotFound404'
import ContentDetail from './pages/ContentDetail'
import PersonDetail from './pages/person/PersonDetail'
import SearchPage from './pages/SearchPage'
import TrendingPage from './pages/TrendingPage'
import TVPage from './pages/tv/TVPage'
import MovieNowPlayingPage from './pages/movie/MovieNowPlayingPage'
import MovieUpcoming from './pages/movie/MovieUpcoming'
import MovieTopRated from './pages/movie/MovieTopRated'
import TVAiringToday from './pages/tv/TVAiringToday'
import TvOnTheAir from './pages/tv/TVOnTheAir'
import TVTopRated from './pages/tv/TVTopRated'
import MovieIndex from './pages/movie/MoviePage'

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
          <Route path="/movie" element={<Layout><MovieIndex /></Layout>} />
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