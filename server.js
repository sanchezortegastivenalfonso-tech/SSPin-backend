const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Función para expandir enlaces acortados (vt.tiktok.com, pin.it, etc.)
async function desglosarUrl(shortUrl) {
    try {
        const response = await axios.get(shortUrl, {
            maxRedirects: 5,
            headers: { 'User-Agent': UA },
            timeout: 4000
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
        url = req.body.url.trim();

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
// PROXY DE DESCARGA DIRECTA (INTACTO)
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
// 1. LÓGICA INSTAGRAM (INTACTA)
// ==========================================
async function procesarInstagram(inputUrl, res) {
    try {
        const timestamp = Date.now();
        let videoUrl = null;

        const decodedUrl = decodeURIComponent(inputUrl.trim());
        const match = decodedUrl.match(/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);

        if (!match || !match[1]) {
            return res.status(400).json({ exito: false, mensaje: 'Enlace de Instagram no válido.' });
        }

        const shortcode = match[1];
        const targetUrl = `https://www.instagram.com/reel/${shortcode}/`;

        // MOTOR 1: FastDL Engine
        try {
            const formData = new URLSearchParams();
            formData.append('q', targetUrl);
            formData.append('vt', 'instagram');

            const fastRes = await axios.post('https://fastdl.app/api/ajaxSearch', formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'User-Agent': UA,
                    'Origin': 'https://fastdl.app',
                    'Referer': 'https://fastdl.app/'
                },
                timeout: 7000
            });

            if (fastRes.data && fastRes.data.data) {
                const html = fastRes.data.data;
                const matchVideo = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/i) ||
                                   html.match(/href="(https:\/\/[^"]+cdninstagram\.com[^"]*)"/i);

                if (matchVideo && matchVideo[1]) {
                    videoUrl = matchVideo[1].replace(/&amp;/g, '&');
                }
            }
        } catch (e) {}

        // MOTOR 2: Direct GraphQL Fallback
        if (!videoUrl) {
            try {
                const gqlParams = new URLSearchParams();
                gqlParams.append('doc_id', '10015901848480574');
                gqlParams.append('variables', JSON.stringify({ shortcode: shortcode }));

                const gqlRes = await axios.post('https://www.instagram.com/api/v1/ads/graph_ql/', gqlParams, {
                    headers: {
                        'User-Agent': 'Instagram 219.0.0.12.117 Android',
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'X-FB-Friendly-Name': 'PolarisPostQuery'
                    },
                    timeout: 7000
                });

                if (gqlRes.data && gqlRes.data.data && gqlRes.data.data.xdt_shortcode_media) {
                    const media = gqlRes.data.data.xdt_shortcode_media;
                    if (media.is_video && media.video_url) {
                        videoUrl = media.video_url;
                    }
                }
            } catch (e) {}
        }

        // MOTOR 3: Embed Query
        if (!videoUrl) {
            try {
                const embedRes = await axios.get(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
                        'Accept-Language': 'en-US,en;q=0.9'
                    },
                    timeout: 7000
                });

                const html = embedRes.data;
                const matchEmbed = html.match(/\\*"video_url\\*"\s*:\s*\\*"(https:[^"]+?)\\*"/i) ||
                                   html.match(/<meta[^>]+property="og:video"[^>]+content="([^"]+)"/i);

                if (matchEmbed && matchEmbed[1]) {
                    videoUrl = matchEmbed[1].replace(/\\+\//g, '/').replace(/\\+u0026/g, '&').replace(/&amp;/g, '&');
                }
            } catch (e) {}
        }

        if (!videoUrl) {
            return res.status(400).json({
                exito: false,
                mensaje: 'No se pudo obtener el video. Si copiaste el enlace directamente, prueba usando Compartir > Copiar vínculo.'
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
        return res.status(500).json({ exito: false, mensaje: 'Error interno al procesar Instagram.' });
    }
}

// ==========================================
// 2. LÓGICA TIKTOK OPTIMIZADA (INTACTA)
// ==========================================
async function procesarTikTok(inputUrl, res) {
    try {
        let cleanUrl = inputUrl.trim();

        if (cleanUrl.includes('vt.tiktok.com') || cleanUrl.includes('vm.tiktok.com')) {
            cleanUrl = await desglosarUrl(cleanUrl);
        }

        const timestamp = Date.now();

        // OPCIÓN 1: TikWM API Directa
        try {
            const tikWmRes = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}`, {
                headers: { 'User-Agent': UA },
                timeout: 5000
            });

            if (tikWmRes.data && tikWmRes.data.code === 0 && tikWmRes.data.data) {
                const videoData = tikWmRes.data.data;
                const directUrl = videoData.hdplay || videoData.play;
                const title = videoData.title || `TikTok_Video_${timestamp}`;
                const fileName = `${title.substring(0, 30)}_${timestamp}`;
                const proxyUrl = `/api/download-file?url=${encodeURIComponent(directUrl)}&name=${encodeURIComponent(fileName)}.mp4`;

                return res.json({
                    exito: true,
                    videoUrlHD: proxyUrl,
                    videoUrl: proxyUrl,
                    titulo: title
                });
            }
        } catch (e) {
            console.log('Falló TikWM rápido, pasando a respaldo...');
        }

        // OPCIÓN 2: SSSTik (Respaldo)
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
            },
            timeout: 5000
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
// 3. LÓGICA PINTEREST (CORREGIDA)
// ==========================================
async function procesarPinterest(inputUrl, res) {
    try {
        let targetUrl = inputUrl.trim();

        if (targetUrl.includes('pin.it')) {
            targetUrl = await desglosarUrl(targetUrl);
        }

        const response = await axios.get(targetUrl, {
            headers: { 'User-Agent': UA }
        });

        const html = response.data;
        let rawVideoUrl = null;

        // Búsqueda en objeto JSON embebido de la página
        const matchJson = html.match(/<script id="__PGI_APP_STATE__" type="application\/json">([\s\S]*?)<\/script>/i) ||
                          html.match(/<script id="initial-state" type="application\/json">([\s\S]*?)<\/script>/i);

        if (matchJson && matchJson[1]) {
            try {
                const data = JSON.parse(matchJson[1]);
                const resources = data.resources || data.v7 || {};
                
                // Recorremos el estado buscando URLs de video mp4
                const jsonStr = JSON.stringify(resources);
                const mp4Matches = jsonStr.match(/https?:\/\/[^"]+?\.mp4/gi);
                if (mp4Matches && mp4Matches.length > 0) {
                    // Tomamos el enlace mp4 de mayor resolución si hay varios
                    rawVideoUrl = mp4Matches.find(url => url.includes('720p') || url.includes('exp')) || mp4Matches[0];
                }
            } catch (e) {}
        }

        // Búsqueda por Expresión Regular directa si no se halló en JSON
        if (!rawVideoUrl) {
            const videoMatch = html.match(/"V_720P":\s*\{\s*"url":\s*"([^"]+)"/i) ||
                               html.match(/"V_EXP720P":\s*\{\s*"url":\s*"([^"]+)"/i) ||
                               html.match(/"url":\s*"(https:\/\/v1\.pinimg\.com\/videos\/[^\"]+\.mp4)"/i) ||
                               html.match(/(https:\/\/v1\.pinimg\.com\/videos\/[^\s"]+\.mp4)/gi);

            if (videoMatch) {
                rawVideoUrl = videoMatch[1] || videoMatch[0];
            }
        }

        if (rawVideoUrl) {
            // Limpiar secuencias de escape de formato JSON o URLs
            rawVideoUrl = rawVideoUrl.replace(/\\/g, '').replace(/&amp;/g, '&');

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

        return res.status(400).json({ exito: false, mensaje: 'Este Pin no contiene un video válido o es una imagen.' });
    } catch (err) {
        console.error('Error procesando Pinterest:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno al procesar Pinterest.' });
    }
}

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
