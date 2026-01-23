// ===============================
// Kamera-Emotionserkennung mit face-api.js
// Optimiert für das neue Balken-UI
// ===============================
(function () {
    const EMOTIONS = ["neutral", "happy", "sad", "angry"];
    const EMOTION_LABELS = {
        neutral: "Neutral",
        happy: "Glücklich",
        sad: "Traurig",
        angry: "Wütend",
    };

    let emotionScores = { neutral: 0, happy: 0, sad: 0, angry: 0 };

    function resetEmotionScores() {
        EMOTIONS.forEach((e) => { emotionScores[e] = 0; });
        console.log("[camera] Emotion-Scores zurückgesetzt.");
        updateUI({ happy: 0, neutral: 0, sad: 0, angry: 0 }, "Warte...", 0);
    }

    window.resetEmotionStats = resetEmotionScores;

    window.getDominantEmotion = function () {
        const entries = Object.entries(emotionScores);
        const top = entries.sort((a, b) => b[1] - a[1])[0];
        return (top && top[1] > 0) ? top[0] : null;
    };

    // Hilfsfunktion: Aktualisiert alle UI-Elemente
    function updateUI(stats, currentLabel, currentProb) {
        // 1. Status-Text oben (Momentaufnahme)
        const statusEl = document.getElementById("emotion-text");
        if (statusEl) {
            statusEl.textContent = `Momentan: ${currentLabel} (${Math.round(currentProb * 100)}%)`;
        }

        // 2. Song-Zusammenfassung Text
        const summaryEl = document.getElementById("song-summary");
        if (summaryEl) {
            summaryEl.innerText = `Song bisher: 😊 Happy ${stats.happy}% | 😐 Neutral ${stats.neutral}% | 😢 Sad ${stats.sad}% | 😡 Angry ${stats.angry}%`;
        }

        // 3. Balken und Prozentzahlen aktualisieren
        EMOTIONS.forEach(e => {
            const bar = document.getElementById(`bar-${e}`);
            const val = document.getElementById(`val-${e}`);
            if (bar) bar.style.width = stats[e] + "%";
            if (val) val.innerText = stats[e] + "%";
        });
    }

    window.addEventListener("load", () => {
        const videoEl = document.getElementById("video-feed");
        const statusEl = document.getElementById("emotion-text");

        if (!videoEl || !window.faceapi) return;

        (async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true });
                videoEl.srcObject = stream;
            } catch (e) {
                if (statusEl) statusEl.textContent = "Kamera blockiert.";
                return;
            }

            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri("./models"),
                faceapi.nets.faceExpressionNet.loadFromUri("./models"),
            ]);

            const detect = async () => {
                const detections = await faceapi.detectAllFaces(videoEl).withFaceExpressions();

                if (detections.length > 0) {
                    const ex = detections[0].expressions;
                    const filtered = {
                        neutral: ex.neutral ?? 0,
                        happy: ex.happy ?? 0,
                        sad: ex.sad ?? 0,
                        angry: ex.angry ?? 0,
                    };

                    // Stärkste Emotion für den Moment finden
                    const [bestEmo, prob] = Object.entries(filtered).sort((a, b) => b[1] - a[1])[0];

                    // Scores für Aggregation erhöhen
                    Object.entries(filtered).forEach(([key, val]) => {
                        emotionScores[key] += val;
                    });

                    // Prozentuale Verteilung berechnen
                    const total = Object.values(emotionScores).reduce((a, b) => a + b, 0);
                    const stats = {};
                    EMOTIONS.forEach(e => {
                        stats[e] = total > 0 ? Math.round((emotionScores[e] / total) * 100) : 0;
                    });

                    // UI Update
                    updateUI(stats, EMOTION_LABELS[bestEmo], prob);
                } else {
                    if (statusEl) statusEl.textContent = "Kein Gesicht erkannt";
                }

                requestAnimationFrame(detect);
            };
            detect();
        })();
    });
})();