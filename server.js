const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// FUNCIÓN AUXILIAR: DESGLOSAR Y EXPANDIR URLS
// ==========================================
async function desglosarUrl(shortUrl) {
    try {
        const response = await axios.get(shortUrl, {
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        return response.request.res.responseUrl || shortUrl;
    } catch (e) {
        return shortUrl;
    }
}

// ==========================================
// ENDPOINT PROXY DE DESCARGA DIRECTA
// ==========================================
app.get('/api/download-file', async (req, res) => {
    const fileUrl = req.query.url;
    let fileName = req.query.name || 'audio_descargado';

    if (!fileUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    try {
        const response = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 40000
        });

        const contentType = response.headers['content-type'] || 'audio/mpeg';

        if (!fileName.includes('.')) {
            fileName += contentType.includes('video') ? '.mp4' : '.mp3';
        }

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', response.data.length);

        return res.send(Buffer.from(response.data));

    } catch (error) {
        console.error('Error enviando archivo vía proxy:', error.message);
        return res.status(500).send('Error al descargar el archivo.');
    }
});

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

        if (plataforma === 'spotify') {
            return await procesarSpotify(url, res);
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
// 1. LÓGICA SPOTIFY (DEFINITIVA Y RESISTENTE A BANEOS DE IP)
// ==========================================
async function procesarSpotify(input, res) {
    try {
        if (input.includes('spotify.link')) {
            input = await desglosarUrl(input);
        }

        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'URL de Spotify no válida.' });
        }
        const trackId = match[1];
        const cleanUrl = `https://open.spotify.com/track/${trackId}`;

        let trackTitle = '';
        let artistName = '';
        let coverImage = '';

        // Extraer metadatos usando Spotify oEmbed oficial
        try {
            const oembedRes = await axios.get(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
            if (oembedRes.data) {
                trackTitle = oembedRes.data.title || '';
                artistName = oembedRes.data.author_name || '';
                coverImage = oembedRes.data.thumbnail_url || '';
            }
        } catch (e) {
            console.log('Error oEmbed:', e.message);
        }

        const titleCombined = artistName ? `${trackTitle} - ${artistName}` : (trackTitle || 'Spotify Track');
        const searchQuery = `${trackTitle} ${artistName}`.trim();

        // MOTOR 1: Cobalt Tools API Direct Gateway (No sufre bloqueo por IP de Render)
        try {
            const cobaltRes = await axios.post('https://api.cobalt.tools/api/json', {
                url: cleanUrl,
                downloadMode: 'audio',
                audioFormat: 'mp3'
            }, {
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                },
                timeout: 12000
            });

            if (cobaltRes.data && cobaltRes.data.url) {
                return res.json({
                    exito: true,
                    titulo: titleCombined,
                    coverUrl: coverImage,
                    audioUrl: `/api/download-file?url=${encodeURIComponent(cobaltRes.data.url)}&name=${encodeURIComponent(titleCombined)}.mp3`
                });
            }
        } catch (e) {
            console.log('Motor 1 (Cobalt) no pudo procesar enlace directo...');
        }

        // MOTOR 2: YouTube Search / Scraper Gateway
        try {
            const ytSearchRes = await axios.get(`https://pipe.yewtu.be/api/v1/search?q=${encodeURIComponent(searchQuery)}&type=video`, {
                timeout: 8000
            });

            if (ytSearchRes.data && ytSearchRes.data.length > 0) {
                const videoId = ytSearchRes.data[0].videoId;
                const ytUrl = `https://www.youtube.com/watch?v=${videoId}`;

                // Procesar enlace mediante la API pública de conversión
                const convRes = await axios.post('https://api.cobalt.tools/api/json', {
                    url: ytUrl,
                    downloadMode: 'audio',
                    audioFormat: 'mp3'
                }, {
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    timeout: 12000
                });

                if (convRes.data && convRes.data.url) {
                    return res.json({
                        exito: true,
                        titulo: titleCombined,
                        coverUrl: coverImage,
                        audioUrl: `/api/download-file?url=${encodeURIComponent(convRes.data.url)}&name=${encodeURIComponent(titleCombined)}.mp3`
                    });
                }
            }
        } catch (e) {
            console.log('Motor 2 (YouTube Gateway) falló...');
        }

        // MOTOR 3: SpotifyMate Action Engine (Bypass Cloudflare)
        try {
            const mateRes = await axios.post('https://spotimate.com/action', 
                new URLSearchParams({ url: cleanUrl }).toString(), 
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
                    },
                    timeout: 10000
                }
            );

            if (mateRes.data && mateRes.data.url) {
                return res.json({
                    exito: true,
                    titulo: titleCombined,
                    coverUrl: coverImage,
                    audioUrl: `/api/download-file?url=${encodeURIComponent(mateRes.data.url)}&name=${encodeURIComponent(titleCombined)}.mp3`
                });
            }
        } catch (e) {
            console.log('Motor 3 (Spotimate) falló...');
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'Spotify bloqueó la descarga en el servidor. Prueba con un video de TikTok o reintenta.'
        });

    } catch (e) {
        console.error('Error en Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en el servidor.' });
    }
}

// ==========================================
// 2. LÓGICA TIKTOK
// ==========================================
async function procesarTikTok(inputUrl, res) {
    try {
        let cleanUrl = inputUrl.trim();

        if (cleanUrl.includes('vt.tiktok.com') || cleanUrl.includes('vm.tiktok.com')) {
            cleanUrl = await desglosarUrl(cleanUrl);
        }

        const formData = new URLSearchParams();
        formData.append('url', cleanUrl);
        formData.append('hd', '1');

        const response = await axios.post('https://www.tikwm.com/api/', formData, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            },
            timeout: 10000
        });

        if (response.data && response.data.data) {
            const data = response.data.data;
            const videoUrl = data.hdplay || data.play;
            const finalUrl = videoUrl.startsWith('http') ? videoUrl : `https://www.tikwm.com${videoUrl}`;
            const title = data.title || 'TikTok_Video';

            return res.json({
                exito: true,
                videoUrlHD: `/api/download-file?url=${encodeURIComponent(finalUrl)}&name=${encodeURIComponent(title)}.mp4`,
                videoUrl: `/api/download-file?url=${encodeURIComponent(finalUrl)}&name=${encodeURIComponent(title)}.mp4`,
                titulo: title
            });
        }

        return res.status(400).json({ exito: false, mensaje: 'No se pudo obtener el video de TikTok.' });

    } catch (err) {
        console.error('Error TikTok:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en TikTok.' });
    }
}

// ==========================================
// 3. LÓGICA PINTEREST
// ==========================================
async function procesarPinterest(inputUrl, res) {
    try {
        const response = await axios.get(inputUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
            },
            timeout: 10000
        });

        const html = response.data;
        const videoMatch = html.match(/https:\/\/[^"]+\.mp4/gi);

        if (videoMatch && videoMatch[0]) {
            let rawVideoUrl = videoMatch[0].replace(/\\/g, '');
            return res.json({
                exito: true,
                videoUrlHD: `/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&name=Pinterest_Video.mp4`,
                videoUrl: `/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&name=Pinterest_Video.mp4`,
                titulo: 'Pinterest Video'
            });
        }

        return res.status(400).json({ exito: false, mensaje: 'Este Pin no contiene un video válido.' });
    } catch (err) {
        console.error('Error Pinterest:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en Pinterest.' });
    }
}

app.listen(PORT, () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
});
