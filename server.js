// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Endpoint proxy para forzar la descarga de videos (Pinterest, TikTok e Instagram)
app.get('/api/proxy-download', async (req, res) => {
    const videoUrl = req.query.url;
    const customFilename = req.query.filename || 'video_mediaflow.mp4';

    if (!videoUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    try {
        // Asignar el Referer adecuado según la plataforma detectada en la URL del recurso
        let refererHeader = 'https://www.tiktok.com/';
        if (videoUrl.includes('pinimg.com') || videoUrl.includes('pinterest')) {
            refererHeader = 'https://www.pinterest.com/';
        } else if (videoUrl.includes('cdninstagram.com') || videoUrl.includes('instagram')) {
            refererHeader = 'https://www.instagram.com/';
        }

        const response = await axios({
            method: 'GET',
            url: videoUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Referer': refererHeader
            }
        });

        // Forzar la descarga del archivo en el navegador
        res.setHeader('Content-Disposition', `attachment; filename="${customFilename}"`);
        res.setHeader('Content-Type', 'video/mp4');

        // Canalizar el flujo de datos directamente al cliente
        response.data.pipe(res);
    } catch (error) {
        console.error('Error en proxy-download:', error.message);
        res.status(500).send('No se pudo procesar la descarga del archivo.');
    }
});

// Endpoint principal para procesar las solicitudes desde el frontend
app.post('/api/descargar', async (req, res) => {
    const { url, plataforma } = req.body;

    if (!url) {
        return res.status(400).json({ exito: false, mensaje: 'Proporciona un enlace válido.' });
    }

    try {
        // Lógica de extracción según la plataforma
        // Reemplazar con la integración o API correspondiente para TikTok, Pinterest e Instagram
        
        return res.json({
            exito: true,
            videoUrlHD: 'URL_DEL_VIDEO_HD',
            videoUrl: 'URL_DEL_VIDEO_SD'
        });
    } catch (error) {
        console.error(`Error procesando enlace de ${plataforma}:`, error.message);
        return res.status(500).json({
            exito: false,
            mensaje: 'No se pudo obtener el video. Intenta con otro enlace.'
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
