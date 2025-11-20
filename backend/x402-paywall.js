// backend/x402-paywall.js (VERSI NEUROWEB / EVM)

const { ethers } = require("ethers");
const { randomUUID } = require("crypto");
let kvClient = null;

// --- KONFIGURASI NEUROWEB (Testnet / Mainnet) ---
// NeuroWeb Testnet RPC
const RPC_URL = process.env.NEUROWEB_RPC || "https://lofar-testnet.origin-trail.network"; 
const provider = new ethers.JsonRpcProvider(RPC_URL);

// Fallback in-memory KV (Sama seperti sebelumnya)
global.__usedRefs = global.__usedRefs || new Set();
global.__userBudgets = global.__userBudgets || new Map();

async function getKvClient() {
  if (kvClient) return kvClient;
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    try {
      const { kv } = require("@vercel/kv");
      kvClient = kv;
      return kvClient;
    } catch (e) {
      console.warn("Gagal init Vercel KV, fallback ke memory");
      return null;
    }
  }
  return null;
}

const kv = {
  get: async (key) => {
    const client = await getKvClient();
    if (client) return client.get(key);
    return global.__userBudgets.get(key) || global.__usedRefs.has(key);
  },
  set: async (key, value, options) => {
    const client = await getKvClient();
    if (client) return client.set(key, value, options);
    if (key.startsWith("budget_")) global.__userBudgets.set(key, value);
    else global.__usedRefs.add(key);
  },
};

/**
 * VERIFIKASI TRANSAKSI EVM (NeuroWeb)
 * Memastikan tx hash valid, jumlah benar, dan data (memo) cocok.
 */
async function verifyTransaction(txHash, reference, requiredAmount, recipientAddress) {
  try {
    // 1. Ambil transaksi dari blockchain
    const tx = await provider.getTransaction(txHash);
    if (!tx) throw new Error("Transaksi tidak ditemukan di NeuroWeb.");

    // 2. Tunggu setidaknya 1 konfirmasi (opsional, tapi aman)
    // await tx.wait(1); 

    // 3. Verifikasi Penerima
    if (tx.to.toLowerCase() !== recipientAddress.toLowerCase()) {
      throw new Error(`Penerima salah. Harusnya: ${recipientAddress}, Diterima: ${tx.to}`);
    }

    // 4. Verifikasi Referensi (Memo di EVM dikirim via 'data' field dalam Hex)
    // Kita asumsikan reference dikirim sebagai HEX data
    const inputData = tx.data;
    const referenceHex = ethers.hexlify(ethers.toUtf8Bytes(reference));
    
    // Cek apakah data transaksi mengandung referensi kita
    if (!inputData.includes(referenceHex.replace('0x', ''))) {
       throw new Error("Referensi/Memo tidak cocok dalam data transaksi.");
    }

    // 5. Verifikasi Jumlah (Native Token OTP / NEURO)
    const valueInEther = ethers.formatEther(tx.value);
    
    // Izinkan toleransi kecil atau cek exact match
    if (parseFloat(valueInEther) < parseFloat(requiredAmount)) {
      throw new Error(`Jumlah kurang. Diterima: ${valueInEther}, Diminta: ${requiredAmount}`);
    }

    return {
      success: true,
      amountReceived: parseFloat(valueInEther),
      sender: tx.from
    };

  } catch (error) {
    console.error("Verifikasi Gagal:", error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Middleware Budget Paywall (Logic Sama, Adaptasi EVM)
 */
const budgetPaywall = ({ amount }) => async (req, res, next) => {
  const payerAddress = req.headers["x402-payer-address"]; // Ganti istilah Pubkey jadi Address
  if (!payerAddress) return next();

  try {
    const budgetKey = `budget_${payerAddress.toLowerCase()}`;
    const currentBudget = parseFloat((await kv.get(budgetKey)) || "0");

    if (currentBudget >= amount) {
      const newBudget = currentBudget - amount;
      console.log(`✅ Budget Used: ${payerAddress}. Sisa: ${newBudget}`);
      await kv.set(budgetKey, newBudget.toString());
      req.x402_payment_method = "budget";
      return next();
    }
    console.log(`⚠️ Budget Insufficient: ${payerAddress}`);
    return next();
  } catch (error) {
    console.error("Budget Error:", error);
    return next();
  }
};

/**
 * x402 Paywall (Fallback ke On-Chain Payment)
 */
function x402Paywall({ amount, recipientWallet }) {
  return async (req, res, next) => {
    if (req.x402_payment_method === "budget") return next();

    const authHeader = req.headers["authorization"];
    // Format header: "x402 <tx_hash>"
    const txHash = authHeader?.startsWith("x402 ") ? authHeader.split(" ")[1] : null;
    const reference = req.query.reference;

    if (txHash && reference) {
      const refKey = `ref_${reference}`;
      if (await kv.get(refKey)) {
        return res.status(401).json({ error: "Payment replay detected" });
      }

      const result = await verifyTransaction(txHash, reference, amount, recipientWallet);

      if (result.success) {
        await kv.set(refKey, "used", { ex: 3600 });
        req.x402_payment_method = "onetime_neuroweb";
        return next();
      } else {
        return res.status(402).json({ error: `Verifikasi gagal: ${result.error}` });
      }
    }

    // Generate Invoice 402 baru
    const newRef = randomUUID();
    res.status(402).json({
      protocol: "x402-neuroweb", // Ubah nama protokol biar keren
      recipient: recipientWallet,
      amount: amount,
      currency: "NEURO", // Atau OTP
      reference: newRef,
      instruction: "Send NEURO to recipient with reference as HEX data."
    });
  };
}

module.exports = { x402Paywall, budgetPaywall, verifyTransaction, kv, provider };