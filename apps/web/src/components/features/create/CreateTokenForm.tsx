import {
  LAUNCH_MODE_CAPABILITIES,
  NETWORKS,
  U64_MAX,
  maxDecimalsForWholeTokens,
  getEvmNetwork,
  shortenAddress,
  type LaunchMode,
  type PublicConfig,
} from "@minthouse/shared";
import { useWallet } from "@solana/wallet-adapter-react";
import { Link } from "@tanstack/react-router";
import { ImagePlus } from "lucide-react";
import { type SubmitEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnection } from "wagmi";
import { CopyButton } from "@/components/ui/CopyButton";
import { buttonStyles } from "@/components/ui/Button";
import { env } from "@/lib/env";
import { launchSecretAddress } from "@/lib/launch-signer";
import { cn } from "@/lib/cn";
import {
  type CreateField,
  type CreateFormValues,
  MIN_LOGO_SIDE,
  defaultInitialSupply,
  initialCreateForm,
  logoFileError,
  modesForLaunch,
  networksForLaunch,
  toTokenConfig,
} from "@/lib/launch-form";
import {
  type LaunchView,
  useTokenLaunch,
} from "@/components/features/create/useTokenLaunch";
import { LAUNCH_STEPS } from "@/lib/launch-token";
import { Field, TextField } from "./fields";
import { NetworkSelect, WalletButton } from "./WalletButton";

type CreateTokenFormProps = {
  config: PublicConfig;
};

export function CreateTokenForm({ config }: CreateTokenFormProps) {
  const { t } = useTranslation("create");
  const clientNetworks = env.VITE_ENABLED_NETWORKS;
  const modes = modesForLaunch(
    clientNetworks,
    config.networks,
    config.pumpfunNetworks,
  );
  const firstMode = modes[0];
  const [values, setValues] = useState<CreateFormValues>(() => {
    const mode = firstMode ?? "solana-spl";
    const network =
      networksForLaunch(
        mode,
        clientNetworks,
        config.networks,
        config.pumpfunNetworks,
      )[0] ?? "solana-devnet";
    return initialCreateForm(mode, network);
  });
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<CreateField, string>>
  >({});
  const [formError, setFormError] = useState<string | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [privateKey, setPrivateKey] = useState("");
  const [privateKeyError, setPrivateKeyError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false);
  const { view, launch, reset } = useTokenLaunch();

  const evm = useConnection();
  const solana = useWallet();
  const capabilities = LAUNCH_MODE_CAPABILITIES[values.mode];
  const networks = networksForLaunch(
    values.mode,
    clientNetworks,
    config.networks,
    config.pumpfunNetworks,
  );
  const networkInfo = NETWORKS[values.network];
  const walletAddress =
    capabilities.family === "bsc"
      ? (evm.address ?? null)
      : (solana.publicKey?.toBase58() ?? null);
  const secret = privateKey.trim();
  const secretAddress = secret
    ? launchSecretAddress(capabilities.family, secret)
    : null;
  const usingSecret = secret.length > 0;
  const address = usingSecret ? secretAddress : walletAddress;
  const chainMismatch =
    !usingSecret &&
    capabilities.family === "bsc" &&
    evm.isConnected &&
    evm.chainId !== getEvmNetwork(values.network).chainId;
  const running = view.status === "running";

  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  if (!firstMode || networks.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-line-strong px-6 py-16 text-center">
        <h2 className="font-display text-3xl">{t("unavailable.title")}</h2>
        <p className="mt-2 text-sm text-fg-muted">{t("unavailable.body")}</p>
      </section>
    );
  }

  const patch = <Key extends keyof CreateFormValues>(
    key: Key,
    value: CreateFormValues[Key],
  ) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const selectMode = (mode: LaunchMode) => {
    const nextNetworks = networksForLaunch(
      mode,
      clientNetworks,
      config.networks,
      config.pumpfunNetworks,
    );
    setValues((current) => ({
      ...current,
      mode,
      network: nextNetworks.includes(current.network)
        ? current.network
        : (nextNetworks[0] ?? current.network),
      decimals: String(LAUNCH_MODE_CAPABILITIES[mode].decimals.default),
      initialSupply: defaultInitialSupply(mode),
    }));
    setFieldErrors({});
    setPrivateKeyError(null);
    setMainnetConfirmed(false);
  };

  const chooseLogo = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    const typeError = logoFileError(file, config.storage.maxLogoBytes);
    if (typeError) {
      setLogo(null);
      setLogoError(typeError);
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const tooSmall =
        bitmap.width < MIN_LOGO_SIDE || bitmap.height < MIN_LOGO_SIDE;
      bitmap.close();
      if (tooSmall) {
        setLogo(null);
        setLogoError(t("errors.logoSmall", { size: MIN_LOGO_SIDE }));
        return;
      }
    } catch {
      setLogo(null);
      setLogoError(t("errors.logoRead"));
      return;
    }
    setLogo(file);
    setLogoError(null);
    setPreview(URL.createObjectURL(file));
  };

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (running) {
      return;
    }
    const parsed = toTokenConfig(values, address);
    const nextLogoError = logo
      ? logoFileError(logo, config.storage.maxLogoBytes)
      : t("errors.logo");
    const signerError = address
      ? null
      : usingSecret
        ? t("errors.privateKey")
        : t("errors.wallet");
    const chainError = chainMismatch
      ? t("errors.chain", { network: networkInfo.label })
      : null;
    const nextFieldErrors = parsed.ok ? {} : { ...parsed.fieldErrors };
    if (usingSecret && !secretAddress) {
      delete nextFieldErrors.recipient;
    }
    setFieldErrors(nextFieldErrors);
    setLogoError(nextLogoError);
    setPrivateKeyError(usingSecret && !secretAddress ? signerError : null);
    if (!parsed.ok || nextLogoError || signerError || chainError || !logo) {
      setFormError(
        usingSecret && !secretAddress ? null : (signerError ?? chainError),
      );
      return;
    }
    if (networkInfo.isMainnet && !mainnetConfirmed) {
      setFormError(t("warnings.mainnetConfirm"));
      return;
    }
    setFormError(null);
    setPrivateKeyError(null);
    void launch(parsed.config, logo, usingSecret ? secret : undefined);
  };

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <form
        onSubmit={submit}
        noValidate
        className="flex min-w-0 flex-col gap-8"
      >
        <fieldset
          disabled={running}
          className="flex flex-col gap-8 disabled:opacity-70"
        >
          <fieldset>
            <legend className="sr-only">{t("modes.legend")}</legend>
            <div className="grid gap-3 sm:grid-cols-3">
              {modes.map((mode) => {
                const selected = values.mode === mode;
                return (
                  <label
                    key={mode}
                    className={cn(
                      "cursor-pointer rounded-xl border p-4 transition-colors",
                      selected
                        ? "border-accent bg-accent-soft"
                        : "border-line bg-surface hover:border-line-strong",
                    )}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={mode}
                      checked={selected}
                      onChange={() => {
                        selectMode(mode);
                      }}
                      className="sr-only"
                    />
                    <span className="block font-medium">
                      {t(`modes.${mode}.title`)}
                    </span>
                    <span className="mt-1 block text-sm text-pretty text-fg-muted">
                      {t(`modes.${mode}.body`)}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("fields.network")} htmlFor="network">
              <NetworkSelect
                id="network"
                networks={networks}
                value={values.network}
                onChange={(network) => {
                  patch("network", network);
                  setMainnetConfirmed(false);
                }}
              />
            </Field>
            <TextField
              id="name"
              label={t("fields.name")}
              value={values.name}
              onChange={(value) => {
                patch("name", value);
              }}
              error={fieldErrors.name}
            />
            <TextField
              id="symbol"
              label={t("fields.symbol")}
              value={values.symbol}
              onChange={(value) => {
                patch("symbol", value);
              }}
              error={fieldErrors.symbol}
              mono
            />
            <LogoField
              preview={preview}
              error={logoError}
              onChange={(file) => {
                void chooseLogo(file);
              }}
            />
          </div>

          <TextField
            id="description"
            label={t("fields.description")}
            value={values.description}
            onChange={(value) => {
              patch("description", value);
            }}
            error={fieldErrors.description}
            hint={t("fields.descriptionHint")}
          />

          <details className="rounded-xl border border-line bg-surface px-4 py-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t("fields.socials")}
            </summary>
            <div className="mt-4 grid gap-4">
              <TextField
                id="website"
                label={t("fields.website")}
                value={values.website}
                onChange={(value) => {
                  patch("website", value);
                }}
                error={fieldErrors.website}
                placeholder="https://"
              />
              <TextField
                id="twitter"
                label={t("fields.twitter")}
                value={values.twitter}
                onChange={(value) => {
                  patch("twitter", value);
                }}
                error={fieldErrors.twitter}
                placeholder="https://x.com/"
              />
              <TextField
                id="telegram"
                label={t("fields.telegram")}
                value={values.telegram}
                onChange={(value) => {
                  patch("telegram", value);
                }}
                error={fieldErrors.telegram}
                placeholder="https://t.me/"
              />
            </div>
          </details>

          <ModeFields values={values} errors={fieldErrors} onPatch={patch} />
        </fieldset>

        {networkInfo.isMainnet ? (
          <div className="flex flex-col gap-3 rounded-xl border border-warn/40 bg-warn-soft p-4 text-sm">
            <p>
              {t("warnings.mainnet", {
                network: networkInfo.label,
                symbol: networkInfo.nativeSymbol,
              })}
            </p>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={mainnetConfirmed}
                onChange={(event) => {
                  setMainnetConfirmed(event.target.checked);
                }}
                className="mt-0.5"
              />
              <span>{t("warnings.mainnetConfirm")}</span>
            </label>
          </div>
        ) : null}

        {!config.storage.persistent && !networkInfo.isLocal ? (
          <p className="text-sm text-pretty text-fg-muted">
            {t("warnings.storage")}
          </p>
        ) : null}

        <div className="flex flex-col gap-4">
          <WalletButton family={capabilities.family} network={values.network} />
          <TextField
            id="deployerKey"
            label={t("fields.privateKey")}
            value={privateKey}
            onChange={(value) => {
              setPrivateKey(value);
              setPrivateKeyError(null);
            }}
            error={privateKeyError ?? undefined}
            hint={t("fields.privateKeyHint")}
            type="password"
            autoComplete="off"
            spellCheck={false}
          />
          {secretAddress ? (
            <p className="text-xs text-fg-muted">
              {t("fields.privateKeySigning", {
                address: shortenAddress(secretAddress, 6),
              })}
            </p>
          ) : null}
          <LaunchProgress view={view} />
          {view.status === "success" ? (
            <SuccessPanel
              name={view.deployment.name}
              address={view.deployment.tokenAddress}
              network={view.deployment.network}
            />
          ) : null}
          {view.status === "error" ? (
            <div
              role="alert"
              className="rounded-xl border border-danger/30 bg-danger-soft p-4"
            >
              <p className="font-medium text-danger">{t("errors.title")}</p>
              <p className="mt-1 text-sm text-pretty text-fg-muted">
                {view.message}
              </p>
              {view.deployment?.txId ? (
                <p className="mt-2 truncate font-mono text-xs text-fg-subtle">
                  {view.deployment.txId}
                </p>
              ) : null}
            </div>
          ) : null}
          {formError ? (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          ) : null}
          {view.status === "success" ? (
            <button
              type="button"
              className={buttonStyles({ variant: "secondary" })}
              onClick={() => {
                reset();
                setLogo(null);
                setPreview(null);
                setPrivateKey("");
                setPrivateKeyError(null);
                setMainnetConfirmed(false);
              }}
            >
              {t("actions.another")}
            </button>
          ) : (
            <button
              type="submit"
              className={buttonStyles({ size: "lg" })}
              disabled={running}
            >
              {running ? t("actions.working") : t("actions.submit")}
            </button>
          )}
        </div>
      </form>

      <aside className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 lg:sticky lg:top-24">
        <h2 className="text-xs text-fg-subtle">{t("summary.title")}</h2>
        <p className="font-medium">{capabilities.label}</p>
        <p className="text-sm text-pretty text-fg-muted">
          {capabilities.supplyBehavior}
        </p>
        <p className="border-t border-line pt-4 text-sm text-pretty text-fg-muted">
          {t("warnings.signer")}
        </p>
      </aside>
    </div>
  );
}

function ModeFields({
  values,
  errors,
  onPatch,
}: {
  values: CreateFormValues;
  errors: Partial<Record<CreateField, string>>;
  onPatch: <Key extends keyof CreateFormValues>(
    key: Key,
    value: CreateFormValues[Key],
  ) => void;
}) {
  const { t } = useTranslation("create");
  const decimals = /^\d+$/.test(values.decimals.trim())
    ? Number(values.decimals)
    : null;
  const solanaMaxWhole =
    values.mode === "solana-spl" && decimals !== null && decimals <= 18
      ? (U64_MAX / 10n ** BigInt(decimals)).toString()
      : null;
  const supplyWhole = /^(?:0|[1-9]\d*)$/.test(values.initialSupply.trim())
    ? BigInt(values.initialSupply.trim())
    : null;
  const fittedDecimals =
    supplyWhole === null ? null : maxDecimalsForWholeTokens(supplyWhole);
  const supplyHint =
    solanaMaxWhole === null || decimals === null
      ? t("fields.supplyHint")
      : supplyWhole !== null && supplyWhole > BigInt(solanaMaxWhole)
        ? fittedDecimals === null
          ? t("fields.supplyHintSolanaTooLarge", { max: U64_MAX.toString() })
          : t("fields.supplyHintSolanaFit", {
              maxDecimals: fittedDecimals,
              max: solanaMaxWhole,
              decimals,
            })
        : t("fields.supplyHintSolana", {
            max: solanaMaxWhole,
            decimals,
          });

  switch (values.mode) {
    case "bsc-erc20":
    case "solana-spl":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            id="decimals"
            label={t("fields.decimals")}
            value={values.decimals}
            onChange={(value) => {
              onPatch("decimals", value);
            }}
            error={errors.decimals}
            inputMode="numeric"
            mono
          />
          <TextField
            id="initialSupply"
            label={t("fields.supply")}
            value={values.initialSupply}
            onChange={(value) => {
              onPatch("initialSupply", value);
              if (
                values.liquidityTokens === values.initialSupply ||
                values.liquidityTokens === ""
              ) {
                onPatch("liquidityTokens", value);
              }
            }}
            error={errors.initialSupply}
            hint={supplyHint}
            inputMode="numeric"
            mono
          />
          <div className="sm:col-span-2">
            <TextField
              id="recipient"
              label={t("fields.recipient")}
              value={values.recipient}
              onChange={(value) => {
                onPatch("recipient", value);
              }}
              error={errors.recipient}
              hint={t("fields.recipientHint")}
              mono
            />
          </div>
          <TextField
            id="liquidityNative"
            label={t("fields.liquidityNative", {
              symbol: NETWORKS[values.network].nativeSymbol,
            })}
            value={values.liquidityNative}
            onChange={(value) => {
              onPatch("liquidityNative", value);
            }}
            error={errors.liquidityNative}
            hint={t("fields.liquidityNativeHint", {
              symbol: NETWORKS[values.network].nativeSymbol,
            })}
            inputMode="decimal"
            mono
          />
          <TextField
            id="liquidityTokens"
            label={t("fields.liquidityTokens")}
            value={values.liquidityTokens}
            onChange={(value) => {
              onPatch("liquidityTokens", value);
            }}
            error={errors.liquidityTokens}
            hint={t("fields.liquidityTokensHint")}
            inputMode="numeric"
            mono
          />
          {values.mode === "bsc-erc20" ? (
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={values.mintingEnabled}
                onChange={(event) => {
                  onPatch("mintingEnabled", event.target.checked);
                }}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{t("fields.minting")}</span>
                <span className="mt-0.5 block text-fg-muted">
                  {t("fields.mintingHint")}
                </span>
              </span>
            </label>
          ) : (
            <fieldset className="flex flex-col gap-2 text-sm sm:col-span-2">
              <legend className="text-xs text-fg-muted">
                {t("fields.authority")}
              </legend>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mintAuthority"
                  checked={values.mintAuthority === "revoke"}
                  onChange={() => {
                    onPatch("mintAuthority", "revoke");
                  }}
                />
                {t("fields.authorityRevoke")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="mintAuthority"
                  checked={values.mintAuthority === "retain"}
                  onChange={() => {
                    onPatch("mintAuthority", "retain");
                  }}
                />
                {t("fields.authorityRetain")}
              </label>
              <label className="mt-2 flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={values.metadataMutable}
                  onChange={(event) => {
                    onPatch("metadataMutable", event.target.checked);
                  }}
                />
                {t("fields.metadataMutable")}
              </label>
            </fieldset>
          )}
        </div>
      );
    case "pumpfun":
      return (
        <div className="grid gap-4 sm:grid-cols-2">
          <p className="text-sm text-pretty text-fg-muted sm:col-span-2">
            {t("fields.pumpSupply")}
          </p>
          <TextField
            id="initialBuySol"
            label={t("fields.initialBuy")}
            value={values.initialBuySol}
            onChange={(value) => {
              onPatch("initialBuySol", value);
            }}
            error={errors.initialBuySol}
            hint={t("fields.initialBuyHint")}
            inputMode="decimal"
            mono
          />
          <TextField
            id="slippagePercent"
            label={t("fields.slippage")}
            value={values.slippagePercent}
            onChange={(value) => {
              onPatch("slippagePercent", value);
            }}
            error={errors.slippagePercent}
            inputMode="decimal"
            mono
          />
        </div>
      );
    default: {
      const exhaustive: never = values.mode;
      throw new Error(`Unhandled launch mode ${String(exhaustive)}`);
    }
  }
}

function LogoField({
  preview,
  error,
  onChange,
}: {
  preview: string | null;
  error: string | null;
  onChange: (file: File | undefined) => void;
}) {
  const { t } = useTranslation("create");
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-fg-muted">{t("fields.logo")}</span>
      <label
        htmlFor="logo"
        className="flex h-10 cursor-pointer items-center gap-3 rounded-lg border border-line-strong bg-surface px-3 text-sm hover:bg-sunken"
      >
        {preview ? (
          <img src={preview} alt="" className="size-6 rounded object-cover" />
        ) : (
          <ImagePlus className="size-4 text-fg-subtle" aria-hidden="true" />
        )}
        <span className="truncate text-fg-muted">
          {preview
            ? t("fields.logoChange")
            : t("fields.logoHint", { size: MIN_LOGO_SIDE })}
        </span>
      </label>
      <input
        id="logo"
        name="logo"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => {
          onChange(event.target.files?.[0]);
        }}
      />
      {error ? (
        <p id="logo-error" role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function LaunchProgress({ view }: { view: LaunchView }) {
  const { t } = useTranslation("create");
  if (view.status === "idle") {
    return null;
  }
  const activeIndex =
    view.status === "running"
      ? LAUNCH_STEPS.indexOf(view.step)
      : view.status === "success"
        ? LAUNCH_STEPS.length
        : -1;
  return (
    <ol
      aria-label={t("steps.label")}
      aria-live="polite"
      className="flex flex-col gap-2"
    >
      {LAUNCH_STEPS.map((step, index) => {
        const done = index < activeIndex;
        const current = view.status === "running" && step === view.step;
        return (
          <li
            key={step}
            className={cn(
              "flex items-center gap-2 text-sm",
              done || current ? "text-fg" : "text-fg-subtle",
            )}
          >
            <span className="font-mono text-xs tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className={done ? "text-accent-ink" : undefined}>
              {t(`steps.${step}`)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function SuccessPanel({
  name,
  address,
  network,
}: {
  name: string;
  address: string | null;
  network: CreateFormValues["network"];
}) {
  const { t } = useTranslation("create");
  return (
    <div className="rounded-xl border border-accent/40 bg-accent-soft p-4">
      <h2 className="font-medium">{t("success.title", { name })}</h2>
      <p className="mt-1 text-sm text-pretty text-fg-muted">
        {t("success.body")}
      </p>
      {address ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="font-mono text-sm">
            {shortenAddress(address, 6)}
          </span>
          <CopyButton value={address} />
          <Link
            to="/app"
            search={{ token: address, tokenNetwork: network }}
            className={buttonStyles({ size: "sm" })}
          >
            {t("success.inspect")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
