const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const xml2js = require("xml2js");

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const TARGET_URL = "https://torrentdosfilmes2.xyz/sitemap_index.xml";

const manifest = {
  id: "com.nuvio.tdflancamentos",
  version: "1.0.4",
  name: "TDF - Lançamentos",
  description: "Catálogo por ordem de adição do Torrent dos Filmes.",
  resources: ["catalog"],
  types: ["movie"],
  catalogs: [
    {
      type: "movie",
      id: "tdf_latest",
      name: "TDF - Recentes"
    }
  ]
};

const builder = new addonBuilder(manifest);

// Cache em memória para evitar timeouts no Nuvio
let catalogCache = [];
let lastFetchTime = 0;
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutos

async function fetchSitemapData() {
  const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(TARGET_URL)}`;
  const response = await axios.get(proxyUrl, { timeout: 4000 });
  const parser = new xml2js.Parser();
  const result = await parser.parseStringPromise(response.data);
  
  const sitemaps = result.sitemapindex.sitemap;
  const postSitemapObj = sitemaps.find(s => s.loc[0].includes("post-sitemap"));
  if (!postSitemapObj) return [];

  const postSitemapUrl = postSitemapObj.loc[0];
  const proxyPostUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(postSitemapUrl)}`;
  const postResponse = await axios.get(proxyPostUrl, { timeout: 4000 });
  const postResult = await parser.parseStringPromise(postResponse.data);

  const items = postResult.urlset.url.map(u => {
    const loc = u.loc[0];
    const lastmod = u.lastmod ? u.lastmod[0] : null;
    const slug = loc.replace(/\/$/, "").split("/").pop();
    const title = slug.replace(/-/g, " ");

    return { title, date: lastmod ? new Date(lastmod) : new Date(0) };
  });

  items.sort((a, b) => b.date - a.date);
  return items.slice(0, 15); // Reduzido para 15 para acelerar o retorno
}

async function getTmdbMeta(title) {
  if (!TMDB_API_KEY) return null;
  try {
    const cleanSearch = title
      .replace(/(torrent|download|dublado|legendado|dual|audio|web-dl|bluray|720p|1080p|4k|\d{4})/gi, "")
      .trim();

    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanSearch)}&language=pt-BR`;
    const res = await axios.get(url, { timeout: 2000 });
    
    if (res.data.results && res.data.results.length > 0) {
      const movie = res.data.results[0];
      return {
        id: `tmdb:${movie.id}`,
        name: movie.title,
        poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
        type: "movie",
        description: movie.overview || ""
      };
    }
  } catch (e) {
    // Ignora erros individuais de busca do TMDB para não travar a resposta
  }
  return null;
}

builder.defineCatalogHandler(async ({ id }) => {
  if (id === "tdf_latest") {
    const now = Date.now();

    // Se o cache for válido, responde instantaneamente (0.1s)
    if (catalogCache.length > 0 && (now - lastFetchTime) < CACHE_DURATION) {
      return { metas: catalogCache };
    }

    try {
      const posts = await fetchSitemapData();
      
      // Processa as chamadas do TMDB em paralelo ultrarrápido
      const metasPromises = posts.map(p => getTmdbMeta(p.title));
      const metasResults = await Promise.all(metasPromises);
      const metas = metasResults.filter(Boolean);

      if (metas.length > 0) {
        catalogCache = metas;
        lastFetchTime = now;
      }

      return { metas: catalogCache };
    } catch (error) {
      console.error("Erro no processamento:", error.message);
      // Se der erro/timeout, retorna o último cache gravado sem travar o app
      return { metas: catalogCache };
    }
  }
  return { metas: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
