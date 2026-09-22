"use client";

import { useState } from "react";
import Papa from "papaparse";
import { importUsersAction, ImportUserPayload } from "../actions";
import { ui } from "@/lib/ui";

export function CsvUpload() {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setMessage("Analyse du fichier CSV en cours...");

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const users: ImportUserPayload[] = [];

        for (const row of results.data as any[]) {
          // Fallback sur différentes casses/variantes possibles pour les colonnes
          const firstName = row["Prénom Elève"] || row["Prenom"] || row["Prénom"] || row["prenom"] || row["First Name"];
          const lastName = row["Nom Elève"] || row["Nom"] || row["nom"] || row["Last Name"];
          const className = row["Classe"] || row["classe"] || row["Class"];
          const sexRaw = (row["Sexe"] || row["sexe"] || "").toString().trim().toUpperCase();
          const sex = sexRaw === "M" || sexRaw === "F" ? sexRaw : undefined;
          const dateOfBirth = row["DateNaiss"] || row["Date de naissance"] || undefined;

          if (firstName && lastName) {
            users.push({
              firstName,
              lastName,
              className: className || "Non Assigné",
              sex,
              dateOfBirth,
            });
          }
        }

        if (users.length === 0) {
          setMessage("Erreur : Aucune donnée valide trouvée. Vérifiez les noms de colonnes (Nom, Prenom, Classe).");
          setLoading(false);
          return;
        }

        setMessage(`Importation de ${users.length} élèves en cours dans la base de données...`);
        try {
          const res = await importUsersAction(users);
          setMessage(`✅ Succès ! ${res.count} nouveaux élèves ont été importés avec succès.`);
        } catch (err) {
          console.error(err);
          setMessage("❌ Une erreur est survenue lors de l'importation.");
        }
        setLoading(false);
      },
      error: (error) => {
        setMessage(`❌ Erreur de lecture : ${error.message}`);
        setLoading(false);
      }
    });
  };

  return (
    <div className={`${ui.cardPad} mt-8`}>
      <h2 className={`${ui.h2} mb-2`}>📥 Importer une base élèves (CSV)</h2>
      <p className={`${ui.muted} mb-6`}>
        Uploadez un fichier .csv contenant les colonnes <strong>Nom Elève</strong>, <strong>Prénom Elève</strong>, <strong>Sexe</strong>, <strong>DateNaiss</strong> et <strong>Classe</strong>. Les élèves déjà importés (même prénom + nom + classe) sont ignorés. Pour un professeur, mets <strong>PROF</strong> dans la colonne Classe.
      </p>

      <div className="flex flex-col gap-4">
        <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-line-2 border-dashed rounded-xl cursor-pointer bg-paper hover:bg-brand-soft hover:border-brand transition-colors">
          <div className="flex flex-col items-center justify-center pt-5 pb-6">
            <svg className="w-8 h-8 mb-3 text-ink-3" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16">
              <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"/>
            </svg>
            <p className="mb-2 text-sm text-ink-2 font-semibold">Cliquez pour uploader</p>
            <p className="text-xs text-ink-3">Fichier .csv uniquement</p>
          </div>
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileUpload}
            disabled={loading}
          />
        </label>

        {message && (
          <div className={message.includes('✅') ? ui.alertOk : message.includes('❌') ? ui.alertErr : ui.alertInfo}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
