const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Carpeta temporal para guardar las descargas
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}
app.use('/downloads', express.static(downloadsDir));

// --- ENDPOINT PRINCIPAL DE DESCARGA ---
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

// --- LÓGICA DE SPOTIFY (API DIRECTA SIN DEPENDER DE YT-DLP) ---
async function procesarSpotify(input, res) {
    let trackTitle = '';
    let artistName = '';
    let coverImage = '';

    try {
        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'URL de canción no válida.' });
        }
        const cleanUrl = `https://open.spotify.com/track/${match[1]}`;

        // 1. Obtener metadatos oficiales desde Spotify
        const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
        if (oembedRes.ok) {
            const oembedData = await oembedRes.json();
            trackTitle = oembedData.title || '';
            artistName = oembedData.author_name || '';
            coverImage = oembedData.thumbnail_url || '';
        }

        if (!trackTitle) {
            return res.status(400).json({ exito: false, mensaje: 'No se pudo leer la información de la canción.' });
        }

        // 2. Extraer el enlace directo MP3 vía API de conversión
        const downloadApiUrl = `https://api.fabdl.com/spotify/get?url=${encodeURIComponent(cleanUrl)}`;
        const apiRes = await fetch(downloadApiUrl);
        const apiData = await apiRes.json();

        if (apiData && apiData.result) {
            const gid = apiData.result.gid;
            const id = apiData.result.id;

            // Iniciar tarea de conversión
            const convertUrl = `https://api.fabdl.com/spotify/mp3-convert-task/${gid}/${id}`;
            const convertRes = await fetch(convertUrl);
            const convertData = await convertRes.json();

            if (convertData && convertData.result && convertData.result.download_url) {
                const finalAudioUrl = `https://api.fabdl.com${convertData.result.download_url}`;

                return res.json({
                    exito: true,
                    titulo: `${trackTitle} - ${artistName}`,
                    audioUrl: finalAudioUrl,
                    coverUrl: coverImage
                });
            }
        }

        // Respaldo vía iTunes si la API principal no devuelve archivo directo
        const searchRes = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(trackTitle + ' ' + artistName)}&entity=song&limit=1`);
        const searchData = await searchRes.json();

        if (searchData.results && searchData.results.length > 0) {
            return res.json({
                exito: true,
                titulo: `${trackTitle} - ${artistName}`,
                audioUrl: searchData.results[0].previewUrl,
                coverUrl: coverImage
            });
        }

        return res.status(400).json({ exito: false, mensaje: 'No se pudo obtener el enlace de descarga del audio.' });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar el audio de Spotify.' });
    }
}

// --- LÓGICA DE TIKTOK ---
async function procesarTikTok(url, res) {
    try {
        const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        if (data.code === 0 && data.data) {
            return res.json({
                exito: true,
                videoUrlHD: data.data.hdplay || data.data.play,
                videoUrl: data.data.play
            });
        }
        return res.status(400).json({ exito: false, mensaje: 'No se encontró el video de TikTok.' });
    } catch (err) {
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar TikTok.' });
    }
}

// --- LÓGICA DE PINTEREST ---
async function procesarPinterest(url, res) {
    try {
        const response = await fetch(`https://api.pinterestdownloader.com/download?url=${encodeURIComponent(url)}`);
        const data = await response.json();

        if (data && (data.url || data.video_url)) {
            const videoLink = data.video_url || data.url;
            return res.json({
                exito: true,
                videoUrlHD: videoLink,
                videoUrl: videoLink
            });
        }
        return res.status(400).json({ exito: false, mensaje: 'No se encontró contenido descargable en este Pin.' });
    } catch (err) {
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar Pinterest.' });
    }
}

app.listen(PORT, () => {
    console.log(`Servidor activo en http://localhost:${PORT}`);
});
