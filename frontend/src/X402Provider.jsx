// frontend/src/X402Provider.jsx

import React, {
  createContext,
  useContext,
  useCallback,
  useState,
  useEffect
} from "react";
import { ethers } from "ethers";

export const X402Context = createContext(null);

/**
 * Helper untuk mendeteksi error dari wallet (misal: user reject transaction)
 */
const isWalletError = (error) => {
  // Kode 4001 adalah standar EIP-1193 untuk User Rejected Request
  if (error?.code === 4001 || error?.code === "ACTION_REJECTED") {
    return true;
  }
  return false;
};

export function X402Provider({ children }) {
  const [account, setAccount] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);

  // URL Backend
  const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

  // Inisialisasi Provider (Metamask) saat load
  useEffect(() => {
    if (window.ethereum) {
      const _provider = new ethers.BrowserProvider(window.ethereum);
      setProvider(_provider);
      
      // Cek apakah sudah connect sebelumnya
      _provider.listAccounts().then((accounts) => {
        if (accounts.length > 0) {
          setAccount(accounts[0].address);
          _provider.getSigner().then((s) => setSigner(s));
        }
      });

      // Listener perubahan akun
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          _provider.getSigner().then((s) => setSigner(s));
        } else {
          setAccount(null);
          setSigner(null);
        }
      });
    }
  }, []);

  // Fungsi Connect Wallet Manual
  const connectWallet = useCallback(async () => {
    if (!provider) {
      alert("Metamask/EVM Wallet tidak ditemukan!");
      return;
    }
    try {
      const accounts = await provider.send("eth_requestAccounts", []);
      setAccount(accounts[0]);
      const _signer = await provider.getSigner();
      setSigner(_signer);
      return accounts[0];
    } catch (error) {
      console.error("Gagal connect wallet:", error);
      throw error;
    }
  }, [provider]);

  /**
   * Eksekusi Pembayaran On-Chain (EVM)
   * Mengirim Native Token (NEURO/OTP) dengan Memo (Reference) di data field.
   */
  const executePayment = useCallback(
    async (invoice, memo) => {
      if (!signer) {
        // Coba connect otomatis jika belum
        await connectWallet();
      }

      console.log("💸 Memproses pembayaran EVM untuk invoice:", invoice);
      console.log("📝 Memo/Reference:", memo);

      try {
        // 1. Encode Memo ke Hex (untuk dimasukkan ke data transaksi)
        const memoHex = ethers.hexlify(ethers.toUtf8Bytes(memo));

        // 2. Siapkan Parameter Transaksi
        const txParams = {
          to: invoice.recipientWallet || invoice.recipient, // Handle format invoice yang fleksibel
          // Asumsi amount dalam unit ether/main unit, konversi ke Wei
          value: ethers.parseEther(invoice.amount.toString()), 
          data: memoHex, // PENTING: Memo masuk di sini sebagai data payload
        };

        // 3. Kirim Transaksi
        console.log("Mengirim transaksi...", txParams);
        const txResponse = await signer.sendTransaction(txParams);
        
        console.log("Hash Transaksi:", txResponse.hash);
        
        // 4. Tunggu Konfirmasi (Opsional, tapi disarankan untuk UX)
        console.log("Menunggu konfirmasi blok...");
        await txResponse.wait(1); 
        
        console.log("✅ Transaksi terkonfirmasi!");
        return txResponse.hash; // Hash ini adalah "signature" untuk x402

      } catch (error) {
        console.error("Error executePayment:", error);
        throw error;
      }
    },
    [signer, connectWallet]
  );

  /**
   * Fetch Wrapper untuk Protokol x402
   * Otomatis menangani pembayaran jika menerima status 402.
   */
  const fetchWith402 = useCallback(
    async (url, options = {}) => {
      // Pastikan wallet terhubung untuk mendapatkan address
      let currentAccount = account;
      if (!currentAccount) {
         try {
           currentAccount = await connectWallet();
         } catch (e) {
           throw new Error("Wallet wajib terhubung untuk akses agen.");
         }
      }

      const headers = new Headers(options.headers || {});
      // Kirim Address EVM (bukan Pubkey Solana)
      headers.append("x402-Payer-Address", currentAccount);

      // 1. Request Pertama (Mungkin kena 402)
      const res = await fetch(url, { ...options, headers });

      if (res.ok) {
        console.log("Fetch berhasil (via Free Tier atau Budget)");
        return res.json();
      } 
      
      if (res.status === 402) {
        // 2. Handle Pembayaran
        const invoice = await res.json();
        console.log("⚠️ Diharuskan Membayar (402):", invoice);

        // Eksekusi pembayaran EVM
        const txHash = await executePayment(invoice, invoice.reference);

        // 3. Request Ulang dengan Bukti Bayar (Tx Hash)
        // Format Auth: "x402 <txHash>"
        const separator = url.includes("?") ? "&" : "?";
        const retryUrl = `${url}${separator}reference=${invoice.reference}`;
        
        const authHeaders = new Headers(options.headers || {});
        authHeaders.append("x402-Payer-Address", currentAccount);
        authHeaders.append("Authorization", `x402 ${txHash}`);

        const finalRes = await fetch(retryUrl, {
          ...options,
          headers: authHeaders,
        });

        if (!finalRes.ok) {
          const finalError = await finalRes.json();
          throw new Error(`Verifikasi gagal: ${finalError.error || "Unknown error"}`);
        }
        
        return finalRes.json();
      } else {
        const errorText = await res.text();
        throw new Error(`HTTP Error: ${res.status} ${res.statusText} - ${errorText}`);
      }
    },
    [account, connectWallet, executePayment]
  );

  /**
   * Fungsi Deposit Budget
   * Agar Agen bisa berjalan otomatis tanpa popup Metamask terus-menerus.
   */
  const depositBudget = useCallback(
    async (invoiceUrl, amount) => {
      if (!account) await connectWallet();

      let invoice;
      // Coba fetch URL untuk memancing 402 dan dapat format invoice yang benar
      const res402 = await fetch(invoiceUrl);
      
      if (res402.status !== 402) {
        // Fallback: ambil invoice dummy dari endpoint tools jika URL target tidak 402
        const toolsRes = await fetch(`${API_BASE}/api/agent-tools`);
        const tools = await toolsRes.json();
        if (!tools || tools.length === 0) throw new Error("Tidak ada tools untuk referensi deposit.");
        
        const fallbackRes = await fetch(`${API_BASE}${tools[0].endpoint}`);
        if (fallbackRes.status !== 402) throw new Error("Gagal inisialisasi invoice deposit.");
        invoice = await fallbackRes.json();
      } else {
        invoice = await res402.json();
      }

      // Modifikasi invoice untuk deposit (amount sesuai input user)
      const depositInvoice = { ...invoice, amount: amount };
      const depositReference = `DEPOSIT-${invoice.reference}`; // Prefix khusus agar server tahu

      // Bayar
      const txHash = await executePayment(depositInvoice, depositReference);

      // Konfirmasi ke Backend
      const confirmRes = await fetch(
        `${API_BASE}/api/confirm-budget-deposit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txHash, // Kirim Hash Transaksi
            reference: depositReference,
            payerAddress: account, // Kirim Alamat EVM
            amount: amount,
          }),
        }
      );

      if (!confirmRes.ok) {
        const confirmError = await confirmRes.json();
        throw new Error(`Konfirmasi deposit gagal: ${confirmError.error}`);
      }

      const confirmData = await confirmRes.json();
      console.log("🎉 Deposit berhasil dicatat:", confirmData);
      return confirmData;
    },
    [account, connectWallet, executePayment, API_BASE]
  );

  const value = {
    fetchWith402,
    depositBudget,
    connectWallet, // Expose fungsi connect
    account,       // Expose akun yang sedang aktif
    isWalletError,
    API_BASE
  };

  return <X402Context.Provider value={value}>{children}</X402Context.Provider>;
}