const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const xml2js = require("xml2js");

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const SITE_SITEMAP = "https://torrentdosfilmes2.xyz/sitemap_index.xml";

const manifest = {
  id: "com.nuvio.tdflancamentos",
  version: "1.0.1",
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

// Cabeçalhos HTTP para simular um navegador real e evitar bloqueios
const customHeaders = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
};

async function getLatestPosts() {
  try {
    console.log("Buscando sitemap principal...");
    const response = await axios.get(SITE_SITEMAP, { headers: customHeaders, timeout: 8000 });
    
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);
    
    // Procura o sitemap de posts
    const sitemaps = result.sitemapindex.sitemap;
    const postSitemapObj = sitemaps.find(s => s.loc[0].includes("post-sitemap"));
    const postSitemapUrl = postSitemapObj ? postSitemapObj.loc[0] : null;

    if (!postSitemapUrl) {
      console.error("Sitemap de posts não encontrado.");
      return [];
    }

    console.log("Buscando sitemap de posts:", postSitemapUrl);
    const postResponse = await axios.get(postSitemapUrl, { headers: customHeaders, timeout: 8000 });
    const postResult = await parser.parseStringPromise(postResponse.data);

    // Mapeia e filtra títulos válidos
    const urls = postResult.urlset.url
      .map(u => {
        const rawUrl = u.loc[0];
        const rawDate = u.lastmod ? u.lastmod[0] : 0;
        // Limpa a URL para extrair o nome do filme
        const slug = rawUrl.split("/").filter(Boolean).pop() || "";
        const cleanTitle = slug.replace(/-/g, " ");
        return {
          title: cleanTitle,
          date: new Date(rawDate)
        };
      })
      .filter(item => item.title.length > 3)
      .sort((a, b) => b.date - a.date)
      .slice(0, 20); // Pega os 20 mais recentes

    return urls;
  } catch (error) {
    console.error("Erro ao buscar sitemap:", error.message);
    return [];
  }
}

async function getTmdbMeta(title) {
  if (!TMDB_API_KEY) return null;

  try {
    // Remove palavras desnecessárias da busca
    const cleanSearch = title
      .replace(/(torrent|download|dublado|legendado|dual|audio|web dl|bluray|720p|1080p|4k|\d{4})/gi, "")
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
    console.log("Recebida requisição de catálogo para o Nuvio...");
    const posts = await getLatestPosts();
    
    if (posts.length === 0) {
      return { metas: [] };
    }

    const metasPromises = posts.map(p => getTmdbMeta(p.title));
    const metasResults = await Promise.all(metasPromises);
    const metas = metasResults.filter(Boolean);
    
    console.log(`Catálogo gerado com ${metas.length} itens.`);
    return { metas };
  }
  return { metas: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
