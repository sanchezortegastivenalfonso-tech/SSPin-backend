const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// Tu clave de RapidAPI configurada
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '557d5c69acmsh8683894f452d382p1001c0jsnc7f52c75f038';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Endpoint principal para procesar los enlaces
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

// Endpoint proxy para forzar la descarga directa inmediata como archivo adjunto
app.get('/api/download-file', async (req, res) => {
    const fileUrl = req.query.url;
    let fileName = req.query.name || 'cancion.mp3';

    if (!fileUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    if (!fileName.endsWith('.mp3')) {
        fileName += '.mp3';
    }

    try {
        const response = await fetch(fileUrl);
        if (!response.ok) {
            return res.status(500).send('Error al obtener el archivo fuente');
        }

        // Encabezados obligatorios para forzar descarga directa en el navegador
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Type', 'audio/mpeg');

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.send(buffer);
    } catch (error) {
        console.error('Error proxy descarga:', error.message);
        res.status(500).send('Error al procesar la descarga directa');
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

        // 1. Metadatos de Spotify mediante oEmbed
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

        // 2. Extracción vía RapidAPI
        if (RAPIDAPI_KEY) {
            try {
                const rapidRes = await fetch(`https://spotify-downloader9.p.rapidapi.com/downloadSong?songId=${encodeURIComponent(cleanUrl)}`, {
                    method: 'GET',
                    headers: {
                        'x-rapidapi-key': RAPIDAPI_KEY,
                        'x-rapidapi-host': 'spotify-downloader9.p.rapidapi.com'
                    }
                });

                if (rapidRes.ok) {
                    const rapidData = await rapidRes.json();
                    const audioUrl = rapidData.data?.downloadLink || rapidData.downloadLink || rapidData.url;
                    
                    if (audioUrl) {
                        const titleCombined = artistName ? `${trackTitle} - ${artistName}` : trackTitle;
                        // Construimos la URL pasando por nuestro proxy para forzar descarga
                        const directDownloadProxyUrl = `/api/download-file?url=${encodeURIComponent(audioUrl)}&name=${encodeURIComponent(titleCombined)}`;

                        return res.json({
                            exito: true,
                            titulo: titleCombined,
                            coverUrl: coverImage || rapidData.data?.cover,
                            cover: coverImage || rapidData.data?.cover,
                            audioUrl: directDownloadProxyUrl,
                            downloadUrl: directDownloadProxyUrl
                        });
                    }
                }
            } catch (err) {
                console.log('Error en RapidAPI:', err.message);
            }
        }

        // Respaldo secundario
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
                    const titleCombined = artistName ? `${trackTitle} - ${artistName}` : trackTitle;
                    const directDownloadProxyUrl = `/api/download-file?url=${encodeURIComponent(fbData.link)}&name=${encodeURIComponent(titleCombined)}`;

                    return res.json({
                        exito: true,
                        titulo: titleCombined,
                        coverUrl: coverImage,
                        cover: coverImage,
                        audioUrl: directDownloadProxyUrl,
                        downloadUrl: directDownloadProxyUrl
                    });
                }
            }
        } catch (e) {
            console.log('Error en CDN de respaldo');
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No fue posible obtener el audio. Revisa la suscripción en RapidAPI.'
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
