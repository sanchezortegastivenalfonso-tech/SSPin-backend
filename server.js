const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
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

// --- LÓGICA DE SPOTIFY ---
async function procesarSpotify(input, res) {
    let trackTitle = '';
    let coverImage = '';

    try {
        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'URL de canción no válida.' });
        }
        const cleanUrl = `https://open.spotify.com/track/${match[1]}`;

        // Intentar obtener metadatos vía oEmbed
        const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
        if (oembedRes.ok) {
            const oembedData = await oembedRes.json();
            trackTitle = oembedData.title || '';
            coverImage = oembedData.thumbnail_url || '';
        }

        // Fallback: Si oembed no devuelve título, extraer del HTML (meta tags)
        if (!trackTitle) {
            const htmlRes = await fetch(cleanUrl);
            const html = await htmlRes.text();
            const titleMatch = html.match(/<property="og:title" content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) {
                trackTitle = titleMatch[1].replace(' | Spotify', '').replace(' - song and lyrics by Spotify', '');
            }
        }
    } catch (e) {
        console.log('Error metadatos:', e.message);
    }

    if (!trackTitle) {
        return res.status(400).json({ exito: false, mensaje: 'No se pudo leer la información de la canción.' });
    }

    const fileId = `song_${Date.now()}`;
    const outputFilePath = path.join(downloadsDir, `${fileId}.mp3`);
    
    // Comando multiplataforma (funciona en Linux/Render y Windows si yt-dlp está instalado)
    const command = `npx yt-dlp -x --audio-format mp3 --ffmpeg-location "${ffmpegPath}" -o "${downloadsDir}/${fileId}.%(ext)s" "ytsearch1:${trackTitle}"`;

    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error('Error al ejecutar yt-dlp:', error.message);
            console.error('Stderr:', stderr);
            return res.status(500).json({ 
                exito: false, 
                mensaje: 'Error al procesar el audio con yt-dlp.' 
            });
        }

        return res.json({
            exito: true,
            titulo: trackTitle,
            audioUrl: `/downloads/${fileId}.mp3`,
            coverUrl: coverImage
        });
    });
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
