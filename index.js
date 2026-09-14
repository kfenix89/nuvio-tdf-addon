const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");
const xml2js = require("xml2js");

const TMDB_API_KEY = process.env.TMDB_API_KEY || "SUA_CHAVE_TMDB_AQUI";
const SITE_SITEMAP = "https://torrentdosfilmes2.xyz/sitemap_index.xml";

const manifest = {
  id: "com.nuvio.tdflancamentos",
  version: "1.0.0",
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

// Função para buscar os URLs do Sitemap ordenados por data
async function getLatestPosts() {
  try {
    const response = await axios.get(SITE_SITEMAP, {
      headers: { "User-Agent": "Mozilla/5.0" }
    });
    
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);
    
    // Pega o primeiro post-sitemap (onde ficam os filmes recentes)
    const postSitemapUrl = result.sitemapindex.sitemap.find(s => s.loc[0].includes("post-sitemap")).loc[0];
    const postResponse = await axios.get(postSitemapUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
    const postResult = await parser.parseStringPromise(postResponse.data);

    // Mapeia os links e ordena pela tag <lastmod> (data mais recente)
    const urls = postResult.urlset.url
      .map(u => ({
        url: u.loc[0],
        date: new Date(u.lastmod ? u.lastmod[0] : 0),
        title: u.loc[0].split("/").filter(Boolean).pop().replace(/-/g, " ")
      }))
      .sort((a, b) => b.date - a.date)
      .slice(0, 20); // Pega os 20 mais recentes

    return urls;
  } catch (error) {
    console.error("Erro no XML:", error.message);
    return [];
  }
}

// Converter título limpo em ID do IMDb/TMDB via API do TMDB
async function getTmdbMeta(title) {
  try {
    const cleanTitle = title.replace(/(torrent|download|dublado|legendado|\d{4})/gi, "").trim();
    const res = await axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(cleanTitle)}&language=pt-BR`);
    
    if (res.data.results && res.data.results.length > 0) {
      const movie = res.data.results[0];
      return {
        id: `tmdb:${movie.id}`,
        name: movie.title,
        poster: `https://image.tmdb.org/t/p/w500${movie.poster_path}`,
        type: "movie",
        description: movie.overview
      };
    }
  } catch (e) {
    return null;
  }
  return null;
}

// Handler do Catálogo no Nuvio/Stremio
builder.defineCatalogHandler(async ({ id }) => {
  if (id === "tdf_latest") {
    const posts = await getLatestPosts();
    const metasPromises = posts.map(p => getTmdbMeta(p.title));
    const metas = (await Promise.all(metasPromises)).filter(Boolean);
    
    return { metas };
  }
  return { metas: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });