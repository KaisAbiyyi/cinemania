/**
 * Seeded deterministic test fixtures for TMDB API and offline tests.
 * Guarantees zero network calls to external api.themoviedb.org.
 */

export const mockGenres = {
  movie: [
    { id: 28, name: "Action" },
    { id: 12, name: "Adventure" },
    { id: 16, name: "Animation" },
    { id: 35, name: "Comedy" },
    { id: 80, name: "Crime" },
    { id: 99, name: "Documentary" },
    { id: 18, name: "Drama" },
    { id: 878, name: "Science Fiction" },
  ],
  tv: [
    { id: 10759, name: "Action & Adventure" },
    { id: 16, name: "Animation" },
    { id: 35, name: "Comedy" },
    { id: 80, name: "Crime" },
    { id: 99, name: "Documentary" },
    { id: 18, name: "Drama" },
    { id: 10765, name: "Sci-Fi & Fantasy" },
  ],
};

export const mockLanguages = [
  { iso_639_1: "en", english_name: "English", name: "English" },
  { iso_639_1: "id", english_name: "Indonesian", name: "Bahasa Indonesia" },
  { iso_639_1: "ja", english_name: "Japanese", name: "日本語" },
  { iso_639_1: "ko", english_name: "Korean", name: "한국어" },
];

export const mockRegions = {
  results: [
    { iso_3166_1: "US", english_name: "United States", native_name: "United States" },
    { iso_3166_1: "ID", english_name: "Indonesia", native_name: "Indonesia" },
    { iso_3166_1: "GB", english_name: "United Kingdom", native_name: "United Kingdom" },
  ],
};

export const mockWatchProviders = {
  results: [
    { provider_id: 8, provider_name: "Netflix", logo_path: "/t2yyOv40HZeVlLjYsCsPHnWLk4W.jpg" },
    { provider_id: 9, provider_name: "Amazon Prime Video", logo_path: "/emthp39XA2zhzgTvILbg2wyCJav.jpg" },
    { provider_id: 337, provider_name: "Disney Plus", logo_path: "/7rwgEs55tOXNuFDURBuowNmFsx2.jpg" },
  ],
};

export const mockMovieDetail = {
  id: 550,
  title: "Fight Club",
  name: "Fight Club",
  overview: "A ticking-time-bomb insomniac and a slippery soap salesman channel primal male aggression into a shocking new form of therapy.",
  poster_path: "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
  backdrop_path: "/hZkgoQYus5vegHoetLkCJzb17zJ.jpg",
  release_date: "1999-10-15",
  first_air_date: "1999-10-15",
  vote_average: 8.4,
  vote_count: 28000,
  genres: [{ id: 18, name: "Drama" }],
  runtime: 139,
  status: "Released",
  tagline: "Mischief. Mayhem. Soap.",
};

export const mockMoviesList = {
  page: 1,
  results: [
    {
      id: 27205,
      title: "Inception",
      overview: "Cobb, a skilled thief who commits corporate espionage by infiltrating the subconscious of his targets.",
      poster_path: "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
      backdrop_path: "/s3TBrRGB1iav7gFOCNx3H31MoES.jpg",
      release_date: "2010-07-15",
      vote_average: 8.4,
      vote_count: 35000,
      genre_ids: [28, 878, 12],
    },
    {
      id: 550,
      title: "Fight Club",
      overview: "A ticking-time-bomb insomniac and a slippery soap salesman channel primal male aggression.",
      poster_path: "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
      backdrop_path: "/hZkgoQYus5vegHoetLkCJzb17zJ.jpg",
      release_date: "1999-10-15",
      vote_average: 8.4,
      vote_count: 28000,
      genre_ids: [18],
    },
  ],
  total_pages: 1,
  total_results: 2,
};
