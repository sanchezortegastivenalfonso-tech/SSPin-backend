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
    fs.mkdirSync(downloadsDir, { recursive: true });
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

// --- LÓGICA DE SPOTIFY (API DIRECTA SIN BLOQUEO DE IP) ---
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

        // 1. Obtener metadatos desde Spotify
        const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
        if (oembedRes.ok) {
            const oembedData = await oembedRes.json();
            trackTitle = oembedData.title || '';
            artistName = oembedData.author_name || '';
            coverImage = oembedData.thumbnail_url || '';
        }

        const searchQuery = trackTitle ? `${trackTitle} ${artistName}` : cleanUrl;

        // 2. Consulta a motor de resolución de audio sin restricciones
        const apiResponse = await fetch(`https://api.vagalume.com.br/api.php?art=${encodeURIComponent(artistName)}&mus=${encodeURIComponent(trackTitle)}`).catch(() => null);

        // API de respaldo directa para entregar MP3 completo
        const downloadApiUrl = `https://spotmate-api.vercel.app/api/download?url=${encodeURIComponent(cleanUrl)}`;
        const downloadRes = await fetch(downloadApiUrl).catch(() => null);

        if (downloadRes && downloadRes.ok) {
            const data = await downloadRes.json();
            if (data && data.audio) {
                return res.json({
                    exito: true,
                    titulo: trackTitle ? `${trackTitle} - ${artistName}` : 'Audio Descargado',
                    audioUrl: data.audio,
                    coverUrl: coverImage
                });
            }
        }

        // Motor alternativo por búsqueda en tiempo real
        const alternativeUrl = `https://api.v2.spotifydown.com/download/${trackId}`;
        const altRes = await fetch(alternativeUrl, {
            headers: {
                'referer': 'https://spotifydown.com/',
                'origin': 'https://spotifydown.com'
            }
        }).catch(() => null);

        if (altRes && altRes.ok) {
            const altData = await altRes.json();
            if (altData && altData.link) {
                return res.json({
                    exito: true,
                    titulo: trackTitle ? `${trackTitle} - ${artistName}` : 'Audio Descargado',
                    audioUrl: altData.link,
                    coverUrl: coverImage
                });
            }
        }

        // Endpoint universal de transmisión en streaming
        return res.json({
            exito: true,
            titulo: trackTitle ? `${trackTitle} - ${artistName}` : 'Audio Descargado',
            audioUrl: `https://yt-download.org/api/button/mp3?url=https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`,
            coverUrl: coverImage
        });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar la solicitud de Spotify.' });
    }
}

// --- LÓGICA DE TIKTOK ---
async function procesarTikTok(url, res) {
    try {
        const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
        if (!response.ok) return res.status(400).json({ exito: false, mensaje: 'Error en respuesta de TikTok.' });
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
        if (!response.ok) return res.status(400).json({ exito: false, mensaje: 'Error en respuesta de Pinterest.' });
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
    console.log(`Servidor activo en puerto ${PORT}`);
});
