const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const xml2js = require("xml2js");

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const TARGET_URL = "https://torrentdosfilmes2.xyz/sitemap_index.xml";

// Uso de proxy publico para ignorar o bloqueio de Cloudflare/IP do Render
const PROXY_URL = `https://api.allorigins.win/raw?url=${encodeURIComponent(TARGET_URL)}`;

const manifest = {
  id: "com.nuvio.tdflancamentos",
  version: "1.0.3",
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

async function getLatestPosts() {
  try {
    console.log("Solicitando sitemap index via proxy...");
    const response = await axios.get(PROXY_URL, { timeout: 15000 });
    
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);
    
    // Localiza o post-sitemap no index XML
    const sitemaps = result.sitemapindex.sitemap;
    const postSitemapObj = sitemaps.find(s => s.loc[0].includes("post-sitemap"));
    
    if (!postSitemapObj) {
      console.error("Nenhum post-sitemap encontrado no XML.");
      return [];
    }

    const postSitemapUrl = postSitemapObj.loc[0];
    const proxyPostUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(postSitemapUrl)}`;
    
    console.log("Solicitando post-sitemap via proxy...");
    const postResponse = await axios.get(proxyPostUrl, { timeout: 15000 });
    const postResult = await parser.parseStringPromise(postResponse.data);

    // Mapeia e organiza os posts do site pela tag <lastmod>
    const items = postResult.urlset.url.map(u => {
      const loc = u.loc[0];
      const lastmod = u.lastmod ? u.lastmod[0] : null;
      
      const slug = loc.replace(/\/$/, "").split("/").pop();
      const title = slug.replace(/-/g, " ");

      return {
        title: title,
        date: lastmod ? new Date(lastmod) : new Date(0)
      };
    });

    items.sort((a, b) => b.date - a.date);
    return items.slice(0, 20); // Retorna os 20 lançamentos mais recentes
  } catch (error) {
    console.error("Erro na busca do sitemap:", error.message);
    return [];
  }
}

async function getTmdbMeta(title) {
  if (!TMDB_API_KEY) return null;

  try {
    // Limpa palavras comuns de release torrent para otimizar o matching no TMDB
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
    console.error("Erro na busca do TMDB:", e.message);
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
