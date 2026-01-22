const CLIENT_ID = "c1118e23caa84e6497022d00757dc5a0";
const REDIRECT_URI = "https://marlone187.github.io/Spotify-emotion-visualizer/callback.html";

// Modus: "auto" oder "manual"
const SELECTED_MODE = sessionStorage.getItem("selected_mode") || "auto";

// ✅ Default Playlists je Emotion (bleiben bestehen)
const DEFAULT_PLAYLISTS = {
    happy: "spotify:playlist:0s4GDB01raiqiNVstNfUXe",
    sad: "spotify:playlist:45rWp1I6aL5ruR3WNG5K2H",
    neutral: "spotify:playlist:07LPGPmhNOGYiWIaFhY61V",
    angry: "spotify:playlist:55DSMbgOO36tDodpwCykG4",
};

// ✅ Custom Playlists aus localStorage (Prototyp)
function loadCustomPlaylists() {
    const raw = localStorage.getItem("custom_playlists");
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

// ✅ Effektive Playlists (Custom überschreibt Default)
function getEffectivePlaylists() {
    const custom = loadCustomPlaylists();
    const effective = { ...DEFAULT_PLAYLISTS };

    if (custom) {
        if (custom.happy_uri) effective.happy = custom.happy_uri;
        if (custom.sad_uri) effective.sad = custom.sad_uri;
        if (custom.neutral_uri) effective.neutral = custom.neutral_uri;
        if (custom.angry_uri) effective.angry = custom.angry_uri;
    }
    return effective;
}

// 🎵 Playlists je Emotion (wird dynamisch gelesen)
let PLAYLISTS = getEffectivePlaylists();

// Startemotion:
// - Auto: "happy"
// - Manual: letzte manuell gewählte Emotion (falls vorhanden), sonst "happy"
let currentEmotion =
    SELECTED_MODE === "manual"
        ? (sessionStorage.getItem("manual_emotion") || "happy")
        : "happy";

// Wenn jemand Custom-Playlists speichert und dann direkt weitergeht,
// stellen wir sicher, dass currentContextUri anhand der effektiven Playlists gesetzt wird.
let currentContextUri = PLAYLISTS[currentEmotion];

// Button-Emotion (hat Vorrang vor Kamera) – Auto-Modus
let pendingEmotion = null;

// Logging
const logEl = document.getElementById("log");
const log = (...msg) => {
    if (logEl) logEl.textContent += msg.join(" ") + "\n";
    console.log(...msg);
};

// globaler Token / Player
let accessToken = sessionStorage.getItem("spotify_access_token") || null;
let player = null;
let deviceId = null;
let lastTrackId = null;
let isPlaying = false;
let playerReady = false;

// Auto-Modus helpers
let preEndHandledTrackId = null;
let isSwitchingPlaylist = false;

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

// Icons
const PLAY_ICON = "▶️";
const PAUSE_ICON = "⏸️";

// Start-Button freischalten
if (startBtn) {
    if (accessToken) {
        startBtn.disabled = false;
        startBtn.textContent = PLAY_ICON;
        log("Access Token gefunden, Start-Button freigegeben.");
        log("Modus:", SELECTED_MODE, "| Startemotion:", currentEmotion);
        log("Playlists aktiv (effective):", JSON.stringify(PLAYLISTS));
    } else {
        log("Kein Access Token – solltest eigentlich auf auth.html gewesen sein.");
    }
}

// Timeline-State
let isSeeking = false;
let currentDurationMs = 0;
let progressInterval = null;

// ===============================
// TOKEN EXCHANGE (nur callback.html)
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
// CALLBACK LOGIK
// ===============================
(async () => {
    const isCallbackPage = window.location.pathname.endsWith("callback.html");
    if (!isCallbackPage) return;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");

    if (code) {
        log("Code empfangen:", code);
        await exchangeCodeForToken(code);

        if (sessionStorage.getItem("spotify_access_token")) {
            log("Weiterleitung zur Modus-Auswahl (start.html)...");
            window.location = "start.html";
        } else {
            log("❌ Kein Access Token nach Exchange — bleibe auf callback.html.");
        }
    } else {
        log("❌ Kein Code in callback gefunden.");
    }
})();

// ===============================
// Emotion Buttons (optional)
// ===============================
function scheduleEmotionChange(emotion) {
    PLAYLISTS = getEffectivePlaylists(); // falls Startseite geändert wurde (neuer Tab)
    if (!PLAYLISTS[emotion]) {
        log("Unbekannte Emotion:", emotion);
        return;
    }
    pendingEmotion = emotion;
    log("Neue Emotion per Button geplant:", emotion);
}

document.querySelectorAll("[data-emotion]").forEach((btn) => {
    btn.addEventListener("click", () => {
        const emo = btn.getAttribute("data-emotion");
        scheduleEmotionChange(emo);
    });
});

// ===============================
// Stats Logger
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

// ===============================
// Progress-Loop
// ===============================
function startProgressLoop() {
    if (!player) return;
    if (progressInterval) clearInterval(progressInterval);

    progressInterval = setInterval(async () => {
        if (!player || isSeeking || isSwitchingPlaylist) return;

        try {
            const state = await player.getCurrentState();
            if (!state || !state.track_window || !state.track_window.current_track) return;

            updateNowPlayingUI(state);

            const track = state.track_window.current_track;
            const currentId = track.id;
            const position = state.position || 0;
            const duration = state.duration || track.duration_ms || 0;

            if (!currentId || !duration) return;

            if (currentId !== lastTrackId) {
                if (lastTrackId) log("🎵 Songwechsel erkannt (Info):", lastTrackId, "→", currentId);
                lastTrackId = currentId;
                preEndHandledTrackId = null;
            }

            // ✅ Auto only: Song-End Evaluierung
            if (SELECTED_MODE === "auto") {
                const remaining = duration - position;
                if (remaining <= 1500 && remaining >= 0 && preEndHandledTrackId !== currentId) {
                    preEndHandledTrackId = currentId;
                    log(`⏱ Song endet bald (Rest: ${Math.round(remaining)} ms) → Emotion auswerten.`);
                    await evaluateAndMaybeSwitchEmotion("song_end");
                }
            }
        } catch (err) {
            log("getCurrentState Fehler:", err);
        }
    }, 500);
}

// ===============================
// Auto: Emotion evaluieren & ggf wechseln
// ===============================
async function evaluateAndMaybeSwitchEmotion(reason) {
    if (SELECTED_MODE !== "auto") return false;

    if (isSwitchingPlaylist) {
        log("⚠️ Playlistwechsel läuft bereits – neue Evaluierung übersprungen.");
        return false;
    }

    PLAYLISTS = getEffectivePlaylists(); // immer aktuell halten

    log("------------------------------------");
    log("🎯 Emotionsevaluierung, Grund:", reason);

    let stats = null;
    if (typeof window.getEmotionStats === "function") stats = window.getEmotionStats();
    logEmotionStats(stats);

    let chosenEmotion = null;

    if (pendingEmotion && PLAYLISTS[pendingEmotion]) {
        log("Nutze Button-Emotion (Vorrang):", pendingEmotion);
        chosenEmotion = pendingEmotion;
    } else if (typeof window.getDominantEmotion === "function") {
        const cameraEmotion = window.getDominantEmotion();
        if (cameraEmotion && PLAYLISTS[cameraEmotion]) {
            log("Dominante Emotion (Kamera, gesamter Song):", cameraEmotion);
            chosenEmotion = cameraEmotion;
        } else {
            log("Keine gültige Kamera-Emotion für diesen Song gefunden.");
        }
    }

    pendingEmotion = null;

    if (typeof window.resetEmotionStats === "function") window.resetEmotionStats();

    if (!chosenEmotion) {
        log("→ Keine Emotion gewählt – Playlist bleibt bei:", currentEmotion);
        return false;
    }

    if (chosenEmotion === currentEmotion) {
        log("→ Emotion entspricht aktueller Playlist:", currentEmotion, "→ kein Wechsel.");
        return false;
    }

    log("→ Playlistwechsel:", currentEmotion, "→", chosenEmotion, "(Grund:", reason + ")");
    isSwitchingPlaylist = true;

    if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
    }

    if (player) {
        try { await player.pause(); } catch {}
    }

    await applyEmotionNow(chosenEmotion);

    setTimeout(() => {
        isSwitchingPlaylist = false;
        startProgressLoop();
        log("Progress-Loop nach Playlistwechsel neu gestartet.");
    }, 400);

    return true;
}

// ===============================
// Player Init
// ===============================
window.onSpotifyWebPlaybackSDKReady = () => {
    log("Spotify Web Playback SDK geladen");
};

async function initPlayerIfNeeded() {
    if (player || playerReady) return;
    if (!accessToken) return;

    log("Initialisiere Spotify Player...");

    player = new Spotify.Player({
        name: "Emotion Player",
        getOAuthToken: (cb) => cb(accessToken),
        volume: 0.5,
    });

    player.addListener("ready", async ({ device_id }) => {
        deviceId = device_id;
        playerReady = true;

        PLAYLISTS = getEffectivePlaylists(); // nochmal aktuell
        currentContextUri = PLAYLISTS[currentEmotion];

        log("Player ready:", device_id);
        log("Starte mit Emotion:", currentEmotion, "->", currentContextUri);

        if (prevBtn) prevBtn.disabled = false;
        if (nextBtn) nextBtn.disabled = false;
        if (volumeSlider) volumeSlider.disabled = false;

        try {
            const vol = await player.getVolume();
            const volPercent = Math.round(vol * 100);
            if (volumeSlider) volumeSlider.value = volPercent.toString();
            if (volumeValueEl) volumeValueEl.textContent = volPercent + "%";
        } catch {}

        // Shuffle
        try {
            await fetch(
                `https://api.spotify.com/v1/me/player/shuffle?state=true&device_id=${deviceId}`,
                { method: "PUT", headers: { Authorization: "Bearer " + accessToken } }
            );
        } catch {}

        if (SELECTED_MODE === "auto") {
            if (typeof window.resetEmotionStats === "function") window.resetEmotionStats();
        }

        await startPlayback();
        isPlaying = true;
        if (startBtn) startBtn.textContent = PAUSE_ICON;

        startProgressLoop();
    });

    player.addListener("initialization_error", ({ message }) => log("Init Error:", message));
    player.addListener("authentication_error", ({ message }) => log("Auth Error:", message));
    player.addListener("account_error", ({ message }) => log("Account Error:", message));
    player.addListener("playback_error", ({ message }) => log("Playback Error:", message));

    await player.connect();
}

// StartBtn toggle
startBtn?.addEventListener("click", async () => {
    if (!accessToken) return;

    if (!playerReady || !player) {
        await initPlayerIfNeeded();
        return;
    }

    try {
        if (isPlaying) {
            await player.pause();
            isPlaying = false;
            if (startBtn) startBtn.textContent = PLAY_ICON;
        } else {
            await player.resume();
            isPlaying = true;
            if (startBtn) startBtn.textContent = PAUSE_ICON;
        }
    } catch (err) {
        log("Pause/Resume Fehler:", err);
    }
});

// Timeline + UI helpers
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

    if (trackImage) {
        const img = track.album && track.album.images && track.album.images[0];
        trackImage.src = img ? img.url : "";
    }

    if (trackTitleEl) trackTitleEl.textContent = track.name || "Unbekannter Titel";
    if (trackArtistEl) {
        const artistNames = (track.artists || []).map((a) => a.name).join(", ");
        trackArtistEl.textContent = artistNames || "Unbekannter Artist";
    }

    const position = state.position || 0;
    const duration = state.duration || track.duration_ms || 0;
    currentDurationMs = duration;

    if (durationEl) durationEl.textContent = msToTime(duration);

    if (!isSeeking && currentTimeEl) currentTimeEl.textContent = msToTime(position);

    if (progressBar) {
        progressBar.disabled = duration <= 0;
        progressBar.max = duration.toString();
        if (!isSeeking) progressBar.value = position.toString();
    }
}

progressBar?.addEventListener("input", (e) => {
    if (!currentDurationMs) return;
    isSeeking = true;
    const newPos = Number(e.target.value);
    if (currentTimeEl) currentTimeEl.textContent = msToTime(newPos);
});

progressBar?.addEventListener("change", async (e) => {
    if (!player) { isSeeking = false; return; }
    const newPos = Number(e.target.value);
    try { await player.seek(newPos); } catch {}
    isSeeking = false;
});

// Prev/Next
prevBtn?.addEventListener("click", async () => {
    if (!player) return;
    try { await player.previousTrack(); } catch {}
});

nextBtn?.addEventListener("click", async () => {
    if (!player) return;

    try {
        if (SELECTED_MODE === "auto") {
            const changed = await evaluateAndMaybeSwitchEmotion("skip_next");
            if (!changed) await player.nextTrack();
        } else {
            await player.nextTrack();
        }
    } catch {}
});

// Volume
volumeSlider?.addEventListener("input", async (e) => {
    const val = Number(e.target.value);
    if (volumeValueEl) volumeValueEl.textContent = `${val}%`;
    if (!player) return;

    try { await player.setVolume(val / 100); } catch {}
});

// ===============================
// Playlist setzen (Manual & Auto)
// ===============================
async function applyEmotionNow(emotion) {
    PLAYLISTS = getEffectivePlaylists(); // ✅ immer aktuell
    if (!PLAYLISTS[emotion]) {
        log("Unbekannte Emotion beim Anwenden:", emotion);
        return;
    }

    currentEmotion = emotion;
    currentContextUri = PLAYLISTS[currentEmotion];

    if (SELECTED_MODE === "manual") {
        sessionStorage.setItem("manual_emotion", currentEmotion);
    }

    log("Wechsle jetzt Playlist auf Emotion:", currentEmotion, "->", currentContextUri);

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
        log("Playlist gesetzt ✅");
    } else {
        log("Fehler beim Setzen:", res.status, await res.text());
    }
}

// ✅ für manual.html
window.applyEmotionNow = applyEmotionNow;

// Start playback
async function startPlayback() {
    if (!deviceId) return;

    PLAYLISTS = getEffectivePlaylists();
    currentContextUri = PLAYLISTS[currentEmotion];

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
