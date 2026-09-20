const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

async function expandirUrl(shortUrl) {
    try {
        const response = await fetch(shortUrl, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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

// Proxy de descarga directo sin alterar el encabezado de audio
app.get('/api/download-file', async (req, res) => {
    const fileUrl = req.query.url;
    const filename = req.query.filename || 'audio.mp3';

    if (!fileUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    try {
        const response = await fetch(fileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            return res.status(500).send('Error al obtener el archivo.');
        }

        const cleanFileName = filename.replace(/[/\\?%*:|"<>]/g, '');

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(cleanFileName)}"`);
        res.setHeader('Content-Type', 'audio/mpeg');
        
        // Retransmitir el audio directamente como flujo continuo (Stream)
        response.body.pipe(res);

    } catch (error) {
        console.error('Error en descarga proxy:', error.message);
        res.status(500).send('Error al descargar el archivo.');
    }
});

// LÓGICA DE SPOTIFY
async function procesarSpotify(input, res) {
    try {
        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'URL de Spotify no válida.' });
        }
        const trackId = match[1];
        const cleanUrl = `https://open.spotify.com/track/${trackId}`;

        let trackTitle = 'Canción';
        let artistName = 'Artista';
        let coverImage = '';

        // Obtener datos e imagen vía oEmbed
        try {
            const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
            if (oembedRes.ok) {
                const oembedData = await oembedRes.json();
                trackTitle = oembedData.title || trackTitle;
                artistName = oembedData.author_name || artistName;
                coverImage = oembedData.thumbnail_url || '';
            }
        } catch (e) {}

        // Obtener audio vía API Cobalt
        const cobaltRes = await fetch('https://co.wuk.sh/api/json', {
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

        if (cobaltRes.ok) {
            const cobaltData = await cobaltRes.json();
            if (cobaltData && cobaltData.url) {
                const fullTitle = `${artistName} - ${trackTitle}.mp3`;
                const proxyUrl = `/api/download-file?url=${encodeURIComponent(cobaltData.url)}&filename=${encodeURIComponent(fullTitle)}`;

                return res.json({
                    exito: true,
                    titulo: `${artistName} - ${trackTitle}`,
                    coverUrl: coverImage,
                    audioUrl: proxyUrl
                });
            }
        }

        return res.status(400).json({ exito: false, mensaje: 'No fue posible procesar esta canción.' });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en Spotify.' });
    }
}

// LÓGICA DE TIKTOK
async function procesarTikTok(url, res) {
    try {
        const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
        if (!response.ok) return res.status(400).json({ exito: false, mensaje: 'Error al conectar con TikTok.' });
        const data = await response.json();

        if (data.code === 0 && data.data) {
            const videoUrl = data.data.hdplay || data.data.play;
            const fullTitle = `${data.data.title || 'TikTok_Video'}.mp4`;
            return res.json({
                exito: true,
                videoUrlHD: `/api/download-file?url=${encodeURIComponent(videoUrl)}&filename=${encodeURIComponent(fullTitle)}`,
                videoUrl: `/api/download-file?url=${encodeURIComponent(data.data.play)}&filename=${encodeURIComponent(fullTitle)}`,
                titulo: data.data.title || 'TikTok Video'
            });
        }
        return res.status(400).json({ exito: false, mensaje: 'No se encontró el video de TikTok.' });
    } catch (err) {
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar TikTok.' });
    }
}

// LÓGICA DE PINTEREST
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
                videoUrlHD: `/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&filename=Pinterest_Video.mp4`,
                videoUrl: `/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&filename=Pinterest_Video.mp4`,
                titulo: 'Pinterest Video'
            });
        }

        return res.status(400).json({ exito: false, mensaje: 'No se encontró video en este enlace.' });
    } catch (err) {
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar Pinterest.' });
    }
}

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
