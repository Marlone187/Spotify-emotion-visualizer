// ===============================
// Kamera-Emotionserkennung (stabil + IMMER Balken)
// - KEIN "Song bisher" Text
// - setzt NUR: #emotion-text = "Momentan: X (YY%)" (textContent)
// - falls Balken/Status fehlen: werden in .emotion-stats ergänzt (kein 2. Overlay)
// - Cache-proof: du musst trotzdem unten ?v=... nutzen
// ===============================
(function () {
    const EMOTIONS = ["happy", "neutral", "sad", "angry"];
    const LABEL = { happy: "Happy", neutral: "Neutral", sad: "Sad", angry: "Angry" };

    let emotionScores = { happy: 0, neutral: 0, sad: 0, angry: 0 };

    window.__cameraReady = false;
    window.__cameraStatus = "init";

    const log = (...a) => console.log("[camera]", ...a);

    function ensureBarsUI() {
        // wir nutzen vorhandenes Layout, falls vorhanden
        const statsBox = document.querySelector(".camera-overlay .emotion-stats");
        if (!statsBox) return;

        // Status-Zeile sicherstellen
        let statusSpan = document.getElementById("emotion-text");
        if (!statusSpan) {
            // wenn eine status-line existiert, nutzen; sonst erstellen
            let statusLine = statsBox.querySelector(".status-line");
            if (!statusLine) {
                statusLine = document.createElement("div");
                statusLine.className = "status-line";
                statusLine.style.marginBottom = "15px";
                statsBox.prepend(statusLine);
            }
            statusLine.innerHTML = `Status: <span class="status-highlight" id="emotion-text">Analysiere...</span>`;
            statusSpan = document.getElementById("emotion-text");
        }

        // Balken prüfen – wenn happy nicht existiert, bauen wir alle 4
        if (document.getElementById("bar-happy")) return;

        const makeBar = (title, key) => {
            const group = document.createElement("div");
            group.className = "bar-group";
            group.style.marginTop = "12px";

            const header = document.createElement("div");
            header.className = "bar-header";
            header.style.cssText =
                "display:flex; justify-content:space-between; font-size:10px; text-transform: uppercase; letter-spacing: 1px;";
            header.innerHTML = `<span>${title}</span><span id="val-${key}">0%</span>`;

            const bg = document.createElement("div");
            bg.className = "bar-bg";

            const fill = document.createElement("div");
            fill.className = "bar-fill";
            fill.id = `bar-${key}`;

            bg.appendChild(fill);
            group.appendChild(header);
            group.appendChild(bg);
            return group;
        };

        statsBox.appendChild(makeBar("Happy", "happy"));
        statsBox.appendChild(makeBar("Neutral", "neutral"));
        statsBox.appendChild(makeBar("Sad", "sad"));
        statsBox.appendChild(makeBar("Angry", "angry"));

        log("Balken-UI ergänzt ✅");
    }

    function setStatusMoment(bestEmo, prob01) {
        const pct = Math.round((prob01 || 0) * 100);
        const text = `Momentan: ${LABEL[bestEmo] || bestEmo} (${pct}%)`;
        window.__cameraStatus = text;

        const el = document.getElementById("emotion-text");
        if (el) el.textContent = text; // ✅ NIE innerHTML
    }

    function setStatusPlain(text) {
        window.__cameraStatus = text;
        const el = document.getElementById("emotion-text");
        if (el) el.textContent = text; // ✅ NIE innerHTML
    }

    function updateBars(stats) {
        EMOTIONS.forEach((e) => {
            const bar = document.getElementById(`bar-${e}`);
            const val = document.getElementById(`val-${e}`);
            const pct = stats?.[e] ?? 0;
            if (bar) bar.style.width = pct + "%";
            if (val) val.textContent = pct + "%";
        });
    }

    function resetEmotionScores() {
        EMOTIONS.forEach((e) => (emotionScores[e] = 0));
        updateBars({ happy: 0, neutral: 0, sad: 0, angry: 0 });
        log("Emotion-Scores zurückgesetzt.");
    }

    window.resetEmotionStats = resetEmotionScores;

    window.getDominantEmotion = function () {
        const top = Object.entries(emotionScores).sort((a, b) => b[1] - a[1])[0];
        if (!top) return null;
        const [emo, score] = top;
        return score > 0 ? emo : null;
    };

    window.getEmotionStats = function () {
        const total = Object.values(emotionScores).reduce((a, b) => a + b, 0);
        if (!total) return null;
        const out = {};
        EMOTIONS.forEach((e) => (out[e] = Math.round((emotionScores[e] / total) * 100)));
        return out;
    };

    async function waitForVideoReady(videoEl, timeoutMs = 12000) {
        const start = Date.now();
        return new Promise((resolve, reject) => {
            const tick = () => {
                const ok = videoEl.readyState >= 2 && videoEl.videoWidth > 0 && videoEl.videoHeight > 0;
                if (ok) return resolve(true);
                if (Date.now() - start > timeoutMs) return reject(new Error("Video not ready (timeout)"));
                requestAnimationFrame(tick);
            };
            tick();
        });
    }

    async function loadModelsWithRetry(modelPath = "./models", retries = 3) {
        let lastErr = null;
        for (let i = 1; i <= retries; i++) {
            try {
                setStatusPlain(`Lade Modelle… (${i}/${retries})`);
                await Promise.all([
                    faceapi.nets.ssdMobilenetv1.loadFromUri(modelPath),
                    faceapi.nets.faceExpressionNet.loadFromUri(modelPath),
                ]);
                log("Modelle geladen ✅");
                return true;
            } catch (e) {
                lastErr = e;
                log("Model-Load Fehler:", e);
                await new Promise((r) => setTimeout(r, 700));
            }
        }
        throw lastErr || new Error("Model load failed");
    }

    window.addEventListener("load", () => {
        // ✅ UI in vorhandenes Layout injizieren (manual + index)
        ensureBarsUI();

        const videoEl = document.getElementById("video-feed");
        if (!videoEl) {
            log("Kein #video-feed gefunden → Kamera läuft nicht.");
            return;
        }

        if (!window.faceapi) {
            setStatusPlain("face-api nicht geladen.");
            log("face-api.js fehlt.");
            return;
        }

        (async () => {
            try {
                window.__cameraReady = false;
                setStatusPlain("Starte Kamera…");

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: "user" },
                    audio: false,
                });

                videoEl.srcObject = stream;
                videoEl.setAttribute("playsinline", "true");
                videoEl.muted = true;

                try { await videoEl.play(); } catch {}

                await waitForVideoReady(videoEl, 12000);
                log("Video ready ✅", videoEl.videoWidth, "x", videoEl.videoHeight);

                await loadModelsWithRetry("./models", 3);

                window.__cameraReady = true;
                resetEmotionScores();
                setStatusPlain("Erkenne Emotionen…");

                let lastTs = 0;
                const intervalMs = 120; // ~8 FPS

                const loop = async (ts) => {
                    requestAnimationFrame(loop);

                    if (!window.__cameraReady) return;
                    if (ts - lastTs < intervalMs) return;
                    lastTs = ts;

                    let detections;
                    try {
                        detections = await faceapi.detectAllFaces(videoEl).withFaceExpressions();
                    } catch (e) {
                        log("detectAllFaces Fehler:", e);
                        return;
                    }

                    if (!detections || detections.length === 0) {
                        setStatusPlain("Kein Gesicht erkannt");
                        return;
                    }

                    const ex = detections[0].expressions || {};
                    const filtered = {
                        happy: ex.happy ?? 0,
                        neutral: ex.neutral ?? 0,
                        sad: ex.sad ?? 0,
                        angry: ex.angry ?? 0,
                    };

                    const best = Object.entries(filtered).sort((a, b) => b[1] - a[1])[0];
                    const bestEmo = best?.[0] || "neutral";
                    const prob = best?.[1] || 0;

                    // ✅ Aggregation mit Multiplier (sad/angry leichter)
                    const MULT = { happy: 1, neutral: 1, sad: 5, angry: 2 };

                    for (const [k, v] of Object.entries(filtered)) {
                        if (!Number.isFinite(v)) continue;
                        emotionScores[k] += v * (MULT[k] ?? 1);
                    }


                    // Prozent
                    const total = Object.values(emotionScores).reduce((a, b) => a + b, 0);
                    const stats = { happy: 0, neutral: 0, sad: 0, angry: 0 };
                    if (total > 0) {
                        EMOTIONS.forEach((e) => (stats[e] = Math.round((emotionScores[e] / total) * 100)));
                    }

                    // ✅ NUR Status + Balken
                    setStatusMoment(bestEmo, prob);
                    updateBars(stats);
                };

                requestAnimationFrame(loop);
                log("Detection Loop gestartet ✅");
            } catch (e) {
                window.__cameraReady = false;
                log("Kamera init Fehler:", e);
                setStatusPlain("Kamera/Modelle Fehler (siehe Konsole).");
            }
        })();
    });
})();
