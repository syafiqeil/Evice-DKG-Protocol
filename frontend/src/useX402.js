// frontend/src/useX402.js

import { useContext } from "react";
import { X402Context } from "./X402Provider.jsx"; 

export const useX402 = () => {
  const context = useContext(X402Context);
  if (!context) {
    throw new Error("useX402 harus digunakan di dalam X402Provider");
  }
  return context;
};