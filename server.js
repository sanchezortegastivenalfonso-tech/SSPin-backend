const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// LISTA Y ROTACIÓN DE LAS API KEYS (SPOTIFY)
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

// Proxy de descarga directa
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
// PROCESAR TIKTOK (Soporte Multi-API para vt.tiktok.com)
// ==========================================
async function procesarTikTok(inputUrl, res) {
    try {
        const cleanUrl = inputUrl.trim();

        // 1. Proveedor 1: TikWM API vía GET con User-Agent emulado
        try {
            const resTikwm = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(cleanUrl)}&hd=1`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
                    'Accept': 'application/json, text/plain, */*'
                }
            });

            if (resTikwm.ok) {
                const data = await resTikwm.json();
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
            console.log('Falló proveedor 1 (TikWM GET):', e.message);
        }

        // 2. Proveedor 2: API Delirius / tiktod
        try {
            const resDelirius = await fetch(`https://deliriussapi-official.vercel.app/download/tiktok?url=${encodeURIComponent(cleanUrl)}`);
            if (resDelirius.ok) {
                const dataDelirius = await resDelirius.json();
                if (dataDelirius.status && dataDelirius.data) {
                    const mediaList = dataDelirius.data.meta?.media || [];
                    const videoObj = mediaList.find(m => m.type === 'video') || mediaList[0];
                    const videoUrl = videoObj?.org || videoObj?.url;

                    if (videoUrl) {
                        const proxyUrl = `/api/download-file?url=${encodeURIComponent(videoUrl)}&name=TikTok_Video.mp4`;
                        return res.json({
                            exito: true,
                            videoUrlHD: proxyUrl,
                            videoUrl: proxyUrl,
                            titulo: dataDelirius.data.title || 'TikTok Video'
                        });
                    }
                }
            }
        } catch (e) {
            console.log('Falló proveedor 2 (Delirius):', e.message);
        }

        // 3. Proveedor 3: API Lovid / SaveTik
        try {
            const resLovid = await fetch(`https://api.tiklydown.eu.org/api/download?url=${encodeURIComponent(cleanUrl)}`);
            if (resLovid.ok) {
                const dataLovid = await resLovid.json();
                const videoUrl = dataLovid.video?.noWatermark || dataLovid.video?.watermark;
                if (videoUrl) {
                    const proxyUrl = `/api/download-file?url=${encodeURIComponent(videoUrl)}&name=TikTok_Video.mp4`;
                    return res.json({
                        exito: true,
                        videoUrlHD: proxyUrl,
                        videoUrl: proxyUrl,
                        titulo: dataLovid.title || 'TikTok Video'
                    });
                }
            }
        } catch (e) {
            console.log('Falló proveedor 3 (Tiklydown):', e.message);
        }

        // 4. Proveedor 4: SSSTik (Form POST)
        try {
            const ssstikRes = await fetch('https://ssstik.io/abc?url=dl', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                },
                body: new URLSearchParams({ id: cleanUrl, locale: 'es', tt: '0' })
            });

            if (ssstikRes.ok) {
                const html = await ssstikRes.text();
                const linkMatch = html.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/i) || html.match(/href="(https:\/\/tikcdn\.io\/[^"]+)"/i);
                if (linkMatch && linkMatch[1]) {
                    const proxyUrl = `/api/download-file?url=${encodeURIComponent(linkMatch[1])}&name=TikTok_Video.mp4`;
                    return res.json({
                        exito: true,
                        videoUrlHD: proxyUrl,
                        videoUrl: proxyUrl,
                        titulo: 'TikTok Video'
                    });
                }
            }
        } catch (e) {
            console.log('Falló proveedor 4 (SSSTik):', e.message);
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No se pudo obtener el video de TikTok. Intenta con un enlace normal o más tarde.'
        });

    } catch (err) {
        console.error('Error general TikTok:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en el servidor.' });
    }
}
// ==========================================
// 3. PROCESAR PINTEREST
// ==========================================
async function procesarPinterest(inputUrl, res) {
    try {
        const response = await fetch(inputUrl, {
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
