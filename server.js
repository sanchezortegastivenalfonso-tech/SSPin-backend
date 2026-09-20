const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// REEMPLAZA ESTE TEXTO CON TU CLAVE GRATUITA DE RAPIDAPI
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || 'TU_CLAVE_RAPIDAPI_AQUI';

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

        // 1. Obtener metadatos oficiales y portada mediante oEmbed público
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
            console.log('Error oembed:', e.message);
        }

        // 2. Extracción mediante RapidAPI (Evita bloqueos de IP en Render)
        if (RAPIDAPI_KEY && RAPIDAPI_KEY !== '557d5c69acmsh8683894f452d382p1001c0jsnc7f52c75f038';) {
            try {
                const rapidRes = await fetch(`https://spotify-downloader9.p.rapidapi.com/downloadSong?songId=${trackId}`, {
                    method: 'GET',
                    headers: {
                        'x-rapidapi-key': RAPIDAPI_KEY,
                        'x-rapidapi-host': 'spotify-downloader9.p.rapidapi.com'
                    }
                });

                if (rapidRes.ok) {
                    const rapidData = await rapidRes.json();
                    if (rapidData && rapidData.data && rapidData.data.downloadLink) {
                        return res.json({
                            exito: true,
                            titulo: artistName ? `${trackTitle} - ${artistName}` : trackTitle,
                            coverUrl: coverImage || rapidData.data.cover,
                            cover: coverImage || rapidData.data.cover,
                            audioUrl: rapidData.data.downloadLink,
                            downloadUrl: rapidData.data.downloadLink
                        });
                    }
                }
            } catch (err) {
                console.log('Error RapidAPI:', err.message);
            }
        }

        // Respaldo por CDN directo
        try {
            const fallbackRes = await fetch(`https://api.spotifydown.com/download/${trackId}`, {
                headers: {
                    'Origin': 'https://spotifydown.com',
                    'Referer': 'https://spotifydown.com/'
                }
            });
            if (fallbackRes.ok) {
                const fbData = await fallbackRes.json();
                if (fbData.success && fbData.link) {
                    return res.json({
                        exito: true,
                        titulo: artistName ? `${trackTitle} - ${artistName}` : trackTitle,
                        coverUrl: coverImage,
                        cover: coverImage,
                        audioUrl: fbData.link,
                        downloadUrl: fbData.link
                    });
                }
            }
        } catch (e) {
            console.log('Error CDN Respaldo');
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No se pudo obtener el audio de Spotify. Configura tu API Key de RapidAPI.'
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

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
