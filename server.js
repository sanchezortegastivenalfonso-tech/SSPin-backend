// server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(express.json());

app.post('/api/descargar', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ exito: false, mensaje: 'Por favor ingresa un enlace.' });
    }

    try {
        // --- LÓGICA TIKTOK ---
        if (url.includes('tiktok.com')) {
            const response = await axios.post('https://www.tikwm.com/api/', new URLSearchParams({
                url: url,
                hd: '1'
            }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                }
            });

            const data = response.data;

            if (data && data.code === 0 && data.data) {
                const videoUrl = data.data.play;
                const videoUrlHD = data.data.hdplay ? `https://www.tikwm.com${data.data.hdplay}` : videoUrl;

                return res.json({
                    exito: true,
                    videoUrl: videoUrl,
                    videoUrlHD: videoUrlHD,
                    titulo: data.data.title || 'Video de TikTok'
                });
            } else {
                return res.json({ exito: false, mensaje: 'No se pudo obtener el video de TikTok.' });
            }
        }

        // --- LÓGICA PINTEREST ---
        if (url.includes('pin.it') || url.includes('pinterest.com')) {
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            const html = response.data;
            const match = html.match(/https:\/\/v1\.pinimg\.com\/videos\/mc\/[^\s"]+\.mp4/);

            if (match) {
                return res.json({
                    exito: true,
                    videoUrl: match[0],
                    videoUrlHD: match[0]
                });
            } else {
                return res.json({ exito: false, mensaje: 'No se encontró un video en esta publicación.' });
            }
        }

        return res.json({ exito: false, mensaje: 'Enlace no soportado.' });

    } catch (error) {
        console.error('Error en el servidor:', error.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en el servidor.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
});
