// ===============================
// CONFIG
// ===============================
const CLIENT_ID = "c1118e23caa84e6497022d00757dc5a0";
const REDIRECT_URI =
    "https://marlone187.github.io/Spotify-emotion-visualizer/callback.html";

// 🎵 Playlists je Emotion
const PLAYLISTS = {
    happy: "spotify:playlist:0s4GDB01raiqiNVstNfUXe",
    sad: "spotify:playlist:45rWp1I6aL5ruR3WNG5K2H",
    neutral: "spotify:playlist:07LPGPmhNOGYiWIaFhY61V",
    angry: "spotify:playlist:55DSMbgOO36tDodpwCykG4",
};

// aktuelle Emotion (Startwert)
let currentEmotion = "happy";
let currentContextUri = PLAYLISTS[currentEmotion];

// Button-Emotion (hat Vorrang vor Kamera)
let pendingEmotion = null;

// Logging
const logEl = document.getElementById("log");
const log = (...msg) => {
    if (logEl) logEl.textContent += msg.join(" ") + "\n";
    console.log(...msg);
};

const SCOPES = [
    "streaming",
    "user-modify-playback-state",
    "user-read-playback-state",
    "user-read-private",
    "user-read-email",
].join(" ");

// globaler Token / Player
let accessToken = sessionStorage.getItem("spotify_access_token") || null;
let player = null;
let deviceId = null;
let lastTrackId = null;
let isPlaying = false; // für Play/Pause-Toggle
let playerReady = false; // ist Player initialisiert?

// Für Enderkennung
let preEndHandledTrackId = null;

// UI
const startBtn = document.getElementById("startBtn");
const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const trackImage = document.getElementById("trackImage");
const trackTitleEl = document.getElementById("trackTitle");
const trackArtistEl = document.getElementById("trackArtist");
const progressBar = document.getElementById("progressBar");
const currentTimeEl = document.getElementById("currentTime");
const durationEl = document.getElementById("durationTime");
const volumeSlider = document.getElementById("volumeSlider");
const volumeValueEl = document.getElementById("volumeValue");

// 🔁 Icons für Play/Pause
const PLAY_ICON = "▶️";
const PAUSE_ICON = "⏸️";

// Start-Button freischalten (nur auf index.html vorhanden)
if (startBtn) {
    if (accessToken) {
        startBtn.disabled = false;
        startBtn.textContent = PLAY_ICON;
        log("Access Token gefunden, Start-Button freigegeben.");
    } else {
        log("Kein Access Token – solltest eigentlich auf auth.html gewesen sein.");
    }
}

// Timeline-State
let isSeeking = false;
let currentDurationMs = 0;
let progressInterval = null;

// ===============================
// TOKEN EXCHANGE (wird nur auf callback.html genutzt)
// ===============================
async function exchangeCodeForToken(code) {
    const verifier = sessionStorage.getItem("code_verifier");

    const body = new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT_URI,
    });

    const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });

    const data = await res.json();

    if (data.access_token) {
        accessToken = data.access_token;
        sessionStorage.setItem("spotify_access_token", accessToken);
        log("Access Token OK (Callback)");
    } else {
        log("Token Fehler:", JSON.stringify(data));
    }
}

// ===============================
// CALLBACK LOGIK (nur aktiv auf callback.html)
// ===============================
(async () => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");

    if (code) {
        log("Code empfangen:", code);
        await exchangeCodeForToken(code);
        log("Weiterleitung zur App...");
        setTimeout(() => {
            window.location = "index.html";
        }, 500);
    }
})();

// ===============================
// Emotion-Buttons (manuell)
// ===============================
function scheduleEmotionChange(emotion) {
    if (!PLAYLISTS[emotion]) {
        log("Unbekannte Emotion:", emotion);
        return;
    }

    pendingEmotion = emotion;
    log(
        "Neue Emotion per Button geplant:",
        emotion,
        "(Button hat Vorrang vor Kamera beim nächsten Wechsel)"
    );
}

document.querySelectorAll("[data-emotion]").forEach((btn) => {
    btn.addEventListener("click", () => {
        const emo = btn.getAttribute("data-emotion");
        scheduleEmotionChange(emo);
    });
});

// ===============================
// Hilfsfunktionen für Emotion-Struktur
// ===============================
function logEmotionStats(stats) {
    if (!stats) {
        log("📊 Keine Emotion-Daten (Kamera aus / kein Gesicht / kein Tracking).");
        return;
    }

    log(
        "📊 Emotionen während des Songs:\n" +
        `   😊 Happy:   ${stats.happy}%\n` +
        `   😢 Sad:     ${stats.sad}%\n` +
        `   😐 Neutral: ${stats.neutral}%\n` +
        `   😡 Angry:   ${stats.angry}%`
    );
}

// zentrale Funktion: Emotion auswerten & ggf. Playlist wechseln
async function evaluateAndMaybeSwitchEmotion(reason) {
    log("------------------------------------");
    log("🎯 Emotionsevaluierung, Grund:", reason);

    let stats = null;
    if (typeof window.getEmotionStats === "function") {
        stats = window.getEmotionStats();
    }
    logEmotionStats(stats);

    let chosenEmotion = null;

    // 1) Button-Emotion hat Vorrang
    if (pendingEmotion && PLAYLISTS[pendingEmotion]) {
        log("Nutze Button-Emotion (Vorrang):", pendingEmotion);
        chosenEmotion = pendingEmotion;
    } else {
        // 2) Kamera-Emotion über gesamte Songdauer
        if (typeof window.getDominantEmotion === "function") {
            const cameraEmotion = window.getDominantEmotion();
            if (cameraEmotion && PLAYLISTS[cameraEmotion]) {
                log("Dominante Emotion (Kamera, gesamter Song):", cameraEmotion);
                chosenEmotion = cameraEmotion;
            } else {
                log("Keine gültige Kamera-Emotion für diesen Song gefunden.");
            }
        }
    }

    // Button ist verbraucht, egal ob genutzt oder nicht
    pendingEmotion = null;

    // Emotion-Tracking für nächsten Song vorbereiten
    if (typeof window.resetEmotionStats === "function") {
        window.resetEmotionStats();
    }

    if (!chosenEmotion) {
        log("→ Keine Emotion gewählt – Playlist bleibt bei:", currentEmotion);
        return false; // keine Änderung
    }

    if (chosenEmotion === currentEmotion) {
        log(
            "→ Dominante/gewählte Emotion entspricht aktueller Playlist:",
            currentEmotion,
            "→ kein Playlistwechsel."
        );
        return false; // keine Änderung
    }

    // Jetzt wirklich wechseln
    log(
        "→ Playlistwechsel:",
        currentEmotion,
        "→",
        chosenEmotion,
        "(Grund:",
        reason + ")"
    );

    // Übergang glätten: erst pausieren
    if (player) {
        try {
            await player.pause();
            log("Player vor Playlistwechsel pausiert.");
        } catch (e) {
            log("Fehler beim Pausieren vor Playlistwechsel:", e);
        }
    }

    // Danach Playlist wechseln
    await applyEmotionNow(chosenEmotion);

    return true; // Playlist wurde geändert
}

// ===============================
// SPOTIFY PLAYER INIT
// ===============================
window.onSpotifyWebPlaybackSDKReady = () => {
    log("Spotify Web Playback SDK geladen");
};

async function initPlayerIfNeeded() {
    if (player || playerReady) {
        return;
    }
    if (!accessToken) {
        log("initPlayerIfNeeded: kein Access Token.");
        return;
    }

    log("Initialisiere Spotify Player...");

    player = new Spotify.Player({
        name: "Emotion Player",
        getOAuthToken: (cb) => cb(accessToken),
        volume: 0.5,
    });

    // Player bereit
    player.addListener("ready", async ({ device_id }) => {
        deviceId = device_id;
        playerReady = true;
        log("Player ready:", device_id);
        log("Starte mit Emotion:", currentEmotion, "->", currentContextUri);

        // Buttons & Slider aktivieren
        if (prevBtn) prevBtn.disabled = false;
        if (nextBtn) nextBtn.disabled = false;
        if (volumeSlider) volumeSlider.disabled = false;

        // aktuelle Lautstärke holen
        try {
            const vol = await player.getVolume(); // 0.0–1.0
            const volPercent = Math.round(vol * 100);
            if (volumeSlider) volumeSlider.value = volPercent.toString();
            if (volumeValueEl) volumeValueEl.textContent = volPercent + "%";
            log(`Aktuelle Lautstärke: ${volPercent}%`);
        } catch (err) {
            log("getVolume Fehler:", err);
        }

        // 🔀 Shuffle aktivieren
        try {
            const shuffleRes = await fetch(
                `https://api.spotify.com/v1/me/player/shuffle?state=true&device_id=${deviceId}`,
                {
                    method: "PUT",
                    headers: { Authorization: "Bearer " + accessToken },
                }
            );

            if (shuffleRes.status === 204) {
                log("Shuffle aktiviert ✅");
            } else {
                log("Shuffle Fehler:", shuffleRes.status, await shuffleRes.text());
            }
        } catch (e) {
            log("Shuffle Request Error:", e);
        }

        // Emotion-Tracking für ersten Song resetten
        if (typeof window.resetEmotionStats === "function") {
            window.resetEmotionStats();
            log("Emotion-Tracking gestartet für ersten Song.");
        }

        // Playback beim ersten Mal direkt starten
        await startPlayback();
        isPlaying = true;
        if (startBtn) startBtn.textContent = PAUSE_ICON;

        // 🔥 Live-Progress + Pre-End-Erkennung
        if (progressInterval) clearInterval(progressInterval);
        progressInterval = setInterval(async () => {
            if (!player || isSeeking) return;
            try {
                const state = await player.getCurrentState();
                if (!state || !state.track_window || !state.track_window.current_track)
                    return;

                updateNowPlayingUI(state);

                const track = state.track_window.current_track;
                const currentId = track.id;
                const position = state.position || 0;
                const duration = state.duration || track.duration_ms || 0;

                if (!currentId || !duration) return;

                // Songwechsel nur zur Info (kein Emotion-Handling mehr hier)
                if (currentId !== lastTrackId) {
                    if (lastTrackId) {
                        log("🎵 Songwechsel erkannt (Info):", lastTrackId, "→", currentId);
                    }
                    lastTrackId = currentId;
                    preEndHandledTrackId = null; // für neuen Song wieder erlauben
                }

                // Pre-End-Erkennung: wenn weniger als 1.5s übrig sind
                const remaining = duration - position;
                if (
                    remaining <= 1500 &&
                    remaining >= 0 &&
                    preEndHandledTrackId !== currentId
                ) {
                    preEndHandledTrackId = currentId;
                    log(
                        `⏱ Song endet bald (Rest: ${Math.round(
                            remaining
                        )} ms) → Emotion auswerten.`
                    );
                    await evaluateAndMaybeSwitchEmotion("song_end");
                }
            } catch (err) {
                log("getCurrentState Fehler:", err);
            }
        }, 500);
    });

    // Player-Fehler
    player.addListener("initialization_error", ({ message }) =>
        log("Init Error:", message)
    );
    player.addListener("authentication_error", ({ message }) =>
        log("Auth Error:", message)
    );
    player.addListener("account_error", ({ message }) =>
        log("Account Error:", message)
    );
    player.addListener("playback_error", ({ message }) =>
        log("Playback Error:", message)
    );

    await player.connect();
}

// ===============================
// START-BUTTON ALS PLAY/PAUSE-TOGGLE
// ===============================
startBtn?.addEventListener("click", async () => {
    if (!accessToken) {
        log("Kein Access Token – bitte zuerst einloggen (auth.html).");
        return;
    }

    // 1. Klick: Player initialisieren
    if (!playerReady || !player) {
        await initPlayerIfNeeded();
        return; // eigentlicher Start passiert im ready-Callback
    }

    try {
        if (isPlaying) {
            await player.pause();
            isPlaying = false;
            if (startBtn) startBtn.textContent = PLAY_ICON;
            log("Playback pausiert (Button).");
        } else {
            await player.resume();
            isPlaying = true;
            if (startBtn) startBtn.textContent = PAUSE_ICON;
            log("Playback gestartet/fortgesetzt (Button).");
        }
    } catch (err) {
        log("Pause/Resume Fehler:", err);
    }
});

// ===============================
// Now Playing / Timeline
// ===============================
function msToTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function updateNowPlayingUI(state) {
    if (!state || !state.track_window) return;
    const track = state.track_window.current_track;
    if (!track) return;

    // Cover
    if (trackImage) {
        const img = track.album && track.album.images && track.album.images[0];
        trackImage.src = img ? img.url : "";
    }

    // Titel / Artist
    if (trackTitleEl) trackTitleEl.textContent = track.name || "Unbekannter Titel";
    if (trackArtistEl) {
        const artistNames = (track.artists || []).map((a) => a.name).join(", ");
        trackArtistEl.textContent = artistNames || "Unbekannter Artist";
    }

    // Progress
    const position = state.position || 0; // ms
    const duration = state.duration || track.duration_ms || 0; // ms
    currentDurationMs = duration;

    if (durationEl) durationEl.textContent = msToTime(duration);

    if (!isSeeking && currentTimeEl) {
        currentTimeEl.textContent = msToTime(position);
    }

    if (progressBar) {
        progressBar.disabled = duration <= 0;
        progressBar.max = duration.toString();
        if (!isSeeking) {
            progressBar.value = position.toString();
        }
    }
}

// Timeline
progressBar?.addEventListener("input", (e) => {
    if (!currentDurationMs) return;
    isSeeking = true;
    const newPos = Number(e.target.value);
    if (currentTimeEl) currentTimeEl.textContent = msToTime(newPos);
});

progressBar?.addEventListener("change", async (e) => {
    if (!player) {
        isSeeking = false;
        return;
    }
    const newPos = Number(e.target.value);
    log("Seek zu:", newPos, "ms");
    try {
        await player.seek(newPos);
    } catch (err) {
        log("Seek Fehler:", err);
    }
    isSeeking = false;
});

// ===============================
// PREV / NEXT Buttons
// ===============================
prevBtn?.addEventListener("click", async () => {
    if (!player) {
        log("Prev: Player nicht bereit.");
        return;
    }

    try {
        await player.previousTrack();
        log("Zu vorherigem Track gesprungen.");
    } catch (err) {
        log("Prev Fehler:", err);
    }
});

nextBtn?.addEventListener("click", async () => {
    if (!player) {
        log("Next: Player nicht bereit.");
        return;
    }

    try {
        // 1. Emotion auswerten (Button + Kamera)
        const changed = await evaluateAndMaybeSwitchEmotion("skip_next");

        // 2. Nur wenn KEINE Playlist gewechselt wurde → normalen Skip
        if (!changed) {
            await player.nextTrack();
            log("Zum nächsten Track gesprungen (gleiche Playlist).");
        } else {
            log("Playlist bereits gewechselt – kein zusätzlicher Skip nötig.");
        }
    } catch (err) {
        log("Next Fehler:", err);
    }
});

// ===============================
// VOLUME Slider
// ===============================
volumeSlider?.addEventListener("input", async (e) => {
    const val = Number(e.target.value); // 0–100
    if (volumeValueEl) volumeValueEl.textContent = `${val}%`;

    if (!player) {
        log("Volume: Player nicht bereit.");
        return;
    }

    const volume = val / 100; // 0.0–1.0
    try {
        await player.setVolume(volume);
        log("Lautstärke gesetzt auf", val + "%");
    } catch (err) {
        log("setVolume Fehler:", err);
    }
});

// ===============================
// Emotion sofort anwenden (Playlist wechseln)
// ===============================
async function applyEmotionNow(emotion) {
    if (!PLAYLISTS[emotion]) {
        log("Unbekannte Emotion beim Anwenden:", emotion);
        return;
    }
    currentEmotion = emotion;
    currentContextUri = PLAYLISTS[currentEmotion];

    log("Wechsle jetzt Playlist auf Emotion:", currentEmotion);

    if (!deviceId || !accessToken) {
        log("Kein Device oder Token – kann Playlist nicht wechseln.");
        return;
    }

    const body = currentContextUri.startsWith("spotify:playlist")
        ? { context_uri: currentContextUri }
        : { uris: [currentContextUri] };

    const res = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
        {
            method: "PUT",
            headers: {
                Authorization: "Bearer " + accessToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        }
    );

    if (res.status === 204) {
        log("Playlist gewechselt! Neue Emotion:", currentEmotion);
    } else {
        log("Fehler beim Wechseln:", res.status, await res.text());
    }
}

// ===============================
// PLAYBACK (Start mit aktueller Emotion)
// ===============================
async function startPlayback() {
    if (!deviceId) {
        log("Kein Gerät (deviceId) – ist der Player ready?");
        return;
    }

    const body = currentContextUri.startsWith("spotify:playlist")
        ? { context_uri: currentContextUri }
        : { uris: [currentContextUri] };

    const res = await fetch(
        `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`,
        {
            method: "PUT",
            headers: {
                Authorization: "Bearer " + accessToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        }
    );

    if (res.status === 204) {
        log("Playback gestartet! Emotion:", currentEmotion);
    } else {
        log("Fehler:", res.status, await res.text());
    }
}
