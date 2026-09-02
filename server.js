// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Habilitar CORS con exposición de cabeceras para descargas fluidas
app.use(cors({
    origin: '*',
    exposedHeaders: ['Content-Disposition']
}));

app.use(express.json());

// Endpoint proxy para servir o forzar la descarga de videos evitando restricciones CORS/Referer
app.get('/api/proxy-download', async (req, res) => {
    const videoUrl = req.query.url;

    if (!videoUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    try {
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

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');

        response.data.pipe(res);
    } catch (error) {
        console.error('Error en proxy-download:', error.message);
        res.status(500).send('No se pudo procesar la descarga del archivo.');
    }
});

// Endpoint de procesamiento de enlaces
app.post('/api/descargar', async (req, res) => {
    const { url, plataforma } = req.body;

    if (!url) {
        return res.status(400).json({ exito: false, mensaje: 'Proporciona un enlace válido.' });
    }

    try {
        // Aquí conectas con tu extractor/API específica según la plataforma
        // Ejemplo de respuesta estructurada:
        return res.json({
            exito: true,
            videoUrlHD: 'https://ejemplo.com/video_hd.mp4',
            videoUrl: 'https://ejemplo.com/video_sd.mp4'
        });
    } catch (error) {
        console.error(`Error procesando enlace de ${plataforma}:`, error.message);
        return res.status(500).json({
            exito: false,
            mensaje: 'No se pudo obtener el video. Verifica la URL introducida.'
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
});
