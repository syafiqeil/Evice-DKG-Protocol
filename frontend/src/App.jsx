// frontend/src/App.jsx
import React from "react";
import "@rainbow-me/rainbowkit/styles.css";

import {
  getDefaultConfig,
  RainbowKitProvider,
  ConnectButton,
} from "@rainbow-me/rainbowkit";
import { WagmiProvider, http } from "wagmi";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";

// Import komponen internal
import PremiumContent from "./PremiumContent.jsx";
import { AgentComponent } from "./AgentComponent.jsx";
import { X402Provider } from "./X402Provider.jsx";

// --- 1. Definisi NeuroWeb Testnet ---
const neuroWebTestnet = {
  id: 20430,
  name: "NeuroWeb Testnet",
  nativeCurrency: { name: "NEURO", symbol: "NEURO", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://lofar-testnet.origin-trail.network"] },
  },
  blockExplorers: {
    default: { name: "Subscan", url: "https://neuroweb-testnet.subscan.io" },
  },
  testnet: true,
};

// --- 2. Konfigurasi Wagmi + RainbowKit ---
const config = getDefaultConfig({
  appName: "Evice DKG Protocol",
  projectId: "YOUR_PROJECT_ID", // Opsional untuk dev
  chains: [neuroWebTestnet],
  transports: {
    [neuroWebTestnet.id]: http(),
  },
});

const queryClient = new QueryClient();

// --- 3. Layout Utama ---
function MainLayout() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <div className="container mx-auto p-4 lg:p-8">
        <header className="flex justify-between items-center gap-6 pb-4 mb-6 border-b border-gray-200">
          <h1 className="text-2xl lg:text-4xl font-bold text-indigo-900">
            Evice <span className="font-light text-gray-500">DKG Protocol</span>
          </h1>

          {/* Tombol Connect Wallet Keren dari RainbowKit */}
          <ConnectButton showBalance={false} accountStatus="address" chainStatus="icon" />
        </header>

        <div className="flex flex-col lg:flex-row lg:space-x-6 space-y-6 lg:space-y-0">
          <div className="w-full lg:w-1/3">
            <AgentComponent />
          </div>
          <div className="w-full lg:w-1/3">
            <PremiumContent />
          </div>
          <div className="w-full lg:w-1/3">
            <div className="h-full p-6 bg-gray-50 rounded-xl border border-gray-200 shadow-sm">
              <h2 className="text-xl font-bold mb-4 text-gray-800">
                Hackathon Architecture
              </h2>
              <p className="text-gray-600 text-sm leading-relaxed mb-4">
                This dApp demonstrates the <strong>Trust & Economic Layer</strong>{" "}
                for AI Agents on NeuroWeb using <strong>RainbowKit + Wagmi</strong>.
              </p>
              <ul className="list-disc list-inside text-gray-600 text-sm space-y-2 mb-6">
                <li>
                  <strong className="text-indigo-700">OriginTrail DKG:</strong>{" "}
                  Verifiable Knowledge Assets.
                </li>
                <li>
                  <strong className="text-indigo-700">NeuroWeb (EVM):</strong> Trust
                  layer for payments & verification.
                </li>
                <li>
                  <strong className="text-indigo-700">x402 Protocol:</strong>{" "}
                  Autonomous payment negotiation via HTTP 402.
                </li>
              </ul>
              <div className="bg-blue-50 p-3 rounded border border-blue-100 text-xs text-blue-800">
                <strong>Tip:</strong> Deposit a budget via the Agent to enable
                autonomous "One-Click" data purchasing without wallet popups.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- 4. App Wrapper ---
function App() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          <X402Provider>
            <MainLayout />
          </X402Provider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export default App;