// frontend/src/X402Provider.jsx

import React, { createContext, useCallback } from "react";
import { useAccount, useSendTransaction } from "wagmi";
import { parseEther, stringToHex } from "viem";

export const X402Context = createContext(null);

const isWalletError = (error) => {
  // Cek error umum wallet rejection
  return error?.message?.includes("User rejected") || error?.code === 4001;
};

export function X402Provider({ children }) {
  const { address, isConnected } = useAccount();
  const { sendTransactionAsync } = useSendTransaction();
  
  // URL Backend
  const API_BASE = (import.meta.env.VITE_API_URL || "http://localhost:3001").replace(/\/$/, "");

  const executePayment = useCallback(
    async (invoice, memo) => {
      if (!isConnected || !address) {
        throw new Error("Wallet tidak terhubung. Silakan connect wallet di pojok kanan atas.");
      }

      console.log("💸 Memproses pembayaran EVM...", invoice);

      try {
        // Kirim Transaksi menggunakan Hooks Wagmi
        const hash = await sendTransactionAsync({
          to: invoice.recipientWallet || invoice.recipient,
          value: parseEther(invoice.amount.toString()),
          data: stringToHex(memo), // Encode memo ke Hex
        });

        console.log("Hash Transaksi:", hash);
        // Kita kembalikan hash agar bisa diverifikasi backend
        return hash;

      } catch (error) {
        console.error("Error executePayment:", error);
        throw error;
      }
    },
    [address, isConnected, sendTransactionAsync]
  );

  const fetchWith402 = useCallback(
    async (url, options = {}) => {
      const headers = new Headers(options.headers || {});
      if (address) {
        headers.append("x402-Payer-Address", address);
      }

      // 1. Request Pertama
      const res = await fetch(url, { ...options, headers });

      if (res.ok) {
        return res.json();
      }

      if (res.status === 402) {
        if (!address) throw new Error("Wallet wajib terhubung untuk melakukan pembayaran.");

        const invoice = await res.json();
        console.log("⚠️ 402 Payment Required:", invoice);

        // Bayar
        const txHash = await executePayment(invoice, invoice.reference);

        // 2. Request Ulang dengan Bukti Bayar
        const separator = url.includes("?") ? "&" : "?";
        const retryUrl = `${url}${separator}reference=${invoice.reference}`;

        const authHeaders = new Headers(options.headers || {});
        authHeaders.append("x402-Payer-Address", address);
        authHeaders.append("Authorization", `x402 ${txHash}`);

        const finalRes = await fetch(retryUrl, { ...options, headers: authHeaders });
        
        if (!finalRes.ok) {
          const finalError = await finalRes.json();
          throw new Error(`Verifikasi gagal: ${finalError.error || "Unknown"}`);
        }
        
        return finalRes.json();
      } else {
        const errorText = await res.text();
        throw new Error(`HTTP Error: ${res.status} ${res.statusText}`);
      }
    },
    [address, executePayment]
  );

  const depositBudget = useCallback(
    async (invoiceUrl, amount) => {
      if (!address) throw new Error("Wallet belum terhubung");

      let invoice;
      const res402 = await fetch(invoiceUrl);
      if (res402.status !== 402) {
        const toolsRes = await fetch(`${API_BASE}/api/agent-tools`);
        const tools = await toolsRes.json();
        if(!tools || tools.length === 0) throw new Error("No tools available for deposit ref");
        
        const fallbackRes = await fetch(`${API_BASE}${tools[0].endpoint}`);
        invoice = await fallbackRes.json();
      } else {
        invoice = await res402.json();
      }

      const depositInvoice = { ...invoice, amount: amount };
      const depositReference = `DEPOSIT-${invoice.reference}`;
      
      const txHash = await executePayment(depositInvoice, depositReference);

      const confirmRes = await fetch(
        `${API_BASE}/api/confirm-budget-deposit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txHash,
            reference: depositReference,
            payerAddress: address,
            amount: amount,
          }),
        }
      );

      if (!confirmRes.ok) {
         throw new Error("Konfirmasi deposit gagal (mungkin butuh waktu konfirmasi block)");
      }
      return confirmRes.json();
    },
    [address, executePayment, API_BASE]
  );

  const value = {
    fetchWith402,
    depositBudget,
    account: address,
    connectWallet: () => {}, // Dummy
    isWalletError,
    API_BASE
  };

  return <X402Context.Provider value={value}>{children}</X402Context.Provider>;
}