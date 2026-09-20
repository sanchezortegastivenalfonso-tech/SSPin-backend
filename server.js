const express = require('express');
const cors = require('cors');
const NodeID3 = require('node-id3');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY || '557d5c69acmsh8683894f452d382p1001c0jsnc7f52c75f038';

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

async function expandirUrl(shortUrl) {
    try {
        const response = await fetch(shortUrl, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        return response.url || shortUrl;
    } catch (e) {
        return shortUrl;
    }
}

app.post('/api/descargar', async (req, res) => {
    let { url, plataforma } = req.body;

    if (!url) {
        return res.status(400).json({ exito: false, mensaje: 'Debes proporcionar un enlace válido.' });
    }

    try {
        url = await expandirUrl(url.trim());

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

// Endpoint proxy para servir el MP3 con etiquetas ID3v2.3 incrustadas
app.get('/api/download-file', async (req, res) => {
    const fileUrl = req.query.url;
    const title = req.query.title || 'Canción';
    const artist = req.query.artist || 'Artista';
    const album = req.query.album || 'Spotify';
    const coverUrl = req.query.cover || '';

    if (!fileUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    try {
        const response = await fetch(fileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            return res.status(500).send('Error al obtener el archivo fuente');
        }

        const arrayBuffer = await response.arrayBuffer();
        let buffer = Buffer.from(arrayBuffer);

        // Configuración de etiquetas ID3 v2.3
        const tags = {
            title: title,
            artist: artist,
            album: album,
            TRCK: '1'
        };

        if (coverUrl) {
            try {
                const imgRes = await fetch(coverUrl);
                if (imgRes.ok) {
                    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
                    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
                    tags.image = {
                        mime: contentType.includes('png') ? 'image/png' : 'image/jpeg',
                        type: { id: 3, name: 'front cover' },
                        description: 'Cover',
                        imageBuffer: imgBuffer
                    };
                }
            } catch (coverErr) {
                console.error('Error descargando carátula:', coverErr.message);
            }
        }

        // Inyectar metadatos con la opción explicitID3v23 para máxima compatibilidad
        const taggedBuffer = NodeID3.write(tags, buffer, { explicitID3v23: true });
        if (taggedBuffer) {
            buffer = taggedBuffer;
        }

        const cleanFileName = `${artist} - ${title}.mp3`.replace(/[/\\?%*:|"<>]/g, '');

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cleanFileName)}"`);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);

    } catch (error) {
        console.error('Error en proxy de descarga:', error.message);
        res.status(500).send('Error al procesar el archivo con metadatos.');
    }
});

// PROCESAR SPOTIFY
async function procesarSpotify(input, res) {
    try {
        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'URL de Spotify no válida.' });
        }
        const trackId = match[1];
        const cleanUrl = `https://open.spotify.com/track/${trackId}`;

        let trackTitle = '';
        let artistName = '';
        let coverImage = '';

        // Obtener datos desde oembed oficial de Spotify
        try {
            const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
            if (oembedRes.ok) {
                const oembedData = await oembedRes.json();
                trackTitle = oembedData.title || '';
                artistName = oembedData.author_name || '';
                coverImage = oembedData.thumbnail_url || '';
            }
        } catch (e) {
            console.log('Error oembed:', e.message);
        }

        let rawAudioUrl = '';

        // Obtención de audio mediante RapidAPI
        if (RAPIDAPI_KEY) {
            try {
                const rapidRes = await fetch(`https://spotify-downloader9.p.rapidapi.com/downloadSong?songId=${encodeURIComponent(cleanUrl)}`, {
                    headers: {
                        'x-rapidapi-key': RAPIDAPI_KEY,
                        'x-rapidapi-host': 'spotify-downloader9.p.rapidapi.com'
                    }
                });

                if (rapidRes.ok) {
                    const rapidData = await rapidRes.json();
                    rawAudioUrl = rapidData.data?.downloadLink || rapidData.downloadLink || rapidData.url;
                    if (!trackTitle) trackTitle = rapidData.data?.title || rapidData.title || 'Canción';
                    if (!artistName) artistName = rapidData.data?.artist || rapidData.artists || 'Artista';
                    if (!coverImage) coverImage = rapidData.data?.cover || rapidData.cover || '';
                }
            } catch (err) {
                console.log('Error RapidAPI:', err.message);
            }
        }

        // Respaldo de descarga si falla la API principal
        if (!rawAudioUrl) {
            try {
                const fallbackRes = await fetch(`https://api.spotifydown.com/download/${trackId}`, {
                    headers: { 'Origin': 'https://spotifydown.com', 'Referer': 'https://spotifydown.com/' }
                });
                if (fallbackRes.ok) {
                    const fbData = await fallbackRes.json();
                    if (fbData.success && fbData.link) {
                        rawAudioUrl = fbData.link;
                        if (!trackTitle) trackTitle = fbData.metadata?.title || 'Canción';
                        if (!artistName) artistName = fbData.metadata?.artists || 'Artista';
                        if (!coverImage) coverImage = fbData.metadata?.cover || '';
                    }
                }
            } catch (e) {}
        }

        if (!trackTitle) trackTitle = 'Canción de Spotify';
        if (!artistName) artistName = 'Spotify Artist';

        if (rawAudioUrl) {
            const proxyUrl = `/api/download-file?url=${encodeURIComponent(rawAudioUrl)}&title=${encodeURIComponent(trackTitle)}&artist=${encodeURIComponent(artistName)}&cover=${encodeURIComponent(coverImage)}`;

            return res.json({
                exito: true,
                titulo: `${trackTitle} - ${artistName}`,
                coverUrl: coverImage,
                audioUrl: proxyUrl
            });
        }

        return res.status(400).json({ exito: false, mensaje: 'No fue posible obtener el archivo de audio.' });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en Spotify.' });
    }
}

// PROCESAR TIKTOK
async function procesarTikTok(url, res) {
    try {
        const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const contentType = response.headers.get('content-type') || '';
        
        if (response.ok && contentType.includes('application/json')) {
            const data = await response.json();
            if (data.code === 0 && data.data) {
                const videoUrl = data.data.hdplay || data.data.play;
                return res.json({
                    exito: true,
                    videoUrlHD: `/api/download-file?url=${encodeURIComponent(videoUrl)}&title=TikTok_HD`,
                    videoUrl: `/api/download-file?url=${encodeURIComponent(data.data.play)}&title=TikTok_SD`,
                    titulo: data.data.title || 'TikTok Video'
                });
            }
        }

        return res.status(400).json({ exito: false, mensaje: 'No se pudo procesar TikTok.' });
    } catch (err) {
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar TikTok.' });
    }
}

// PROCESAR PINTEREST
async function procesarPinterest(url, res) {
    try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (!response.ok) return res.status(400).json({ exito: false, mensaje: 'No se pudo acceder a Pinterest.' });

        const html = await response.text();
        const videoMatch = html.match(/https:\/\/[^"]+\.mp4/gi);

        if (videoMatch && videoMatch[0]) {
            const rawVideoUrl = videoMatch[0].replace(/\\/g, '');
            return res.json({
                exito: true,
                videoUrlHD: `/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&title=Pinterest_Video`,
                videoUrl: `/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&title=Pinterest_Video`,
                titulo: 'Pinterest Video'
            });
        }

        return res.status(400).json({ exito: false, mensaje: 'No contiene video descargable.' });
    } catch (err) {
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar Pinterest.' });
    }
}

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
