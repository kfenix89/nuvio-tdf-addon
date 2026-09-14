const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const xml2js = require("xml2js");

// Chaves de API e URLs
const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const SCRAPER_API_KEY = process.env.SCRAPER_API_KEY || "cba201758865599e63aa28e3d821568a";
const SITE_SITEMAP = "https://torrentdosfilmes2.xyz/sitemap_index.xml";

const manifest = {
  id: "com.nuvio.tdflancamentos",
  version: "1.0.7",
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

// Função para buscar páginas ignorando o Cloudflare via ScraperAPI
async function fetchXmlThroughScraper(targetUrl) {
  try {
    const url = `http://api.scraperapi.com?api_key=${SCRAPER_API_KEY}&url=${encodeURIComponent(targetUrl)}`;
    const response = await axios.get(url, { timeout: 20000 });
    return response.data;
  } catch (err) {
    console.error(`Erro ao buscar ${targetUrl} via ScraperAPI:`, err.message);
    return null;
  }
}

// Extrai e ordena os posts mais recentes do sitemap
async function getLatestPosts() {
  try {
    console.log("Buscando sitemap principal...");
    const xmlData = await fetchXmlThroughScraper(SITE_SITEMAP);
    if (!xmlData) return [];

    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData);

    const sitemaps = result.sitemapindex.sitemap;
    const postSitemapObj = sitemaps.find(s => s.loc[0].includes("post-sitemap"));

    if (!postSitemapObj) {
      console.error("Sitemap de posts não encontrado.");
      return [];
    }

    const postSitemapUrl = postSitemapObj.loc[0];
    console.log("Buscando post-sitemap:", postSitemapUrl);

    const postXmlData = await fetchXmlThroughScraper(postSitemapUrl);
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

    // Ordena do mais recente para o mais antigo e limita aos 20 primeiros
    items.sort((a, b) => b.date - a.date);
    return items.slice(0, 20);
  } catch (error) {
    console.error("Erro ao processar sitemap:", error.message);
    return [];
  }
}

// Busca metadados (poster, nome, sinopse) no TMDB
async function getTmdbMeta(title) {
  if (!TMDB_API_KEY) return null;

  try {
    // Tratamento e limpeza do nome do arquivo torrent
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

// Handler do catálogo
builder.defineCatalogHandler(async ({ id }) => {
  if (id === "tdf_latest") {
    console.log("Recebida requisição de catálogo...");
    const posts = await getLatestPosts();

    if (posts.length === 0) {
      return { metas: [] };
    }

    const metasPromises = posts.map(p => getTmdbMeta(p.title));
    const metasResults = await Promise.all(metasPromises);
    const metas = metasResults.filter(Boolean);

    console.log(`Sucesso: ${metas.length} itens retornados.`);
    return { metas };
  }
  return { metas: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
