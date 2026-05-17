import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import arCommon from "./locales/ar/common.json";
import arPages from "./locales/ar/pages.json";
import enCommon from "./locales/en/common.json";
import enPages from "./locales/en/pages.json";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      ar: { common: arCommon, pages: arPages },
      en: { common: enCommon, pages: enPages },
    },
    fallbackLng: "ar",
    defaultNS: "common",
    ns: ["common", "pages"],
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
    },
  });

export default i18n;
