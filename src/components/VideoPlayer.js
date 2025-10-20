"use client";

import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

export default function VideoPlayer() {
    const [socket, setSocket] = useState(null);
    const [videoUrl, setVideoUrl] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const videoRef = useRef(null);
    const fileInputRef = useRef(null);
    const isRemoteEvent = useRef(false);

    useEffect(() => {
        // Connexion au serveur Socket.IO
        // Utilise l'URL actuelle du navigateur pour la connexion
        const socketUrl = typeof window !== 'undefined' 
            ? window.location.origin 
            : 'http://localhost:3000';
            
        const socketInstance = io(socketUrl, {
            transports: ["websocket", "polling"],
        });

        socketInstance.on("connect", () => {
            console.log("Connecté au serveur");
            setIsConnected(true);
        });

        socketInstance.on("disconnect", () => {
            console.log("Déconnecté du serveur");
            setIsConnected(false);
        });

        // Recevoir l'état de la vidéo à la connexion
        socketInstance.on("video-state", (state) => {
            console.log("État vidéo reçu:", state);
            if (state.videoUrl) {
                setVideoUrl(state.videoUrl);
                setTimeout(() => {
                    if (videoRef.current) {
                        videoRef.current.currentTime = state.currentTime;
                        if (state.isPlaying) {
                            videoRef.current.play().catch(console.error);
                        }
                    }
                }, 100);
            }
        });

        // Nouvelle vidéo uploadée
        socketInstance.on("video-uploaded", (data) => {
            console.log("Nouvelle vidéo disponible");
            setVideoUrl(data.videoUrl);
        });

        // Événements de synchronisation
        socketInstance.on("play", (data) => {
            console.log("Play reçu du serveur", data);
            if (videoRef.current) {
                isRemoteEvent.current = true;
                videoRef.current.currentTime = data.currentTime;
                videoRef.current.play().catch((err) => {
                    console.error("Erreur play:", err);
                    isRemoteEvent.current = false;
                });
                // Réinitialiser après un délai
                setTimeout(() => {
                    isRemoteEvent.current = false;
                }, 500);
            }
        });

        socketInstance.on("pause", (data) => {
            console.log("Pause reçu du serveur", data);
            if (videoRef.current) {
                isRemoteEvent.current = true;
                videoRef.current.currentTime = data.currentTime;
                videoRef.current.pause();
                // Réinitialiser après un délai
                setTimeout(() => {
                    isRemoteEvent.current = false;
                }, 500);
            }
        });

        socketInstance.on("seek", (data) => {
            console.log("Seek reçu du serveur", data);
            if (videoRef.current) {
                isRemoteEvent.current = true;
                videoRef.current.currentTime = data.currentTime;
                // Réinitialiser après un délai
                setTimeout(() => {
                    isRemoteEvent.current = false;
                }, 500);
            }
        });

        // Suppression de vidéo
        socketInstance.on("video-deleted", () => {
            console.log("Vidéo supprimée");
            setVideoUrl(null);
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.close();
        };
    }, []);

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!file.name.endsWith(".mkv") && !file.type.includes("video")) {
            alert("Veuillez sélectionner un fichier vidéo valide (.mkv)");
            return;
        }

        setUploading(true);
        setUploadProgress(0);

        try {
            // Utiliser FormData pour l'upload
            const formData = new FormData();
            formData.append("video", file);

            // Upload avec XMLHttpRequest pour suivre la progression
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener("progress", (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round(
                        (event.loaded / event.total) * 100
                    );
                    setUploadProgress(percentComplete);
                }
            });

            xhr.addEventListener("load", () => {
                if (xhr.status === 200) {
                    const response = JSON.parse(xhr.responseText);
                    setVideoUrl(response.videoUrl);
                    setUploading(false);
                    setUploadProgress(0);
                } else {
                    alert("Erreur lors de l'upload: " + xhr.statusText);
                    setUploading(false);
                    setUploadProgress(0);
                }
            });

            xhr.addEventListener("error", () => {
                alert("Erreur lors de l'upload du fichier");
                setUploading(false);
                setUploadProgress(0);
            });

            xhr.open("POST", "/api/upload");
            xhr.send(formData);
        } catch (error) {
            console.error("Erreur:", error);
            alert("Erreur lors de l'upload du fichier");
            setUploading(false);
            setUploadProgress(0);
        }
    };

    const handlePlay = () => {
        if (isRemoteEvent.current) {
            console.log("Play ignoré (événement distant)");
            isRemoteEvent.current = false;
            return;
        }

        console.log("Play local émis");
        if (socket && videoRef.current) {
            socket.emit("play", { currentTime: videoRef.current.currentTime });
        }
    };

    const handlePause = () => {
        if (isRemoteEvent.current) {
            console.log("Pause ignoré (événement distant)");
            isRemoteEvent.current = false;
            return;
        }

        console.log("Pause local émis");
        if (socket && videoRef.current) {
            socket.emit("pause", { currentTime: videoRef.current.currentTime });
        }
    };

    const handleSeeked = () => {
        if (isRemoteEvent.current) {
            console.log("Seek ignoré (événement distant)");
            isRemoteEvent.current = false;
            return;
        }

        console.log("Seek local émis");
        if (socket && videoRef.current) {
            socket.emit("seek", { currentTime: videoRef.current.currentTime });
        }
    };

    return (
        <div className="w-full max-w-4xl mx-auto p-6">
            <div className="mb-6">
                <h1 className="text-3xl font-bold mb-2">
                    Lecteur Vidéo Synchronisé
                </h1>
                <div className="flex items-center gap-2">
                    <div
                        className={`w-3 h-3 rounded-full ${
                            isConnected ? "bg-green-500" : "bg-red-500"
                        }`}
                    />
                    <span className="text-sm">
                        {isConnected ? "Connecté" : "Déconnecté"}
                    </span>
                </div>
            </div>

            {!videoUrl ? (
                <div className="border-2 border-dashed border-gray-600 rounded-lg p-12 text-center bg-gray-800/50">
                    <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleFileUpload}
                        accept=".mkv,video/*"
                        className="hidden"
                        disabled={uploading}
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                    >
                        {uploading
                            ? `Chargement... ${uploadProgress}%`
                            : "Choisir une vidéo (.mkv)"}
                    </button>

                    {uploading && (
                        <div className="mt-6 w-full max-w-md mx-auto">
                            <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
                                <div
                                    className="bg-blue-500 h-full transition-all duration-300 ease-out flex items-center justify-center text-xs text-white font-semibold"
                                    style={{ width: `${uploadProgress}%` }}
                                >
                                    {uploadProgress > 10 &&
                                        `${uploadProgress}%`}
                                </div>
                            </div>
                            <p className="mt-2 text-sm text-gray-400">
                                Chargement du fichier en cours...
                            </p>
                        </div>
                    )}

                    {!uploading && (
                        <p className="mt-4 text-gray-400 text-sm">
                            La vidéo sera synchronisée pour tous les
                            utilisateurs
                        </p>
                    )}
                </div>
            ) : (
                <div className="bg-black rounded-lg overflow-hidden">
                    <video
                        ref={videoRef}
                        src={videoUrl}
                        controls
                        className="w-full"
                        onPlay={handlePlay}
                        onPause={handlePause}
                        onSeeked={handleSeeked}
                    />
                </div>
            )}

            {videoUrl && (
                <button
                    onClick={() => {
                        if (socket) {
                            socket.emit("delete-video");
                        }
                        setVideoUrl(null);
                    }}
                    className="mt-4 bg-red-500 hover:bg-red-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                >
                    Supprimer la vidéo
                </button>
            )}

            <div className="mt-6 p-4 bg-blue-900/30 border border-blue-700/50 rounded-lg">
                <h2 className="font-semibold mb-2 text-blue-300">
                    ℹ️ Instructions :
                </h2>
                <ul className="text-sm space-y-1 text-gray-300">
                    <li>• Uploadez une vidéo .mkv</li>
                    <li>
                        • La vidéo sera visible par tous les utilisateurs
                        connectés
                    </li>
                    <li>• Play/Pause/Seek sont synchronisés en temps réel</li>
                    <li>
                        • Ouvrez l&apos;app dans plusieurs onglets pour tester !
                    </li>
                </ul>
            </div>
        </div>
    );
}
