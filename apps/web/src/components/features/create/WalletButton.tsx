import type { ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { WalletReadyState, type WalletName } from "@solana/wallet-adapter-base";
import { useWallet } from "@solana/wallet-adapter-react";
import { ChevronDown, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useConnect, useConnection, useDisconnect, useConnectors, useSwitchChain } from "wagmi";
import { type ChainFamily, type NetworkId, NETWORKS, getEvmNetwork, shortenAddress } from "@minthouse/shared";
import { Button, buttonStyles } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

type WalletButtonProps = {
  family: ChainFamily;
  network: NetworkId;
};

export function WalletButton({ family, network }: WalletButtonProps) {
  if (family === "bsc") {
    return <EvmWallet network={network} />;
  }
  return <SolanaWallet />;
}

function WalletDialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation("create");
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger className={buttonStyles({ variant: "secondary" })}>
        <Wallet className="size-4" aria-hidden="true" />
        {t("wallet.connect")}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-fg/30 dark:bg-black/60" />
        <Dialog.Popup className="fixed inset-x-4 top-1/2 z-50 flex max-h-[70dvh] -translate-y-1/2 flex-col gap-3 overflow-y-auto rounded-2xl border border-line bg-surface p-5 shadow-xl sm:inset-x-auto sm:left-1/2 sm:w-[min(24rem,calc(100vw-3rem))] sm:-translate-x-1/2">
          <Dialog.Title className="font-medium">{t("wallet.title")}</Dialog.Title>
          <Dialog.Description className="text-sm text-fg-muted">{t("wallet.body")}</Dialog.Description>
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function ConnectedAccount({ address, onDisconnect }: { address: string; onDisconnect: () => void }) {
  const { t } = useTranslation("create");
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-sunken px-3 py-2">
      <span className="min-w-0 truncate font-mono text-sm">{shortenAddress(address, 4)}</span>
      <Button variant="ghost" size="sm" onClick={onDisconnect}>
        {t("wallet.disconnect")}
      </Button>
    </div>
  );
}

function EvmWallet({ network }: { network: NetworkId }) {
  const { t } = useTranslation("create");
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const account = useConnection();
  const connectors = useConnectors();
  const { mutateAsync: connect, isPending } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const { mutateAsync: switchChain, isPending: switching } = useSwitchChain();
  const expectedChainId = getEvmNetwork(network).chainId;

  const choose = async (connector: (typeof connectors)[number]) => {
    setFailure(null);
    try {
      await connect({ connector, chainId: expectedChainId });
      setOpen(false);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : t("wallet.failed"));
    }
  };

  if (account.isConnected && account.address) {
    const mismatch = account.chainId !== expectedChainId;
    return (
      <div className="flex flex-col gap-2">
        <ConnectedAccount
          address={account.address}
          onDisconnect={() => {
            disconnect();
          }}
        />
        {mismatch ? (
          <Button
            variant="secondary"
            disabled={switching}
            onClick={() => {
              void switchChain({ chainId: expectedChainId }).catch((error: unknown) => {
                setFailure(error instanceof Error ? error.message : t("wallet.failed"));
              });
            }}
          >
            {t("wallet.switch", { network: NETWORKS[network].label })}
          </Button>
        ) : null}
        {failure ? (
          <p role="alert" className="text-xs text-danger">
            {failure}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <WalletDialog open={open} onOpenChange={setOpen}>
        <ul className="flex flex-col gap-2">
          {connectors.map((connector) => (
            <li key={connector.uid}>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  void choose(connector);
                }}
                className="flex h-11 w-full items-center gap-3 rounded-lg border border-line px-3 text-left text-sm hover:bg-sunken disabled:opacity-50"
              >
                {connector.icon ? <img src={connector.icon} alt="" className="size-5" /> : <Wallet className="size-4 text-fg-subtle" aria-hidden="true" />}
                {connector.name}
              </button>
            </li>
          ))}
        </ul>
        {failure ? (
          <p role="alert" className="text-xs text-danger">
            {failure}
          </p>
        ) : null}
      </WalletDialog>
    </div>
  );
}

function SolanaWallet() {
  const { t } = useTranslation("create");
  const [open, setOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const solana = useWallet();
  const pending = useRef<WalletName | null>(null);

  useEffect(() => {
    if (!pending.current || !solana.wallet || solana.wallet.adapter.name !== pending.current || solana.connected || solana.connecting) {
      return;
    }
    pending.current = null;
    void solana.connect().catch((error: unknown) => {
      setFailure(error instanceof Error ? error.message : t("wallet.failed"));
    });
  }, [solana, t]);

  const choose = (name: WalletName) => {
    setFailure(null);
    setOpen(false);
    if (solana.wallet?.adapter.name === name) {
      void solana.connect().catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : t("wallet.failed"));
      });
      return;
    }
    pending.current = name;
    solana.select(name);
  };

  if (solana.connected && solana.publicKey) {
    const address = solana.publicKey.toBase58();
    return (
      <ConnectedAccount
        address={address}
        onDisconnect={() => {
          void solana.disconnect();
        }}
      />
    );
  }

  const ordered = [...solana.wallets].sort((left, right) => rank(right.readyState) - rank(left.readyState));

  return (
    <div className="flex flex-col gap-2">
      <WalletDialog open={open} onOpenChange={setOpen}>
        {ordered.length === 0 ? <p className="text-sm text-fg-muted">{t("wallet.empty")}</p> : null}
        <ul className="flex flex-col gap-2">
          {ordered.map(({ adapter, readyState }) => (
            <li key={adapter.name}>
              <button
                type="button"
                onClick={() => {
                  choose(adapter.name);
                }}
                className="flex h-11 w-full items-center gap-3 rounded-lg border border-line px-3 text-left text-sm hover:bg-sunken"
              >
                {adapter.icon ? <img src={adapter.icon} alt="" className="size-5" /> : <Wallet className="size-4 text-fg-subtle" aria-hidden="true" />}
                <span className="flex-1">{adapter.name}</span>
                {readyState === WalletReadyState.NotDetected ? <span className="text-xs text-fg-subtle">{t("wallet.install")}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </WalletDialog>
      {failure ? (
        <p role="alert" className="text-xs text-danger">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

function rank(state: WalletReadyState): number {
  switch (state) {
    case WalletReadyState.Installed:
      return 2;
    case WalletReadyState.Loadable:
      return 1;
    case WalletReadyState.NotDetected:
    case WalletReadyState.Unsupported:
      return 0;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export function NetworkSelect({
  id,
  networks,
  value,
  onChange,
}: {
  id: string;
  networks: readonly NetworkId[];
  value: NetworkId;
  onChange: (network: NetworkId) => void;
}) {
  return (
    <div className="relative">
      <select
        id={id}
        value={value}
        onChange={(event) => {
          const next = networks.find((network) => network === event.target.value);
          if (next) {
            onChange(next);
          }
        }}
        className={cn(selectClass)}
      >
        {networks.map((network) => (
          <option key={network} value={network}>
            {NETWORKS[network].label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
    </div>
  );
}

const selectClass = "h-10 w-full appearance-none rounded-lg border border-line-strong bg-surface pr-9 pl-3 text-sm";
