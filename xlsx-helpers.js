// Lecture flexible de collaborateurs.xlsx : c'est le seul fichier saisi/maintenu à la
// main par l'utilisateur (les 2 autres sont générés par nos éditeurs), donc ni le nom de
// l'onglet ni le texte des en-têtes de colonnes ne sont fiables. On se base uniquement
// sur l'ORDRE des colonnes : la 1ère ligne de l'onglet choisi est toujours traitée comme
// un en-tête (son contenu est ignoré, quel qu'il soit) et les 5 premières colonnes de
// données doivent apparaître dans cet ordre : id, nom, prenom, poste, senior_manager_id.
// Les colonnes suivantes (ex. les colonnes d'aide id_suggestion/doublon_id de notre
// gabarit) sont ignorées.
window.CartoXlsx = (function () {
  "use strict";

  // Onglets d'aide générés par notre propre gabarit (mode d'emploi, liste cachée pour les
  // menus déroulants) : jamais l'onglet de données, à sauter lors de la détection auto.
  const NON_DATA_SHEET_NAMES = ["lisez-moi", "lisezmoi", "readme", "listes", "instructions", "mode d'emploi"];

  function isHidden(wb, name) {
    const meta = (wb.Workbook && wb.Workbook.Sheets) || [];
    const entry = meta.find((s) => s.name === name);
    return !!(entry && entry.Hidden);
  }

  function findDataSheetName(wb) {
    const candidate = (wb.SheetNames || []).find(
      (name) => !isHidden(wb, name) && !NON_DATA_SHEET_NAMES.includes(String(name).trim().toLowerCase())
    );
    return candidate || (wb.SheetNames || [])[0];
  }

  function cell(row, i) {
    const v = row[i];
    return v === undefined || v === null ? "" : String(v).trim();
  }

  function readCollaborateurs(wb) {
    const name = findDataSheetName(wb);
    const sheet = name && wb.Sheets[name];
    if (!sheet) return [];
    const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
    return grid
      .slice(1)
      .filter((row) => row.some((c) => String(c).trim() !== ""))
      .map((row) => ({
        id: cell(row, 0),
        nom: cell(row, 1),
        prenom: cell(row, 2),
        poste: cell(row, 3),
        senior_manager_id: cell(row, 4),
      }));
  }

  return { readCollaborateurs };
})();
