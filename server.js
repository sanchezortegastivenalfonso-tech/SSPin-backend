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
        return res.status(400).json({ exito: false, mensaje: 'Debes proporcionar un enlace.' });
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

        // 1. Obtener Metadatos y PORTADA real de Spotify (oEmbed)
        let trackTitle = 'Canción de Spotify';
        let artistName = '';
        let coverImage = '';

        try {
            const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
            if (oembedRes.ok) {
                const oembedData = await oembedRes.json();
                trackTitle = oembedData.title || trackTitle;
                artistName = oembedData.author_name || '';
                coverImage = oembedData.thumbnail_url || '';
            }
        } catch (e) {
            console.log('Error metadatos Spotify:', e.message);
        }

        const query = `${trackTitle} ${artistName}`.trim();

        // 2. Buscar canción completa vía API directa
        const searchRes = await fetch(`https://spotidown.app/api/download-track`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: cleanUrl })
        }).catch(() => null);

        if (searchRes && searchRes.ok) {
            const data = await searchRes.json();
            if (data && data.file_url) {
                return res.json({
                    exito: true,
                    titulo: `${trackTitle} - ${artistName}`,
                    coverUrl: coverImage || data.cover,
                    cover: coverImage || data.cover,
                    audioUrl: data.file_url,
                    downloadUrl: data.file_url
                });
            }
        }

        // 3. Método Alternativo / Backup para obtener el MP3 completo
        const backupRes = await fetch(`https://api.fabdl.com/spotify/get?url=${encodeURIComponent(cleanUrl)}`);
        if (backupRes.ok) {
            const backupData = await backupRes.json();
            if (backupData.result) {
                const mp3Convert = await fetch(`https://api.fabdl.com/spotify/mp3-convert-task/${backupData.result.gid}/${backupData.result.id}`);
                const convertData = await mp3Convert.json();
                if (convertData.result && convertData.result.download_url) {
                    const finalUrl = `https://api.fabdl.com${convertData.result.download_url}`;
                    return res.json({
                        exito: true,
                        titulo: `${trackTitle} - ${artistName}`,
                        coverUrl: coverImage || backupData.result.image,
                        cover: coverImage || backupData.result.image,
                        audioUrl: finalUrl,
                        downloadUrl: finalUrl
                    });
                }
            }
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No se pudo extraer la canción completa. Intenta de nuevo.'
        });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar la canción.' });
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

app.listen(PORT, () => console.log(`Servidor en puerto ${PORT}`));
