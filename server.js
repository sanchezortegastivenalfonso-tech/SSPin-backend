const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// LISTA Y ROTACIÓN DE LAS 6 API KEYS (SPOTIFY)
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

// Resolver redirecciones cortas (vt.tiktok.com)
async function unshortenUrl(shortUrl) {
    try {
        const res = await fetch(shortUrl, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
            }
        });
        return res.url || shortUrl;
    } catch (e) {
        console.log('Error expandiendo URL:', e.message);
        return shortUrl;
    }
}

// Endpoint principal
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

// Proxy de descarga
app.get('/api/download-file', async (req, res) => {
    const fileUrl = req.query.url;
    let fileName = req.query.name || 'archivo_media';

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

        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        
        if (!fileName.includes('.')) {
            if (contentType.includes('audio') || contentType.includes('mpeg')) {
                fileName += '.mp3';
            } else {
                fileName += '.mp4';
            }
        }

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Type', contentType);

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.send(buffer);
    } catch (error) {
        console.error('Error proxy descarga:', error.message);
        res.status(500).send('Error al procesar la descarga directa');
    }
});

// ==========================================
// 1. PROCESAR SPOTIFY
// ==========================================
async function procesarSpotify(input, res) {
    try {
        const expandedUrl = await unshortenUrl(input);
        const match = expandedUrl.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'URL de Spotify no válida.' });
        }
        const trackId = match[1];
        const cleanUrl = `https://open.spotify.com/track/${trackId}`;

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

        const titleCombined = artistName ? `${trackTitle} - ${artistName}` : trackTitle;

        for (let i = 0; i < API_KEYS.length; i++) {
            const currentApiKey = getNextApiKey();

            try {
                const rapidRes = await fetch(`https://spotify-downloader9.p.rapidapi.com/downloadSong?songId=${encodeURIComponent(cleanUrl)}`, {
                    method: 'GET',
                    headers: {
                        'x-rapidapi-key': currentApiKey,
                        'x-rapidapi-host': 'spotify-downloader9.p.rapidapi.com'
                    }
                });

                if (rapidRes.ok) {
                    const rapidData = await rapidRes.json();
                    const audioUrl = rapidData.data?.downloadLink || rapidData.downloadLink || rapidData.url;

                    if (audioUrl) {
                        const directDownloadProxyUrl = `/api/download-file?url=${encodeURIComponent(audioUrl)}&name=${encodeURIComponent(titleCombined)}.mp3`;

                        return res.json({
                            exito: true,
                            titulo: titleCombined,
                            coverUrl: coverImage || rapidData.data?.cover,
                            audioUrl: directDownloadProxyUrl
                        });
                    }
                }
            } catch (err) {
                console.log(`Intento Spotify Key [${i + 1}] falló:`, err.message);
            }
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'Límite de descargas de Spotify alcanzado temporalmente.'
        });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar Spotify.' });
    }
}

// ==========================================
// 2. PROCESAR TIKTOK (Optimizada para Servidores Cloud)
// ==========================================
async function procesarTikTok(inputUrl, res) {
    try {
        const resolvedUrl = await unshortenUrl(inputUrl);

        // Método 1: API Directa en Formato Form-Data con User-Agent Móvil Real
        try {
            const bodyData = new URLSearchParams();
            bodyData.append('url', resolvedUrl);
            bodyData.append('hd', '1');

            const tikwmRes = await fetch('https://www.tikwm.com/api/', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'User-Agent': 'TikTok 26.2.0 rv:262018 (iPhone; iOS 14.4.2; en_US) Cronet'
                },
                body: bodyData
            });

            if (tikwmRes.ok) {
                const data = await tikwmRes.json();
                if (data.code === 0 && data.data) {
                    const videoLink = data.data.hdplay || data.data.play;
                    const finalVideoUrl = videoLink.startsWith('http') ? videoLink : `https://www.tikwm.com${videoLink}`;
                    const proxyUrl = `/api/download-file?url=${encodeURIComponent(finalVideoUrl)}&name=TikTok_Video.mp4`;

                    return res.json({
                        exito: true,
                        videoUrlHD: proxyUrl,
                        videoUrl: proxyUrl,
                        titulo: data.data.title || 'TikTok Video'
                    });
                }
            }
        } catch (e) {
            console.log('Error Método 1 TikTok:', e.message);
        }

        // Método 2: API de Loli
        try {
            const loliRes = await fetch(`https://api.lolihuman.xyz/api/tiktok?apikey=9b257262ed075388c1b960a0&url=${encodeURIComponent(resolvedUrl)}`);
            if (loliRes.ok) {
                const loliData = await loliRes.json();
                if (loliData.status === 200 && loliData.result) {
                    const videoUrl = loliData.result.link || loliData.result.no_watermark;
                    const proxyUrl = `/api/download-file?url=${encodeURIComponent(videoUrl)}&name=TikTok_Video.mp4`;

                    return res.json({
                        exito: true,
                        videoUrlHD: proxyUrl,
                        videoUrl: proxyUrl,
                        titulo: loliData.result.title || 'TikTok Video'
                    });
                }
            }
        } catch (e) {
            console.log('Error Método 2 TikTok:', e.message);
        }

        // Método 3: API RapidAPI con tus Claves Existentes
        for (let i = 0; i < API_KEYS.length; i++) {
            const key = getNextApiKey();
            try {
                const rapidTikTokRes = await fetch(`https://tiktok-downloader-download-tiktok-videos-without-watermark.p.rapidapi.com/index?url=${encodeURIComponent(resolvedUrl)}`, {
                    headers: {
                        'x-rapidapi-key': key,
                        'x-rapidapi-host': 'tiktok-downloader-download-tiktok-videos-without-watermark.p.rapidapi.com'
                    }
                });

                if (rapidTikTokRes.ok) {
                    const rapidData = await rapidTikTokRes.json();
                    const videoUrl = rapidData.video?.[0] || rapidData.play;
                    if (videoUrl) {
                        const proxyUrl = `/api/download-file?url=${encodeURIComponent(videoUrl)}&name=TikTok_Video.mp4`;
                        return res.json({
                            exito: true,
                            videoUrlHD: proxyUrl,
                            videoUrl: proxyUrl,
                            titulo: rapidData.description || 'TikTok Video'
                        });
                    }
                }
            } catch (e) {
                console.log(`Error RapidAPI TikTok Key [${i + 1}]`);
            }
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No se pudo procesar este enlace de TikTok. Intenta con el enlace completo desde el navegador.'
        });

    } catch (err) {
        console.error('Error TikTok:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en servidor al procesar TikTok.' });
    }
}

// ==========================================
// 3. PROCESAR PINTEREST
// ==========================================
async function procesarPinterest(inputUrl, res) {
    try {
        const url = await unshortenUrl(inputUrl);
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'es-ES,es;q=0.9'
            }
        });

        if (!response.ok) {
            return res.status(400).json({ exito: false, mensaje: 'No se pudo acceder a Pinterest.' });
        }

        const html = await response.text();

        const videoMatch = html.match(/https:\/\/[^"]+\.mp4/gi) || 
                           html.match(/"video_list":\{"V_720P":\{"url":"(https?:\/\/[^"]+)"/i) ||
                           html.match(/"url":"(https:\/\/v1\.pinimg\.com\/videos\/[^\"]+)"/i);

        if (videoMatch && videoMatch[0]) {
            let rawVideoUrl = videoMatch[0].replace(/\\/g, '');
            if (videoMatch[1]) rawVideoUrl = videoMatch[1].replace(/\\/g, '');

            const proxyUrl = `/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&name=Pinterest_Video.mp4`;

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
