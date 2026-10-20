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
// 3. LÓGICA PINTEREST (REESCRITA)
// ==========================================
const PIN_HEADERS = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,es;q=0.8'
};

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Quita escapes de JSON/HTML para poder buscar URLs dentro de cualquier texto
function limpiarUrlPin(texto) {
    return String(texto)
        .replace(/\\u002F/gi, '/')
        .replace(/\\\//g, '/')
        .replace(/\\u0026/gi, '&')
        .replace(/&amp;/g, '&')
        .replace(/\\/g, '');
}

// Busca enlaces de video (.mp4 y .m3u8) de Pinterest dentro de un texto
function extraerVideosPin(texto) {
    const normal = limpiarUrlPin(texto);
    const encontrados = normal.match(/https?:\/\/[^\s"'<>\\)]+?\.(?:mp4|m3u8)(?:\?[^\s"'<>\\)]*)?/gi) || [];
    return [...new Set(encontrados.filter(u => /pinimg\.com/i.test(u)))];
}

function resolucionUrl(u) {
    const m = u.match(/(\d{3,4})(?:p|w)\b/i);
    return m ? parseInt(m[1], 10) : 0;
}

// Elige el mp4 de mejor calidad (hasta 1080)
function elegirMp4(urls) {
    const mp4 = urls.filter(u => /\.mp4/i.test(u));
    if (!mp4.length) return null;
    mp4.sort((a, b) => Math.min(resolucionUrl(b), 1080) - Math.min(resolucionUrl(a), 1080));
    return mp4[0];
}

// Muchos pines solo muestran el enlace HLS (.m3u8). Se prueban los mp4 equivalentes.
function derivarMp4(m3u8) {
    const base = m3u8.split('?')[0];
    const m = base.match(/^(https?:\/\/[^/]+)\/videos\/(?:mmhls|hls)\/(.+?)(?:_\d+w)?\.m3u8$/i);
    if (!m) return [];
    return [
        `${m[1]}/videos/720p/${m[2]}.mp4`,
        `${m[1]}/videos/iht/expMp4/${m[2]}_720w.mp4`,
        `${m[1]}/videos/iht/expMp4/${m[2]}.mp4`
    ];
}

// Comprueba (sin descargar) que el enlace realmente sea un video
async function existeVideo(url) {
    try {
        const r = await axios.get(url, {
            headers: { 'User-Agent': UA, 'Range': 'bytes=0-1' },
            timeout: 5000,
            responseType: 'stream',
            validateStatus: () => true
        });
        r.data.destroy();
        const tipo = String(r.headers['content-type'] || '');
        return (r.status === 200 || r.status === 206) && /video|octet-stream/i.test(tipo);
    } catch (e) {
        return false;
    }
}

// Obtiene el ID del pin (también desde enlaces cortos pin.it)
async function resolverPin(entrada) {
    const regexId = /pin\/(?:[\w%-]*--)?(\d+)/i;
    const directo = entrada.match(regexId);
    if (directo) return { finalUrl: entrada, pinId: directo[1] };

    if (!/pin\.it|pinterest\./i.test(entrada)) return { finalUrl: entrada, pinId: null };

    for (let i = 0; i < 3; i++) {
        try {
            const r = await axios.get(entrada, {
                headers: PIN_HEADERS,
                maxRedirects: 6,
                timeout: 8000,
                validateStatus: () => true
            });
            const finalUrl = (r.request && r.request.res && r.request.res.responseUrl) || entrada;
            const m = finalUrl.match(regexId) ||
                      (typeof r.data === 'string' ? r.data.match(/pinterest\.[a-z.]+\/pin\/(?:[\w%-]*--)?(\d+)/i) : null);
            if (m) return { finalUrl, pinId: m[1] };
        } catch (e) {}
        await esperar(700);
    }
    return { finalUrl: entrada, pinId: null };
}

// MOTOR 1: API interna de Pinterest (datos del pin en JSON)
async function motorPinResource(pinId, info) {
    try {
        const data = JSON.stringify({
            options: { id: pinId, field_set_key: 'unauth_react_main_pin', noCache: true, fetch_visual_search_objects: false },
            context: {}
        });
        const r = await axios.get('https://www.pinterest.com/resource/PinResource/get/', {
            params: { source_url: `/pin/${pinId}/`, data, _: Date.now() },
            headers: {
                'User-Agent': UA,
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'Accept-Language': 'en-US,en;q=0.9',
                'X-Requested-With': 'XMLHttpRequest',
                'X-Pinterest-AppState': 'active',
                'Referer': 'https://www.pinterest.com/'
            },
            timeout: 8000,
            validateStatus: () => true
        });
        if ([401, 403, 429].includes(r.status)) info.bloqueado = true;
        const pin = r.data && r.data.resource_response && r.data.resource_response.data;
        if (pin && typeof pin === 'object') {
            info.pinEncontrado = true;
            return extraerVideosPin(JSON.stringify(pin));
        }
    } catch (e) {}
    return [];
}

// MOTOR 2: widget público de Pinterest
async function motorPidgets(pinId, info) {
    try {
        const r = await axios.get('https://widgets.pinterest.com/v3/pidgets/pins/info/', {
            params: { pin_ids: pinId },
            headers: { 'User-Agent': UA, 'Accept': 'application/json' },
            timeout: 8000,
            validateStatus: () => true
        });
        if ([401, 403, 429].includes(r.status)) info.bloqueado = true;
        const lista = r.data && r.data.data;
        if (Array.isArray(lista) && lista.length) {
            info.pinEncontrado = true;
            return extraerVideosPin(JSON.stringify(lista));
        }
    } catch (e) {}
    return [];
}

// MOTOR 3: leer la página del pin (HTML)
async function motorHtml(pinId, finalUrl, info) {
    const paginas = [`https://www.pinterest.com/pin/${pinId}/`];
    if (finalUrl && /^https?:\/\//i.test(finalUrl) && !paginas.includes(finalUrl)) paginas.push(finalUrl);

    for (const pagina of paginas) {
        try {
            const r = await axios.get(pagina, {
                headers: PIN_HEADERS,
                maxRedirects: 5,
                timeout: 9000,
                validateStatus: () => true
            });
            if ([401, 403, 429].includes(r.status)) {
                info.bloqueado = true;
                continue;
            }
            const html = typeof r.data === 'string' ? r.data : JSON.stringify(r.data || '');
            if (/og:title|__PWS_DATA__|initial-state|pinimg/i.test(html)) info.pinEncontrado = true;
            const urls = extraerVideosPin(html);
            if (urls.length) return urls;
        } catch (e) {}
    }
    return [];
}

async function procesarPinterest(inputUrl, res) {
    try {
        const entrada = inputUrl.trim();
        const { finalUrl, pinId } = await resolverPin(entrada);

        if (!pinId) {
            return res.status(400).json({
                exito: false,
                mensaje: 'No se pudo leer el enlace de Pinterest. Cópialo de nuevo con Compartir > Copiar enlace.'
            });
        }

        const info = { bloqueado: false, pinEncontrado: false };

        // Los dos motores rápidos se consultan a la vez; el HTML solo si hace falta
        const [a, b] = await Promise.all([motorPinResource(pinId, info), motorPidgets(pinId, info)]);
        let urls = [...a, ...b];
        if (!urls.length) urls = await motorHtml(pinId, finalUrl, info);

        let rawVideoUrl = elegirMp4(urls);

        // Si solo hay HLS (.m3u8), se prueban los mp4 equivalentes
        if (!rawVideoUrl) {
            const m3u8 = urls.filter(u => /\.m3u8/i.test(u));
            for (const lista of m3u8) {
                for (const candidato of derivarMp4(lista)) {
                    if (await existeVideo(candidato)) {
                        rawVideoUrl = candidato;
                        break;
                    }
                }
                if (rawVideoUrl) break;
            }
        }

        if (rawVideoUrl) {
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

        if (info.bloqueado) {
            return res.status(429).json({
                exito: false,
                mensaje: 'Pinterest bloqueó la consulta por un momento. Espera un minuto e inténtalo de nuevo.'
            });
        }
        if (info.pinEncontrado) {
            return res.status(400).json({ exito: false, mensaje: 'Este Pin no contiene un video válido o es una imagen.' });
        }
        return res.status(400).json({
            exito: false,
            mensaje: 'No se pudo leer el Pin. Comprueba que sea público e inténtalo de nuevo.'
        });
    } catch (err) {
        console.error('Error procesando Pinterest:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno al procesar Pinterest.' });
    }
}

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
