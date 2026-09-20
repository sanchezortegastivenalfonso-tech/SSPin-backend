const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

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

async function procesarSpotify(input, res) {
    try {
        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'URL de Spotify no válida.' });
        }
        const trackId = match[1];
        const cleanUrl = `https://open.spotify.com/track/${trackId}`;

        // 1. Obtener metadatos oficiales y portada HD
        let trackTitle = 'Canción de Spotify';
        let coverImage = '';

        try {
            const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
            if (oembedRes.ok) {
                const oembedData = await oembedRes.json();
                trackTitle = oembedData.title || trackTitle;
                coverImage = oembedData.thumbnail_url || '';
            }
        } catch (e) {
            console.log('Error oembed:', e.message);
        }

        // 2. Extraer audio MP3 completo vía API de Cobalt / Spotdl rápida
        const downloadApiUrl = `https://api.spotifydown.com/download/${trackId}`;
        const response = await fetch(downloadApiUrl, {
            headers: {
                'Origin': 'https://spotifydown.com',
                'Referer': 'https://spotifydown.com/'
            }
        });

        if (response.ok) {
            const data = await response.json();
            if (data.success && data.link) {
                return res.json({
                    exito: true,
                    titulo: data.metadata ? `${data.metadata.title} - ${data.metadata.artists}` : trackTitle,
                    coverUrl: data.metadata?.cover || coverImage,
                    cover: data.metadata?.cover || coverImage,
                    audioUrl: data.link,
                    downloadUrl: data.link
                });
            }
        }

        // Backup 2: Servidor de respaldo de audio directo
        const backupApi = await fetch(`https://spotidownloader.com/api/download-track`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: cleanUrl })
        }).catch(() => null);

        if (backupApi && backupApi.ok) {
            const backupData = await backupApi.json();
            if (backupData && backupData.download_url) {
                return res.json({
                    exito: true,
                    titulo: trackTitle,
                    coverUrl: backupData.cover || coverImage,
                    cover: backupData.cover || coverImage,
                    audioUrl: backupData.download_url,
                    downloadUrl: backupData.download_url
                });
            }
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No se pudo obtener el audio. Revisa el enlace e intenta de nuevo.'
        });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error procesando la canción.' });
    }
}

async function procesarTikTok(url, res) {
    try {
        const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
        const data = await response.json();
        if (data.code === 0 && data.data) {
            return res.json({
                exito: true,
                downloadUrl: data.data.hdplay || data.data.play,
                audioUrl: data.data.hdplay || data.data.play
            });
        }
        return res.status(400).json({ exito: false, mensaje: 'No se encontró el video.' });
    } catch (err) {
        return res.status(500).json({ exito: false, mensaje: 'Error en TikTok.' });
    }
}

async function procesarPinterest(url, res) {
    try {
        const response = await fetch(`https://api.pinterestdownloader.com/download?url=${encodeURIComponent(url)}`);
        const data = await response.json();
        if (data && (data.url || data.video_url)) {
            const media = data.video_url || data.url;
            return res.json({
                exito: true,
                downloadUrl: media,
                audioUrl: media
            });
        }
        return res.status(400).json({ exito: false, mensaje: 'No se encontró el Pin.' });
    } catch (err) {
        return res.status(500).json({ exito: false, mensaje: 'Error en Pinterest.' });
    }
}

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
