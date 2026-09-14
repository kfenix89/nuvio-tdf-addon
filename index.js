const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const xml2js = require("xml2js");

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const SITE_SITEMAP = "https://torrentdosfilmes2.xyz/sitemap_index.xml";

const manifest = {
  id: "com.nuvio.tdflancamentos",
  version: "1.0.2",
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

const customHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
};

async function getLatestPosts() {
  try {
    const response = await axios.get(SITE_SITEMAP, { headers: customHeaders, timeout: 10000 });
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);
    
    // Filtra o sitemap de posts
    const sitemaps = result.sitemapindex.sitemap;
    const postSitemapObj = sitemaps.find(s => s.loc[0].includes("post-sitemap"));
    
    if (!postSitemapObj) return [];

    const postSitemapUrl = postSitemapObj.loc[0];
    const postResponse = await axios.get(postSitemapUrl, { headers: customHeaders, timeout: 10000 });
    const postResult = await parser.parseStringPromise(postResponse.data);

    // Extrai os URLs do post-sitemap
    const items = postResult.urlset.url.map(u => {
      const loc = u.loc[0];
      const lastmod = u.lastmod ? u.lastmod[0] : null;
      
      // Remove a barra final e pega o último segmento da URL
      const slug = loc.replace(/\/$/, "").split("/").pop();
      const title = slug.replace(/-/g, " ");

      return {
        title: title,
        date: lastmod ? new Date(lastmod) : new Date(0)
      };
    });

    // Ordena do mais recente para o mais antigo e limita aos 25 primeiros
    items.sort((a, b) => b.date - a.date);
    return items.slice(0, 25);
  } catch (error) {
    console.error("Erro ao ler Sitemap do site:", error.message);
    return [];
  }
}

async function getTmdbMeta(title) {
  if (!TMDB_API_KEY) return null;

  try {
    // Limpa palavras comuns de títulos de torrent para otimizar a busca no TMDB
    const cleanSearch = title
      .replace(/(torrent|download|dublado|legendado|dual|audio|web-dl|bluray|720p|1080p|4k|\d{4})/gi, "")
      .trim();

    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanSearch)}&language=pt-BR`;
    const res = await axios.get(url, { timeout: 6000 });
    
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
    console.error("Erro ao converter título no TMDB:", e.message);
  }
  return null;
}

builder.defineCatalogHandler(async ({ id }) => {
  if (id === "tdf_latest") {
    const posts = await getLatestPosts();
    
    if (posts.length === 0) {
      return { metas: [] };
    }

    const metasPromises = posts.map(p => getTmdbMeta(p.title));
    const metasResults = await Promise.all(metasPromises);
    const metas = metasResults.filter(Boolean);
    
    return { metas };
  }
  return { metas: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
