// server.js
// Asegúrate de tener axios importado: const axios = require('axios');

app.get('/api/proxy-download', async (req, res) => {
    const videoUrl = req.query.url;
    if (!videoUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    try {
        const response = await axios({
            method: 'GET',
            url: videoUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
                'Referer': 'https://www.tiktok.com/'
            }
        });

        // Forzar cabeceras para que el navegador lo descargue como archivo
        res.setHeader('Content-Disposition', 'attachment; filename="video_descargado.mp4"');
        res.setHeader('Content-Type', 'video/mp4');

        // Canalizar el stream directamente al cliente
        response.data.pipe(res);
    } catch (error) {
        console.error('Error en proxy-download:', error.message);
        res.status(500).send('No se pudo procesar la descarga del archivo.');
    }
});
