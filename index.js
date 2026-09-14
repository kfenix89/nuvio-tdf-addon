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
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8"
};

// Filmes de fallback caso o sitemap do site bloqueie o IP da nuvem
const fallbackTitles = [
  "Duna Parte 2",
  "Deadpool & Wolverine",
  "Godzilla e Kong O Novo Imperio",
  "Divertida Mente 2",
  "O Dublê",
  "Kung Fu Panda 4",
  "Planeta dos Macacos O Reinado"
];

async function getLatestPosts() {
  try {
    console.log("-> Tentando baixar sitemap...");
    const response = await axios.get(SITE_SITEMAP, { headers: customHeaders, timeout: 6000 });
    
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(response.data);
    
    let postSitemapUrl = null;
    if (result.sitemapindex && result.sitemapindex.sitemap) {
      const sitemapObj = result.sitemapindex.sitemap.find(s => s.loc && s.loc[0].includes("post-sitemap"));
      if (sitemapObj) postSitemapUrl = sitemapObj.loc[0];
    }

    if (!postSitemapUrl) {
      console.log("-> Sitemap secundário não encontrado. Usando lista padrão.");
      return fallbackTitles;
    }

    console.log("-> Baixando posts de:", postSitemapUrl);
    const postResponse = await axios.get(postSitemapUrl, { headers: customHeaders, timeout: 6000 });
    const postResult = await parser.parseStringPromise(postResponse.data);

    if (!postResult.urlset || !postResult.urlset.url) return fallbackTitles;

    const urls = postResult.urlset.url
      .map(u => {
        const rawUrl = u.loc ? u.loc[0] : "";
        const slug = rawUrl.split("/").filter(Boolean).pop() || "";
        return slug.replace(/-/g, " ");
      })
      .filter(t => t.length > 3)
      .slice(0, 15);

    return urls.length > 0 ? urls : fallbackTitles;
  } catch (error) {
    console.log("-> Erro de bloqueio no site ( Cloudflare / Timeout ). Usando lista reserva.", error.message);
    return fallbackTitles;
  }
}

async function getTmdbMeta(cleanTitle) {
  if (!TMDB_API_KEY) return null;

  try {
    const queryTitle = cleanTitle
      .replace(/(torrent|download|dublado|legendado|dual|audio|web dl|bluray|720p|1080p|4k|\d{4})/gi, "")
      .trim();

    if (!queryTitle) return null;

    const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(queryTitle)}&language=pt-BR`;
    const res = await axios.get(url, { timeout: 4000 });
    
    if (res.data && res.data.results && res.data.results.length > 0) {
      const movie = res.data.results[0];
      return {
        id: `tmdb:${movie.id}`,
        name: movie.title,
        poster: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : null,
        type: "movie",
        description: movie.overview || "Sem sinopse disponível."
      };
    }
  } catch (e) {
    console.log("-> Erro TMDB para item:", cleanTitle, e.message);
  }
  return null;
}

builder.defineCatalogHandler(async ({ id }) => {
  console.log(`-> Nuvio pediu catálogo ID: ${id}`);
  if (id === "tdf_latest") {
    const titles = await getLatestPosts();
    
    const metasPromises = titles.map(t => getTmdbMeta(t));
    const metasResults = await Promise.all(metasPromises);
    const metas = metasResults.filter(Boolean);

    console.log(`-> Sucesso! Entregando ${metas.length} filmes para o Nuvio.`);
    return { metas };
  }
  return { metas: [] };
});

const port = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port });
