import "i18next";
import type common from "../../public/locales/en/common.json";
import type create from "../../public/locales/en/create.json";
import type explore from "../../public/locales/en/explore.json";
import type landing from "../../public/locales/en/landing.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      common: typeof common;
      create: typeof create;
      landing: typeof landing;
      explore: typeof explore;
    };
  }
}
