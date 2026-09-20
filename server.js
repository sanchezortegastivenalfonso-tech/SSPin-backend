const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Carpeta temporal de descargas
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
}
app.use('/downloads', express.static(downloadsDir));

app.post('/api/descargar', async (req, res) => {
    const { url, plataforma } = req.body;

    if (!url) {
        return res.status(400).json({ exito: false, mensaje: 'Debes proporcionar un enlace válido.' });
    }

    try {
        if (plataforma === 'spotify') {
            return await procesarSpotify(url, req, res);
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

async function procesarSpotify(input, req, res) {
    try {
        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'Enlace de Spotify no válido.' });
        }
        const trackId = match[1];
        const cleanUrl = `https://open.spotify.com/track/${trackId}`;

        // 1. Obtener metadatos reales de Spotify
        let trackTitle = '';
        let artistName = '';
        let coverImage = '';

        try {
            const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
            if (oembedRes.ok) {
                const oembedData = await oembedRes.json();
                trackTitle = oembedData.title || '';
                artistName = oembedData.author_name || '';
                coverImage = oembedData.thumbnail_url || '';
            }
        } catch (e) {
            console.log('Error oEmbed:', e.message);
        }

        const searchQuery = trackTitle ? `${trackTitle} ${artistName}` : cleanUrl;
        const timestamp = Date.now();
        const outputFilename = `spotify_${timestamp}.mp3`;
        const outputPath = path.join(downloadsDir, outputFilename);

        // Detectar si yt-dlp está en la raíz del proyecto o en el sistema
        const ytdlpBin = fs.existsSync(path.join(__dirname, 'yt-dlp')) ? './yt-dlp' : 'yt-dlp';

        // Comando yt-dlp optimizado con User-Agent de navegador para bypass de bloqueo 403
        const command = `${ytdlpBin} "ytsearch1:${searchQuery}" --user-agent "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" --no-playlist`;

        exec(command, (error, stdout, stderr) => {
            if (error || !fs.existsSync(outputPath)) {
                console.error('Error al extraer audio con yt-dlp:', stderr || error.message);
                return res.status(500).json({ 
                    exito: false, 
                    mensaje: 'No se pudo procesar la canción de Spotify. Intenta nuevamente.' 
                });
            }

            // Generar enlace directo del servidor
            const protocol = req.headers['x-forwarded-proto'] || req.protocol;
            const host = req.get('host');
            const fileUrl = `${protocol}://${host}/downloads/${outputFilename}`;

            // Auto-eliminar archivo del servidor a los 10 minutos
            setTimeout(() => {
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            }, 10 * 60 * 1000);

            return res.json({
                exito: true,
                titulo: trackTitle ? `${trackTitle} - ${artistName}` : 'Audio Descargado',
                audioUrl: fileUrl,
                coverUrl: coverImage
            });
        });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar la canción.' });
    }
}

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
        return res.status(400).json({ exito: false, mensaje: 'No se encontró el contenido de Pinterest.' });
    } catch (err) {
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar Pinterest.' });
    }
}

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
