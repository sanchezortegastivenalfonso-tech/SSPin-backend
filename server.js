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

        // 1. Obtener metadatos oficiales y Portada HD vía Spotify oEmbed
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

        // 2. Extraer audio MP3 completo mediante API de descarga directa
        const spotifyApis = [
            `https://api.vagalume.com.br/valida_url/?url=${encodeURIComponent(cleanUrl)}`,
            `https://spotify-downloader-api.vercel.app/api/download?url=${encodeURIComponent(cleanUrl)}`
        ];

        // Opción A: Servicio Directo Spotimate / SpotiDown
        try {
            const apiRes = await fetch(`https://api.spotidownloader.com/download?url=${encodeURIComponent(cleanUrl)}`, {
                headers: { 'User-Agent': 'Mozilla/5.0' }
            });
            if (apiRes.ok) {
                const data = await apiRes.json();
                if (data && data.link) {
                    return res.json({
                        exito: true,
                        titulo: artistName ? `${trackTitle} - ${artistName}` : trackTitle,
                        coverUrl: coverImage,
                        cover: coverImage,
                        audioUrl: data.link,
                        downloadUrl: data.link
                    });
                }
            }
        } catch (e) {
            console.log('Fallo opción A, probando respaldo...');
        }

        // Opción B: Servicio de Respaldo por ID
        try {
            const backupRes = await fetch(`https://api.fabdl.com/spotify/get?url=${encodeURIComponent(cleanUrl)}`);
            if (backupRes.ok) {
                const bData = await backupRes.json();
                if (bData.result) {
                    const convertRes = await fetch(`https://api.fabdl.com/spotify/mp3-convert-task/${bData.result.gid}/${bData.result.id}`);
                    const convertData = await convertRes.json();
                    if (convertData.result && convertData.result.download_url) {
                        const dlLink = `https://api.fabdl.com${convertData.result.download_url}`;
                        return res.json({
                            exito: true,
                            titulo: artistName ? `${trackTitle} - ${artistName}` : trackTitle,
                            coverUrl: coverImage || bData.result.image,
                            cover: coverImage || bData.result.image,
                            audioUrl: dlLink,
                            downloadUrl: dlLink
                        });
                    }
                }
            }
        } catch (e) {
            console.log('Fallo opción B');
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No se pudo obtener el audio. Intenta nuevamente en un momento.'
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
