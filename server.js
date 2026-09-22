const express = require('express');
const cors = require('cors');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// LISTA Y ROTACIÓN DE LAS 6 API KEYS (SPOTIFY)
// ==========================================
const API_KEYS = [
    '557d5c69acmsh8683894f452d382p1001c0jsnc7f52c75f038', // Clave original
    'd57a57f0e6msh60d33aa70fd4bfap142a4ejsn3dd732d92d81', // Primera nueva
    'cfe9f96619msh2bf6f1ef96b6f5dp1ca3b8jsn55c76c99edbb', // Segunda nueva
    'ff647c7411msh1f8a4b925654801p17bfa0jsn43708a13c350', // Tercera nueva
    '662e02b486msh639f823b995cba3p1a1e83jsn3419c2db929d', // Cuarta nueva
    '9652174c07msh5a18f10e100709cp1f0e56jsna7079cb837cf'  // Quinta nueva
];

let currentKeyIndex = 0;

// Obtener la siguiente clave en ciclo
function getNextApiKey() {
    const key = API_KEYS[currentKeyIndex];
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    return key;
}

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// Expandir enlaces acortados genéricos
async function expandirUrl(shortUrl) {
    try {
        const response = await fetch(shortUrl, {
            method: 'GET',
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        return response.url || shortUrl;
    } catch (e) {
        return shortUrl;
    }
}

// Endpoint principal
app.post('/api/descargar', async (req, res) => {
    let { url, plataforma } = req.body;

    if (!url) {
        return res.status(400).json({ exito: false, mensaje: 'Debes proporcionar un enlace válido.' });
    }

    try {
        url = await expandirUrl(url.trim());

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

// Proxy para forzar descarga directa en el navegador
app.get('/api/download-file', async (req, res) => {
    const fileUrl = req.query.url;
    let fileName = req.query.name || 'archivo_media';

    if (!fileUrl) {
        return res.status(400).send('URL no proporcionada');
    }

    try {
        const response = await fetch(fileUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            return res.status(500).send('Error al obtener el archivo fuente');
        }

        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        
        if (!fileName.includes('.')) {
            if (contentType.includes('audio') || contentType.includes('mpeg')) {
                fileName += '.mp3';
            } else {
                fileName += '.mp4';
            }
        }

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Type', contentType);

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        res.send(buffer);
    } catch (error) {
        console.error('Error proxy descarga:', error.message);
        res.status(500).send('Error al procesar la descarga directa');
    }
});

// ==========================================
// 1. PROCESAR SPOTIFY (Rotación de 6 Keys)
// ==========================================
async function procesarSpotify(input, res) {
    try {
        const match = input.match(/track\/([a-zA-Z0-9]+)/);
        if (!match) {
            return res.status(400).json({ exito: false, mensaje: 'URL de Spotify no válida.' });
        }
        const trackId = match[1];
        const cleanUrl = `https://open.spotify.com/track/${trackId}`;

        let trackTitle = 'Canción de Spotify';
        let artistName = '';
        let coverImage = '';

        try {
            const oembedRes = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`);
            if (oembedRes.ok) {
                const oembedData = await oembedRes.json();
                trackTitle = oembedData.title || trackTitle;
                artistName = oembedData.author_name || '';
                coverImage = oembedData.thumbnail_url || '';
            }
        } catch (e) {
            console.log('Error oembed:', e.message);
        }

        const titleCombined = artistName ? `${trackTitle} - ${artistName}` : trackTitle;

        // Intentar secuencialmente con las 6 API Keys
        for (let i = 0; i < API_KEYS.length; i++) {
            const currentApiKey = getNextApiKey();

            try {
                const rapidRes = await fetch(`https://spotify-downloader9.p.rapidapi.com/downloadSong?songId=${encodeURIComponent(cleanUrl)}`, {
                    method: 'GET',
                    headers: {
                        'x-rapidapi-key': currentApiKey,
                        'x-rapidapi-host': 'spotify-downloader9.p.rapidapi.com'
                    }
                });

                if (rapidRes.ok) {
                    const rapidData = await rapidRes.json();
                    const audioUrl = rapidData.data?.downloadLink || rapidData.downloadLink || rapidData.url;

                    if (audioUrl) {
                        const directDownloadProxyUrl = `/api/download-file?url=${encodeURIComponent(audioUrl)}&name=${encodeURIComponent(titleCombined)}.mp3`;

                        return res.json({
                            exito: true,
                            titulo: titleCombined,
                            coverUrl: coverImage || rapidData.data?.cover,
                            audioUrl: directDownloadProxyUrl
                        });
                    }
                }
            } catch (err) {
                console.log(`Intento con Key [${i + 1}] falló:`, err.message);
            }
        }

        // Respaldo secundario si todas las API Keys de RapidAPI se agotan
        try {
            const fallbackRes = await fetch(`https://api.spotifydown.com/download/${trackId}`, {
                headers: {
                    'Origin': 'https://spotifydown.com',
                    'Referer': 'https://spotifydown.com/'
                }
            });
            if (fallbackRes.ok) {
                const fbData = await fallbackRes.json();
                if (fbData.success && fbData.link) {
                    const directDownloadProxyUrl = `/api/download-file?url=${encodeURIComponent(fbData.link)}&name=${encodeURIComponent(titleCombined)}.mp3`;

                    return res.json({
                        exito: true,
                        titulo: titleCombined,
                        coverUrl: coverImage,
                        audioUrl: directDownloadProxyUrl
                    });
                }
            }
        } catch (e) {
            console.log('Error en CDN de respaldo de Spotify');
        }

        return res.status(400).json({
            exito: false,
            mensaje: 'Se ha alcanzado el límite diario de descargas de Spotify. Por favor, reintenta mañana.'
        });

    } catch (e) {
        console.error('Error procesando Spotify:', e.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar la canción de Spotify.' });
    }
}

// ==========================================
// 2. PROCESAR TIKTOK (Soporte Enlaces Cortos vt.tiktok.com)
// ==========================================
async function procesarTikTok(inputUrl, res) {
    try {
        let finalUrl = inputUrl;
        
        // Resolver redirección de enlaces acortados
        try {
            const redirectRes = await fetch(inputUrl, {
                method: 'HEAD',
                redirect: 'follow',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                }
            });
            if (redirectRes.url) finalUrl = redirectRes.url;
        } catch (e) {
            console.log('No se pudo resolver redirección HEAD, usando URL directa.');
        }

        // Intento 1: API TikWM
        const response = await fetch(`https://tikwm.com/api/?url=${encodeURIComponent(finalUrl)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        });
        
        const contentType = response.headers.get('content-type') || '';
        
        if (response.ok && contentType.includes('application/json')) {
            const data = await response.json();
            if (data.code === 0 && data.data) {
                const videoHD = data.data.hdplay ? (data.data.hdplay.startsWith('http') ? data.data.hdplay : `https://tikwm.com${data.data.hdplay}`) : null;
                const videoSD = data.data.play ? (data.data.play.startsWith('http') ? data.data.play : `https://tikwm.com${data.data.play}`) : null;
                const mainVideo = videoHD || videoSD;

                if (mainVideo) {
                    const proxyHD = `/api/download-file?url=${encodeURIComponent(videoHD || mainVideo)}&name=TikTok_HD.mp4`;
                    const proxySD = `/api/download-file?url=${encodeURIComponent(videoSD || mainVideo)}&name=TikTok_SD.mp4`;

                    return res.json({
                        exito: true,
                        videoUrlHD: proxyHD,
                        videoUrl: proxySD,
                        titulo: data.data.title || 'TikTok Video'
                    });
                }
            }
        }

        // Intento 2: API LoLHuman (Respaldo)
        const altRes = await fetch(`https://api.lolhuman.xyz/api/tiktok?apikey=free&url=${encodeURIComponent(finalUrl)}`);
        if (altRes.ok) {
            const altData = await altRes.json();
            if (altData.status === 200 && altData.result) {
                const videoLink = altData.result.link || altData.result;
                if (typeof videoLink === 'string' && videoLink.startsWith('http')) {
                    const proxyUrl = `/api/download-file?url=${encodeURIComponent(videoLink)}&name=TikTok_Video.mp4`;
                    return res.json({
                        exito: true,
                        videoUrlHD: proxyUrl,
                        videoUrl: proxyUrl,
                        titulo: 'TikTok Video'
                    });
                }
            }
        }

        // Intento 3: SSSTik
        const ssstikRes = await fetch(`https://ssstik.io/abc?url=dl`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            body: new URLSearchParams({ id: finalUrl, locale: 'es', tt: '0' })
        });

        if (ssstikRes.ok) {
            const html = await ssstikRes.text();
            const linkMatch = html.match(/href="(https:\/\/[^"]+)"[^>]*class="[^"]*download_link/i) || html.match(/href="(https:\/\/[^"]+)"/i);
            if (linkMatch && linkMatch[1]) {
                const proxyUrl = `/api/download-file?url=${encodeURIComponent(linkMatch[1])}&name=TikTok_Video.mp4`;
                return res.json({
                    exito: true,
                    videoUrlHD: proxyUrl,
                    videoUrl: proxyUrl,
                    titulo: 'TikTok Video'
                });
            }
        }

        return res.status(400).json({ exito: false, mensaje: 'No se pudo procesar este enlace de TikTok.' });

    } catch (err) {
        console.error('Error TikTok:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error al procesar el video de TikTok.' });
    }
}

// ==========================================
// 3. PROCESAR PINTEREST
// ==========================================
async function procesarPinterest(url, res) {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'es-ES,es;q=0.9'
            }
        });

        if (!response.ok) {
            return res.status(400).json({ exito: false, mensaje: 'No se pudo acceder al enlace de Pinterest.' });
        }

        const html = await response.text();

        const videoMatch = html.match(/https:\/\/[^"]+\.mp4/gi) || 
                           html.match(/"video_list":\{"V_720P":\{"url":"(https?:\/\/[^"]+)"/i) ||
                           html.match(/"url":"(https:\/\/v1\.pinimg\.com\/videos\/[^\"]+)"/i);

        if (videoMatch && videoMatch[0]) {
            let rawVideoUrl = videoMatch[0].replace(/\\/g, '');
            if (videoMatch[1]) rawVideoUrl = videoMatch[1].replace(/\\/g, '');

            const proxyUrl = `/api/download-file?url=${encodeURIComponent(rawVideoUrl)}&name=Pinterest_Video.mp4`;

            return res.json({
                exito: true,
                videoUrlHD: proxyUrl,
                videoUrl: proxyUrl,
                titulo: 'Pinterest Video'
            });
        }

        return res.status(400).json({ exito: false, mensaje: 'Este Pin no contiene un video válido para descargar.' });
    } catch (err) {
        console.error('Error Pinterest:', err.message);
        return res.status(500).json({ exito: false, mensaje: 'Error interno procesando Pinterest.' });
    }
}

app.listen(PORT, () => console.log(`Servidor activo en el puerto ${PORT}`));
