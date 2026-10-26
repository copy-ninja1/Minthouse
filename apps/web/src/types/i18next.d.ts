import "i18next";
import type common from "../../public/locales/en/common.json";
import type explore from "../../public/locales/en/explore.json";
import type landing from "../../public/locales/en/landing.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof common;
      landing: typeof landing;
      explore: typeof explore;
    };
  }
}
