// ===============================
// Kamera-Emotionserkennung mit face-api.js
// Aggregiert Emotionen über den ganzen Song
// ===============================
(function () {
    const EMOTIONS = ["neutral", "happy", "sad", "angry"];
    const EMOTION_LABELS = {
        neutral: "Neutral",
        happy: "Glücklich",
        sad: "Traurig",
        angry: "Wütend",
    };

    // Aggregierte Scores über die Songdauer
    let emotionScores = {
        neutral: 0,
        happy: 0,
        sad: 0,
        angry: 0,
    };

    // Letzte erkannte "Moment-Emotion" (nur für UI, nicht für Steuerung)
    let lastMomentEmotion = null;

    // Hilfsfunktionen für Reset und Auswertung
    function resetEmotionScores() {
        EMOTIONS.forEach((e) => {
            emotionScores[e] = 0;
        });
        lastMomentEmotion = null;
        console.log("[camera] Emotion-Scores zurückgesetzt.");
    }

    // global verfügbar für app.js
    window.resetEmotionStats = resetEmotionScores;

    // Dominante Emotion über die gesammelten Scores (für Songende)
    window.getDominantEmotion = function () {
        const entries = Object.entries(emotionScores);
        const [emotion, score] = entries.sort((a, b) => b[1] - a[1])[0] || [];
        if (!score || score <= 0) return null;
        return emotion;
    };

    // Prozentuelle Verteilung für Logging
    window.getEmotionStats = function () {
        const total = Object.values(emotionScores).reduce((a, b) => a + b, 0);
        if (total === 0) return null;

        const stats = {};
        EMOTIONS.forEach((e) => {
            stats[e] = Math.round((emotionScores[e] / total) * 100);
        });
        return stats;
    };

    // ===============================
    // Main: Kamera + Modelle + Loop
    // ===============================
    window.addEventListener("load", () => {
        const videoEl = document.getElementById("video-feed");
        const emotionTextEl = document.getElementById("emotion-text");

        // Index-Seite kann ohne Kamera laufen → einfach raus
        if (!videoEl || !emotionTextEl) return;

        if (!window.faceapi) {
            emotionTextEl.textContent = "face-api konnte nicht geladen werden.";
            console.error("face-api.js nicht gefunden.");
            return;
        }

        (async () => {
            // Kamera starten
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                    audio: false,
                });
                videoEl.srcObject = stream;
            } catch (e) {
                console.error("getUserMedia-Fehler:", e);
                emotionTextEl.textContent = "Kamera blockiert oder nicht verfügbar.";
                return;
            }

            await new Promise((resolve) => {
                if (videoEl.readyState >= 2) resolve();
                videoEl.onloadeddata = resolve;
            });

            // Modelle laden
            emotionTextEl.textContent = "Lade Modelle…";

            try {
                await Promise.all([
                    faceapi.nets.ssdMobilenetv1.loadFromUri("./models"),
                    faceapi.nets.faceExpressionNet.loadFromUri("./models"),
                ]);
            } catch (e) {
                console.error("Fehler beim Laden der Modelle:", e);
                emotionTextEl.textContent = "Fehler beim Laden der Modelle.";
                return;
            }

            emotionTextEl.textContent = "Modelle geladen. Erkenne Emotionen…";

            // Detection-Loop
            const detect = async () => {
                let detections;

                try {
                    detections = await faceapi
                        .detectAllFaces(videoEl)
                        .withFaceExpressions();
                } catch (e) {
                    console.error("Fehler bei detectAllFaces:", e);
                    requestAnimationFrame(detect);
                    return;
                }

                if (!detections.length) {
                    emotionTextEl.textContent = "Kein Gesicht erkannt";
                    requestAnimationFrame(detect);
                    return;
                }

                const ex = detections[0].expressions || {};

                // Nur unsere 4 Emotionen
                const filtered = {
                    neutral: ex.neutral ?? 0,
                    happy: ex.happy ?? 0,
                    sad: ex.sad ?? 0,
                    angry: ex.angry ?? 0,
                };

                // Momentan stärkste Emotion bestimmen
                const [emotion, prob] = Object.entries(filtered).sort(
                    (a, b) => b[1] - a[1]
                )[0];

                lastMomentEmotion = emotion;

                // Live-Text für UI
                emotionTextEl.textContent = `${EMOTION_LABELS[emotion]} (${Math.round(
                    prob * 100
                )}%)`;

                // In aggregierte Scores einfließen lassen
                // (je Frame addieren → am Ende normalisieren wir in getEmotionStats)
                Object.entries(filtered).forEach(([key, value]) => {
                    if (!Number.isFinite(value)) return;
                    emotionScores[key] += value;
                });

                requestAnimationFrame(detect);
            };

            // Beim Start einmal alles resetten
            resetEmotionScores();
            detect();
        })();
    });
})();
