import i18n from "i18next";
import HttpBackend from "i18next-http-backend";
import { initReactI18next } from "react-i18next";

export const I18N_NAMESPACES = ["common", "landing", "explore"] as const;

void i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    lng: "en",
    fallbackLng: "en",
    supportedLngs: ["en"],
    ns: I18N_NAMESPACES,
    defaultNS: "common",
    backend: { loadPath: "/locales/{{lng}}/{{ns}}.json" },
    interpolation: { escapeValue: false },
    react: { useSuspense: true },
  });

export { i18n };
