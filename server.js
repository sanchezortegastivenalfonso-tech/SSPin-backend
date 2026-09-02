// server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();

app.use(cors());
app.use(express.json());

// Endpoint principal para procesar enlaces
app.post('/api/descargar', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ exito: false, mensaje: 'Por favor ingresa un enlace.' });
    }

    try {
        // --- TIKTOK ---
        if (url.includes('tiktok.com')) {
            const response = await axios.post('https://www.tikwm.com/api/', new URLSearchParams({
                url: url,
                hd: '1'
            }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });

            const data = response.data;

            if (data && data.code === 0 && data.data) {
                // Usamos la URL de play directo o redirección libre de marca de agua
                const playUrl = data.data.play;
                const playUrlHD = data.data.hdplay ? `https://www.tikwm.com${data.data.hdplay}` : playUrl;

                return res.json({
                    exito: true,
                    videoUrl: playUrl,
                    videoUrlHD: playUrlHD,
                    titulo: data.data.title || 'Video de TikTok'
                });
            } else {
                return res.json({ exito: false, mensaje: 'No se pudo obtener el video de TikTok. Revisa el enlace.' });
            }
        }

        // --- PINTEREST ---
        if (url.includes('pin.it') || url.includes('pinterest.com')) {
            // Seguir redirecciones si es un enlace corto (pin.it)
            const response = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Language': 'en-US,en;q=0.9'
                },
                maxRedirects: 5
            });

            const html = response.data;

            // Intentar buscar video en metadatos OpenGraph de Pinterest
            let videoMatch = html.match(/<meta property="og:video:secure_url" content="([^"]+)"/) ||
                             html.match(/<meta property="og:video" content="([^"]+)"/) ||
                             html.match(/https:\/\/v1\.pinimg\.com\/videos\/mc\/[^\s"]+\.mp4/);

            if (videoMatch && videoMatch[1]) {
                let directUrl = videoMatch[1].replace(/&amp;/g, '&');
                return res.json({
                    exito: true,
                    videoUrl: directUrl,
                    videoUrlHD: directUrl,
                    titulo: 'Video de Pinterest'
                });
            } else if (videoMatch && videoMatch[0]) {
                return res.json({
                    exito: true,
                    videoUrl: videoMatch[0],
                    videoUrlHD: videoMatch[0],
                    titulo: 'Video de Pinterest'
                });
            } else {
                return res.json({ exito: false, mensaje: 'No se encontró un archivo de video en esta publicación de Pinterest.' });
            }
        }

        return res.json({ exito: false, mensaje: 'Enlace no soportado. Revisa que sea de TikTok o Pinterest.' });

    } catch (error) {
        console.error('Error al procesar la solicitud:', error.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno en el servidor.' });
    }
});

// Endpoint proxy para forzar la descarga de archivos sin problemas de CORS/Descarga bloqueada
app.get('/api/proxy-download', async (req, res) => {
    const fileUrl = req.query.url;
    if (!fileUrl) {
        return res.status(400).send('URL requerida');
    }

    try {
        const response = await axios({
            method: 'get',
            url: fileUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        res.setHeader('Content-Disposition', 'attachment; filename="video.mp4"');
        res.setHeader('Content-Type', 'video/mp4');
        response.data.pipe(res);
    } catch (err) {
        console.error('Error en descarga de video:', err.message);
        res.status(500).send('Error descargando el video');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor activo en el puerto ${PORT}`);
});
