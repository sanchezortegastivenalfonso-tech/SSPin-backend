// server.js
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Función para resolver URLs acortadas (pin.it / vt.tiktok.com) a la URL final
async function resolverUrlFinal(urlOriginal) {
    try {
        const res = await axios.get(urlOriginal, {
            headers: { 'User-Agent': USER_AGENT },
            maxRedirects: 10,
            timeout: 8000
        });
        return res.request.res.responseUrl || urlOriginal;
    } catch (e) {
        return urlOriginal;
    }
}

// Extractor para TikTok
async function obtenerVideoTikTok(urlEntrada) {
    const urlFinal = await resolverUrlFinal(urlEntrada);

    // Intento 1: API Directa de TikWM
    try {
        const apiRes = await axios.post('https://www.tikwm.com/api/', 
            new URLSearchParams({ url: urlFinal, hd: '1' }).toString(), 
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
                timeout: 8000
            }
        );

        if (apiRes.data && apiRes.data.code === 0 && apiRes.data.data) {
            return {
                exito: true,
                videoUrl: apiRes.data.data.play
            };
        }
    } catch (err) {
        console.warn('TikWM falló, intentando SSSTik...');
    }

    // Intento 2: SSSTik
    try {
        const response = await axios.post('https://ssstik.io/abc?url=dl', 
            new URLSearchParams({ 'id': urlFinal, 'locale': 'es', 'tt': 'W1dSM3lh' }).toString(), 
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'User-Agent': USER_AGENT,
                    'Origin': 'https://ssstik.io',
                    'Referer': 'https://ssstik.io/es'
                },
                timeout: 8000
            }
        );

        const $ = cheerio.load(response.data);
        const downloadUrl = $('a.without_watermark').attr('href') || $('a.dl-button').attr('href');

        if (downloadUrl) {
            return { exito: true, videoUrl: downloadUrl };
        }
    } catch (err) {
        console.error('Error en TikTok:', err.message);
    }

    return null;
}

// Extractor para Pinterest
async function obtenerVideoPinterest(urlEntrada) {
    try {
        // Resolver pin.it a pinterest.com/pin/...
        const response = await axios.get(urlEntrada, {
            headers: { 'User-Agent': USER_AGENT },
            maxRedirects: 10
        });

        const html = response.data;
        const videoRegex = /"contentUrl":"(https:\/\/[^"]+\.mp4)"/;
        const match = html.match(videoRegex);

        if (match && match[1]) {
            const directVideoUrl = match[1].replace(/\\\//g, '/');
            return { exito: true, videoUrl: directVideoUrl };
        }
    } catch (error) {
        console.error('Error en Pinterest:', error.message);
    }

    return null;
}

// Endpoint Principal API
app.post('/api/descargar', async (req, res) => {
    const { url, plataforma } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'Debes proporcionar una URL.' });
    }

    const esPinterest = plataforma === 'pinterest' || url.includes('pin.it') || url.includes('pinterest');
    const esTikTok = plataforma === 'tiktok' || url.includes('vt.tiktok.com') || url.includes('tiktok.com');

    if (esPinterest) {
        const resultado = await obtenerVideoPinterest(url);
        if (resultado) {
            // Se envía a través del proxy para omitir bloqueos de reproductor
            const proxyUrl = `/api/proxy-download?url=${encodeURIComponent(resultado.videoUrl)}`;
            return res.json({ exito: true, videoUrl: proxyUrl });
        } else {
            return res.status(404).json({ error: 'No se encontró un video en este Pin.' });
        }
    } 
    
    if (esTikTok) {
        const resultado = await obtenerVideoTikTok(url);
        if (resultado) {
            return res.json(resultado);
        } else {
            return res.status(404).json({ error: 'No se pudo obtener el video de TikTok. Revisa la URL.' });
        }
    }

    return res.status(400).json({ error: 'URL no compatible.' });
});

// Proxy de transmisión
app.get('/api/proxy-download', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('URL no proporcionada');

    try {
        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'stream',
            headers: {
                'User-Agent': USER_AGENT,
                'Referer': 'https://www.pinterest.com/'
            }
        });

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Disposition', 'inline; filename="video_pinterest.mp4"');
        response.data.pipe(res);
    } catch (error) {
        console.error('Error en proxy:', error.message);
        res.status(500).send('Error al transmitir el video.');
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});