import "@testing-library/jest-dom/vitest";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import common from "../../public/locales/en/common.json";
import explore from "../../public/locales/en/explore.json";
import landing from "../../public/locales/en/landing.json";

void i18n.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  ns: ["common", "landing", "explore"],
  defaultNS: "common",
  resources: { en: { common, landing, explore } },
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
