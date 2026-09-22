const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

// URL base de tu backend en Render
const SERVER_URL = 'https://sspin-backend-0vj7.onrender.com';

// ==========================================
// 1. ROTACIÓN DE API KEYS (SPOTIFY)
// ==========================================
const API_KEYS = [
    '557d5c69acmsh8683894f452d382p1001c0jsnc7f52c75f038',
    'd57a57f0e6msh60d33aa70fd4bfap142a4ejsn3dd732d92d81',
    'cfe9f96619msh2bf6f1ef96b6f5dp1ca3b8jsn55c76c99edbb',
    'ff647c7411msh1f8a4b925654801p17bfa0jsn43708a13c350',
    '662e02b486msh639f823b995cba3p1a1e83jsn3419c2db929d',
    '9652174c07msh5a18f10e100709cp1f0e56jsna7079cb837cf'
];

let currentKeyIndex = 0;

function getNextApiKey() {
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return key;
}

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ==========================================
// PROXY DE DESCARGA DIRECTA POR STREAMING
// ==========================================
app.get('/api/download-file', async (req, res) => {
    const fileUrl = req.query.url;
    let fileName = req.query.name || req.query.filename || 'archivo_media';

    if (!fileUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    try {
        const response = await axios({
            method: 'get',
            url: fileUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!fileName.endsWith('.mp3') && !fileName.endsWith('.mp4')) {
            fileName += '.mp3';
        }

        // Forzar descarga directa en lugar de reproducción
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Type', 'application/octet-stream');

        response.data.pipe(res);

    } catch (error) {
        console.error('Error proxy descarga:', error.message);
        res.status(500).send('Error al procesar la descarga directa');
    }
});

// ==========================================
// ENDPOINT PRINCIPAL: /api/descargar
// ==========================================
app.post('/api/descargar', async (req, res) => {
    let { url, plataforma } = req.body;

    if (!url) {
        return res.status(400).json({ exito: false, mensaje: 'Debes proporcionar un enlace válido.' });
    }

    try {
        url = url.trim();

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

// ==========================================
// 1. LÓGICA SPOTIFY
// ==========================================
async function procesarSpotify(input, res) {
    try {
        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'URL de Spotify no válida.' });
        }
        const trackId = match[1];
        const cleanUrl = `https://open.spotify.com/track/${trackId}`;

        let trackTitle = 'Canción de Spotify';
        let artistName = '';
        let coverImage = '';

        try {
            const oembedRes = await axios.get(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
            if (oembedRes.data) {
                trackTitle = oembedRes.data.title || trackTitle;
                artistName = oembedRes.data.author_name || '';
                coverImage = oembedRes.data.thumbnail_url || '';
            }
        } catch (e) {
            console.log('Error oembed:', e.message);
        }

        const titleCombined = artistName ? `${trackTitle} - ${artistName}` : trackTitle;
        let audioUrl = '';

        for (let i = 0; i < API_KEYS.length; i++) {
            const currentApiKey = getNextApiKey();

            try {
                const rapidRes = await axios.get(`https://spotify-downloader9.p.rapidapi.com/downloadSong?songId=${encodeURIComponent(cleanUrl)}`, {
                    headers: {
                        'x-rapidapi-key': currentApiKey,
                        'x-rapidapi-host': 'spotify-downloader9.p.rapidapi.com'
                    },
                    timeout: 8000
                });

                if (rapidRes.data) {
                    audioUrl = rapidRes.data.data?.downloadLink || rapidRes.data.downloadLink || rapidRes.data.url;
                    if (audioUrl) break;
                }
            } catch (err) {
                console.log(`RapidAPI Key [${i + 1}] falló:`, err.message);
            }
        }

        if (!audioUrl) {
            try {
                const fallbackRes = await axios.get(`https://api.spotifydown.com/download/${trackId}`, {
                    headers: {
                        'Origin': 'https://spotifydown.com',
                        'Referer': 'https://spotifydown.com/'
                    },
                    timeout: 10000
                });

                if (fallbackRes.data && fallbackRes.data.success && fallbackRes.data.link) {
                    audioUrl = fallbackRes.data.link;
                    if (!coverImage) coverImage = fallbackRes.data.metadata?.cover || '';
                }
            } catch (fallbackErr) {
                console.error('Error fallback Spotify:', fallbackErr.message);
            }
        }

        if (audioUrl) {
            const proxyDownloadUrl = `${SERVER_URL}/api/download-file?url=${encodeURIComponent(audioUrl)}&name=${encodeURIComponent(titleCombined)}.mp3`;

            return res.json({
                exito: true,
                titulo: titleCombined,
                coverUrl: coverImage,
                audioUrl: proxyDownloadUrl
            });
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No se pudo obtener el archivo de audio. Intenta nuevamente.'
        });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en Spotify.' });
    }
}

// ==========================================
// 2. LÓGICA TIKTOK
// ==========================================
async function procesarTikTok(url, res) {
    try {
        const params = new URLSearchParams();
        params.append('id', url);
        params.append('locale', 'es');
        params.append('tt', '0');

        const response = await axios.post('https://ssstik.io/abc?url=dl', params, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': 'https://ssstik.io',
                'Referer': 'https://ssstik.io/es'
            }
        });

        const html = response.data;
        const linkMatch = html.match(/href="(https:\/\/[^"]+)"[^>]*class="[^"]*download_link/i) || html.match(/href="(https:\/\/[^"]+)"/i);

        if (linkMatch && linkMatch[1]) {
            const rawVideoUrl = linkMatch[1];
            const proxyUrl = `${SERVER_URL}/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&name=TikTok_Video.mp4`;

            return res.json({
                exito: true,
                videoUrlHD: proxyUrl,
                videoUrl: proxyUrl,
                titulo: 'TikTok Video'
            });
        }

        return res.status(400).json({ exito: false, mensaje: 'No se pudo extraer el enlace del video.' });

    } catch (err) {
        console.error('Error procesando TikTok:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno al procesar TikTok.' });
    }
}

// ==========================================
// 3. LÓGICA PINTEREST
// ==========================================
async function procesarPinterest(inputUrl, res) {
    try {
        const response = await axios.get(inputUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        const html = response.data;
        const videoMatch = html.match(/https:\/\/[^"]+\.mp4/gi) || 
                           html.match(/"video_list":\{"V_720P":\{"url":"(https?:\/\/[^"]+)"/i) ||
                           html.match(/"url":"(https:\/\/v1\.pinimg\.com\/videos\/[^\"]+)"/i);

        if (videoMatch && videoMatch[0]) {
            let rawVideoUrl = videoMatch[0].replace(/\\/g, '');
            if (videoMatch[1]) rawVideoUrl = videoMatch[1].replace(/\\/g, '');

            const proxyUrl = `${SERVER_URL}/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&name=Pinterest_Video.mp4`;

            return res.json({
                exito: true,
                videoUrlHD: proxyUrl,
                videoUrl: proxyUrl,
                titulo: 'Pinterest Video'
            });
        }

        return res.status(400).json({ exito: false, mensaje: 'Este Pin no contiene un video válido.' });
    } catch (err) {
        console.error('Error Pinterest:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en Pinterest.' });
    }
}

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
