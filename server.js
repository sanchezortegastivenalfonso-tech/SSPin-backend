const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        return response.request.res.responseUrl || shortUrl;
    } catch (e) {
        if (e.response && e.response.headers && e.response.headers.location) {
            return e.response.headers.location.split('?')[0];
        }
        return shortUrl;
    }
}

// ==========================================
// ENDPOINT PROXY DE DESCARGA DIRECTA
// ==========================================
app.get('/api/download-file', async (req, res) => {
    const fileUrl = req.query.url;
    let fileName = req.query.name || 'archivo_media';

    if (!fileUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    try {
        const response = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 35000
        });

        const contentType = response.headers['content-type'] || 'application/octet-stream';

        if (!fileName.includes('.')) {
            fileName += contentType.includes('video') ? '.mp4' : '.mp3';
        }

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', response.data.length);

        return res.send(Buffer.from(response.data));

    } catch (error) {
        console.error('Error enviando archivo vía proxy:', error.message);
        return res.status(500).send('Error al transferir el archivo. Inténtalo de nuevo.');
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
        console.error('Error general en /api/descargar:', error.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en el servidor.' });
    }
});

// ==========================================
// 1. LÓGICA SPOTIFY
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

        // Obtenemos información oficial del track vía oEmbed
        try {
            const oembedRes = await axios.get(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
            if (oembedRes.data) {
                trackTitle = oembedRes.data.title || '';
                artistName = oembedRes.data.author_name || '';
                coverImage = oembedRes.data.thumbnail_url || '';
            }
        } catch (e) {
            console.log('Error oEmbed Spotify:', e.message);
        }

        const titleCombined = artistName ? `${trackTitle} - ${artistName}` : (trackTitle || 'Spotify Track');
        const query = encodeURIComponent(`${trackTitle} ${artistName}`);

        // MOTOR 1: SpotifyDown API
        try {
            const apiRes = await axios.get(`https://api.spotifydown.com/download/${trackId}`, {
                headers: {
                    'Origin': 'https://spotifydown.com',
                    'Referer': 'https://spotifydown.com/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });

            if (apiRes.data && apiRes.data.success && apiRes.data.link) {
                return res.json({
                    exito: true,
                    titulo: titleCombined,
                    coverUrl: coverImage,
                    audioUrl: `/api/download-file?url=${encodeURIComponent(apiRes.data.link)}&name=${encodeURIComponent(titleCombined)}.mp3`
                });
            }
        } catch (e) {
            console.log('Motor 1 (SpotifyDown) falló...');
        }

        // MOTOR 2: SoundCloud Track Engine
        try {
            const scRes = await axios.get(`https://api-v2.soundcloud.com/search/tracks?q=${query}&client_id=iZ864qBBL623P13sLX384C3fL76A495U&limit=1`, {
                timeout: 8000
            });

            if (scRes.data && scRes.data.collection && scRes.data.collection.length > 0) {
                const track = scRes.data.collection[0];
                if (track.media && track.media.transcodings) {
                    const progressive = track.media.transcodings.find(t => t.format.protocol === 'progressive');
                    if (progressive) {
                        const streamRes = await axios.get(`${progressive.url}?client_id=iZ864qBBL623P13sLX384C3fL76A495U`);
                        if (streamRes.data && streamRes.data.url) {
                            return res.json({
                                exito: true,
                                titulo: titleCombined,
                                coverUrl: coverImage,
                                audioUrl: `/api/download-file?url=${encodeURIComponent(streamRes.data.url)}&name=${encodeURIComponent(titleCombined)}.mp3`
                            });
                        }
                    }
                }
            }
        } catch (e) {
            console.log('Motor 2 (SoundCloud) falló...');
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No se pudo procesar la canción de Spotify. Inténtalo con otro enlace o reintenta en unos segundos.'
        });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno al procesar Spotify.' });
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

        // MOTOR 1: TikWM Form-Data API
        try {
            const formData = new URLSearchParams();
            formData.append('url', cleanUrl);
            formData.append('hd', '1');

            const response = await axios.post('https://www.tikwm.com/api/', formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
        } catch (e1) {
            console.log('TikTok Motor 1 falló:', e1.message);
        }

        // MOTOR 2: LoveTik API
        try {
            const paramsLovo = new URLSearchParams();
            paramsLovo.append('query', cleanUrl);

            const lovoRes = await axios.post('https://lovetik.com/api/ajax/search', paramsLovo, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });

            if (lovoRes.data && lovoRes.data.links && lovoRes.data.links.length > 0) {
                const directUrl = lovoRes.data.links[0].a;
                const title = lovoRes.data.desc || 'TikTok_Video';

                return res.json({
                    exito: true,
                    videoUrlHD: `/api/download-file?url=${encodeURIComponent(directUrl)}&name=${encodeURIComponent(title)}.mp4`,
                    videoUrl: `/api/download-file?url=${encodeURIComponent(directUrl)}&name=${encodeURIComponent(title)}.mp4`,
                    titulo: title
                });
            }
        } catch (e2) {
            console.log('TikTok Motor 2 falló:', e2.message);
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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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

// Inicialización del servidor
app.listen(PORT, () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
});
