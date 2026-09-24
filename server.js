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
            timeout: 25000
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
// LÓGICA SPOTIFY (MOTOR DE ALTA PRECISIÓN)
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

        let trackTitle = 'Cancion';
        let artistName = '';
        let coverImage = '';

        // Obtenemos los metadatos oficiales directamente de Spotify
        try {
            const oembedRes = await axios.get(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
            if (oembedRes.data) {
                trackTitle = oembedRes.data.title || trackTitle;
                artistName = oembedRes.data.author_name || '';
                coverImage = oembedRes.data.thumbnail_url || '';
            }
        } catch (e) {
            console.log('Error al obtener metadata oEmbed:', e.message);
        }

        const titleCombined = artistName ? `${trackTitle} - ${artistName}` : trackTitle;

        // MOTOR 1: SpotifyMate API (Precisión por Track ID)
        try {
            const mateRes = await axios.post('https://spotimate.com/api/download', 
                { url: cleanUrl },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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
        } catch (err) {
            console.log('Falló Motor 1 (Spotimate), probando Motor 2...');
        }

        // MOTOR 2: SpotifyDown API
        try {
            const spotRes = await axios.get(`https://api.spotifydown.com/download/${trackId}`, {
                headers: {
                    'Origin': 'https://spotifydown.com',
                    'Referer': 'https://spotifydown.com/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                },
                timeout: 10000
            });

            if (spotRes.data && spotRes.data.success && spotRes.data.link) {
                return res.json({
                    exito: true,
                    titulo: titleCombined,
                    coverUrl: coverImage,
                    audioUrl: `/api/download-file?url=${encodeURIComponent(spotRes.data.link)}&name=${encodeURIComponent(titleCombined)}.mp3`
                });
            }
        } catch (err) {
            console.log('Falló Motor 2 (SpotifyDown):', err.message);
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No se pudo obtener el audio exacto. Verifica el enlace e intentalo de nuevo.'
        });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar Spotify.' });
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
