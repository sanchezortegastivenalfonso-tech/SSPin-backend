const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

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
// ENDPOINT PROXY DE DESCARGA
// ==========================================
app.get('/api/download-file', async (req, res) => {
    const fileUrl = req.query.url;
    let fileName = req.query.name || 'cancion';

    if (!fileUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    try {
        const response = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 30000
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
        console.error('Error enviando archivo:', error.message);
        return res.status(500).send('Error al descargar el archivo. Realiza la búsqueda de nuevo.');
    }
});

// ==========================================
// ENDPOINT PRINCIPAL: /api/descargar
// ==========================================
app.post('/api/descargar', async (req, res) => {
    let { url, plataforma } = req.body;

    if (!url) {
        return res.status(400).json({ exito: false, mensaje: 'Debes proporcionar un enlace valido.' });
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
// LÓGICA SPOTIFY (DEFINITIVA Y EXACTA)
// ==========================================
async function procesarSpotify(input, res) {
    try {
        if (input.includes('spotify.link')) {
            input = await desglosarUrl(input);
        }

        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'URL de Spotify no valida.' });
        }
        const trackId = match[1];
        const cleanUrl = `https://open.spotify.com/track/${trackId}`;

        let trackTitle = '';
        let artistName = '';
        let coverImage = '';

        // 1. EXTRAER METADATOS PRECISOS DE SPOTIFY
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

        if (!trackTitle) {
            return res.status(400).json({ exito: false, mensaje: 'No se pudieron extraer los datos de la canción.' });
        }

        const titleCombined = artistName ? `${trackTitle} - ${artistName}` : trackTitle;
        const searchQuery = `${trackTitle} ${artistName} Audio Official`;

        // 2. MOTOR 1: SpotDL Public Engine API
        try {
            const spotDlRes = await axios.get(`https://api.spotdl.com/search?query=${encodeURIComponent(cleanUrl)}`, {
                timeout: 8000
            });
            if (spotDlRes.data && spotDlRes.data.downloadUrl) {
                return res.json({
                    exito: true,
                    titulo: titleCombined,
                    coverUrl: coverImage,
                    audioUrl: `/api/download-file?url=${encodeURIComponent(spotDlRes.data.downloadUrl)}&name=${encodeURIComponent(titleCombined)}.mp3`
                });
            }
        } catch (e) {
            console.log('Motor 1 (SpotDL) falló...');
        }

        // 3. MOTOR 2: BÚSQUEDA Y CONVERSIÓN VÍA CONVERTIDOR MP3 ROBUSTO (YTMP3 API)
        try {
            const ytSearchRes = await axios.get(`https://invidious.io.lol/api/v1/search?q=${encodeURIComponent(searchQuery)}&type=video`, {
                timeout: 7000
            });

            let videoId = '';
            if (ytSearchRes.data && ytSearchRes.data.length > 0) {
                videoId = ytSearchRes.data[0].videoId;
            }

            if (videoId) {
                const mp3Res = await axios.get(`https://api.vevioz.com/api/button/mp3/${videoId}`, {
                    timeout: 8000
                });

                if (mp3Res.data && typeof mp3Res.data === 'string') {
                    const matchUrl = mp3Res.data.match(/href="(https:\/\/[^"]+)"/);
                    if (matchUrl && matchUrl[1]) {
                        return res.json({
                            exito: true,
                            titulo: titleCombined,
                            coverUrl: coverImage,
                            audioUrl: `/api/download-file?url=${encodeURIComponent(matchUrl[1])}&name=${encodeURIComponent(titleCombined)}.mp3`
                        });
                    }
                }
            }
        } catch (e) {
            console.log('Motor 2 falló:', e.message);
        }

        // 4. MOTOR 3: Respaldo de descarga rápida vía Savetube API
        try {
            const saveRes = await axios.post('https://api.savetube.me/api/v1/terabox-download', {
                url: cleanUrl
            }, { timeout: 8000 });

            if (saveRes.data && saveRes.data.downloadUrl) {
                return res.json({
                    exito: true,
                    titulo: titleCombined,
                    coverUrl: coverImage,
                    audioUrl: `/api/download-file?url=${encodeURIComponent(saveRes.data.downloadUrl)}&name=${encodeURIComponent(titleCombined)}.mp3`
                });
            }
        } catch (e) {
            console.log('Motor 3 falló:', e.message);
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No se pudo procesar la canción de Spotify. Intenta nuevamente.'
        });

    } catch (e) {
        console.error('Error en Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno al procesar la canción.' });
    }
}

// ==========================================
// LÓGICA TIKTOK
// ==========================================
async function procesarTikTok(inputUrl, res) {
    try {
        let cleanUrl = inputUrl.trim();

        if (cleanUrl.includes('vt.tiktok.com') || cleanUrl.includes('vm.tiktok.com')) {
            cleanUrl = await desglosarUrl(cleanUrl);
        }

        const paramsLovo = new URLSearchParams();
        paramsLovo.append('query', cleanUrl);

        const lovoRes = await axios.post('https://lovetik.com/api/ajax/search', paramsLovo, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
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

        return res.status(400).json({ exito: false, mensaje: 'No se pudo obtener el video de TikTok.' });

    } catch (err) {
        console.error('Error TikTok:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en TikTok.' });
    }
}

// ==========================================
// LÓGICA PINTEREST
// ==========================================
async function procesarPinterest(inputUrl, res) {
    try {
        const response = await axios.get(inputUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
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

        return res.status(400).json({ exito: false, mensaje: 'Este Pin no contiene un video valido.' });
    } catch (err) {
        console.error('Error Pinterest:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en Pinterest.' });
    }
}

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
