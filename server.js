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
// 1. LÓGICA INSTAGRAM (SISTEMA DE MOTORES REPARADO)
// ==========================================
async function procesarInstagram(inputUrl, res) {
    try {
        const timestamp = Date.now();
        let videoUrl = null;

        // Extraer la ID única del Reel/Publicación (ej: Dcr4deKx9n6)
        const match = inputUrl.match(/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i);
        if (!match || !match[1]) {
            return res.status(400).json({ exito: false, mensaje: 'Enlace de Instagram no válido.' });
        }

        const shortcode = match[1];
        const cleanUrl = `https://www.instagram.com/reel/${shortcode}/`;

        // MOTOR 1: Instagram GraphQL Endpoint Directo con App ID Oficial
        try {
            const gqlRes = await axios.get('https://www.instagram.com/api/v1/media/by/shortcode/', {
                params: { shortcode },
                headers: {
                    'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; Xiaomi; M2101K6G; sweet; qcom; en_US; 458229258)',
                    'X-IG-App-ID': '936619743392459',
                    'Accept': '*/*'
                },
                timeout: 8000
            });

            if (gqlRes.data && gqlRes.data.items && gqlRes.data.items[0]) {
                const item = gqlRes.data.items[0];
                if (item.video_versions && item.video_versions.length > 0) {
                    videoUrl = item.video_versions[0].url;
                    console.log('Instagram OK con Motor 1 (GraphQL App API)');
                }
            }
        } catch (e) {
            console.log('Falló Motor 1 GraphQL App API:', e.message);
        }

        // MOTOR 2: FastSave / Instavideos Public API
        if (!videoUrl) {
            try {
                const apiRes = await axios.post('https://instavideosave.net/api/instagram', {
                    url: cleanUrl
                }, {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': UA,
                        'Origin': 'https://instavideosave.net',
                        'Referer': 'https://instavideosave.net/'
                    },
                    timeout: 8000
                });

                if (apiRes.data && apiRes.data.url) {
                    videoUrl = apiRes.data.url;
                    console.log('Instagram OK con Motor 2 (InstaVideoSave)');
                } else if (apiRes.data && apiRes.data.media && apiRes.data.media.length > 0) {
                    videoUrl = apiRes.data.media[0].url;
                    console.log('Instagram OK con Motor 2 (InstaVideoSave Array)');
                }
            } catch (e) {
                console.log('Falló Motor 2 InstaVideoSave:', e.message);
            }
        }

        // MOTOR 3: Rapid/Public Proxy Downloader
        if (!videoUrl) {
            try {
                const params = new URLSearchParams();
                params.append('q', cleanUrl);
                params.append('vt', 'instagram');

                const proxyRes = await axios.post('https://v3.fastdl.app/api/ajaxSearch', params, {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'User-Agent': UA,
                        'X-Requested-With': 'XMLHttpRequest'
                    },
                    timeout: 8000
                });

                if (proxyRes.data && proxyRes.data.data) {
                    const html = proxyRes.data.data;
                    const matchMp4 = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/i) ||
                                     html.match(/href="(https:\/\/[^"]+download[^"]*)"/i);
                    if (matchMp4 && matchMp4[1]) {
                        videoUrl = matchMp4[1].replace(/&amp;/g, '&');
                        console.log('Instagram OK con Motor 3 (FastDL Proxy)');
                    }
                }
            } catch (e) {
                console.log('Falló Motor 3 FastDL Proxy:', e.message);
            }
        }

        if (!videoUrl) {
            return res.status(400).json({
                exito: false,
                mensaje: 'No se pudo obtener el video. Verifica que la publicación sea pública y vuelve a intentarlo.'
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
