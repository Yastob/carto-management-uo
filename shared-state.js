// Partage les données chargées/éditées entre les 3 pages (Collaborateurs / Rattachements /
// Réunions / Visualisation) via sessionStorage, pour ne rien reperdre en changeant d'onglet.
// Ne stocke que les lignes déjà parsées (mêmes objets que XLSX.utils.sheet_to_json) — jamais
// le fichier binaire. Portée : cet onglet de navigateur uniquement, jamais envoyé nulle part.
window.CartoState = (function () {
  "use strict";
  const KEYS = {
    collab: "carto_collaborateurs_rows",
    collabPrev: "carto_collaborateurs_prev_rows",
    rattach: "carto_rattachements_rows",
    points: "carto_reunions_rows",
  };

  function save(key, rows) {
    try {
      // À chaque nouveau collaborateurs.xlsx chargé, on garde une trace de la version
      // précédente : ça permet aux pages de paramétrage de détecter qui a rejoint/quitté
      // le périmètre d'un SM par rapport à l'ancien référentiel.
      if (key === "collab") {
        const current = sessionStorage.getItem(KEYS.collab);
        if (current) sessionStorage.setItem(KEYS.collabPrev, current);
      }
      sessionStorage.setItem(KEYS[key], JSON.stringify(rows));
    } catch (e) {
      /* stockage indisponible (navigation privée, etc.) : on continue sans persistance */
    }
  }

  function load(key) {
    try {
      const raw = sessionStorage.getItem(KEYS[key]);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clear(key) {
    try {
      sessionStorage.removeItem(KEYS[key]);
    } catch (e) {
      /* ignore */
    }
  }

  return { save, load, clear };
})();
