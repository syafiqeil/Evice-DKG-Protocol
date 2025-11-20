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
  origin: '*', // Izinkan semua origin
  exposedHeaders: ['Content-Type', 'Authorization', 'x402-Payer-Address'], 
}));
app.use(express.json());

const CONFIG = {
  recipientWallet: process.env.MY_EVM_WALLET_ADDRESS, 
};

// --- KONFIGURASI DKG (OriginTrail) ---
const dkg = new DKG({
    endpoint: process.env.OT_NODE_ENDPOINT || 'http://localhost',
    port: 8900,
    useSSL: false,
    blockchain: {
        name: 'otp:20430', // NeuroWeb Testnet
        publicKey: process.env.EVM_PUBLIC_KEY,
        privateKey: process.env.EVM_PRIVATE_KEY, 
    },
    maxNumberOfRetries: 3,
    frequency: 2,
    contentType: 'all'
});

// --- DATABASE UAL ---
// Pastikan UAL ini diisi setelah menjalankan publish-assets.js
const KNOWLEDGE_ASSETS = {
  tokenomics: process.env.TOKENOMICS_UAL || "did:dkg:otp:2043/0xPLACEHOLDER1",
  roadmap: process.env.ROADMAP_UAL || "did:dkg:otp:2043/0xPLACEHOLDER2",
};

// --- MCP (Model Context Protocol) DEFINITIONS ---
const mcpTools = [
  {
    name: "get_tokenomics",
    description: "Retrieve verified tokenomics data from OriginTrail DKG",
    parameters: { type: "object", properties: {} },
    price_neuro: 0.005,
    endpoint: "/api/get-context?docId=tokenomics"
  },
  {
    name: "get_roadmap",
    description: "Retrieve verified project roadmap from OriginTrail DKG",
    parameters: { type: "object", properties: {} },
    price_neuro: 0.005,
    endpoint: "/api/get-context?docId=roadmap"
  },
  {
    name: "get_premium_sample",
    description: "Retrieve a sample premium data payload",
    parameters: { type: "object", properties: {} },
    price_neuro: 0.01,
    endpoint: "/api/premium-data"
  }
];

// 1. Endpoint MCP Discovery (Standar Baru)
app.get("/api/mcp/tools", (req, res) => {
  res.json({
    jsonrpc: "2.0",
    result: {
      tools: mcpTools
    }
  });
});

// 2. Endpoint Legacy untuk Frontend React (Mapping dari MCP)
app.get("/api/agent-tools", (req, res) => {
  const uiTools = mcpTools.map(t => ({
    id: t.name.replace("get_", "").replace("_sample", ""), // formatting ID biar rapi di UI
    description: t.description,
    endpoint: t.endpoint,
    cost: t.price_neuro
  }));
  res.json(uiTools);
});

// --- API PUBLIK ---
app.get("/api/public", (req, res) => {
  res.json({ message: "Free data for you all!" });
});

// --- API PREMIUM (DILINDUNGI) ---

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

// Main Handler (x402 + DKG)
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

    console.log(`🔍 Verifying & Fetching from DKG: ${assetUAL}`);

    try {
      const result = await dkg.asset.get(assetUAL);
      
      if (result && result.assertion && result.assertion.public) {
        const verifiedData = result.assertion.public;
        
        res.json({
          context: verifiedData.text, 
          metadata: {
              source: "OriginTrail DKG (NeuroWeb)",
              ual: assetUAL,
              publisher: verifiedData.author?.name || "Anonymous",
              verifiability: "✅ Cryptographically Verified"
          },
          paymentMethod: req.x402_payment_method || "unknown",
        });
      } else {
        throw new Error("Asset found but data is empty/private.");
      }

    } catch (error) {
      console.error("DKG Fetch Error:", error);
      res.status(500).json({ 
          error: "Failed to fetch verified data from DKG.",
          details: error.message
      });
    }
  }
);

// Helper: Cek Budget (Digunakan Frontend untuk UI)
app.get("/api/get-current-budget", async (req, res) => {
  const { payerAddress } = req.query; // Ubah parameter query jadi payerAddress
  if (!payerAddress) {
    return res.status(400).json({ error: "payerAddress is required" });
  }
  try {
    const budgetKey = `budget_${payerAddress.toLowerCase()}`;
    const currentBudget = (await kv.get(budgetKey)) || "0";
    res.json({ currentBudget: currentBudget });
  } catch (e) {
    console.error("Error fetching budget:", e);
    res.status(500).json({ error: "Failed to fetch current budget" });
  }
});

// --- ENDPOINT DEPOSIT (EVM) ---
app.post("/api/confirm-budget-deposit", async (req, res) => {
  try {
    const { txHash, reference, payerAddress, amount } = req.body;

    if (!txHash || !reference || !payerAddress || !amount) {
      return res.status(400).json({ error: "Data tidak lengkap (txHash, reference, payerAddress, amount)" });
    }

    // Cek replay attack
    const refKey = `ref_${reference}`;
    if (await kv.get(refKey)) return res.status(401).json({ error: "Tx already used" });

    // Verifikasi Transaksi di NeuroWeb
    const verification = await verifyTransaction(
      txHash, 
      reference, 
      amount, 
      CONFIG.recipientWallet
    );

    if (verification.success && verification.sender.toLowerCase() === payerAddress.toLowerCase()) {
      // Update Budget
      const budgetKey = `budget_${payerAddress.toLowerCase()}`;
      const currentBudget = parseFloat((await kv.get(budgetKey)) || "0");
      const newBudget = currentBudget + verification.amountReceived;

      await kv.set(budgetKey, newBudget.toString());
      await kv.set(refKey, "used", { ex: 3600 });

      console.log(`💰 Deposit Success: ${amount} NEURO from ${payerAddress}`);
      res.json({ success: true, newBudget });
    } else {
      res.status(400).json({ error: "Verifikasi deposit gagal", details: verification.error });
    }
  } catch (e) {
    console.error("Deposit Error:", e);
    res.status(500).json({ error: e.message });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(3001, () => console.log("Evice DKG Protocol running on port 3001"));
module.exports = app;