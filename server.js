const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// ==========================================
// DESGLOSAR Y EXPANDIR URLS
// ==========================================
async function desglosarUrl(shortUrl) {
    try {
        const response = await axios.get(shortUrl, {
            maxRedirects: 5,
            headers: { 'User-Agent': USER_AGENT }
        });
        return response.request.res.responseUrl || shortUrl;
    } catch (e) {
        if (e.response && e.response.headers && e.response.headers.location) {
            return e.response.headers.location.split('?')[0];
        }
        return shortUrl;
    }
}

// ==========================================
// PROXY DE DESCARGA DIRECTA
// ==========================================
app.get('/api/download-file', async (req, res) => {
    const fileUrl = req.query.url;
    let fileName = req.query.name || 'archivo_media';

    if (!fileUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    try {
        const response = await axios.get(fileUrl, {
            responseType: 'arraybuffer',
            headers: { 'User-Agent': USER_AGENT },
            timeout: 40000
        });

        const contentType = response.headers['content-type'] || 'application/octet-stream';

        if (!fileName.includes('.')) {
            fileName += contentType.includes('video') ? '.mp4' : '.mp3';
        }

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', response.data.length);

        return res.send(Buffer.from(response.data));

    } catch (error) {
        console.error('Error enviando archivo vía proxy:', error.message);
        return res.status(500).send('Error al descargar el archivo.');
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
        if (input.includes('spotify.link')) {
            input = await desglosarUrl(input);
        }

        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'URL de Spotify no válida.' });
        }
        const trackId = match[1];
        const cleanUrl = `https://open.spotify.com/track/${trackId}`;

        let trackTitle = '';
        let artistName = '';
        let coverImage = '';

        try {
            const oembedRes = await axios.get(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
            if (oembedRes.data) {
                trackTitle = oembedRes.data.title || '';
                artistName = oembedRes.data.author_name || '';
                coverImage = oembedRes.data.thumbnail_url || '';
            }
        } catch (e) {
            console.log('Error oEmbed Spotify:', e.message);
        }

        const titleCombined = artistName ? `${trackTitle} - ${artistName}` : (trackTitle || 'Spotify Track');
        const query = `${trackTitle} ${artistName}`.trim();

        // MOTOR 1: J2DOWNLOAD / API Directa alternativa
        try {
            const j2Res = await axios.get(`https://api.v2.fabdl.com/spotify/get?url=${encodeURIComponent(cleanUrl)}`, {
                headers: { 'User-Agent': USER_AGENT },
                timeout: 10000
            });

            if (j2Res.data && j2Res.data.result && j2Res.data.result.gid) {
                const gid = j2Res.data.result.gid;
                const id = j2Res.data.result.id;

                const convertRes = await axios.get(`https://api.v2.fabdl.com/spotify/mp3-convert-task/${gid}/${id}`, {
                    headers: { 'User-Agent': USER_AGENT },
                    timeout: 15000
                });

                if (convertRes.data && convertRes.data.result && convertRes.data.result.download_url) {
                    const downloadLink = `https://api.v2.fabdl.com${convertRes.data.result.download_url}`;
                    return res.json({
                        exito: true,
                        titulo: titleCombined,
                        coverUrl: coverImage,
                        audioUrl: `/api/download-file?url=${encodeURIComponent(downloadLink)}&name=${encodeURIComponent(titleCombined)}.mp3`
                    });
                }
            }
        } catch (e) {
            console.log('Motor 1 (FabDL) falló:', e.message);
        }

        // MOTOR 2: Spotimate Web Direct
        try {
            const spotRes = await axios.post('https://spotimate.com/action', 
                `url=${encodeURIComponent(cleanUrl)}`, 
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                        'User-Agent': USER_AGENT,
                        'Referer': 'https://spotimate.com/'
                    },
                    timeout: 10000
                }
            );

            if (spotRes.data && spotRes.data.status && spotRes.data.url) {
                return res.json({
                    exito: true,
                    titulo: titleCombined,
                    coverUrl: coverImage,
                    audioUrl: `/api/download-file?url=${encodeURIComponent(spotRes.data.url)}&name=${encodeURIComponent(titleCombined)}.mp3`
                });
            }
        } catch (e) {
            console.log('Motor 2 (Spotimate) falló:', e.message);
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'No se pudo descargar de Spotify por restricciones de servidor. Inténtalo con TikTok.'
        });

    } catch (e) {
        console.error('Error Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno procesando Spotify.' });
    }
}

// ==========================================
// 2. LÓGICA TIKTOK (SOLUCIÓN ERROR 403)
// ==========================================
async function procesarTikTok(inputUrl, res) {
    try {
        let cleanUrl = inputUrl.trim();

        if (cleanUrl.includes('vt.tiktok.com') || cleanUrl.includes('vm.tiktok.com')) {
            cleanUrl = await desglosarUrl(cleanUrl);
        }

        // MOTOR 1: SSSTik API (Inmune a bloqueos 403)
        try {
            const params = new URLSearchParams();
            params.append('id', cleanUrl);
            params.append('locale', 'es');
            params.append('tt', 'RFBzT241');

            const sssRes = await axios.post('https://ssstik.io/abc?url=dl', params, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'User-Agent': USER_AGENT,
                    'Origin': 'https://ssstik.io',
                    'Referer': 'https://ssstik.io/es'
                },
                timeout: 10000
            });

            const html = sssRes.data;
            const videoMatch = html.match(/href="(https:\/\/[^"]+\.ssstik\.io[^"]+)"/i) || html.match(/href="(https:\/\/[^"]+tik-cdn[^"]+)"/i);

            if (videoMatch && videoMatch[1]) {
                return res.json({
                    exito: true,
                    videoUrlHD: `/api/download-file?url=${encodeURIComponent(videoMatch[1])}&name=TikTok_Video.mp4`,
                    videoUrl: `/api/download-file?url=${encodeURIComponent(videoMatch[1])}&name=TikTok_Video.mp4`,
                    titulo: 'TikTok Video'
                });
            }
        } catch (e) {
            console.log('TikTok SSSTik falló:', e.message);
        }

        // MOTOR 2: TikWM API
        try {
            const formData = new URLSearchParams();
            formData.append('url', cleanUrl);
            formData.append('hd', '1');

            const response = await axios.post('https://www.tikwm.com/api/', formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': USER_AGENT
                },
                timeout: 10000
            });

            if (response.data && response.data.data) {
                const data = response.data.data;
                const videoUrl = data.hdplay || data.play;
                const finalUrl = videoUrl.startsWith('http') ? videoUrl : `https://www.tikwm.com${videoUrl}`;
                const title = data.title || 'TikTok_Video';

                return res.json({
                    exito: true,
                    videoUrlHD: `/api/download-file?url=${encodeURIComponent(finalUrl)}&name=${encodeURIComponent(title)}.mp4`,
                    videoUrl: `/api/download-file?url=${encodeURIComponent(finalUrl)}&name=${encodeURIComponent(title)}.mp4`,
                    titulo: title
                });
            }
        } catch (e) {
            console.log('TikTok TikWM falló:', e.message);
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
            headers: { 'User-Agent': USER_AGENT },
            timeout: 10000
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

        return res.status(400).json({ exito: false, mensaje: 'Este Pin no contiene un video válido.' });
    } catch (err) {
        console.error('Error Pinterest:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en Pinterest.' });
    }
}

app.listen(PORT, () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
});
