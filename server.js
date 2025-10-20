const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { Server } = require("socket.io");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const dev = process.env.NODE_ENV !== "production";
const hostname = dev ? "localhost" : "0.0.0.0";
const port = process.env.PORT || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Créer le dossier uploads s'il n'existe pas
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// Configuration de multer pour l'upload de fichiers
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        cb(null, "video_" + Date.now() + path.extname(file.originalname));
    },
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 * 1024 }, // 5 GB max
});

// État global de la vidéo
let videoState = {
    isPlaying: false,
    currentTime: 0,
    videoUrl: null,
    lastUpdate: Date.now(),
};

app.prepare().then(() => {
    const httpServer = createServer(async (req, res) => {
        try {
            const parsedUrl = parse(req.url, true);

            // Route pour l'upload de vidéo
            if (req.url.startsWith("/api/upload") && req.method === "POST") {
                upload.single("video")(req, res, (err) => {
                    if (err) {
                        console.error("Erreur d'upload:", err);
                        res.statusCode = 500;
                        res.setHeader("Content-Type", "application/json");
                        res.end(JSON.stringify({ error: err.message }));
                        return;
                    }

                    // Supprimer l'ancienne vidéo si elle existe
                    if (videoState.videoUrl) {
                        const oldFilename = videoState.videoUrl.replace(
                            "/uploads/",
                            ""
                        );
                        const oldFilePath = path.join(uploadsDir, oldFilename);

                        if (fs.existsSync(oldFilePath)) {
                            fs.unlink(oldFilePath, (err) => {
                                if (err) {
                                    console.error(
                                        "Erreur lors de la suppression de l'ancienne vidéo:",
                                        err
                                    );
                                } else {
                                    console.log(
                                        "Ancienne vidéo supprimée:",
                                        oldFilename
                                    );
                                }
                            });
                        }
                    }

                    const videoUrl = `/uploads/${req.file.filename}`;
                    videoState.videoUrl = videoUrl;
                    videoState.currentTime = 0;
                    videoState.isPlaying = false;
                    videoState.lastUpdate = Date.now();

                    // Notifier tous les clients via Socket.IO
                    if (io) {
                        io.emit("video-uploaded", { videoUrl });
                    }

                    res.statusCode = 200;
                    res.setHeader("Content-Type", "application/json");
                    res.end(JSON.stringify({ videoUrl }));
                });
                return;
            }

            // Route pour servir les fichiers uploadés
            if (req.url.startsWith("/uploads/")) {
                const filePath = path.join(
                    uploadsDir,
                    req.url.replace("/uploads/", "")
                );
                if (fs.existsSync(filePath)) {
                    const stat = fs.statSync(filePath);
                    const fileSize = stat.size;
                    const range = req.headers.range;

                    if (range) {
                        const parts = range.replace(/bytes=/, "").split("-");
                        const start = parseInt(parts[0], 10);
                        const end = parts[1]
                            ? parseInt(parts[1], 10)
                            : fileSize - 1;
                        const chunksize = end - start + 1;
                        const file = fs.createReadStream(filePath, {
                            start,
                            end,
                        });
                        const head = {
                            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                            "Accept-Ranges": "bytes",
                            "Content-Length": chunksize,
                            "Content-Type": "video/x-matroska",
                        };
                        res.writeHead(206, head);
                        file.pipe(res);
                    } else {
                        const head = {
                            "Content-Length": fileSize,
                            "Content-Type": "video/x-matroska",
                        };
                        res.writeHead(200, head);
                        fs.createReadStream(filePath).pipe(res);
                    }
                    return;
                }
            }

            await handle(req, res, parsedUrl);
        } catch (err) {
            console.error("Error occurred handling", req.url, err);
            res.statusCode = 500;
            res.end("internal server error");
        }
    });

    const io = new Server(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
        },
        maxHttpBufferSize: 1e8, // 100 MB pour l'upload de vidéos
    });

    io.on("connection", (socket) => {
        console.log("Nouvelle connexion:", socket.id);

        // Envoyer l'état actuel de la vidéo au nouveau client
        socket.emit("video-state", videoState);

        // Play
        socket.on("play", (data) => {
            console.log("Play reçu:", data);
            videoState.isPlaying = true;
            videoState.currentTime = data.currentTime;
            videoState.lastUpdate = Date.now();

            // Diffuser à tous les clients sauf l'émetteur
            socket.broadcast.emit("play", { currentTime: data.currentTime });
        });

        // Pause
        socket.on("pause", (data) => {
            console.log("Pause reçu:", data);
            videoState.isPlaying = false;
            videoState.currentTime = data.currentTime;
            videoState.lastUpdate = Date.now();

            // Diffuser à tous les clients sauf l'émetteur
            socket.broadcast.emit("pause", { currentTime: data.currentTime });
        });

        // Seek (changement de position)
        socket.on("seek", (data) => {
            console.log("Seek reçu:", data);
            videoState.currentTime = data.currentTime;
            videoState.lastUpdate = Date.now();

            // Diffuser à tous les clients sauf l'émetteur
            socket.broadcast.emit("seek", { currentTime: data.currentTime });
        });

        // Suppression de vidéo
        socket.on("delete-video", () => {
            console.log("Suppression vidéo demandée");

            // Supprimer le fichier physique si il existe
            if (videoState.videoUrl) {
                const filename = videoState.videoUrl.replace("/uploads/", "");
                const filePath = path.join(uploadsDir, filename);

                if (fs.existsSync(filePath)) {
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            console.error(
                                "Erreur lors de la suppression du fichier:",
                                err
                            );
                        } else {
                            console.log("Fichier supprimé:", filename);
                        }
                    });
                }
            }

            videoState.videoUrl = null;
            videoState.currentTime = 0;
            videoState.isPlaying = false;
            videoState.lastUpdate = Date.now();

            // Diffuser à tous les clients (y compris l'émetteur)
            io.emit("video-deleted");
        });

        // Déconnexion
        socket.on("disconnect", () => {
            console.log("Déconnexion:", socket.id);
        });
    });

    httpServer
        .once("error", (err) => {
            console.error(err);
            process.exit(1);
        })
        .listen(port, () => {
            console.log(`> Prêt sur http://${hostname}:${port}`);
        });
});
