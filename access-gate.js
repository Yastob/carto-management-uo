// Frein d'accès simple côté navigateur — PAS une vraie sécurité (le code est visible par
// quiconque sait ouvrir les outils de développement, et rien n'est chiffré côté serveur
// puisqu'il n'y a pas de serveur). Sert uniquement à éviter la découverte accidentelle du
// lien (moteurs de recherche, partage par erreur). Aucune donnée métier n'est protégée par
// cet écran : les fichiers Excel restent, comme toujours, traités uniquement en local par
// la personne qui les charge.
//
// Pour changer le mot de passe partagé : lance `python scripts/make_password_hash.py
// "nouveau-mot-de-passe"` et remplace PASSWORD_HASH ci-dessous par le résultat.
(function () {
  "use strict";

  const STORAGE_KEY = "carto_access_unlocked_v1";
  const PASSWORD_HASH = "ce6e57938539680a69377a34525d53bb5b686f818bb27fcf24f4ae0b605abb50"; // mot de passe par défaut : mc2i2026 — À CHANGER avant de partager le lien

  if (localStorage.getItem(STORAGE_KEY) === "1") return;

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function injectStyle() {
    const style = document.createElement("style");
    style.textContent = `
      #access-gate-overlay {
        position: fixed; inset: 0; z-index: 99999;
        background: #0d0d0d; color: #fff;
        display: flex; align-items: center; justify-content: center;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      #access-gate-box {
        background: #1a1a19; border: 1px solid rgba(255,255,255,0.1);
        border-radius: 12px; padding: 28px 30px; max-width: 340px; width: 90%;
        box-shadow: 0 10px 40px rgba(0,0,0,0.4);
      }
      #access-gate-box h2 { margin: 0 0 8px; color: #9085e9; font-size: 17px; }
      #access-gate-box p { margin: 0 0 16px; font-size: 13px; color: #c3c2b7; line-height: 1.5; }
      #access-gate-input {
        width: 100%; padding: 9px 11px; border-radius: 6px; border: 1px solid #383835;
        background: #0d0d0d; color: #fff; font-size: 14px; margin-bottom: 10px; box-sizing: border-box;
      }
      #access-gate-submit {
        width: 100%; padding: 9px 11px; border-radius: 6px; border: none;
        background: #9085e9; color: #0d0d0d; font-weight: 700; font-size: 14px; cursor: pointer;
      }
      #access-gate-submit:hover { opacity: 0.9; }
      #access-gate-error { margin-top: 10px; font-size: 12.5px; color: #e66767; display: none; }
    `;
    document.head.appendChild(style);
  }

  function showGate() {
    injectStyle();
    const overlay = document.createElement("div");
    overlay.id = "access-gate-overlay";
    overlay.innerHTML = `
      <div id="access-gate-box">
        <h2>Accès protégé</h2>
        <p>Cet outil contient des informations internes à l'UO. Entre le mot de passe partagé pour continuer.</p>
        <input type="password" id="access-gate-input" placeholder="Mot de passe" autocomplete="off">
        <button id="access-gate-submit">Valider</button>
        <div id="access-gate-error">Mot de passe incorrect.</div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = document.getElementById("access-gate-input");
    const errorEl = document.getElementById("access-gate-error");
    input.focus();

    async function tryUnlock() {
      const hash = await sha256Hex(input.value);
      if (hash === PASSWORD_HASH) {
        localStorage.setItem(STORAGE_KEY, "1");
        overlay.remove();
      } else {
        errorEl.style.display = "block";
        input.select();
      }
    }

    document.getElementById("access-gate-submit").addEventListener("click", tryUnlock);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") tryUnlock();
    });
  }

  if (document.body) showGate();
  else document.addEventListener("DOMContentLoaded", showGate);
})();
