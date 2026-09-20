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

        // 1. Obtener metadatos oficiales y portada HD desde Spotify
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

        // 2. Buscar y extraer audio con instancias Invidious (fallback de alta disponibilidad)
        const invidiousInstances = [
            'https://inv.hostux.net',
            'https://invidious.nerdvpn.de',
            'https://invidious.drgns.space',
            'https://vid.puffyan.us'
        ];

        for (const instance of invidiousInstances) {
            try {
                const searchRes = await fetch(`${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`);
                if (searchRes.ok) {
                    const searchData = await searchRes.json();
                    if (searchData && searchData.length > 0) {
                        const videoId = searchData[0].videoId;
                        const videoRes = await fetch(`${instance}/api/v1/videos/${videoId}`);
                        if (videoRes.ok) {
                            const videoData = await videoRes.json();
                            const audioStreams = videoData.adaptiveFormats ? 
                                videoData.adaptiveFormats.filter(f => f.type && f.type.startsWith('audio/')) : [];
                            
                            if (audioStreams.length > 0) {
                                // Seleccionar la mejor calidad de audio
                                audioStreams.sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
                                const audioUrl = audioStreams[0].url;

                                return res.json({
                                    exito: true,
                                    titulo: artistName ? `${trackTitle} - ${artistName}` : trackTitle,
                                    coverUrl: coverImage,
                                    cover: coverImage,
                                    audioUrl: audioUrl,
                                    downloadUrl: audioUrl
                                });
                            }
                        }
                    }
                }
            } catch (err) {
                console.log(`Fallo en instancia ${instance}, intentando siguiente...`);
            }
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No fue posible procesar la canción en este momento. Revisa la URL e intenta nuevamente.'
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
