const CLIENT_ID = "c1118e23caa84e6497022d00757dc5a0";
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

// ===============================
// CUSTOM PLAYLISTS
// ===============================
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

// ===============================
// STATE
// ===============================
let currentEmotion =
    SELECTED_MODE === "manual"
        ? (sessionStorage.getItem("manual_emotion") || "happy")
        : "happy";

let currentContextUri = PLAYLISTS[currentEmotion];
let pendingEmotion = null;

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

// ===============================
// UI
// ===============================
const logEl = document.getElementById("log");
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

const PLAY_ICON = "▶️";
const PAUSE_ICON = "⏸️";

// ===============================
// LOG
// ===============================
const log = (...msg) => {
    if (logEl) logEl.textContent += msg.join(" ") + "\n";
    console.log(...msg);
};

// ===============================
// START BUTTON ENABLE
// ===============================
if (startBtn) {
    if (accessToken) {
        startBtn.disabled = false;
        startBtn.textContent = PLAY_ICON;
        log("Access Token gefunden. Modus:", SELECTED_MODE);
    } else {
        log("Kein Access Token – bitte auth.html nutzen.");
    }
}

// ===============================
// TIMELINE
// ===============================
let isSeeking = false;
let currentDurationMs = 0;
let progressInterval = null;

// ===============================
// TOKEN EXCHANGE (callback.html)
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
// CALLBACK LOGIC
// ===============================
(async () => {
    if (!window.location.pathname.endsWith("callback.html")) return;

    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");

    if (!code) return;

    log("Code empfangen:", code);
    await exchangeCodeForToken(code);

    if (sessionStorage.getItem("spotify_access_token")) {
        log("Weiterleitung zu start.html ...");
        window.location = "start.html";
    } else {
        log("❌ Kein Token nach Exchange.");
    }
})();

// ===============================
// SPOTIFY HELPERS
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
            log("✅ Transfer Playback OK (204)");
            await new Promise((r) => setTimeout(r, 300));
            return true;
        }

        const text = await res.text();
        log("⚠️ Transfer Antwort:", res.status, text);
        return false;
    } catch (e) {
        log("❌ Transfer Error:", e);
        return false;
    }
}

// ===============================
// DEBUG
// ===============================
async function debugPlayerState(label = "DEBUG") {
    try {
        const [devicesRes, playerRes, currentRes] = await Promise.all([
            fetch("https://api.spotify.com/v1/me/player/devices", {
                headers: { Authorization: "Bearer " + accessToken },
            }),
            fetch("https://api.spotify.com/v1/me/player", {
                headers: { Authorization: "Bearer " + accessToken },
            }),
            fetch("https://api.spotify.com/v1/me/player/currently-playing", {
                headers: { Authorization: "Bearer " + accessToken },
            }),
        ]);

        const devices = await devicesRes.json().catch(() => null);
        const playerState = await playerRes.json().catch(() => null);
        const current = await currentRes.json().catch(() => null);

        log(`🧪 ${label} /devices:`, devicesRes.status, JSON.stringify(devices));
        log(`🧪 ${label} /me/player:`, playerRes.status, JSON.stringify(playerState));
        log(`🧪 ${label} /currently-playing:`, currentRes.status, JSON.stringify(current));
    } catch (e) {
        log("debugPlayerState error:", e);
    }
}

// ===============================
// CLEAN SWITCH SYSTEM
// ===============================
async function setDeviceVolumePercent(percent) {
    if (!deviceId || !accessToken) return;
    const p = Math.max(0, Math.min(100, Math.round(percent)));
    try {
        await fetch(
            `https://api.spotify.com/v1/me/player/volume?volume_percent=${p}&device_id=${deviceId}`,
            {
                method: "PUT",
                headers: { Authorization: "Bearer " + accessToken },
            }
        );
    } catch {}
}

async function getCurrentVolumePercentFallback() {
    if (volumeSlider && volumeSlider.value) return Number(volumeSlider.value);
    return 50;
}

async function fadeDeviceVolume(from, to, ms = 300, steps = 12) {
    const stepMs = Math.max(10, Math.floor(ms / steps));
    for (let i = 1; i <= steps; i++) {
        const v = from + ((to - from) * i) / steps;
        await setDeviceVolumePercent(v);
        await new Promise((r) => setTimeout(r, stepMs));
    }
}

async function pauseHard() {
    try {
        await fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${deviceId}`, {
            method: "PUT",
            headers: { Authorization: "Bearer " + accessToken },
        });
    } catch {}
}

async function playContextHard(body) {
    try {
        return await fetch(
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
    } catch (e) {
        log("playContextHard error:", e);
        return null;
    }
}

// ===============================
// 🎧 CLEAN PLAY
// ===============================
async function cleanSwitchPlay(body) {
    if (!deviceId || !accessToken) return null;

    const originalVol = await getCurrentVolumePercentFallback();

    // HARD MUTE
    await setDeviceVolumePercent(0);

    // DOUBLE PAUSE
    await pauseHard();
    await new Promise((r) => setTimeout(r, 80));
    await pauseHard();

    // FORCE START NEW CONTEXT AT 0
    const safeBody = {
        ...body,
        position_ms: 0,
        offset: body.context_uri ? { position: 0 } : undefined,
    };

    const res = await playContextHard(safeBody);

    // WAIT FOR SWITCH
    await new Promise((r) => setTimeout(r, 200));

    // FADE IN
    await fadeDeviceVolume(0, originalVol, 350, 14);

    return res;
}

// ===============================
// EMOTION BUTTONS
// ===============================
function scheduleEmotionChange(emotion) {
    PLAYLISTS = getEffectivePlaylists();
    if (!PLAYLISTS[emotion]) return;
    pendingEmotion = emotion;
    log("Neue Emotion geplant:", emotion);
}

document.querySelectorAll("[data-emotion]").forEach((btn) => {
    btn.addEventListener("click", () => {
        scheduleEmotionChange(btn.getAttribute("data-emotion"));
    });
});

// ===============================
// PROGRESS LOOP
// ===============================
function startProgressLoop() {
    if (!player) return;
    if (progressInterval) clearInterval(progressInterval);

    progressInterval = setInterval(async () => {
        if (!player || isSeeking || isSwitchingPlaylist) return;

        try {
            const state = await player.getCurrentState();
            if (!state || !state.track_window?.current_track) return;

            updateNowPlayingUI(state);

            const track = state.track_window.current_track;
            const currentId = track.id;
            const position = state.position || 0;
            const duration = state.duration || track.duration_ms || 0;

            if (!currentId || !duration) return;

            if (currentId !== lastTrackId) {
                lastTrackId = currentId;
                preEndHandledTrackId = null;
            }

            if (SELECTED_MODE === "auto") {
                const remaining = duration - position;
                if (remaining <= 1500 && preEndHandledTrackId !== currentId) {
                    preEndHandledTrackId = currentId;
                    await evaluateAndMaybeSwitchEmotion("song_end");
                }
            }
        } catch {}
    }, 500);
}

// ===============================
// AUTO SWITCH
// ===============================
async function evaluateAndMaybeSwitchEmotion(reason) {
    if (SELECTED_MODE !== "auto" || isSwitchingPlaylist) return false;

    PLAYLISTS = getEffectivePlaylists();
    let chosenEmotion = null;

    if (pendingEmotion && PLAYLISTS[pendingEmotion]) {
        chosenEmotion = pendingEmotion;
    } else if (typeof window.getDominantEmotion === "function") {
        const cam = window.getDominantEmotion();
        if (cam && PLAYLISTS[cam]) chosenEmotion = cam;
    }

    pendingEmotion = null;
    if (!chosenEmotion || chosenEmotion === currentEmotion) return false;

    isSwitchingPlaylist = true;
    if (progressInterval) clearInterval(progressInterval);

    await applyEmotionNow(chosenEmotion);

    setTimeout(() => {
        isSwitchingPlaylist = false;
        startProgressLoop();
    }, 500);

    return true;
}

// ===============================
// SDK READY
// ===============================
window.onSpotifyWebPlaybackSDKReady = () => {
    log("Spotify Web Playback SDK geladen");
};

// ===============================
// INIT PLAYER
// ===============================
async function initPlayerIfNeeded() {
    if (player || playerReady || !accessToken) return;

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

        await transferPlaybackToWebSDKDevice();

        await startPlayback();
        isPlaying = true;
        if (startBtn) startBtn.textContent = PAUSE_ICON;

        startProgressLoop();
    });

    await player.connect();
}

// ===============================
// PLAY / PAUSE
// ===============================
startBtn?.addEventListener("click", async () => {
    if (!accessToken) return;

    if (!playerReady) {
        await initPlayerIfNeeded();
        return;
    }

    try {
        if (isPlaying) {
            await player.pause();
            isPlaying = false;
            startBtn.textContent = PLAY_ICON;
        } else {
            await player.resume();
            isPlaying = true;
            startBtn.textContent = PAUSE_ICON;
        }
    } catch {}
});

// ===============================
// UI HELPERS
// ===============================
function msToTime(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function updateNowPlayingUI(state) {
    const track = state.track_window.current_track;
    if (!track) return;

    const img = track.album?.images?.[0];
    if (trackImage) trackImage.src = img?.url || "";

    if (trackTitleEl) trackTitleEl.textContent = track.name || "";
    if (trackArtistEl)
        trackArtistEl.textContent =
            track.artists?.map((a) => a.name).join(", ") || "";

    const pos = state.position || 0;
    const dur = state.duration || track.duration_ms || 0;
    currentDurationMs = dur;

    if (currentTimeEl) currentTimeEl.textContent = msToTime(pos);
    if (durationEl) durationEl.textContent = msToTime(dur);

    if (progressBar && !isSeeking) {
        progressBar.max = String(dur);
        progressBar.value = String(pos);
    }
}

// ===============================
// SEEK
// ===============================
progressBar?.addEventListener("input", (e) => {
    isSeeking = true;
    if (currentTimeEl) currentTimeEl.textContent = msToTime(Number(e.target.value));
});

progressBar?.addEventListener("change", async (e) => {
    try { await player.seek(Number(e.target.value)); } catch {}
    isSeeking = false;
});

// ===============================
// TRACK CONTROLS
// ===============================
prevBtn?.addEventListener("click", async () => {
    try { await player.previousTrack(); } catch {}
});

nextBtn?.addEventListener("click", async () => {
    if (SELECTED_MODE === "auto") {
        const changed = await evaluateAndMaybeSwitchEmotion("skip_next");
        if (!changed) await player.nextTrack();
    } else {
        await player.nextTrack();
    }
});

// ===============================
// VOLUME UI
// ===============================
volumeSlider?.addEventListener("input", async (e) => {
    const val = Number(e.target.value);
    if (volumeValueEl) volumeValueEl.textContent = `${val}%`;
    try { await player.setVolume(val / 100); } catch {}
});

// ===============================
// APPLY EMOTION
// ===============================
async function applyEmotionNow(emotion) {
    PLAYLISTS = getEffectivePlaylists();
    if (!PLAYLISTS[emotion]) return;

    currentEmotion = emotion;
    currentContextUri = PLAYLISTS[currentEmotion];

    if (SELECTED_MODE === "manual") {
        sessionStorage.setItem("manual_emotion", currentEmotion);
    }

    const body = currentContextUri.startsWith("spotify:playlist")
        ? { context_uri: currentContextUri }
        : { uris: [currentContextUri] };

    await transferPlaybackToWebSDKDevice();

    const res = await cleanSwitchPlay(body);

    if (res && res.status === 204) {
        log("✅ Playlist gesetzt:", currentEmotion);
        return;
    }

    const txt = res ? await res.text() : "";
    log("Fehler:", res?.status, txt);

    if (res?.status === 403) {
        await debugPlayerState("403_APPLY");
    }
}

window.applyEmotionNow = applyEmotionNow;

// ===============================
// START PLAYBACK
// ===============================
async function startPlayback() {
    PLAYLISTS = getEffectivePlaylists();
    currentContextUri = PLAYLISTS[currentEmotion];

    const body = currentContextUri.startsWith("spotify:playlist")
        ? { context_uri: currentContextUri }
        : { uris: [currentContextUri] };

    const res = await cleanSwitchPlay(body);

    if (res && res.status === 204) {
        log("Playback gestartet! Emotion:", currentEmotion);
        return;
    }

    const txt = res ? await res.text() : "";
    log("Fehler:", res?.status, txt);

    if (res?.status === 403) {
        await debugPlayerState("403_START");
    }
}
