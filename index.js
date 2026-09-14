const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const xml2js = require("xml2js");

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const TARGET_URL = "https://torrentdosfilmes2.xyz/sitemap_index.xml";

const manifest = {
  id: "com.nuvio.tdflancamentos",
  version: "1.0.5",
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

// Memória local para entrega instantânea ao Nuvio
let catalogMemory = [];

// Função de scraping via JSDelivr/CORS proxy com timeout curto
async function fetchLatestFromSite() {
  console.log("[CRON] Atualizando catálogo em segundo plano...");
  try {
    // Tenta obter o sitemap via proxy
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(TARGET_URL)}`;
    const response = await axios.get(proxyUrl, { 
      timeout: 8000,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);
    
    const sitemaps = result.sitemapindex.sitemap;
    const postSitemapObj = sitemaps.find(s => s.loc[0].includes("post-sitemap"));
    if (!postSitemapObj) return;

    const postSitemapUrl = postSitemapObj.loc[0];
    const proxyPostUrl = `https://corsproxy.io/?${encodeURIComponent(postSitemapUrl)}`;
    const postResponse = await axios.get(proxyPostUrl, { timeout: 8000 });
    const postResult = await parser.parseStringPromise(postResponse.data);

    const items = postResult.urlset.url.map(u => {
      const loc = u.loc[0];
      const lastmod = u.lastmod ? u.lastmod[0] : null;
      const slug = loc.replace(/\/$/, "").split("/").pop();
      const title = slug.replace(/-/g, " ");

      return { title, date: lastmod ? new Date(lastmod) : new Date(0) };
    });

    items.sort((a, b) => b.date - a.date);
    const topItems = items.slice(0, 15);

    // Consulta o TMDB
    const metasPromises = topItems.map(p => getTmdbMeta(p.title));
    const metasResults = await Promise.all(metasPromises);
    const validMetas = metasResults.filter(Boolean);

    if (validMetas.length > 0) {
      catalogMemory = validMetas;
      console.log(`[CRON] Catálogo atualizado com sucesso! Total: ${validMetas.length} itens.`);
    }
  } catch (error) {
    console.error("[CRON] Erro ao atualizar catálogo:", error.message);
  }
}

async function getTmdbMeta(title) {
  if (!TMDB_API_KEY) return null;
  try {
    const cleanSearch = title
      .replace(/(torrent|download|dublado|legendado|dual|audio|web-dl|bluray|720p|1080p|4k|\d{4})/gi, "")
      .trim();

    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanSearch)}&language=pt-BR`;
    const res = await axios.get(url, { timeout: 3000 });
    
    if (res.data && res.data.results && res.data.results.length > 0) {
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
    // Silencia erros individuais do TMDB
  }
  return null;
}

// Resposta imediata ao Nuvio
builder.defineCatalogHandler(async ({ id }) => {
  if (id === "tdf_latest") {
    // Retorna instantaneamente o que estiver na memória
    return { metas: catalogMemory };
  }
  return { metas: [] };
});

// Executa a primeira busca ao iniciar o servidor
fetchLatestFromSite();

// Executa a atualização a cada 30 minutos em segundo plano
setInterval(fetchLatestFromSite, 30 * 60 * 1000);

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
