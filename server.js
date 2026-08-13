// server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/descargar', async (req, res) => {
    const { url } = req.body;

    if (!url || !url.includes('pin')) {
        return res.status(400).json({ error: 'URL de Pinterest no válida.' });
    }

    try {
        const response = await axios.get(url);
        const html = response.data;
        
        const videoRegex = /"contentUrl":"(https:\/\/[^"]+\.mp4)"/;
        const match = html.match(videoRegex);

        if (match && match[1]) {
            const videoUrl = match[1].replace(/\\\//g, '/');
            return res.json({ exito: true, videoUrl: videoUrl });
        } else {
            return res.status(404).json({ error: 'No se encontró un video en este Pin.' });
        }

    } catch (error) {
        return res.status(500).json({ error: 'Error al procesar el enlace.' });
    }
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});