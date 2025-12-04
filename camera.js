// ===============================
// Kamera-Emotionserkennung mit face-api.js
// ===============================
(function () {
    const EMOTION_LABELS = {
        neutral: "Neutral",
        happy: "Glücklich",
        sad: "Traurig",
        angry: "Wütend",
    };

    // UI-Buttons für die Emotionen (optional, falls vorhanden)
    const emotionButtons = {};

    let lastAppliedEmotion = null;
    let currentCandidateEmotion = null;
    let candidateSince = 0;
    const STABLE_MS = 3000; // wie lange eine Emotion stabil sein muss, bevor wir Spotify umschalten

    // aktuell aktiven Button im UI hervorheben
    function highlightEmotionButton(emotion) {
        if (!emotionButtons || Object.keys(emotionButtons).length === 0) return;

        Object.keys(emotionButtons).forEach((emo) => {
            const btn = emotionButtons[emo];
            if (!btn) return;
            if (emo === emotion) {
                btn.classList.add("active-emotion");
            } else {
                btn.classList.remove("active-emotion");
            }
        });
    }

    window.addEventListener("load", () => {
        const videoEl = document.getElementById("video-feed");
        const emotionTextEl = document.getElementById("emotion-text");

        // Emotion-Buttons einsammeln, falls vorhanden
        document.querySelectorAll("[data-emotion]").forEach((btn) => {
            const emo = btn.getAttribute("data-emotion");
            if (emo) {
                emotionButtons[emo] = btn;
            }
        });

        if (!videoEl || !emotionTextEl) return;

        if (!window.faceapi) {
            emotionTextEl.textContent = "face-api konnte nicht geladen werden.";
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
                console.error("Kamera-Fehler:", e);
                emotionTextEl.textContent = "Kamera blockiert oder nicht verfügbar.";
                return;
            }

            // Warten bis das Video bereit ist
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

            emotionTextEl.textContent = "Modelle geladen. Starte Erkennung…";

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

                const filtered = {
                    neutral: ex.neutral ?? 0,
                    happy: ex.happy ?? 0,
                    sad: ex.sad ?? 0,
                    angry: ex.angry ?? 0,
                };

                const [emotion, prob] = Object.entries(filtered).sort(
                    (a, b) => b[1] - a[1]
                )[0];

                emotionTextEl.textContent =
                    `${EMOTION_LABELS[emotion]} (${Math.round(prob * 100)}%)`;

                const now = Date.now();

                // Neue Emotion als Kandidat merken
                if (emotion !== currentCandidateEmotion) {
                    currentCandidateEmotion = emotion;
                    candidateSince = now;
                } else if (
                    emotion !== lastAppliedEmotion &&
                    now - candidateSince >= STABLE_MS
                ) {
                    // Emotion ist stabil genug → Spotify-Emotion umschalten
                    lastAppliedEmotion = emotion;

                    // UI highlight
                    highlightEmotionButton(emotion);

                    // WICHTIG: app.js stellt scheduleEmotionChange global bereit
                    if (typeof window.scheduleEmotionChange === "function") {
                        window.scheduleEmotionChange(emotion);
                    } else {
                        console.warn(
                            "scheduleEmotionChange ist nicht verfügbar – stelle sicher, dass app.js vor camera.js geladen wird."
                        );
                    }
                }

                requestAnimationFrame(detect);
            };

            detect();
        })();
    });
})();
