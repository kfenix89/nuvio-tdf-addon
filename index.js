const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const xml2js = require("xml2js");

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const SITE_SITEMAP = "https://torrentdosfilmes2.xyz/sitemap_index.xml";

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

// Função para fazer requisição via proxy e burlar bloqueio de Cloudflare
async function fetchXmlThroughProxy(targetUrl) {
  try {
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`;
    const response = await axios.get(proxyUrl, { timeout: 10000 });
    return response.data;
  } catch (err) {
    console.error("Erro ao buscar via proxy:", err.message);
    return null;
  }
}

async function getLatestPosts() {
  try {
    console.log("Buscando sitemap principal...");
    const xmlData = await fetchXmlThroughProxy(SITE_SITEMAP);
    if (!xmlData) return [];

    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData);

    const sitemaps = result.sitemapindex.sitemap;
    const postSitemapObj = sitemaps.find(s => s.loc[0].includes("post-sitemap"));

    if (!postSitemapObj) {
      console.error("Sitemap de posts não encontrado no XML.");
      return [];
    }

    const postSitemapUrl = postSitemapObj.loc[0];
    console.log("Buscando post-sitemap:", postSitemapUrl);

    const postXmlData = await fetchXmlThroughProxy(postSitemapUrl);
    if (!postXmlData) return [];

    const postResult = await parser.parseStringPromise(postXmlData);

    const items = postResult.urlset.url.map(u => {
      const loc = u.loc[0];
      const lastmod = u.lastmod ? u.lastmod[0] : null;

      const slug = loc.replace(/\/$/, "").split("/").pop() || "";
      const title = slug.replace(/-/g, " ");

      return {
        title: title,
        date: lastmod ? new Date(lastmod) : new Date(0)
      };
    });

    // Ordena do mais recente para o mais antigo
    items.sort((a, b) => b.date - a.date);
    return items.slice(0, 20);
  } catch (error) {
    console.error("Erro ao processar sitemap:", error.message);
    return [];
  }
}

async function getTmdbMeta(title) {
  if (!TMDB_API_KEY) return null;

  try {
    // Limpeza de termos comuns de torrent para garantir resultado no TMDB
    const cleanSearch = title
      .replace(/(torrent|download|dublado|legendado|dual|audio|web-dl|bluray|720p|1080p|4k|\d{4})/gi, "")
      .trim();

    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanSearch)}&language=pt-BR`;
    const res = await axios.get(url, { timeout: 5000 });

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
    console.error("Erro na busca TMDB:", e.message);
  }
  return null;
}

builder.defineCatalogHandler(async ({ id }) => {
  if (id === "tdf_latest") {
    console.log("Processando requisição de catálogo...");
    const posts = await getLatestPosts();

    if (posts.length === 0) {
      console.log("Nenhum post extraído do sitemap.");
      return { metas: [] };
    }

    const metasPromises = posts.map(p => getTmdbMeta(p.title));
    const metasResults = await Promise.all(metasPromises);
    const metas = metasResults.filter(Boolean);

    console.log(`Sucesso: ${metas.length} filmes retornados ao Nuvio.`);
    return { metas };
  }
  return { metas: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
