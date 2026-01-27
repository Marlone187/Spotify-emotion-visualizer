const CLIENT_ID = "c6c192d6f0c54c68bbb4342717ca9501";
const REDIRECT_URI = "https://marlone187.github.io/Spotify-emotion-visualizer/callback.html";

// Modus: "auto" oder "manual"
const SELECTED_MODE = sessionStorage.getItem("selected_mode") || "auto";

// Default Playlists
const DEFAULT_PLAYLISTS = {
    happy: "spotify:playlist:0s4GDB01raiqiNVstNfUXe",
    sad: "spotify:playlist:45rWp1I6aL5ruR3WNG5K2H",
    neutral: "spotify:playlist:07LPGPmhNOGYiWIaFhY61V",
    angry: "spotify:playlist:55DSMbgOO36tDodpwCykG4",
};

// Custom Playlists (Prototyp) aus localStorage
function loadCustomPlaylists() {
    const raw = localStorage.getItem("custom_playlists");
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
}

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

let PLAYLISTS = getEffectivePlaylists();

// Startemotion
let currentEmotion =
    SELECTED_MODE === "manual"
        ? (sessionStorage.getItem("manual_emotion") || "happy")
        : "happy";

let currentContextUri = PLAYLISTS[currentEmotion];

// Auto: Button override
let pendingEmotion = null;

// Logging
const logEl = document.getElementById("log");
const log = (...msg) => {
    if (logEl) logEl.textContent += msg.join(" ") + "\n";
    console.log(...msg);
};

// Token / Player
let accessToken = sessionStorage.getItem("spotify_access_token") || null;
let player = null;
let deviceId = null;
let lastTrackId = null;
let isPlaying = false;
let playerReady = false;

// Auto helpers
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

const PLAY_ICON = "▶";
const PAUSE_ICON = "❚❚";

// Start-Button enable
if (startBtn) {
    if (accessToken) {
        startBtn.disabled = false;
        startBtn.textContent = PLAY_ICON;
        log("Access Token gefunden. Modus:", SELECTED_MODE);
    } else {
        log("Kein Access Token – bitte auth.html nutzen.");
    }
}

// Timeline
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
            log("Weiterleitung zu start.html ...");
            window.location = "start.html";
        } else {
            log("❌ Kein Token nach Exchange.");
        }
    }
})();

// ===============================
// ✅ FIX: Transfer Playback (gegen 403 Restriction violated)
// ===============================
async function transferPlaybackToWebSDKDevice() {
    if (!deviceId || !accessToken) return false;

    try {
        log("🔁 Transfer Playback auf Web-Player Device...");

        const res = await fetch("https://api.spotify.com/v1/me/player", {
            method: "PUT",
            headers: {
                Authorization: "Bearer " + accessToken,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                device_ids: [deviceId],
                play: false,
            }),
        });

        if (res.status === 204) {
            log("✅ Transfer Playback OK (204).");
            await new Promise((r) => setTimeout(r, 300));
            return true;
        }

        const text = await res.text();
        log("⚠️ Transfer Playback Antwort:", res.status, text);
        await new Promise((r) => setTimeout(r, 300));
        return res.ok;
    } catch (e) {
        log("❌ Transfer Playback Error:", e);
        return false;
    }
}

// ===============================
// Auto: optional Emotion Buttons (falls auf index.html vorhanden)
// ===============================
function scheduleEmotionChange(emotion) {
    PLAYLISTS = getEffectivePlaylists();
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
// Progress Loop
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
                if (lastTrackId) log("🎵 Songwechsel:", lastTrackId, "→", currentId);
                lastTrackId = currentId;
                preEndHandledTrackId = null;
            }

            // ✅ Auto only
            if (SELECTED_MODE === "auto") {
                const remaining = duration - position;
                if (remaining <= 1500 && remaining >= 0 && preEndHandledTrackId !== currentId) {
                    preEndHandledTrackId = currentId;
                    log(`⏱ Song endet bald (Rest: ${Math.round(remaining)}ms) → Emotion auswerten.`);
                    await evaluateAndMaybeSwitchEmotion("song_end");
                }
            }
        } catch (err) {
            log("getCurrentState Fehler:", err);
        }
    }, 500);
}

// ===============================
// Auto: Emotion evaluieren & ggf. wechseln
// ===============================
async function evaluateAndMaybeSwitchEmotion(reason) {
    if (SELECTED_MODE !== "auto") return false;
    if (isSwitchingPlaylist) return false;

    PLAYLISTS = getEffectivePlaylists();

    let chosenEmotion = null;

    if (pendingEmotion && PLAYLISTS[pendingEmotion]) {
        chosenEmotion = pendingEmotion;
        log("Button-Emotion:", chosenEmotion);
    } else if (typeof window.getDominantEmotion === "function") {
        const cameraEmotion = window.getDominantEmotion();
        if (cameraEmotion && PLAYLISTS[cameraEmotion]) {
            chosenEmotion = cameraEmotion;
            log("Kamera-Emotion:", chosenEmotion);
        }
    }

    pendingEmotion = null;
    if (typeof window.resetEmotionStats === "function") window.resetEmotionStats();

    if (!chosenEmotion || chosenEmotion === currentEmotion) return false;

    log("Playlistwechsel:", currentEmotion, "→", chosenEmotion, "| Grund:", reason);

    isSwitchingPlaylist = true;
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }

    try { await player.pause(); } catch {}

    await applyEmotionNow(chosenEmotion);

    setTimeout(() => {
        isSwitchingPlaylist = false;
        startProgressLoop();
    }, 400);

    return true;
}

// ===============================
// Spotify SDK Ready
// ===============================
window.onSpotifyWebPlaybackSDKReady = () => {
    log("Spotify Web Playback SDK geladen");
};

// ===============================
// Player Init
// ===============================
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

        PLAYLISTS = getEffectivePlaylists();
        currentContextUri = PLAYLISTS[currentEmotion];

        log("Player ready:", deviceId);
        log("Startemotion:", currentEmotion, "→", currentContextUri);

        if (prevBtn) prevBtn.disabled = false;
        if (nextBtn) nextBtn.disabled = false;
        if (volumeSlider) volumeSlider.disabled = false;

        try {
            const vol = await player.getVolume();
            const volPercent = Math.round(vol * 100);
            if (volumeSlider) volumeSlider.value = String(volPercent);
            if (volumeValueEl) volumeValueEl.textContent = volPercent + "%";
        } catch {}

        // ✅ FIX: Transfer Playback
        await transferPlaybackToWebSDKDevice();

        // Shuffle (optional)
        try {
            const shuffleRes = await fetch(
                `https://api.spotify.com/v1/me/player/shuffle?state=true&device_id=${deviceId}`,
                { method: "PUT", headers: { Authorization: "Bearer " + accessToken } }
            );
            if (shuffleRes.status === 204) log("Shuffle aktiviert ✅");
            else log("Shuffle Fehler:", shuffleRes.status, await shuffleRes.text());
        } catch (e) {
            log("Shuffle Request Error:", e);
        }

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

// ===============================
// Start Button Toggle
// ===============================
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
            log("Playback pausiert.");
        } else {
            await player.resume();
            isPlaying = true;
            if (startBtn) startBtn.textContent = PAUSE_ICON;
            log("Playback fortgesetzt.");
        }
    } catch (err) {
        log("Pause/Resume Fehler:", err);
    }
});

// ===============================
// Now Playing UI / Timeline
// ===============================
function msToTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function updateNowPlayingUI(state) {
    const track = state.track_window.current_track;
    if (!track) return;

    if (trackImage) {
        const img = track.album?.images?.[0];
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
        progressBar.max = String(duration);
        if (!isSeeking) progressBar.value = String(position);
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
    try { await player.seek(newPos); } catch (err) { log("Seek Fehler:", err); }
    isSeeking = false;
});

// ===============================
// Prev / Next
// ===============================
prevBtn?.addEventListener("click", async () => {
    if (!player) return;
    try { await player.previousTrack(); } catch (err) { log("Prev Fehler:", err); }
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
    } catch (err) {
        log("Next Fehler:", err);
    }
});

// ===============================
// Volume
// ===============================
volumeSlider?.addEventListener("input", async (e) => {
    const val = Number(e.target.value);
    if (volumeValueEl) volumeValueEl.textContent = `${val}%`;
    if (!player) return;
    try { await player.setVolume(val / 100); } catch (err) { log("setVolume Fehler:", err); }
});

// ===============================
// ✅ Playlist setzen (Manual & Auto) + 403 Retry
// ===============================
async function applyEmotionNow(emotion) {
    PLAYLISTS = getEffectivePlaylists();
    if (!PLAYLISTS[emotion]) {
        log("Unbekannte Emotion:", emotion);
        return;
    }

    currentEmotion = emotion;
    currentContextUri = PLAYLISTS[currentEmotion];

    // NEU: Theme-Farbe anpassen
    if (typeof window.setEmotionTheme === 'function') {
        window.setEmotionTheme(currentEmotion);
    }

    if (SELECTED_MODE === "manual") {
        sessionStorage.setItem("manual_emotion", currentEmotion);
    }

    if (!deviceId || !accessToken) {
        log("Kein Device/Token – kann nicht play setzen.");
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
        log("✅ Playlist gesetzt:", currentEmotion);
        return;
    }

    const txt = await res.text();
    log("Fehler beim Wechseln:", res.status, txt);

    if (res.status === 403) {
        log("⚠️ 403 Restriction violated → Transfer + Retry...");
        await transferPlaybackToWebSDKDevice();

        const retry = await fetch(
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

        if (retry.status === 204) log("✅ Retry erfolgreich!");
        else log("❌ Retry fehlgeschlagen:", retry.status, await retry.text());
    }
}

window.applyEmotionNow = applyEmotionNow;

// ===============================
// Start playback + 403 handling
// ===============================
async function startPlayback() {
    if (!deviceId) {
        log("Kein deviceId.");
        return;
    }

    PLAYLISTS = getEffectivePlaylists();
    currentContextUri = PLAYLISTS[currentEmotion];

    // NEU: Theme-Farbe anpassen (beim ersten Start)
    if (typeof window.setEmotionTheme === 'function') {
        window.setEmotionTheme(currentEmotion);
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
        return;
    }

    const txt = await res.text();
    log("Fehler:", res.status, txt);

    if (res.status === 403) {
        log(
            "⚠️ 403 Restriction violated: Bitte Spotify App (Handy/Desktop) kurz öffnen, " +
            "ein Lied starten/pausieren und dann hier erneut versuchen."
        );

        await transferPlaybackToWebSDKDevice();

        const retry = await fetch(
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

        if (retry.status === 204) {
            log("✅ Retry nach Transfer erfolgreich!");
        } else {
            log("❌ Retry fehlgeschlagen:", retry.status, await retry.text());
        }
    }
}
