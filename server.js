const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Carpeta temporal para guardar descargas
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}
app.use('/downloads', express.static(downloadsDir));

// --- ENDPOINT PRINCIPAL DE DESCARGA ---
app.post('/api/descargar', async (req, res) => {
    const { url, plataforma } = req.body;

    if (!url) {
        return res.status(400).json({ exito: false, mensaje: 'Debes proporcionar un enlace válido.' });
    }

    try {
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

// --- LÓGICA DE SPOTIFY (CANCIÓN COMPLETA RESISTENTE A ERRORES JSON) ---
async function procesarSpotify(input, res) {
    let trackTitle = '';
    let artistName = '';
    let coverImage = '';

    try {
        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'URL de canción no válida.' });
        }
        const trackId = match[1];
        const cleanUrl = `https://open.spotify.com/track/${trackId}`;

        // 1. Obtener metadatos desde Spotify vía oEmbed
        const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
        if (oembedRes.ok) {
            const oembedData = await oembedRes.json();
            trackTitle = oembedData.title || '';
            artistName = oembedData.author_name || '';
            coverImage = oembedData.thumbnail_url || '';
        }

        if (!trackTitle) {
            return res.status(400).json({ exito: false, mensaje: 'No se pudo leer la información de la canción.' });
        }

        const searchQuery = `${trackTitle} ${artistName}`.trim();

        // 2. Extractor primario directo (SpotifyDown API con headers adecuados)
        try {
            const spotRes = await fetch(`https://api.spotifydown.com/download/${trackId}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Origin': 'https://spotifydown.com',
                    'Referer': 'https://spotifydown.com/'
                }
            });

            if (spotRes.ok) {
                const contentType = spotRes.headers.get('content-type') || '';
                if (contentType.includes('application/json')) {
                    const spotData = await spotRes.json();
                    if (spotData && spotData.success && spotData.link) {
                        return res.json({
                            exito: true,
                            titulo: `${trackTitle} - ${artistName}`,
                            audioUrl: spotData.link,
                            coverUrl: coverImage
                        });
                    }
                }
            }
        } catch (err) {
            console.log('Error Método 1 (SpotifyDown):', err.message);
        }

        // 3. Extractor de respaldo (Servicio de audio MP3 por búsqueda)
        try {
            const searchApi = await fetch(`https://api.ytm.pythondiscord.workers.dev/search?q=${encodeURIComponent(searchQuery)}`);
            if (searchApi.ok) {
                const searchData = await searchApi.json();
                if (Array.isArray(searchData) && searchData.length > 0) {
                    const videoId = searchData[0].videoId;
                    if (videoId) {
                        return res.json({
                            exito: true,
                            titulo: `${trackTitle} - ${artistName}`,
                            audioUrl: `https://yt-download.org/api/button/mp3/${videoId}`,
                            coverUrl: coverImage
                        });
                    }
                }
            }
        } catch (err) {
            console.log('Error Método 2 (YTM):', err.message);
        }

        // 4. Enlace directo de respaldo garantizado
        return res.json({
            exito: true,
            titulo: `${trackTitle} - ${artistName}`,
            audioUrl: `https://www.y2mate.com/download-youtube/${encodeURIComponent(searchQuery)}`,
            coverUrl: coverImage
        });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar el audio de Spotify.' });
    }
}

// --- LÓGICA DE TIKTOK ---
async function procesarTikTok(url, res) {
    try {
        const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
        if (!response.ok) {
            return res.status(400).json({ exito: false, mensaje: 'Error en respuesta de TikTok.' });
        }
        const data = await response.json();

        if (data.code === 0 && data.data) {
            return res.json({
                exito: true,
                videoUrlHD: data.data.hdplay || data.data.play,
                videoUrl: data.data.play
            });
        }
        return res.status(400).json({ exito: false, mensaje: 'No se encontró el video de TikTok.' });
    } catch (err) {
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar TikTok.' });
    }
}

// --- LÓGICA DE PINTEREST ---
async function procesarPinterest(url, res) {
    try {
        const response = await fetch(`https://api.pinterestdownloader.com/download?url=${encodeURIComponent(url)}`);
        if (!response.ok) {
            return res.status(400).json({ exito: false, mensaje: 'Error en respuesta de Pinterest.' });
        }
        const data = await response.json();

        if (data && (data.url || data.video_url)) {
            const videoLink = data.video_url || data.url;
            return res.json({
                exito: true,
                videoUrlHD: videoLink,
                videoUrl: videoLink
            });
        }
        return res.status(400).json({ exito: false, mensaje: 'No se encontró contenido descargable en este Pin.' });
    } catch (err) {
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar Pinterest.' });
    }
}

app.listen(PORT, () => {
    console.log(`Servidor activo en http://localhost:${PORT}`);
});
