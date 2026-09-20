const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Expandir enlaces acortados (vt.tiktok.com, pin.it, etc.)
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

// Endpoint principal
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

// Proxy para forzar descarga directa
app.get('/api/download-file', async (req, res) => {
    const fileUrl = req.query.url;
    let fileName = req.query.name || 'archivo_media';

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
// 1. PROCESAR SPOTIFY (Extracción vía YouTube Search)
// ==========================================
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

        // Obtenemos título y artista original desde la API de Spotify OEMBED
        try {
            const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
            if (oembedRes.ok) {
                const oembedData = await oembedRes.json();
                trackTitle = oembedData.title || '';
                artistName = oembedData.author_name || '';
                coverImage = oembedData.thumbnail_url || '';
            }
        } catch (e) {
            console.log('Error metadatos oembed:', e.message);
        }

        if (!trackTitle) {
            return res.status(400).json({ exito: false, mensaje: 'No se pudo leer la canción de Spotify.' });
        }

        const searchQuery = `${trackTitle} ${artistName} audio`;
        const titleCombined = artistName ? `${trackTitle} - ${artistName}` : trackTitle;

        // Búsqueda del audio en YouTube mediante API pública limpia
        const ytSearchUrl = `https://pipe.piped.projectsegfau.lt/search?q=${encodeURIComponent(searchQuery)}&filter=videos`;
        const ytRes = await fetch(ytSearchUrl);
        
        if (!ytRes.ok) {
            return res.status(400).json({ exito: false, mensaje: 'No se pudo encontrar el audio coincidente.' });
        }

        const ytData = await ytRes.json();
        const firstVideo = ytData.items && ytData.items[0];

        if (!firstVideo || !firstVideo.url) {
            return res.status(400).json({ exito: false, mensaje: 'No se encontró la canción en el catálogo.' });
        }

        const ytVideoUrl = `https://www.youtube.com${firstVideo.url}`;

        // Obtener enlace directo MP3 usando servidor de descarga
        const convertRes = await fetch('https://cobalt.tools/api/json', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0'
            },
            body: JSON.stringify({
                url: ytVideoUrl,
                downloadMode: 'audio',
                audioFormat: 'mp3'
            })
        });

        if (convertRes.ok) {
            const convertData = await convertRes.json();
            if (convertData.url) {
                const directDownloadProxyUrl = `/api/download-file?url=${encodeURIComponent(convertData.url)}&name=${encodeURIComponent(titleCombined)}.mp3`;

                return res.json({
                    exito: true,
                    titulo: titleCombined,
                    coverUrl: coverImage,
                    audioUrl: directDownloadProxyUrl
                });
            }
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'El servidor de audio está congestionado. Intenta de nuevo en un momento.'
        });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar la canción.' });
    }
}

// ==========================================
// 2. PROCESAR TIKTOK
// ==========================================
async function procesarTikTok(url, res) {
    try {
        const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'application/json'
            }
        });
        
        const contentType = response.headers.get('content-type') || '';
        
        if (response.ok && contentType.includes('application/json')) {
            const data = await response.json();
            if (data.code === 0 && data.data) {
                const videoHD = data.data.hdplay ? (data.data.hdplay.startsWith('http') ? data.data.hdplay : `https://tikwm.com${data.data.hdplay}`) : null;
                const videoSD = data.data.play ? (data.data.play.startsWith('http') ? data.data.play : `https://tikwm.com${data.data.play}`) : null;
                const mainVideo = videoHD || videoSD;

                if (mainVideo) {
                    const proxyHD = `/api/download-file?url=${encodeURIComponent(videoHD || mainVideo)}&name=TikTok_HD.mp4`;
                    const proxySD = `/api/download-file?url=${encodeURIComponent(videoSD || mainVideo)}&name=TikTok_SD.mp4`;

                    return res.json({
                        exito: true,
                        videoUrlHD: proxyHD,
                        videoUrl: proxySD,
                        titulo: data.data.title || 'TikTok Video'
                    });
                }
            }
        }

        return res.status(400).json({ exito: false, mensaje: 'No se pudo procesar este enlace de TikTok.' });
    } catch (err) {
        console.error('Error TikTok:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar el video de TikTok.' });
    }
}

// ==========================================
// 3. PROCESAR PINTEREST
// ==========================================
async function procesarPinterest(url, res) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'es-ES,es;q=0.9'
            }
        });

        if (!response.ok) {
            return res.status(400).json({ exito: false, mensaje: 'No se pudo acceder al enlace de Pinterest.' });
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

        return res.status(400).json({ exito: false, mensaje: 'Este Pin no contiene un video válido para descargar.' });
    } catch (err) {
        console.error('Error Pinterest:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno procesando Pinterest.' });
    }
}

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
