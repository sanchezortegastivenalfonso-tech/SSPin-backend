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

// Carpeta temporal para almacenar audios
const downloadsDir = path.join(__dirname, 'downloads');
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir, { recursive: true });
}
app.use('/downloads', express.static(downloadsDir));

// --- ENDPOINT PRINCIPAL ---
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

// --- LÓGICA DE SPOTIFY (DESCARGA DIRECTA Y PROXY DE ARCHIVO) ---
async function procesarSpotify(input, req, res) {
    try {
        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'Enlace de Spotify no válido.' });
        }
        const trackId = match[1];
        const cleanUrl = `https://open.spotify.com/track/${trackId}`;

        // 1. Obtener metadatos oficiales de la canción
        let trackTitle = 'Cancion_Spotify';
        let coverImage = '';
        try {
            const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
            if (oembedRes.ok) {
                const oembedData = await oembedRes.json();
                if (oembedData.title) trackTitle = oembedData.title.replace(/[/\\?%*:|"<>]/g, '');
                if (oembedData.thumbnail_url) coverImage = oembedData.thumbnail_url;
            }
        } catch (e) {
            console.log('Error oEmbed:', e.message);
        }

        // 2. Pedir la URL directa del MP3 a la API pública de Cobalt
        const cobaltRes = await fetch('https://api.cobalt.tools/', {
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

        const cobaltData = await cobaltRes.json();

        if (!cobaltRes.ok || !cobaltData.url) {
            return res.status(400).json({ 
                exito: false, 
                mensaje: 'No se pudo procesar la canción de Spotify. Intenta nuevamente.' 
            });
        }

        // 3. DESCARGAR EL ARCHIVO MP3 EN TU PROPIO SERVIDOR
        // Esto evita que el usuario navegue a otra página o sea redirigido
        const audioStreamRes = await fetch(cobaltData.url);
        if (!audioStreamRes.ok) {
            return res.status(500).json({ exito: false, mensaje: 'Error al transferir el archivo de audio.' });
        }

        const fileName = `spotify_${Date.now()}.mp3`;
        const filePath = path.join(downloadsDir, fileName);
        const fileStream = fs.createWriteStream(filePath);

        await new Promise((resolve, reject) => {
            audioStreamRes.body.pipe(fileStream);
            audioStreamRes.body.on('error', reject);
            fileStream.on('finish', resolve);
        });

        // 4. Retornar la URL directa alojada en TU servidor Render
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const localAudioUrl = `${protocol}://${host}/downloads/${fileName}`;

        // Limpiar archivo del servidor pasados 10 minutos
        setTimeout(() => {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }, 10 * 60 * 1000);

        return res.json({
            exito: true,
            titulo: trackTitle,
            audioUrl: localAudioUrl,
            coverUrl: coverImage
        });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al descargar la canción.' });
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
        return res.status(400).json({ exito: false, mensaje: 'No se encontró el contenido de Pinterest.' });
    } catch (err) {
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar Pinterest.' });
    }
}

app.listen(PORT, () => console.log(`Servidor escuchando en puerto ${PORT}`));
