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

// --- LÓGICA DE SPOTIFY (CANCIÓN COMPLETA) ---
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

        // 1. Obtener metadatos desde Spotify
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

        const searchQuery = `${trackTitle} ${artistName}`;

        // 2. Extractor principal de canción completa MP3
        const spottyRes = await fetch(`https://spottydl.xyz/api/download?url=${encodeURIComponent(cleanUrl)}`);
        if (spottyRes.ok) {
            const spottyData = await spottyRes.json();
            if (spottyData && (spottyData.link || spottyData.url)) {
                return res.json({
                    exito: true,
                    titulo: `${trackTitle} - ${artistName}`,
                    audioUrl: spottyData.link || spottyData.url,
                    coverUrl: coverImage
                });
            }
        }

        // 3. Extractor de respaldo para canciones completas (vía YouTube Audio API)
        const ytAudioRes = await fetch(`https://api.cobalt.tools/api/json`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                url: cleanUrl,
                downloadMode: 'audio',
                audioFormat: 'mp3'
            })
        });

        if (ytAudioRes.ok) {
            const ytAudioData = await ytAudioRes.json();
            if (ytAudioData && ytAudioData.url) {
                return res.json({
                    exito: true,
                    titulo: `${trackTitle} - ${artistName}`,
                    audioUrl: ytAudioData.url,
                    coverUrl: coverImage
                });
            }
        }

        return res.status(400).json({ exito: false, mensaje: 'No se pudo obtener el audio completo de la canción.' });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar el audio completo.' });
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
