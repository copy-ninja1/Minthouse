import { NETWORKS, type NetworkId, isAddressForFamily, normalizeAddress } from "@minthouse/shared";
import { ChevronDown, ScanSearch } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

type TokenLookupFormProps = {
  networks: readonly NetworkId[];
  onInspect: (network: NetworkId, address: string) => void;
  className?: string;
};

type LookupFailure = {
  network: NetworkId;
  address: string;
  message: string;
};

/**
 * Inspect any token by address. Addresses are validated with the chain's own
 * rules (EIP-55 checksum for BSC, base58 public key for Solana) before any request.
 */
export function TokenLookupForm({ networks, onInspect, className }: TokenLookupFormProps) {
  const { t } = useTranslation("explore");
  const [network, setNetwork] = useState<NetworkId | undefined>(networks[0]);
  const [address, setAddress] = useState("");

  // Fields are controlled so React's post-action form reset never wipes a rejected address.
  const [failure, setFailure] = useState<LookupFailure | null>(null);

  const inspect = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const submittedNetwork = networks.find((id) => id === formData.get("network"));
    const submittedAddress = formData.get("address");
    const trimmed = typeof submittedAddress === "string" ? submittedAddress.trim() : "";
    if (!submittedNetwork) {
      return;
    }
    if (trimmed === "") {
      setFailure({ network: submittedNetwork, address: trimmed, message: t("lookup.required") });
      return;
    }
    const { family, label } = NETWORKS[submittedNetwork];
    if (!isAddressForFamily(family, trimmed)) {
      setFailure({ network: submittedNetwork, address: trimmed, message: t("lookup.invalid", { network: label }) });
      return;
    }
    setFailure(null);
    onInspect(submittedNetwork, normalizeAddress(family, trimmed));
  };

  // Hide the message as soon as the user edits, so a corrected address is not marked invalid.
  const error = failure && failure.network === network && failure.address === address.trim() ? failure.message : null;

  if (!network) {
    return null;
  }

  const family = NETWORKS[network].family;
  const errorId = "lookup-address-error";

  return (
    <section id="inspect" aria-labelledby="lookup-title" className={cn("scroll-mt-24 rounded-xl border border-line bg-surface p-5", className)}>
      <h2 id="lookup-title" className="flex items-center gap-2 font-medium">
        <ScanSearch className="size-4 text-accent-ink" aria-hidden="true" />
        {t("lookup.title")}
      </h2>
      <p className="mt-1 text-sm text-pretty text-fg-muted">{t("lookup.body")}</p>

      <form onSubmit={inspect} noValidate className="mt-4 flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="lookup-network" className="text-xs text-fg-muted">
            {t("lookup.network")}
          </label>
          <div className="relative">
            <select
              id="lookup-network"
              name="network"
              value={network}
              onChange={(event) => {
                setNetwork(networks.find((id) => id === event.target.value) ?? network);
              }}
              className="h-10 w-full appearance-none rounded-lg border border-line-strong bg-surface pr-9 pl-3 text-sm"
            >
              {networks.map((id) => (
                <option key={id} value={id}>
                  {NETWORKS[id].label}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="lookup-address" className="text-xs text-fg-muted">
            {t("lookup.address")}
          </label>
          <input
            id="lookup-address"
            name="address"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
            }}
            placeholder={t(`lookup.placeholder.${family}`)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="h-10 w-full rounded-lg border border-line-strong bg-surface px-3 font-mono text-sm placeholder:font-sans placeholder:text-fg-subtle aria-invalid:border-danger"
          />
          {error ? (
            <p id={errorId} role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
        </div>

        <Button type="submit" variant="primary" className="w-full">
          {t("lookup.submit")}
        </Button>
      </form>
    </section>
  );
}
