const CLIENT_ID = "c1118e23caa84e6497022d00757dc5a0";
const REDIRECT_URI = "http://127.0.0.1:8000/callback.html";

const SCOPES = [
    "streaming",
    "user-modify-playback-state",
    "user-read-playback-state",
    "user-read-private",
    "user-read-email",
].join(" ");

function randomString(len = 64) {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function sha256(str) {
    const buffer = new TextEncoder().encode(str);
    return await crypto.subtle.digest("SHA-256", buffer);
}

function base64url(data) {
    return btoa(String.fromCharCode(...new Uint8Array(data)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

async function startSpotifyLogin() {
    const existingToken = sessionStorage.getItem("spotify_access_token");
    if (existingToken) {
        window.location = "index.html";
        return;
    }

    const verifier = randomString();
    const challenge = base64url(await sha256(verifier));
    sessionStorage.setItem("code_verifier", verifier);

    const params = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPES,
        code_challenge_method: "S256",
        code_challenge: challenge,
    });

    window.location =
        "https://accounts.spotify.com/authorize?" + params.toString();
}


startSpotifyLogin().catch((err) => {
    console.error("Fehler beim Starten des Spotify Logins:", err);
});
