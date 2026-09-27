// Import en lecture seule depuis Google Sheets, en complément du glisser-déposer de
// fichiers locaux. Utilise Google Identity Services (GIS, script accounts.google.com/gsi/client
// chargé à la demande) pour une connexion OAuth côté navigateur uniquement (implicit flow,
// pas de backend) puis l'API Sheets v4 directement en fetch avec le jeton obtenu.
//
// NON FONCTIONNEL tant que CLIENT_ID ci-dessous n'a pas été remplacé par un vrai identifiant
// OAuth mc2i (projet Google Cloud + écran de consentement restreint à l'organisation + client
// "Web application" — voir GOOGLE_SHEETS_SETUP.md). Le reste du code (UI dans app.js, parsing)
// est déjà opérationnel et ne demandera aucune autre modification une fois le client créé.
window.CartoGoogleSheets = (function () {
  "use strict";

  // Placeholder volontairement invalide : isConfigured() le détecte pour désactiver
  // proprement l'UI plutôt que d'échouer avec une erreur Google cryptique.
  const CLIENT_ID = "REMPLACE_PAR_TON_CLIENT_ID.apps.googleusercontent.com";
  const SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";

  const isConfigured = () => !CLIENT_ID.startsWith("REMPLACE_PAR_");

  let tokenClient = null;
  let accessToken = null;
  let gisLoadPromise = null;

  function loadGis() {
    if (gisLoadPromise) return gisLoadPromise;
    gisLoadPromise = new Promise((resolve, reject) => {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Bibliothèque Google injoignable (accounts.google.com)."));
      document.head.appendChild(s);
    });
    return gisLoadPromise;
  }

  // Ouvre la fenêtre de consentement Google si besoin ; résout avec un jeton d'accès valide.
  // Un seul jeton par session d'onglet : pas de rafraîchissement silencieux (pas de backend
  // pour stocker un refresh token), une reconnexion est nécessaire après expiration (~1h).
  function ensureToken() {
    if (accessToken) return Promise.resolve(accessToken);
    if (!isConfigured()) {
      return Promise.reject(
        new Error("Intégration Google Sheets non configurée pour cette instance (voir GOOGLE_SHEETS_SETUP.md).")
      );
    }
    return loadGis().then(
      () =>
        new Promise((resolve, reject) => {
          tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPE,
            callback: (resp) => {
              if (resp.error) {
                reject(new Error("Connexion Google refusée ou annulée (" + resp.error + ")."));
                return;
              }
              accessToken = resp.access_token;
              resolve(accessToken);
            },
          });
          tokenClient.requestAccessToken({ prompt: "" });
        })
    );
  }

  function signOut() {
    if (accessToken && window.google) google.accounts.oauth2.revoke(accessToken, () => {});
    accessToken = null;
  }

  // Accepte un lien Google Sheets classique (…/spreadsheets/d/<id>/edit#gid=0) ou un id nu.
  function parseSpreadsheetId(input) {
    const s = String(input || "").trim();
    const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9-_]{20,}$/.test(s)) return s;
    return null;
  }

  async function apiGet(url) {
    const token = await ensureToken();
    const res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (res.status === 401) {
      accessToken = null; // jeton expiré ou révoqué : la prochaine tentative redemandera une connexion
      throw new Error("Session Google expirée — clique de nouveau sur « Se connecter avec Google ».");
    }
    if (res.status === 403) throw new Error("Accès refusé à cette feuille (droits insuffisants, ou compte non autorisé par l'organisation).");
    if (res.status === 404) throw new Error("Feuille introuvable — vérifie le lien collé.");
    if (!res.ok) throw new Error("Erreur Google Sheets (HTTP " + res.status + ").");
    return res.json();
  }

  // Métadonnées (titre du classeur + liste des onglets, avec leur visibilité) — pas les
  // données elles-mêmes, pour choisir le bon onglet avant de tout rapatrier.
  async function listTabs(spreadsheetId) {
    const data = await apiGet(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties.title,sheets.properties.hidden`
    );
    return {
      title: data.properties.title,
      tabs: (data.sheets || []).map((s) => ({ name: s.properties.title, hidden: !!s.properties.hidden })),
    };
  }

  async function fetchGrid(spreadsheetId, tabName) {
    const range = encodeURIComponent(`'${tabName}'`);
    const data = await apiGet(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`);
    return data.values || [];
  }

  return { isConfigured, ensureToken, signOut, parseSpreadsheetId, listTabs, fetchGrid };
})();
