// backend/server.js 

require('dotenv').config();
const express = require("express");
const cors = require("cors");
const DKG = require('dkg.js');
const { ethers } = require("ethers");
const {
  x402Paywall,
  budgetPaywall,
  verifyTransaction,
  kv,
} = require("./x402-paywall");

const app = express();

app.use(cors({
  origin: '*',
  exposedHeaders: ['Content-Type', 'Authorization', 'x402-Payer-Address'], 
}));
app.use(express.json());

const CONFIG = {
  recipientWallet: process.env.MY_EVM_WALLET_ADDRESS, 
};

// --- KONFIGURASI DKG ---
const dkg = new DKG({
    endpoint: process.env.OT_NODE_ENDPOINT || 'http://localhost',
    port: 8900,
    useSSL: false,
    blockchain: {
        name: 'otp:20430',
        publicKey: process.env.EVM_PUBLIC_KEY,
        privateKey: process.env.EVM_PRIVATE_KEY, 
    },
    maxNumberOfRetries: 3,
    frequency: 2,
    contentType: 'all'
});

// --- DATABASE UAL ---
const KNOWLEDGE_ASSETS = {
  tokenomics: process.env.TOKENOMICS_UAL || "mock:did:dkg:otp:20430/tokenomics",
  roadmap: process.env.ROADMAP_UAL || "mock:did:dkg:otp:20430/roadmap",
};

// --- MOCK DATA STORE (Untuk Fallback jika Node Mati) ---
const MOCK_CONTENT = {
  "mock:did:dkg:otp:20430/tokenomics": "Tokenomics: 50% Community, 30% Team, 20% Foundation. Vesting 4 years. (Verified via Mock DKG)",
  "mock:did:dkg:otp:20430/roadmap": "Roadmap: Q1 DKG Integration, Q2 Mainnet Launch, Q3 AI Agents Swarm. (Verified via Mock DKG)"
};

const mcpTools = [
  {
    name: "get_tokenomics",
    description: "Retrieve verified tokenomics data",
    price_neuro: 0.005,
    endpoint: "/api/get-context?docId=tokenomics"
  },
  {
    name: "get_roadmap",
    description: "Retrieve verified project roadmap",
    price_neuro: 0.005,
    endpoint: "/api/get-context?docId=roadmap"
  }
];

app.get("/api/agent-tools", (req, res) => {
  const uiTools = mcpTools.map(t => ({
    id: t.name.replace("get_", ""), 
    description: t.description,
    endpoint: t.endpoint,
    cost: t.price_neuro
  }));
  res.json(uiTools);
});

app.get("/api/public", (req, res) => {
  res.json({ message: "Free data for you all!" });
});

// --- PREMIUM API (Protected by x402) ---
app.get(
  "/api/premium-data",
  budgetPaywall({ amount: 0.01, ...CONFIG }), 
  x402Paywall({ amount: 0.01, ...CONFIG }), 
  (req, res) => {
    res.json({
      message: "This is your premium data sir.",
      paymentMethod: req.x402_payment_method || "unknown",
      timestamp: new Date().toISOString(),
    });
  }
);

// --- MAIN HANDLER (x402 + DKG + MOCK FALLBACK) ---
app.get(
  "/api/get-context",
  budgetPaywall({ amount: 0.005, ...CONFIG }), 
  x402Paywall({ amount: 0.005, ...CONFIG }),   
  async (req, res) => {
    const docId = req.query.docId;
    const assetUAL = KNOWLEDGE_ASSETS[docId];

    if (!assetUAL) {
      return res.status(404).json({ error: "Asset UAL not defined for this topic." });
    }

    console.log(`🔍 Request for: ${docId} (UAL: ${assetUAL})`);

    // 1. Cek apakah ini Mock UAL?
    if (assetUAL.startsWith("mock:")) {
        console.log("⚠️ Serving MOCK data (DKG Node Bypass)");
        return res.json({
            context: MOCK_CONTENT[assetUAL] || "Mock data not found.",
            metadata: {
                source: "Evice Local Cache (Mock Mode)",
                ual: assetUAL,
                verifiability: "✅ Simulated Verification"
            },
            paymentMethod: req.x402_payment_method || "unknown",
        });
    }

    // 2. Jika UAL asli, ambil dari DKG Node
    try {
      console.log(`🔗 Connecting to DKG Node...`);
      const result = await dkg.asset.get(assetUAL);
      
      if (result && result.assertion && result.assertion.public) {
        res.json({
          context: result.assertion.public.text, 
          metadata: {
              source: "OriginTrail DKG (NeuroWeb)",
              ual: assetUAL,
              publisher: result.assertion.public.author?.name || "Anonymous",
              verifiability: "✅ Cryptographically Verified"
          },
          paymentMethod: req.x402_payment_method || "unknown",
        });
      } else {
        throw new Error("Asset found but empty.");
      }

    } catch (error) {
      console.error("DKG Fetch Error:", error.message);
      res.status(500).json({ 
          error: "Failed to fetch from DKG Node. Ensure node is running.",
          details: error.message
      });
    }
  }
);

// --- ENDPOINT DEPOSIT & BUDGET ---
app.get("/api/get-current-budget", async (req, res) => {
  const { payerAddress } = req.query;
  if (!payerAddress) return res.status(400).json({ error: "payerAddress required" });
  
  const budgetKey = `budget_${payerAddress.toLowerCase()}`;
  const currentBudget = (await kv.get(budgetKey)) || "0";
  res.json({ currentBudget: currentBudget });
});

app.post("/api/confirm-budget-deposit", async (req, res) => {
  try {
    const { txHash, reference, payerAddress, amount } = req.body;
    if (!txHash || !reference || !payerAddress || !amount) {
      return res.status(400).json({ error: "Incomplete data" });
    }

    const refKey = `ref_${reference}`;
    if (await kv.get(refKey)) return res.status(401).json({ error: "Tx already used" });

    // Verifikasi ke Blockchain (Tetap dilakukan walau DKG di-mock)
    const verification = await verifyTransaction(
      txHash, 
      reference, 
      amount, 
      CONFIG.recipientWallet
    );

    if (verification.success && verification.sender.toLowerCase() === payerAddress.toLowerCase()) {
      const budgetKey = `budget_${payerAddress.toLowerCase()}`;
      const currentBudget = parseFloat((await kv.get(budgetKey)) || "0");
      const newBudget = currentBudget + verification.amountReceived;

      await kv.set(budgetKey, newBudget.toString());
      await kv.set(refKey, "used", { ex: 3600 });

      console.log(`💰 Deposit Success: ${amount} from ${payerAddress}`);
      res.json({ success: true, newBudget });
    } else {
      res.status(400).json({ error: "Deposit verification failed", details: verification.error });
    }
  } catch (e) {
    console.error("Deposit Error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(3001, () => console.log("Evice Protocol (Mock/Hybrid Mode) running on port 3001"));