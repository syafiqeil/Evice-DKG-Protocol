// backend/publish-assets.js
require('dotenv').config();
const DKG = require('dkg.js');

// Konfigurasi DKG Client
const dkgOptions = {
    endpoint: process.env.OT_NODE_ENDPOINT || 'http://localhost', 
    port: process.env.OT_NODE_PORT || 8900,
    useSSL: false, 
    loglevel: 'error', // Kurangi noise log
    blockchain: {
        name: 'otp:20430', 
        publicKey: process.env.EVM_PUBLIC_KEY || '0x0000000000000000000000000000000000000000',
        privateKey: process.env.EVM_PRIVATE_KEY || '0x0000000000000000000000000000000000000000', 
    },
    maxNumberOfRetries: 3, // Jangan retry terlalu lama jika error
    frequency: 1,
    contentType: 'all',
};

const dkg = new DKG(dkgOptions);

async function publishData(type, contentData) {
    console.log(`🚀 Publishing ${type} to DKG...`);
    
    const asset = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": `Evice Protocol: ${type}`,
        "text": contentData,
        "author": { "@type": "Organization", "name": "Evice Labs" },
        "datePublished": new Date().toISOString()
    };

    try {
        // Coba Create Asset di DKG
        const result = await dkg.asset.create(
            { public: asset },
            { keywords: ['Evice', 'x402', type], epochsNum: 5 }
        );
        
        if (result.UAL) {
            console.log(`✅ ${type} Published to Real DKG!`);
            return result.UAL;
        }
        throw new Error("UAL undefined");
        
    } catch (error) {
        // FALLBACK KE MOCK MODE
        const isConnRefused = error.message.includes("ECONNREFUSED") || error.message.includes("connect");
        
        if (isConnRefused) {
            console.warn(`⚠️ Node DKG tidak terdeteksi (Port 8900). Menggunakan MOCK UAL untuk demo.`);
            // Return format mock khusus yang akan dikenali server.js
            return `mock:did:dkg:otp:20430/${type.toLowerCase()}`; 
        }
        
        console.error(`❌ Gagal publish ${type}:`, error.message);
        return null;
    }
}

(async () => {
    const tokenomicsText = "Tokenomics: 50% Community, 30% Team, 20% Foundation. Vesting 4 years.";
    const roadmapText = "Roadmap: Q1 DKG Integration, Q2 Mainnet Launch, Q3 AI Agents Swarm.";

    // Publish Tokenomics
    const ual1 = await publishData("Tokenomics", tokenomicsText);
    
    // Publish Roadmap
    const ual2 = await publishData("Roadmap", roadmapText);

    console.log("\n🎉 SIMPAN KODE UAL INI UNTUK FILE .ENV BACKEND ANDA:");
    console.log("---------------------------------------------------");
    console.log(`TOKENOMICS_UAL="${ual1}"`);
    console.log(`ROADMAP_UAL="${ual2}"`);
    console.log("---------------------------------------------------");
})();