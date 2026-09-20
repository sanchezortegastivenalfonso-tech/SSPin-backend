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

// Carpeta temporal para guardar las descargas
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

// --- LÓGICA DE SPOTIFY (CANCIÓN COMPLETA ESTABLE) ---
async function procesarSpotify(input, res) {
    let trackTitle = '';
    let artistName = '';
    let coverImage = '';

    try {
        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'URL de canción no válida.' });
        }
        const cleanUrl = `https://open.spotify.com/track/${match[1]}`;

        // 1. Obtener datos oficiales desde Spotify
        const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
        if (oembedRes.ok) {
            const oembedData = await oembedRes.json();
            trackTitle = oembedData.title || '';
            artistName = oembedData.author_name || '';
            coverImage = oembedData.thumbnail_url || '';
        }

        if (!trackTitle) {
            return res.status(400).json({ exito: false, mensaje: 'No se pudo obtener el nombre de la canción.' });
        }

        const query = `${trackTitle} ${artistName}`.trim();

        // 2. Método 1: API de SpotifyDown
        try {
            const spotRes = await fetch(`https://api.spotifydown.com/download/${match[1]}`, {
                headers: {
                    'Origin': 'https://spotifydown.com',
                    'Referer': 'https://spotifydown.com/'
                }
            });
            const spotData = await spotRes.json();
            if (spotData.success && spotData.link) {
                return res.json({
                    exito: true,
                    titulo: `${trackTitle} - ${artistName}`,
                    audioUrl: spotData.link,
                    coverUrl: coverImage
                });
            }
        } catch (err) {
            console.log('Error Método 1:', err.message);
        }

        // 3. Método 2: API Invidious / YouTube Audio
        try {
            const searchRes = await fetch(`https://vid.puffyan.us/api/v1/search?q=${encodeURIComponent(query)}&type=video`);
            const searchData = await searchRes.json();

            if (Array.isArray(searchData) && searchData.length > 0) {
                const videoId = searchData[0].videoId;
                const audioApiRes = await fetch(`https://api.cobalt.tools/api/json`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json',
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        url: `https://www.youtube.com/watch?v=${videoId}`,
                        downloadMode: 'audio',
                        audioFormat: 'mp3'
                    })
                });

                const audioData = await audioApiRes.json();
                if (audioData && audioData.url) {
                    return res.json({
                        exito: true,
                        titulo: `${trackTitle} - ${artistName}`,
                        audioUrl: audioData.url,
                        coverUrl: coverImage
                    });
                }
            }
        } catch (err) {
            console.log('Error Método 2:', err.message);
        }

        return res.status(400).json({ exito: false, mensaje: 'No se pudo generar el enlace de la canción completa.' });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar el audio.' });
    }
}

// --- LÓGICA DE TIKTOK ---
async function procesarTikTok(url, res) {
    try {
        const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
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
