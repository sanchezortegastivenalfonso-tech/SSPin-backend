const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Función para expandir enlaces acortados (vt.tiktok.com)
async function desglosarUrl(shortUrl) {
    try {
        const response = await axios.get(shortUrl, {
            maxRedirects: 5,
            headers: { 'User-Agent': UA }
        });
        return response.request.res.responseUrl || shortUrl;
    } catch (e) {
        return shortUrl;
    }
}

// ==========================================
// ENDPOINT PRINCIPAL: /api/descargar
// ==========================================
app.post('/api/descargar', async (req, res) => {
    let { url, plataforma } = req.body;

    if (!url) {
        return res.status(400).json({ exito: false, mensaje: 'Debes proporcionar un enlace válido.' });
    }

    try {
        url = url.trim();

        if (plataforma === 'instagram') {
            return await procesarInstagram(url, res);
        } else if (plataforma === 'tiktok') {
            return await procesarTikTok(url, res);
        } else if (plataforma === 'pinterest') {
            return await procesarPinterest(url, res);
        } else {
            return res.status(400).json({ exito: false, mensaje: 'Plataforma no soportada.' });
        }
    } catch (error) {
        console.error('Error general:', error.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en el servidor.' });
    }
});

// ==========================================
// PROXY DE DESCARGA DIRECTA
// ==========================================
app.get('/api/download-file', async (req, res) => {
    const fileUrl = req.query.url;
    let fileName = req.query.name || req.query.filename || 'archivo_media';

    if (!fileUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    try {
        const response = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
            headers: { 'User-Agent': UA }
        });

        const contentType = response.headers['content-type'] || 'application/octet-stream';

        if (!fileName.includes('.')) {
            if (contentType.includes('audio') || contentType.includes('mpeg')) {
                fileName += '.mp3';
            } else {
                fileName += '.mp4';
            }
        }

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Type', contentType);
        res.send(Buffer.from(response.data));

    } catch (error) {
        console.error('Error proxy descarga:', error.message);
        res.status(500).send('Error al procesar la descarga directa');
    }
});

// ==========================================
// 1. LÓGICA INSTAGRAM (OPTIMIZADA)
// ==========================================
function buscarVideoEnJson(obj) {
    if (!obj) return null;
    if (typeof obj === 'string') {
        return /^https?:\/\/.+(\.mp4|video)/i.test(obj) ? obj : null;
    }
    if (Array.isArray(obj)) {
        for (const item of obj) {
            const r = buscarVideoEnJson(item);
            if (r) return r;
        }
        return null;
    }
    if (typeof obj === 'object') {
        for (const key of ['video_url', 'videoUrl', 'download_url', 'downloadUrl', 'url']) {
            if (typeof obj[key] === 'string' && /^https?:\/\//.test(obj[key])) return obj[key];
        }
        for (const key of Object.keys(obj)) {
            const r = buscarVideoEnJson(obj[key]);
            if (r) return r;
        }
    }
    return null;
}

function extraerVideoInstagram(texto) {
    const patrones = [
        /\\*"video_url\\*"\s*:\s*\\*"(https:[^"]+?)\\*"/,
        /\\*"video_versions\\*"\s*:\s*\[\s*\{[^}]*?\\*"url\\*"\s*:\s*\\*"(https:[^"]+?)\\*"/,
        /<meta[^>]+property="og:video(?::secure_url)?"[^>]+content="([^"]+)"/i,
        /<meta[^>]+content="([^"]+)"[^>]+property="og:video(?::secure_url)?"/i
    ];

    for (const patron of patrones) {
        const m = texto.match(patron);
        if (m && m[1]) {
            const limpio = m[1]
                .replace(/\\+\//g, '/')
                .replace(/\\+u0026/g, '&')
                .replace(/&amp;/g, '&')
                .replace(/\\+$/, '');
            if (/^https:\/\//.test(limpio)) return limpio;
        }
    }
    return null;
}

async function procesarInstagram(inputUrl, res) {
    try {
        const timestamp = Date.now();
        let videoUrl = null;

        // MOTOR 1: Cobalt Tools API (Rápido y omite bloqueos de IP)
        try {
            const cobaltRes = await axios.post('https://api.cobalt.tools/api/json', {
                url: inputUrl,
                videoQuality: '720'
            }, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': UA
                },
                timeout: 10000
            });

            if (cobaltRes.data && cobaltRes.data.url) {
                videoUrl = cobaltRes.data.url;
                console.log('Instagram OK con motor Cobalt');
            }
        } catch (e) {
            console.log('Falló motor Cobalt para Instagram, probando métodos secundarios...');
        }

        // MOTOR 2: Scrapers directos de Instagram (Fallback)
        if (!videoUrl) {
            const match = inputUrl.match(/instagram\.com\/(?:[^\/?#]+\/)?(reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
            if (!match) {
                return res.status(400).json({ exito: false, mensaje: 'Enlace de Instagram no válido. Usa un enlace de reel o publicación.' });
            }

            const tipo = match[1].toLowerCase() === 'reels' ? 'reel' : match[1].toLowerCase();
            const shortcode = match[2];

            const navHeaders = {
                'User-Agent': UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://www.instagram.com/'
            };

            const metodos = [
                {
                    nombre: 'embed captioned',
                    fn: async () => {
                        const r = await axios.get(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, { headers: navHeaders, timeout: 10000 });
                        return extraerVideoInstagram(String(r.data));
                    }
                },
                {
                    nombre: 'embed simple',
                    fn: async () => {
                        const r = await axios.get(`https://www.instagram.com/${tipo}/${shortcode}/embed/`, { headers: navHeaders, timeout: 10000 });
                        return extraerVideoInstagram(String(r.data));
                    }
                },
                {
                    nombre: 'graphql',
                    fn: async () => {
                        const r = await axios.get('https://www.instagram.com/graphql/query/', {
                            params: { doc_id: '8845758582119845', variables: JSON.stringify({ shortcode }) },
                            headers: { ...navHeaders, 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest', 'Accept': '*/*' },
                            timeout: 10000
                        });
                        const media = r.data && r.data.data && (r.data.data.xdt_shortcode_media || r.data.data.shortcode_media);
                        return (media && media.video_url) || null;
                    }
                }
            ];

            for (const metodo of metodos) {
                try {
                    const encontrado = await metodo.fn();
                    if (encontrado) {
                        videoUrl = encontrado;
                        console.log(`Instagram OK con método: ${metodo.nombre}`);
                        break;
                    }
                } catch (e) {
                    console.log(`Falló Instagram (${metodo.nombre}): ${e.message}`);
                }
            }
        }

        // MOTOR 3: API externa opcional si tienes configurada una variable de entorno
        if (!videoUrl && process.env.IG_API_URL) {
            try {
                const headers = {};
                if (process.env.IG_API_KEY) headers['x-rapidapi-key'] = process.env.IG_API_KEY;
                if (process.env.IG_API_HOST) headers['x-rapidapi-host'] = process.env.IG_API_HOST;

                const apiUrl = process.env.IG_API_URL.replace('{url}', encodeURIComponent(inputUrl));
                const apiRes = await axios.get(apiUrl, { headers, timeout: 15000 });
                videoUrl = buscarVideoEnJson(apiRes.data);
            } catch (e) {
                console.log('Falló API externa de Instagram:', e.message);
            }
        }

        if (!videoUrl) {
            return res.status(400).json({
                exito: false,
                mensaje: 'No se pudo obtener el video. Verifica que la publicación sea pública y vuelva a intentarlo.'
            });
        }

        const fileName = `Instagram_Video_${timestamp}`;
        const proxyUrl = `/api/download-file?url=${encodeURIComponent(videoUrl)}&name=${encodeURIComponent(fileName)}.mp4`;

        return res.json({
            exito: true,
            videoUrlHD: proxyUrl,
            videoUrl: proxyUrl,
            titulo: 'Instagram Video'
        });

    } catch (e) {
        console.error('Error procesando Instagram:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno al procesar Instagram.' });
    }
}

// ==========================================
// 2. LÓGICA TIKTOK (MULTI-API EN CASCADA CON DESGLOSE DE URL)
// ==========================================
async function procesarTikTok(inputUrl, res) {
    try {
        let cleanUrl = inputUrl.trim();

        if (cleanUrl.includes('vt.tiktok.com') || cleanUrl.includes('vm.tiktok.com')) {
            cleanUrl = await desglosarUrl(cleanUrl);
        }

        const timestamp = Date.now();

        // --- OPCIÓN 1: API Lovetik ---
        try {
            const paramsLovo = new URLSearchParams();
            paramsLovo.append('query', cleanUrl);

            const lovoRes = await axios.post('https://lovetik.com/api/ajax/search', paramsLovo, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'User-Agent': UA
                }
            });

            if (lovoRes.data && lovoRes.data.links && lovoRes.data.links.length > 0) {
                const directUrl = lovoRes.data.links[0].a;
                const title = lovoRes.data.desc || `TikTok_Video_${timestamp}`;
                const fileName = `${title}_${timestamp}`;
                const proxyUrl = `/api/download-file?url=${encodeURIComponent(directUrl)}&name=${encodeURIComponent(fileName)}.mp4`;

                return res.json({
                    exito: true,
                    videoUrlHD: proxyUrl,
                    videoUrl: proxyUrl,
                    titulo: title
                });
            }
        } catch (e) {
            console.log('Falló Lovetik, intentando con SSSTik...');
        }

        // --- OPCIÓN 2: SSSTik ---
        const params = new URLSearchParams();
        params.append('id', cleanUrl);
        params.append('locale', 'es');
        params.append('tt', '0');

        const response = await axios.post('https://ssstik.io/abc?url=dl', params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': UA,
                'Origin': 'https://ssstik.io',
                'Referer': 'https://ssstik.io/es'
            }
        });

        const html = response.data;
        const linkMatch = html.match(/href="(https:\/\/[^"]+)"[^>]*class="[^"]*download_link/i) || html.match(/href="(https:\/\/[^"]+)"/i);

        if (linkMatch && linkMatch[1]) {
            const rawVideoUrl = linkMatch[1];
            const fileName = `TikTok_Video_${timestamp}`;
            const proxyUrl = `/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&name=${encodeURIComponent(fileName)}.mp4`;

            return res.json({
                exito: true,
                videoUrlHD: proxyUrl,
                videoUrl: proxyUrl,
                titulo: 'TikTok Video'
            });
        }

        return res.status(400).json({ exito: false, mensaje: 'No se pudo extraer el enlace del video de TikTok.' });

    } catch (err) {
        console.error('Error procesando TikTok:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno al procesar TikTok.' });
    }
}

// ==========================================
// 3. LÓGICA PINTEREST
// ==========================================
async function procesarPinterest(inputUrl, res) {
    try {
        const response = await axios.get(inputUrl, {
            headers: { 'User-Agent': UA }
        });

        const html = response.data;

        const videoMatch = html.match(/https:\/\/[^"]+\.mp4/gi) || 
                           html.match(/"video_list":\{"V_720P":\{"url":"(https?:\/\/[^"]+)"/i) ||
                           html.match(/"url":"(https:\/\/v1\.pinimg\.com\/videos\/[^\"]+)"/i);

        if (videoMatch && videoMatch[0]) {
            let rawVideoUrl = videoMatch[0].replace(/\\/g, '');
            if (videoMatch[1]) rawVideoUrl = videoMatch[1].replace(/\\/g, '');

            const timestamp = Date.now();
            const fileName = `Pinterest_Video_${timestamp}`;
            const proxyUrl = `/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&name=${encodeURIComponent(fileName)}.mp4`;

            return res.json({
                exito: true,
                videoUrlHD: proxyUrl,
                videoUrl: proxyUrl,
                titulo: 'Pinterest Video'
            });
        }

        return res.status(400).json({ exito: false, mensaje: 'Este Pin no contiene un video válido.' });
    } catch (err) {
        console.error('Error Pinterest:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en Pinterest.' });
    }
}

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
