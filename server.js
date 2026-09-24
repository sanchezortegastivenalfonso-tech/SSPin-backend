const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

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

async function desglosarUrl(shortUrl) {
    try {
        const response = await axios.get(shortUrl, {
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        return response.request.res.responseUrl || shortUrl;
    } catch (e) {
        return shortUrl;
    }
}

// ==========================================
// ENDPOINT DE DESCARGA DIRECTA POR STREAM
// ==========================================
app.get('/api/download-file', async (req, res) => {
    const fileUrl = req.query.url;
    let fileName = req.query.name || 'archivo_descargado';

    if (!fileUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    try {
        // Hacemos el fetch como arraybuffer para evitar errores de expiración en streams diferidos
        const response = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Referer': 'https://open.spotify.com/'
            },
            timeout: 20000
        });

        const contentType = response.headers['content-type'] || 'audio/mpeg';

        if (!fileName.includes('.')) {
            fileName += contentType.includes('video') ? '.mp4' : '.mp3';
        }

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', response.data.length);

        return res.send(Buffer.from(response.data));

    } catch (error) {
        console.error('Error al procesar el archivo en el proxy:', error.message);
        return res.status(500).send('El enlace expiro o el servidor de origen denego el acceso. Intenta buscar de nuevo.');
    }
});

// ==========================================
// ENDPOINT PRINCIPAL: /api/descargar
// ==========================================
app.post('/api/descargar', async (req, res) => {
    let { url, plataforma } = req.body;

    if (!url) {
        return res.status(400).json({ exito: false, mensaje: 'Debes proporcionar un enlace valido.' });
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
            return res.status(400).json({ exito: false, mensaje: 'URL de Spotify no valida.' });
        }
        const trackId = match[1];
        const cleanUrl = `https://open.spotify.com/track/${trackId}`;

        let trackTitle = 'Cancion_Spotify';
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

        // Intentar RapidAPI con rotación
        for (let i = 0; i < API_KEYS.length; i++) {
            const currentApiKey = getNextApiKey();
            try {
                const rapidRes = await axios.get(`https://spotify-downloader9.p.rapidapi.com/downloadSong?songId=${encodeURIComponent(cleanUrl)}`, {
                    headers: {
                        'x-rapidapi-key': currentApiKey,
                        'x-rapidapi-host': 'spotify-downloader9.p.rapidapi.com'
                    },
                    timeout: 10000
                });

                if (rapidRes.data) {
                    const audioUrl = rapidRes.data.data?.downloadLink || rapidRes.data.downloadLink || rapidRes.data.url;
                    if (audioUrl) {
                        return res.json({
                            exito: true,
                            titulo: titleCombined,
                            coverUrl: coverImage,
                            audioUrl: `/api/download-file?url=${encodeURIComponent(audioUrl)}&name=${encodeURIComponent(titleCombined)}.mp3`
                        });
                    }
                }
            } catch (err) {
                console.log(`Key ${i + 1} fallo, intentando la siguiente...`);
            }
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No se pudo generar el enlace en este momento. Intentalo de nuevo.'
        });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar Spotify.' });
    }
}

// ==========================================
// 2. LÓGICA TIKTOK
// ==========================================
async function procesarTikTok(inputUrl, res) {
    try {
        let cleanUrl = inputUrl.trim();

        if (cleanUrl.includes('vt.tiktok.com') || cleanUrl.includes('vm.tiktok.com')) {
            cleanUrl = await desglosarUrl(cleanUrl);
        }

        try {
            const paramsLovo = new URLSearchParams();
            paramsLovo.append('query', cleanUrl);

            const lovoRes = await axios.post('https://lovetik.com/api/ajax/search', paramsLovo, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            if (lovoRes.data && lovoRes.data.links && lovoRes.data.links.length > 0) {
                const directUrl = lovoRes.data.links[0].a;
                const title = lovoRes.data.desc || 'TikTok_Video';

                return res.json({
                    exito: true,
                    videoUrlHD: `/api/download-file?url=${encodeURIComponent(directUrl)}&name=${encodeURIComponent(title)}.mp4`,
                    videoUrl: `/api/download-file?url=${encodeURIComponent(directUrl)}&name=${encodeURIComponent(title)}.mp4`,
                    titulo: title
                });
            }
        } catch (e) {
            console.log('Fallo Lovetik...');
        }

        return res.status(400).json({ exito: false, mensaje: 'No se pudo obtener el video de TikTok.' });

    } catch (err) {
        console.error('Error TikTok:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en TikTok.' });
    }
}

// ==========================================
// 3. LÓGICA PINTEREST
// ==========================================
async function procesarPinterest(inputUrl, res) {
    try {
        const response = await axios.get(inputUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const html = response.data;
        const videoMatch = html.match(/https:\/\/[^"]+\.mp4/gi);

        if (videoMatch && videoMatch[0]) {
            let rawVideoUrl = videoMatch[0].replace(/\\/g, '');
            return res.json({
                exito: true,
                videoUrlHD: `/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&name=Pinterest_Video.mp4`,
                videoUrl: `/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&name=Pinterest_Video.mp4`,
                titulo: 'Pinterest Video'
            });
        }

        return res.status(400).json({ exito: false, mensaje: 'Este Pin no contiene un video valido.' });
    } catch (err) {
        console.error('Error Pinterest:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en Pinterest.' });
    }
}

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
