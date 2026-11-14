/* eslint-disable */
/**
 * Replayable deterministic TMDB API & Image CDN mock interceptor for Next.js server and E2E testing.
 * Intercepts outgoing HTTPS requests to api.themoviedb.org and image.tmdb.org without modifying application code.
 * Enforces 100% offline determinism and blocks unmocked external network traffic.
 *
 * Usage:
 *   NODE_OPTIONS="--require ./tests/fixtures/mock-tmdb.cjs" next start -p 3055
 */

const https = require('https');
const http = require('http');
const { PassThrough } = require('stream');
const fs = require('fs');
const path = require('path');
const logPath = path.resolve(__dirname, 'request-logs.json');

const requestLog = [];

function recordRequest(entry) {
  requestLog.push(entry);
  try {
    let existing = [];
    if (fs.existsSync(logPath)) {
      try {
        const content = fs.readFileSync(logPath, 'utf8');
        existing = JSON.parse(content);
        if (!Array.isArray(existing)) existing = [];
      } catch (_) {}
    }
    existing.push(entry);
    fs.writeFileSync(logPath, JSON.stringify(existing, null, 2));
  } catch (_) {}
}

// 70-byte valid 1x1 transparent PNG buffer (header: 89504e47)
const transparentPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const fixtures = {
  genres: {
    genres: [
      { id: 28, name: "Action" },
      { id: 12, name: "Adventure" },
      { id: 16, name: "Animation" },
      { id: 35, name: "Comedy" },
      { id: 80, name: "Crime" },
      { id: 99, name: "Documentary" },
      { id: 18, name: "Drama" },
      { id: 878, name: "Science Fiction" },
      { id: 10765, name: "Sci-Fi & Fantasy" },
      { id: 10759, name: "Action & Adventure" }
    ]
  },
  languages: [
    { iso_639_1: "en", english_name: "English", name: "English" },
    { iso_639_1: "id", english_name: "Indonesian", name: "Bahasa Indonesia" }
  ],
  providersRegion: {
    results: [
      { iso_3166_1: "US", english_name: "United States", native_name: "United States" }
    ]
  },
  providers: {
    results: [
      { provider_id: 8, provider_name: "Netflix", logo_path: "/t2yyOv40HZeVlLjYsCsPHnWLk4W.jpg" }
    ]
  },
  searchMovieInception: {
    page: 1,
    results: [
      {
        id: 27205,
        title: "Inception",
        overview: "Cobb, a skilled thief who commits corporate espionage by infiltrating the subconscious of his targets is offered a chance to regain his old life.",
        poster_path: "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
        backdrop_path: "/s3TBrRGB1iav7gFOCNx3H31MoES.jpg",
        release_date: "2010-07-15",
        vote_average: 8.4,
        vote_count: 35000,
        genre_ids: [28, 878, 12]
      }
    ],
    total_pages: 1,
    total_results: 1
  },
  searchEmpty: {
    page: 1,
    results: [],
    total_pages: 0,
    total_results: 0
  },
  movieDetail: {
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
    tagline: "Mischief. Mayhem. Soap."
  },
  movieList: {
    page: 1,
    results: [
      {
        id: 27205,
        title: "Inception",
        original_title: "Inception",
        overview: "Cobb, a skilled thief who commits corporate espionage by infiltrating the subconscious of his targets is offered a chance to regain his old life.",
        poster_path: "/oYuLEt3zVCKq57qu2F8dT7NIa6f.jpg",
        backdrop_path: "/s3TBrRGB1iav7gFOCNx3H31MoES.jpg",
        release_date: "2010-07-15",
        vote_average: 8.4,
        vote_count: 35000,
        genre_ids: [28, 878, 12]
      },
      {
        id: 157336,
        title: "Interstellar",
        original_title: "Interstellar",
        overview: "The adventures of a group of explorers who make use of a newly discovered wormhole to surpass the limitations on human space travel.",
        poster_path: "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
        backdrop_path: "/xJHokMbljvjADYDit5fK5VQsXEG.jpg",
        release_date: "2014-11-05",
        vote_average: 8.4,
        vote_count: 34000,
        genre_ids: [12, 18, 878]
      },
      {
        id: 550,
        title: "Fight Club",
        original_title: "Fight Club",
        overview: "A ticking-time-bomb insomniac and a slippery soap salesman channel primal male aggression into a shocking new form of therapy.",
        poster_path: "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg",
        backdrop_path: "/hZkgoQYus5vegHoetLkCJzb17zJ.jpg",
        release_date: "1999-10-15",
        vote_average: 8.4,
        vote_count: 28000,
        genre_ids: [18]
      },
      {
        id: 680,
        title: "Pulp Fiction",
        original_title: "Pulp Fiction",
        overview: "A burger-loving hit man, his philosophical partner, a drug-addled gangster's moll and a washed-up boxer converge in four tales of violence.",
        poster_path: "/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg",
        backdrop_path: "/suaEOtk1N1sgg2MTM7oZd2cfVp3.jpg",
        release_date: "1994-09-10",
        vote_average: 8.5,
        vote_count: 27000,
        genre_ids: [53, 80]
      }
    ],
    total_pages: 5,
    total_results: 20
  },
  tvList: {
    page: 1,
    results: [
      {
        id: 1399,
        name: "Game of Thrones",
        original_name: "Game of Thrones",
        overview: "Seven noble families fight for control of the mythical land of Westeros. Friction between the houses leads to full-scale war.",
        poster_path: "/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg",
        backdrop_path: "/2OMB0ynKlyIenMJWI2Dy9IWT4c.jpg",
        first_air_date: "2011-04-17",
        vote_average: 8.4,
        vote_count: 23000,
        genre_ids: [10765, 18, 10759]
      },
      {
        id: 1396,
        name: "Breaking Bad",
        original_name: "Breaking Bad",
        overview: "A chemistry teacher diagnosed with inoperable lung cancer turns to manufacturing methamphetamine.",
        poster_path: "/ggFHVNu6YYI5L9pCfOacjizRGt.jpg",
        backdrop_path: "/2OMB0ynKlyIenMJWI2Dy9IWT4c.jpg",
        first_air_date: "2008-01-20",
        vote_average: 8.9,
        vote_count: 14000,
        genre_ids: [18, 80]
      },
      {
        id: 66732,
        name: "Stranger Things",
        original_name: "Stranger Things",
        overview: "When a young boy vanishes, a small town uncovers a mystery involving secret experiments and terrifying supernatural forces.",
        poster_path: "/49WJfeN0moxb9IPfGn8AIqMGskD.jpg",
        backdrop_path: "/56v2KjBlU4XaOv9rVYEQypROD7P.jpg",
        first_air_date: "2016-07-15",
        vote_average: 8.6,
        vote_count: 17000,
        genre_ids: [18, 10765, 9648]
      },
      {
        id: 94605,
        name: "Arcane",
        original_name: "Arcane",
        overview: "Set in the utopian region of Piltover and the oppressed underground of Zaun, two iconic League champions clash.",
        poster_path: "/fqldf2t8ztc9aiwn3k6mlX3tvRT.jpg",
        backdrop_path: "/56v2KjBlU4XaOv9rVYEQypROD7P.jpg",
        first_air_date: "2021-11-06",
        vote_average: 8.7,
        vote_count: 4000,
        genre_ids: [16, 10765, 18]
      }
    ],
    total_pages: 5,
    total_results: 20
  }
};

function getFixture(urlObj) {
  const pathname = urlObj.pathname;
  const search = urlObj.searchParams;

  const q = search.get('query') || '';
  if (q.toLowerCase().includes('simulate_unauth') || q.toLowerCase().includes('unauth')) {
    return { errorStatus: 401, errorBody: { status_code: 7, status_message: "Invalid API key: You must be granted a valid key." } };
  }

  if (pathname.includes('/genre/')) return fixtures.genres;
  if (pathname.includes('/configuration/languages')) return fixtures.languages;
  if (pathname.includes('/watch/providers/regions')) return fixtures.providersRegion;
  if (pathname.includes('/watch/providers/')) return fixtures.providers;

  if (pathname.includes('/search/movie')) {
    if (q.toLowerCase().includes('inception')) {
      return fixtures.searchMovieInception;
    }
    return fixtures.searchEmpty;
  }

  if (pathname.includes('/search/')) {
    return fixtures.searchEmpty;
  }

  if (pathname.includes('/discover/tv') || pathname.includes('/trending/tv')) {
    return fixtures.tvList;
  }

  if (pathname.includes('/discover/movie')) {
    const kw = search.get('with_keywords') || '';
    if (kw === '999991') {
      return fixtures.searchEmpty;
    }
    if (kw === '999992') {
      return {
        page: 1,
        results: [
          {
            id: 999901,
            title: "Shortage Single Posterless Movie",
            overview: "Deterministic single-result fixture without poster image.",
            poster_path: null,
            release_date: "2024-05-12",
            vote_average: 7.5,
            adult: false,
          },
        ],
        total_pages: 1,
        total_results: 1,
      };
    }
    if (kw === '999993') {
      return {
        errorStatus: 429,
        errorBody: { status_code: 25, status_message: "Rate limit exceeded" },
        headers: { "retry-after": "3" },
      };
    }
    if (kw === '999994' || kw === '999995') {
      const count = kw === '999995' ? 100 : 20;
      const results = Array.from({ length: count }, (_, idx) => ({
        id: 800000 + idx + 1,
        title: `Deterministic Movie ${idx + 1}`,
        overview: `Overview for Deterministic Movie ${idx + 1}.`,
        poster_path: idx % 5 === 0 ? null : `/poster_${idx + 1}.jpg`,
        release_date: `2020-01-${String((idx % 28) + 1).padStart(2, '0')}`,
        vote_average: Number((6 + (idx % 40) / 10).toFixed(1)),
        adult: false,
      }));
      return {
        page: 1,
        results,
        total_pages: 1,
        total_results: count,
      };
    }
    return fixtures.movieList;
  }

  if (pathname.includes('/movie/popular') || pathname.includes('/movie/top_rated')) {
    return fixtures.movieList;
  }

  if (pathname.match(/\/movie\/\d+/)) {
    return fixtures.movieDetail;
  }

  if (pathname.includes('/trending/')) {
    return {
      page: 1,
      results: [
        ...fixtures.movieList.results.slice(0, 2),
        ...fixtures.tvList.results.slice(0, 2)
      ],
      total_pages: 1,
      total_results: 4
    };
  }

  return fixtures.movieList;
}

const originalHttpsRequest = https.request;
https.request = function(...args) {
  let urlObj;
  let cb;
  if (typeof args[0] === 'string' || args[0] instanceof URL) {
    urlObj = new URL(args[0]);
    if (typeof args[1] === 'function') cb = args[1];
    else if (typeof args[2] === 'function') cb = args[2];
  } else if (typeof args[0] === 'object') {
    const host = args[0].hostname || args[0].host;
    const path = args[0].path || '/';
    if (host) {
      urlObj = new URL(`https://${host}${path}`);
    }
    if (typeof args[1] === 'function') cb = args[1];
  }

  const hostname = urlObj ? urlObj.hostname : '';

  // Intercept TMDB API requests
  if (hostname === 'api.themoviedb.org') {
    const fixtureResult = getFixture(urlObj);
    const isError = fixtureResult.errorStatus !== undefined;
    const statusCode = isError ? fixtureResult.errorStatus : 200;
    const bodyObj = isError ? fixtureResult.errorBody : fixtureResult;
    const bodyStr = JSON.stringify(bodyObj);

    const sanitizedUrl = new URL(urlObj.href);
    if (sanitizedUrl.searchParams.has('api_key')) {
      sanitizedUrl.searchParams.set('api_key', '[REDACTED]');
    }

    recordRequest({
      timestamp: new Date().toISOString(),
      url: sanitizedUrl.href,
      pathname: sanitizedUrl.pathname,
      query: sanitizedUrl.search,
      statusCode,
      fixtureReturned: isError ? 'error_401' :
                       fixtureResult === fixtures.tvList ? 'tvList' :
                       fixtureResult === fixtures.movieList ? 'movieList' :
                       fixtureResult === fixtures.searchMovieInception ? 'searchMovieInception' :
                       fixtureResult === fixtures.searchEmpty ? 'searchEmpty' :
                       fixtureResult === fixtures.movieDetail ? 'movieDetail' : 'other',
      resultCount: isError ? 0 : (fixtureResult.results ? fixtureResult.results.length : (fixtureResult.id ? 1 : 0))
    });

    const clientReq = new PassThrough();
    clientReq.setHeader = () => {};
    clientReq.getHeader = () => {};
    clientReq.removeHeader = () => {};
    clientReq.abort = () => {};
    clientReq.destroy = () => {};
    clientReq.setTimeout = () => {};

    const clientRes = new PassThrough();
    clientRes.statusCode = statusCode;
    clientRes.headers = {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(bodyStr)),
      ...(fixtureResult.headers || {})
    };

    clientReq.on('finish', () => {
      process.nextTick(() => {
        if (cb) cb(clientRes);
        clientRes.end(Buffer.from(bodyStr));
      });
    });

    return clientReq;
  }

  // Intercept TMDB Image CDN requests (100% offline deterministic 1x1 PNG fixture)
  if (hostname === 'image.tmdb.org') {
    recordRequest({
      timestamp: new Date().toISOString(),
      url: urlObj.href,
      pathname: urlObj.pathname,
      query: urlObj.search,
      statusCode: 200,
      fixtureReturned: 'fixtureImagePng',
      resultCount: 1
    });

    const clientReq = new PassThrough();
    clientReq.setHeader = () => {};
    clientReq.getHeader = () => {};
    clientReq.removeHeader = () => {};
    clientReq.abort = () => {};
    clientReq.destroy = () => {};
    clientReq.setTimeout = () => {};

    const clientRes = new PassThrough();
    clientRes.statusCode = 200;
    clientRes.headers = {
      'content-type': 'image/png',
      'content-length': String(transparentPng.length),
      'cache-control': 'public, max-age=31536000, immutable'
    };

    clientReq.on('finish', () => {
      process.nextTick(() => {
        if (cb) cb(clientRes);
        clientRes.end(transparentPng);
      });
    });

    return clientReq;
  }

  // Guard: Block all unexpected outbound external traffic
  const isAllowedLocal = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '';
  if (!isAllowedLocal) {
    const errorMsg = `[mock_tmdb] BLOCKED unexpected outbound external request to ${hostname}: offline determinism enforced`;
    console.error(errorMsg);
    const clientReq = new PassThrough();
    clientReq.setHeader = () => {};
    clientReq.getHeader = () => {};
    clientReq.removeHeader = () => {};
    clientReq.abort = () => {};
    clientReq.destroy = () => {};
    clientReq.setTimeout = () => {};
    process.nextTick(() => {
      clientReq.emit('error', new Error(errorMsg));
    });
    return clientReq;
  }

  return originalHttpsRequest.apply(this, args);
};

https.get = function(...args) {
  const req = https.request(...args);
  req.end();
  return req;
};

process.on('exit', () => {
  if (requestLog.length === 0) return;
  try {
    let existing = [];
    if (fs.existsSync(logPath)) {
      try {
        const content = fs.readFileSync(logPath, 'utf8');
        existing = JSON.parse(content);
        if (!Array.isArray(existing)) existing = [];
      } catch (_) {}
    }
    const existingTimes = new Set(existing.map(e => e.timestamp + e.url));
    let added = false;
    for (const r of requestLog) {
      if (!existingTimes.has(r.timestamp + r.url)) {
        existing.push(r);
        added = true;
      }
    }
    if (added || existing.length > 0) {
      fs.writeFileSync(logPath, JSON.stringify(existing, null, 2));
    }
  } catch (_) {}
});

console.log('[mock_tmdb] TMDB API & Image CDN deterministic interceptor active');
